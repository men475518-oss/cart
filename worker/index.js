// もふもふカート オンライン対戦サーバー（Cloudflare Workers + Durable Objects 版）
//
// GitHub Pages のような静的ホスティングでは WebSocket サーバーを動かせないため、
// 中継サーバーだけを Cloudflare Workers に置く。無料プランで WebSocket が使える。
//
// デプロイ:  npx wrangler deploy
// ローカル:  npx wrangler dev            (→ ws://127.0.0.1:8787)
//
// クライアント側の通信プロトコルは Node 版（server/index.js）と完全に同じなので、
// ゲームの「サーバー設定」に https://<name>.<subdomain>.workers.dev を入れるだけで動く。

import {
  MAX_PLAYERS,
  CASUAL_WAIT_MS,
  CASUAL_MIN,
  COURSE_IDS,
  computeResults,
  deserializeRoom,
  generateCode,
  humanPlayers,
  makeRoom,
  mayActAs,
  resetToLobby,
  resultDeadlineFor,
  roomView,
  sanitizeChar,
  sanitizeKart,
  sanitizeLaps,
  sanitizeName,
  serializeRoom,
  startRace,
} from '../server/rooms.js';

const CASUAL_TICK_MS = 1000;
const MAX_MESSAGE_BYTES = 16 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/health') {
      const id = env.RACE_HUB.idFromName('hub');
      return env.RACE_HUB.get(id).fetch(new Request('https://hub/health'));
    }

    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      // すべての部屋を 1 つの Durable Object が持つ。友達同士で遊ぶ規模なら十分で、
      // 部屋コードでの合流やカジュアルマッチの待ち行列を単純に実装できる。
      const id = env.RACE_HUB.idFromName('hub');
      return env.RACE_HUB.get(id).fetch(request);
    }

    return new Response(
      'もふもふカート オンライン対戦サーバー（Cloudflare Workers）\n' +
        'ゲームの「サーバー設定」にこのページの URL を入力してください。\n',
      { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS } }
    );
  },
};

export class RaceHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.rooms = new Map(); // code -> room
    this.queue = []; // カジュアルマッチ待機中の clientId
    this.loaded = false;
    this.nextId = 1;
  }

  // ---------- 永続化 ----------
  // ハイバネーションで復帰したときにも部屋の状態を復元できるようにする。
  async load() {
    if (this.loaded) return;
    this.loaded = true;
    const saved = await this.state.storage.get(['rooms', 'queue', 'nextId']);
    for (const data of saved.get('rooms') || []) {
      const room = deserializeRoom(data);
      this.rooms.set(room.code, room);
    }
    this.queue = saved.get('queue') || [];
    this.nextId = saved.get('nextId') || 1;
    // 接続が全部切れている部屋は破棄する
    const live = new Set(this.sockets().map((ws) => this.meta(ws).id));
    for (const [code, room] of [...this.rooms]) {
      const anyone = humanPlayers(room).some((p) => live.has(p.id)) || [...room.spectators].some((s) => live.has(s));
      if (!anyone) this.rooms.delete(code);
    }
    this.queue = this.queue.filter((id) => live.has(id));
  }

  async save() {
    await this.state.storage.put({
      rooms: [...this.rooms.values()].map(serializeRoom),
      queue: this.queue,
      nextId: this.nextId,
    });
    await this.scheduleAlarm();
  }

  // ---------- WebSocket の付帯情報 ----------
  sockets() {
    return this.state.getWebSockets();
  }
  meta(ws) {
    return ws.deserializeAttachment() || {};
  }
  setMeta(ws, patch) {
    const next = { ...this.meta(ws), ...patch };
    ws.serializeAttachment(next);
    return next;
  }
  socketOf(clientId) {
    for (const ws of this.sockets()) if (this.meta(ws).id === clientId) return ws;
    return null;
  }

  send(target, obj) {
    const ws = typeof target === 'string' ? this.socketOf(target) : target;
    if (!ws) return;
    try {
      ws.send(JSON.stringify(obj));
    } catch (e) {
      /* 切断済み */
    }
  }

  broadcast(room, obj, exceptId = null) {
    const data = JSON.stringify(obj);
    const ids = new Set([...humanPlayers(room).map((p) => p.id), ...room.spectators]);
    for (const ws of this.sockets()) {
      const m = this.meta(ws);
      if (!ids.has(m.id) || m.id === exceptId) continue;
      try {
        ws.send(data);
      } catch (e) {
        /* 切断済み */
      }
    }
  }

  pushRoom(room) {
    this.broadcast(room, { t: 'room', room: roomView(room) });
  }

  // ---------- 接続 ----------
  async fetch(request) {
    await this.load();
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({ ok: true, rooms: this.rooms.size, clients: this.sockets().length, queue: this.queue.length }),
        { headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // ハイバネーション対応の受け入れ。アイドル中は課金対象の実行時間を消費しない。
    this.state.acceptWebSocket(server);
    const id = `p${this.nextId++}`;
    this.setMeta(server, { id, name: '', room: null, spectator: false });
    await this.state.storage.put('nextId', this.nextId);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    await this.load();
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    try {
      await this.handle(ws, msg);
    } catch (e) {
      console.error('handle error', msg.t, e && e.stack);
    }
  }

  async webSocketClose(ws) {
    await this.load();
    await this.leaveAll(ws);
  }

  async webSocketError(ws) {
    await this.load();
    await this.leaveAll(ws);
  }

  // ---------- メッセージ処理 ----------
  async handle(ws, msg) {
    const m = this.meta(ws);
    const room = m.room ? this.rooms.get(m.room) : null;

    switch (msg.t) {
      case 'hello': {
        const name = sanitizeName(msg.name, `プレイヤー${m.id.slice(1)}`);
        this.setMeta(ws, { name });
        this.send(ws, { t: 'welcome', id: m.id, version: 1 });
        return;
      }
      case 'ping':
        this.send(ws, { t: 'pong', ts: msg.ts, now: Date.now() });
        return;

      case 'create': {
        const code = generateCode((c) => this.rooms.has(c));
        const r = makeRoom(code, 'private');
        this.rooms.set(code, r);
        await this.joinRoom(ws, r, this.profileOf(ws, msg));
        return;
      }

      case 'join': {
        const r = this.rooms.get(String(msg.code || '').toUpperCase());
        if (!r) return this.send(ws, { t: 'error', msg: 'その部屋は見つかりません', code: 'notfound' });
        if (humanPlayers(r).length >= MAX_PLAYERS) return this.send(ws, { t: 'error', msg: '部屋が満員です', code: 'full' });
        if (r.status === 'racing')
          return this.send(ws, { t: 'error', msg: 'レース中です。観戦モードで参加できます', code: 'racing' });
        await this.joinRoom(ws, r, this.profileOf(ws, msg));
        return;
      }

      case 'casual': {
        await this.leaveAll(ws);
        this.profileOf(ws, msg);
        this.setMeta(ws, { queuedAt: Date.now() });
        if (!this.queue.includes(m.id)) this.queue.push(m.id);
        this.send(ws, { t: 'queue', waiting: this.queue.length, seconds: Math.ceil(CASUAL_WAIT_MS / 1000) });
        await this.save();
        return;
      }

      case 'spectate': {
        const r = this.rooms.get(String(msg.code || '').toUpperCase());
        if (!r) return this.send(ws, { t: 'error', msg: 'その部屋は見つかりません', code: 'notfound' });
        await this.leaveAll(ws);
        r.spectators.add(m.id);
        this.setMeta(ws, { room: r.code, spectator: true });
        this.send(ws, { t: 'room', room: roomView(r), spectating: true });
        this.pushRoom(r);
        await this.save();
        return;
      }

      case 'leave':
        await this.leaveAll(ws);
        return;

      case 'ready': {
        const p = room?.players.get(m.id);
        if (!p) return;
        p.ready = !!msg.ready;
        this.pushRoom(room);
        await this.save();
        return;
      }

      case 'update': {
        const p = room?.players.get(m.id);
        if (!p) return;
        Object.assign(p, this.profileOf(ws, { ...msg, name: msg.name || p.name }));
        this.pushRoom(room);
        await this.save();
        return;
      }

      case 'setCourse': {
        if (!room || room.hostId !== m.id) return;
        if (COURSE_IDS.includes(msg.course)) room.course = msg.course;
        if (msg.laps) room.laps = sanitizeLaps(msg.laps, room.laps);
        this.pushRoom(room);
        await this.save();
        return;
      }

      case 'start': {
        if (!room || room.hostId !== m.id || room.status !== 'lobby') return;
        const startMsg = startRace(room, { course: msg.course, laps: msg.laps, cpuCount: msg.cpuCount });
        this.broadcast(room, startMsg);
        await this.save();
        return;
      }

      case 'state': {
        if (!room || room.status !== 'racing') return;
        const id = String(msg.id || m.id);
        if (!mayActAs(room, m.id, id)) return;
        const owner = room.players.get(id);
        if (msg.s && typeof msg.s.tp === 'number') owner.progress = msg.s.tp;
        // 走行データは毎秒 15 回流れるので、ここでは保存せず中継だけする
        this.broadcast(room, { t: 'state', id, s: msg.s }, m.id);
        return;
      }

      case 'event': {
        if (!room || !msg.e || typeof msg.e !== 'object') return;
        const e = msg.e;
        if (e.k === 'finish') {
          const id = String(e.id || m.id);
          if (mayActAs(room, m.id, id) && !room.finish.has(id)) {
            const time = Number(e.time);
            room.finish.set(id, Number.isFinite(time) ? time : (Date.now() - room.raceStartedAt) / 1000);
            await this.afterFinish(room);
          }
        }
        this.broadcast(room, { t: 'event', id: m.id, e }, m.id);
        return;
      }

      case 'chat': {
        if (!room) return;
        const text = String(msg.msg || '').slice(0, 80);
        if (text) this.broadcast(room, { t: 'chat', id: m.id, name: this.meta(ws).name, msg: text });
        return;
      }

      default:
        return;
    }
  }

  profileOf(ws, msg) {
    const m = this.meta(ws);
    const profile = {
      name: sanitizeName(msg.name, m.name || `プレイヤー${m.id.slice(1)}`),
      char: sanitizeChar(msg.char),
      kart: sanitizeKart(msg.kart),
    };
    this.setMeta(ws, { name: profile.name, profile });
    return profile;
  }

  async joinRoom(ws, room, profile) {
    await this.leaveAll(ws);
    const m = this.meta(ws);
    room.players.set(m.id, { id: m.id, ...profile, ready: false, cpu: false, progress: 0 });
    if (!room.hostId) room.hostId = m.id;
    this.setMeta(ws, { room: room.code, spectator: false });
    this.pushRoom(room);
    await this.save();
  }

  async leaveAll(ws) {
    const m = this.meta(ws);
    const qi = this.queue.indexOf(m.id);
    if (qi >= 0) this.queue.splice(qi, 1);
    const room = m.room ? this.rooms.get(m.room) : null;
    this.setMeta(ws, { room: null, spectator: false });
    if (!room) {
      await this.save();
      return;
    }
    room.spectators.delete(m.id);
    if (room.players.has(m.id)) {
      room.players.delete(m.id);
      this.broadcast(room, { t: 'left', id: m.id });
      if (room.hostId === m.id) {
        // ホストが抜けたら、ホストが動かしていた CPU も退場する
        for (const [id, p] of [...room.players]) {
          if (p.cpu) {
            room.players.delete(id);
            this.broadcast(room, { t: 'left', id });
          }
        }
        const next = humanPlayers(room)[0];
        room.hostId = next ? next.id : null;
      }
    }
    if (humanPlayers(room).length === 0) {
      this.rooms.delete(room.code);
      for (const sid of room.spectators) this.send(sid, { t: 'error', msg: '部屋が閉じられました', code: 'closed' });
    } else {
      if (room.status === 'racing') await this.afterFinish(room);
      this.pushRoom(room);
    }
    await this.save();
  }

  /** 誰かがゴールした / 抜けたあとに、結果確定の締め切りを更新する */
  async afterFinish(room) {
    const deadline = resultDeadlineFor(room);
    if (deadline === -1) {
      this.finishRace(room);
      return;
    }
    if (deadline > 0 && !room.resultDeadline) room.resultDeadline = deadline;
  }

  finishRace(room) {
    if (room.status !== 'racing') return;
    const results = computeResults(room);
    resetToLobby(room);
    this.broadcast(room, { t: 'results', results });
    this.pushRoom(room);
  }

  // ---------- タイマー（Durable Object のアラーム） ----------
  // ハイバネーション中も動くので、setTimeout ではなくアラームを使う。
  nextDeadline() {
    let next = 0;
    const consider = (t) => {
      if (t > 0 && (next === 0 || t < next)) next = t;
    };
    if (this.queue.length > 0) consider(Date.now() + CASUAL_TICK_MS);
    for (const room of this.rooms.values()) {
      consider(room.resultDeadline);
      consider(room.hardDeadline);
    }
    return next;
  }

  async scheduleAlarm() {
    const next = this.nextDeadline();
    const current = await this.state.storage.getAlarm();
    if (next === 0) {
      if (current !== null) await this.state.storage.deleteAlarm();
      return;
    }
    if (current === null || next < current) await this.state.storage.setAlarm(next);
  }

  async alarm() {
    await this.load();
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      if (room.status !== 'racing') continue;
      if ((room.resultDeadline && now >= room.resultDeadline) || (room.hardDeadline && now >= room.hardDeadline)) {
        this.finishRace(room);
      }
    }
    this.tickCasual(now);
    await this.save();
  }

  /** カジュアルマッチ: 一定人数か待ち時間で自動的に部屋を作って開始する */
  tickCasual(now = Date.now()) {
    if (this.queue.length === 0) return;
    const sockets = this.queue.map((id) => this.socketOf(id)).filter(Boolean);
    this.queue = sockets.map((ws) => this.meta(ws).id);
    if (this.queue.length === 0) return;

    const oldest = Math.min(...sockets.map((ws) => this.meta(ws).queuedAt || now));
    const waited = now - oldest;
    const enough =
      this.queue.length >= MAX_PLAYERS ||
      (this.queue.length >= CASUAL_MIN && waited >= CASUAL_WAIT_MS) ||
      waited >= CASUAL_WAIT_MS * 2;

    if (enough) {
      const group = sockets.slice(0, MAX_PLAYERS);
      this.queue = this.queue.slice(group.length);
      const code = generateCode((c) => this.rooms.has(c));
      const room = makeRoom(code, 'casual');
      room.course = COURSE_IDS[Math.floor(Math.random() * COURSE_IDS.length)];
      this.rooms.set(code, room);
      for (const ws of group) {
        const m = this.meta(ws);
        room.players.set(m.id, { id: m.id, ...(m.profile || {}), ready: true, cpu: false, progress: 0 });
        if (!room.hostId) room.hostId = m.id;
        this.setMeta(ws, { room: code, spectator: false });
      }
      this.pushRoom(room);
      const startMsg = startRace(room, {
        course: room.course,
        cpuCount: MAX_PLAYERS - humanPlayers(room).length,
      });
      this.broadcast(room, startMsg);
      return;
    }

    for (const ws of sockets) {
      const m = this.meta(ws);
      this.send(ws, {
        t: 'queue',
        waiting: this.queue.length,
        seconds: Math.max(0, Math.ceil((CASUAL_WAIT_MS - (now - (m.queuedAt || now))) / 1000)),
      });
    }
  }
}

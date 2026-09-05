// もふもふカート オンライン対戦サーバー（WebSocket リレー + 静的ファイル配信）
// 使い方:  node server/index.js   (PORT 環境変数でポート変更、既定 8787)
// LAN 対戦: 同じ Wi-Fi 内の端末から  ws://<このPCのIP>:8787  を設定画面で指定
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DIST = path.join(__dirname, '..', 'dist');
const MAX_PLAYERS = 8;
const CASUAL_WAIT_MS = 12000;
const CASUAL_MIN = 2;
const RESULT_GRACE_MS = 30000;
const RACE_HARD_LIMIT_MS = 6 * 60 * 1000;

const COURSE_IDS = ['meadow', 'beach', 'snow', 'volcano', 'city'];
const CHAR_IDS = ['pyon', 'moco', 'taro', 'mint', 'pepe', 'don', 'hino', 'hoo'];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

// ---------- 静的配信（ビルド済み dist があれば） ----------
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: clients.size }));
    return;
  }
  if (!fs.existsSync(DIST)) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('もふもふカート サーバー稼働中。クライアントは `npm run build` 後に配信されます。');
    return;
  }
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  let file = path.normalize(path.join(DIST, urlPath));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
  fs.createReadStream(file).pipe(res);
});

// ---------- 状態 ----------
const clients = new Map(); // ws -> client
const rooms = new Map(); // code -> room
const casualQueue = [];
let nextId = 1;

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function sanitizeName(n, fallback) {
  const s = String(n || '').replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 12);
  return s || fallback;
}
function sanitizeChar(c) {
  return CHAR_IDS.includes(c) ? c : CHAR_IDS[Math.floor(Math.random() * CHAR_IDS.length)];
}
function sanitizeKart(k) {
  if (!k || typeof k !== 'object') return { color: 'default', wheels: 'standard', accessory: 'none' };
  return { color: String(k.color || 'default').slice(0, 12), wheels: String(k.wheels || 'standard').slice(0, 12), accessory: String(k.accessory || 'none').slice(0, 12) };
}

function send(client, obj) {
  if (client.ws.readyState === 1) client.ws.send(JSON.stringify(obj));
}
function broadcast(room, obj, except = null) {
  const data = JSON.stringify(obj);
  for (const c of room.members()) if (c !== except && c.ws.readyState === 1) c.ws.send(data);
}

function roomView(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    mode: room.mode,
    course: room.course,
    laps: room.laps,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, char: p.char, kart: p.kart, ready: p.ready, isHost: p.id === room.hostId, cpu: !!p.cpu })),
    spectators: room.spectators.size,
  };
}
function pushRoom(room) {
  broadcast(room, { t: 'room', room: roomView(room) });
}

class Room {
  constructor(code, mode) {
    this.code = code;
    this.mode = mode; // private | casual
    this.status = 'lobby';
    this.hostId = null;
    this.players = new Map(); // id -> player {id,name,char,kart,ready,client,cpu}
    this.spectators = new Set(); // clients
    this.course = COURSE_IDS[0];
    this.laps = 3;
    this.finish = new Map();
    this.raceStartedAt = 0;
    this.resultTimer = null;
    this.hardTimer = null;
  }
  *members() {
    for (const p of this.players.values()) if (p.client) yield p.client;
    for (const s of this.spectators) yield s;
  }
  humanPlayers() {
    return [...this.players.values()].filter((p) => !p.cpu);
  }
}

function joinRoom(client, room, profile) {
  leaveAll(client);
  const p = { id: client.id, name: profile.name, char: profile.char, kart: profile.kart, ready: false, client };
  room.players.set(p.id, p);
  if (!room.hostId) room.hostId = p.id;
  client.room = room;
  pushRoom(room);
}

function leaveAll(client) {
  const idx = casualQueue.indexOf(client);
  if (idx >= 0) casualQueue.splice(idx, 1);
  const room = client.room;
  if (!room) return;
  client.room = null;
  room.spectators.delete(client);
  if (room.players.has(client.id)) {
    room.players.delete(client.id);
    broadcast(room, { t: 'left', id: client.id });
    // ホストが抜けたら CPU も消える
    if (room.hostId === client.id) {
      for (const [id, p] of [...room.players]) if (p.cpu) {
        room.players.delete(id);
        broadcast(room, { t: 'left', id });
      }
      const next = room.humanPlayers()[0];
      room.hostId = next ? next.id : null;
    }
  }
  if (room.humanPlayers().length === 0) {
    clearTimeout(room.resultTimer);
    clearTimeout(room.hardTimer);
    rooms.delete(room.code);
    for (const s of room.spectators) send(s, { t: 'error', msg: '部屋が閉じられました', code: 'closed' });
  } else {
    if (room.status === 'racing') checkRaceDone(room);
    pushRoom(room);
  }
}

function startRace(room, opts = {}) {
  if (room.status === 'racing') return;
  room.status = 'racing';
  room.course = COURSE_IDS.includes(opts.course) ? opts.course : room.course;
  room.laps = Math.min(5, Math.max(1, Number(opts.laps) || room.laps));
  room.finish = new Map();
  room.raceStartedAt = Date.now();
  // CPU 補充（ホストが実行する）
  for (const [id, p] of [...room.players]) if (p.cpu) room.players.delete(id);
  const cpuCount = Math.max(0, Math.min(MAX_PLAYERS - room.humanPlayers().length, opts.cpuCount ?? 0));
  const usedChars = new Set([...room.players.values()].map((p) => p.char));
  for (let i = 0; i < cpuCount; i++) {
    const pool = CHAR_IDS.filter((c) => !usedChars.has(c));
    const char = pool.length ? pool[Math.floor(Math.random() * pool.length)] : CHAR_IDS[Math.floor(Math.random() * CHAR_IDS.length)];
    usedChars.add(char);
    const id = `cpu${i + 1}-${room.code}`;
    room.players.set(id, { id, name: `CPU ${i + 1}`, char, kart: { color: 'default', wheels: 'standard', accessory: 'none' }, ready: true, client: null, cpu: true });
  }
  const seed = Math.floor(Math.random() * 1e9);
  broadcast(room, { t: 'start', course: room.course, laps: room.laps, seed, hostId: room.hostId, players: roomView(room).players, startAt: Date.now() + 500 });
  clearTimeout(room.hardTimer);
  room.hardTimer = setTimeout(() => finishRace(room), RACE_HARD_LIMIT_MS);
}

function checkRaceDone(room) {
  const racers = [...room.players.values()];
  const humans = racers.filter((p) => !p.cpu);
  const allHumansDone = humans.every((p) => room.finish.has(p.id));
  const allDone = racers.every((p) => room.finish.has(p.id));
  if (allDone) finishRace(room);
  else if (allHumansDone && !room.resultTimer) room.resultTimer = setTimeout(() => finishRace(room), 8000);
  else if (room.finish.size > 0 && !room.resultTimer) room.resultTimer = setTimeout(() => finishRace(room), RESULT_GRACE_MS);
}

function finishRace(room) {
  if (room.status !== 'racing') return;
  clearTimeout(room.resultTimer);
  clearTimeout(room.hardTimer);
  room.resultTimer = null;
  const racers = [...room.players.values()];
  const list = racers.map((p) => ({ id: p.id, name: p.name, char: p.char, time: room.finish.get(p.id) ?? null, progress: p.progress || 0 }));
  list.sort((a, b) => {
    if (a.time !== null && b.time !== null) return a.time - b.time;
    if (a.time !== null) return -1;
    if (b.time !== null) return 1;
    return b.progress - a.progress;
  });
  list.forEach((r, i) => (r.rank = i + 1));
  room.status = 'lobby';
  for (const p of room.players.values()) {
    p.ready = false;
    p.progress = 0;
  }
  broadcast(room, { t: 'results', results: list });
  pushRoom(room);
}

// ---------- カジュアルマッチ ----------
let casualTimer = null;
function tickCasual() {
  casualTimer = null;
  if (casualQueue.length === 0) return;
  const oldest = casualQueue[0].queuedAt;
  const waited = Date.now() - oldest;
  if (casualQueue.length >= MAX_PLAYERS || (casualQueue.length >= CASUAL_MIN && waited >= CASUAL_WAIT_MS) || (casualQueue.length >= 1 && waited >= CASUAL_WAIT_MS * 2)) {
    const group = casualQueue.splice(0, MAX_PLAYERS);
    const room = new Room(genCode(), 'casual');
    rooms.set(room.code, room);
    for (const c of group) joinRoom(c, room, c.profile);
    room.course = COURSE_IDS[Math.floor(Math.random() * COURSE_IDS.length)];
    setTimeout(() => startRace(room, { course: room.course, cpuCount: MAX_PLAYERS - room.humanPlayers().length }), 1500);
  }
  for (const c of casualQueue) send(c, { t: 'queue', waiting: casualQueue.length, seconds: Math.max(0, Math.ceil((CASUAL_WAIT_MS - (Date.now() - c.queuedAt)) / 1000)) });
  if (casualQueue.length) casualTimer = setTimeout(tickCasual, 1000);
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
wss.on('connection', (ws) => {
  const client = { ws, id: `p${nextId++}`, name: '', room: null, alive: true, profile: null, queuedAt: 0 };
  clients.set(ws, client);
  ws.on('pong', () => (client.alive = true));
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    handle(client, msg);
  });
  ws.on('close', () => {
    leaveAll(client);
    clients.delete(ws);
  });
});

function profileOf(client, msg) {
  const p = { name: sanitizeName(msg.name, client.name || `プレイヤー${client.id.slice(1)}`), char: sanitizeChar(msg.char), kart: sanitizeKart(msg.kart) };
  client.name = p.name;
  client.profile = p;
  return p;
}

function handle(client, msg) {
  const room = client.room;
  switch (msg.t) {
    case 'hello':
      client.name = sanitizeName(msg.name, `プレイヤー${client.id.slice(1)}`);
      send(client, { t: 'welcome', id: client.id, version: 1 });
      break;
    case 'ping':
      send(client, { t: 'pong', ts: msg.ts, now: Date.now() });
      break;
    case 'create': {
      const r = new Room(genCode(), 'private');
      rooms.set(r.code, r);
      joinRoom(client, r, profileOf(client, msg));
      break;
    }
    case 'join': {
      const r = rooms.get(String(msg.code || '').toUpperCase());
      if (!r) return send(client, { t: 'error', msg: 'その部屋は見つかりません', code: 'notfound' });
      if (r.humanPlayers().length >= MAX_PLAYERS) return send(client, { t: 'error', msg: '部屋が満員です', code: 'full' });
      if (r.status === 'racing') return send(client, { t: 'error', msg: 'レース中です。観戦モードで参加できます', code: 'racing' });
      joinRoom(client, r, profileOf(client, msg));
      break;
    }
    case 'casual': {
      leaveAll(client);
      profileOf(client, msg);
      client.queuedAt = Date.now();
      casualQueue.push(client);
      send(client, { t: 'queue', waiting: casualQueue.length, seconds: Math.ceil(CASUAL_WAIT_MS / 1000) });
      if (!casualTimer) casualTimer = setTimeout(tickCasual, 1000);
      break;
    }
    case 'spectate': {
      const r = rooms.get(String(msg.code || '').toUpperCase());
      if (!r) return send(client, { t: 'error', msg: 'その部屋は見つかりません', code: 'notfound' });
      leaveAll(client);
      r.spectators.add(client);
      client.room = r;
      send(client, { t: 'room', room: roomView(r), spectating: true });
      pushRoom(r);
      break;
    }
    case 'leave':
      leaveAll(client);
      break;
    case 'ready': {
      const p = room?.players.get(client.id);
      if (!p) return;
      p.ready = !!msg.ready;
      pushRoom(room);
      break;
    }
    case 'update': {
      const p = room?.players.get(client.id);
      if (!p) return;
      const prof = profileOf(client, { ...msg, name: msg.name || p.name });
      Object.assign(p, prof);
      pushRoom(room);
      break;
    }
    case 'setCourse': {
      if (!room || room.hostId !== client.id) return;
      if (COURSE_IDS.includes(msg.course)) room.course = msg.course;
      if (msg.laps) room.laps = Math.min(5, Math.max(1, Number(msg.laps) || 3));
      pushRoom(room);
      break;
    }
    case 'start': {
      if (!room || room.hostId !== client.id || room.status !== 'lobby') return;
      startRace(room, { course: msg.course, laps: msg.laps, cpuCount: msg.cpuCount });
      break;
    }
    case 'state': {
      if (!room || room.status !== 'racing') return;
      const id = String(msg.id || client.id);
      const owner = room.players.get(id);
      if (!owner) return;
      if (owner.cpu ? room.hostId !== client.id : id !== client.id) return;
      if (msg.s && typeof msg.s.tp === 'number') owner.progress = msg.s.tp;
      broadcast(room, { t: 'state', id, s: msg.s }, client);
      break;
    }
    case 'event': {
      if (!room || !msg.e || typeof msg.e !== 'object') return;
      const e = msg.e;
      if (e.k === 'finish') {
        const id = String(e.id || client.id);
        const owner = room.players.get(id);
        if (owner && (owner.cpu ? room.hostId === client.id : id === client.id) && !room.finish.has(id)) {
          room.finish.set(id, Number(e.time) || (Date.now() - room.raceStartedAt) / 1000);
          checkRaceDone(room);
        }
      }
      broadcast(room, { t: 'event', id: client.id, e }, client);
      break;
    }
    case 'chat': {
      if (!room) return;
      const text = String(msg.msg || '').slice(0, 80);
      if (text) broadcast(room, { t: 'chat', id: client.id, name: client.name, msg: text });
      break;
    }
    default:
      break;
  }
}

// 死活監視
const heartbeat = setInterval(() => {
  for (const [ws, c] of clients) {
    if (!c.alive) {
      ws.terminate();
      continue;
    }
    c.alive = false;
    try {
      ws.ping();
    } catch (e) {
      /* ignore */
    }
  }
}, 20000);
heartbeat.unref?.();

export function listen(port = PORT) {
  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      const addr = server.address();
      console.log(`🏁 もふもふカート サーバー起動: http://0.0.0.0:${addr.port}  (WebSocket 同ポート)`);
      resolve(server);
    });
  });
}
export function close() {
  clearInterval(heartbeat);
  for (const ws of clients.keys()) ws.terminate();
  return new Promise((resolve) => server.close(() => resolve()));
}
export { server, rooms, wss };

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) listen(PORT);

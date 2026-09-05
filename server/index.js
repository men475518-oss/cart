// もふもふカート オンライン対戦サーバー（WebSocket リレー + 静的ファイル配信）
// 使い方:  node server/index.js   (PORT 環境変数でポート変更、既定 8787)
// LAN 対戦: 同じ Wi-Fi 内の端末から  ws://<このPCのIP>:8787  を設定画面で指定
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
// 部屋・マッチングのロジックは Cloudflare Worker 版（worker/index.js）と共有する
import {
  CASUAL_MIN,
  CASUAL_WAIT_MS,
  COURSE_IDS,
  MAX_PLAYERS,
  computeResults,
  fillWithCpu,
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
  startRace as applyRaceStart,
} from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DIST = path.join(__dirname, '..', 'dist');

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

const genCode = () => generateCode((c) => rooms.has(c));

function send(client, obj) {
  if (client.ws.readyState === 1) client.ws.send(JSON.stringify(obj));
}
/** 部屋にいる接続（プレイヤー + 観戦者） */
function* membersOf(room) {
  for (const p of room.players.values()) if (p.client) yield p.client;
  for (const s of room.spectators) yield s;
}

function broadcast(room, obj, except = null) {
  const data = JSON.stringify(obj);
  for (const c of membersOf(room)) if (c !== except && c.ws.readyState === 1) c.ws.send(data);
}

function pushRoom(room) {
  broadcast(room, { t: 'room', room: roomView(room) });
}

/** 共有の makeRoom に、Node 版だけで使うタイマー欄を足す */
function newRoom(code, mode) {
  return Object.assign(makeRoom(code, mode), { resultTimer: null, hardTimer: null });
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
      const next = humanPlayers(room)[0];
      room.hostId = next ? next.id : null;
    }
  }
  if (humanPlayers(room).length === 0) {
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
  broadcast(room, applyRaceStart(room, opts));
  clearTimeout(room.hardTimer);
  room.hardTimer = setTimeout(() => finishRace(room), room.hardDeadline - Date.now());
}

function checkRaceDone(room) {
  const deadline = resultDeadlineFor(room);
  if (deadline === -1) return finishRace(room);
  if (deadline > 0 && !room.resultTimer) room.resultTimer = setTimeout(() => finishRace(room), deadline - Date.now());
}

function finishRace(room) {
  if (room.status !== 'racing') return;
  clearTimeout(room.resultTimer);
  clearTimeout(room.hardTimer);
  room.resultTimer = null;
  const results = computeResults(room);
  resetToLobby(room);
  broadcast(room, { t: 'results', results });
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
    const room = newRoom(genCode(), 'casual');
    rooms.set(room.code, room);
    for (const c of group) joinRoom(c, room, c.profile);
    room.course = COURSE_IDS[Math.floor(Math.random() * COURSE_IDS.length)];
    setTimeout(() => startRace(room, { course: room.course, cpuCount: MAX_PLAYERS - humanPlayers(room).length }), 1500);
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
      const r = newRoom(genCode(), 'private');
      rooms.set(r.code, r);
      joinRoom(client, r, profileOf(client, msg));
      break;
    }
    case 'join': {
      const r = rooms.get(String(msg.code || '').toUpperCase());
      if (!r) return send(client, { t: 'error', msg: 'その部屋は見つかりません', code: 'notfound' });
      if (humanPlayers(r).length >= MAX_PLAYERS) return send(client, { t: 'error', msg: '部屋が満員です', code: 'full' });
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
      if (msg.laps) room.laps = sanitizeLaps(msg.laps, room.laps);
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
      if (!mayActAs(room, client.id, id)) return;
      if (msg.s && typeof msg.s.tp === 'number') room.players.get(id).progress = msg.s.tp;
      broadcast(room, { t: 'state', id, s: msg.s }, client);
      break;
    }
    case 'event': {
      if (!room || !msg.e || typeof msg.e !== 'object') return;
      const e = msg.e;
      if (e.k === 'finish') {
        const id = String(e.id || client.id);
        if (mayActAs(room, client.id, id) && !room.finish.has(id)) {
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

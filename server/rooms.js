// 部屋・マッチングの純粋ロジック。
// Node 版サーバー（server/index.js）と Cloudflare Worker 版（worker/index.js）の
// 両方から使う。実行環境固有の API（WebSocket, タイマー, ストレージ）には依存しない。

export const MAX_PLAYERS = 8;
export const CASUAL_WAIT_MS = 12000;
export const CASUAL_MIN = 2;
export const RESULT_GRACE_MS = 30000;
export const HUMANS_DONE_GRACE_MS = 8000;
export const RACE_HARD_LIMIT_MS = 6 * 60 * 1000;

export const COURSE_IDS = ['meadow', 'beach', 'snow', 'volcano', 'city'];
export const CHAR_IDS = ['pyon', 'moco', 'taro', 'mint', 'pepe', 'don', 'hino', 'hoo'];

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい I/O/0/1 は除く

/** 4 文字のルームコードを作る。taken(code) が true を返す間は引き直す。 */
export function generateCode(taken, random = Math.random) {
  for (let attempt = 0; attempt < 200; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(random() * CODE_CHARS.length)];
    if (!taken(code)) return code;
  }
  throw new Error('ルームコードを生成できませんでした');
}

export function sanitizeName(name, fallback) {
  const s = String(name ?? '')
    .replace(/[\x00-\x1f<>]/g, '')
    .trim()
    .slice(0, 12);
  return s || fallback;
}

export function sanitizeChar(char, random = Math.random) {
  return CHAR_IDS.includes(char) ? char : CHAR_IDS[Math.floor(random() * CHAR_IDS.length)];
}

export function sanitizeKart(kart) {
  const fallback = { color: 'default', wheels: 'standard', accessory: 'none' };
  if (!kart || typeof kart !== 'object') return fallback;
  return {
    color: String(kart.color || fallback.color).slice(0, 12),
    wheels: String(kart.wheels || fallback.wheels).slice(0, 12),
    accessory: String(kart.accessory || fallback.accessory).slice(0, 12),
  };
}

export function sanitizeLaps(laps, fallback = 3) {
  const n = Number(laps);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(5, Math.max(1, Math.round(n)));
}

export function makeRoom(code, mode) {
  return {
    code,
    mode, // 'private' | 'casual'
    status: 'lobby', // 'lobby' | 'racing'
    hostId: null,
    players: new Map(), // id -> { id, name, char, kart, ready, cpu, progress }
    spectators: new Set(), // clientId
    course: COURSE_IDS[0],
    laps: 3,
    finish: new Map(), // id -> ゴールタイム(秒)
    raceStartedAt: 0,
    resultDeadline: 0, // 0 = 未設定
    hardDeadline: 0,
  };
}

export function humanPlayers(room) {
  return [...room.players.values()].filter((p) => !p.cpu);
}

/** クライアントへ送る部屋の状態 */
export function roomView(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    mode: room.mode,
    course: room.course,
    laps: room.laps,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      char: p.char,
      kart: p.kart,
      ready: p.ready,
      isHost: p.id === room.hostId,
      cpu: !!p.cpu,
    })),
    spectators: room.spectators.size,
  };
}

/** 空き枠を CPU で埋める。ホストがその CPU を操作する。 */
export function fillWithCpu(room, cpuCount, random = Math.random) {
  for (const [id, p] of [...room.players]) if (p.cpu) room.players.delete(id);
  const want = Math.max(0, Math.min(MAX_PLAYERS - humanPlayers(room).length, cpuCount || 0));
  const used = new Set([...room.players.values()].map((p) => p.char));
  for (let i = 0; i < want; i++) {
    const pool = CHAR_IDS.filter((c) => !used.has(c));
    const char = pool.length ? pool[Math.floor(random() * pool.length)] : CHAR_IDS[Math.floor(random() * CHAR_IDS.length)];
    used.add(char);
    const id = `cpu${i + 1}-${room.code}`;
    room.players.set(id, {
      id,
      name: `CPU ${i + 1}`,
      char,
      kart: sanitizeKart(null),
      ready: true,
      cpu: true,
      progress: 0,
    });
  }
}

/**
 * レース開始時の設定を room に反映し、クライアントへ配る start メッセージを返す。
 */
export function startRace(room, opts = {}, random = Math.random, now = Date.now()) {
  room.status = 'racing';
  if (COURSE_IDS.includes(opts.course)) room.course = opts.course;
  room.laps = sanitizeLaps(opts.laps, room.laps);
  room.finish = new Map();
  room.raceStartedAt = now;
  room.resultDeadline = 0;
  room.hardDeadline = now + RACE_HARD_LIMIT_MS;
  fillWithCpu(room, opts.cpuCount ?? 0, random);
  for (const p of room.players.values()) p.progress = 0;
  return {
    t: 'start',
    course: room.course,
    laps: room.laps,
    seed: Math.floor(random() * 1e9),
    hostId: room.hostId,
    players: roomView(room).players,
    startAt: now + 500,
  };
}

/** ゴール状況から、次に必要な締め切り時刻を求める（0 = 締め切り不要 / -1 = 即確定） */
export function resultDeadlineFor(room, now = Date.now()) {
  const racers = [...room.players.values()];
  if (racers.length === 0) return -1;
  if (racers.every((p) => room.finish.has(p.id))) return -1;
  const humans = racers.filter((p) => !p.cpu);
  if (humans.length > 0 && humans.every((p) => room.finish.has(p.id))) return now + HUMANS_DONE_GRACE_MS;
  if (room.finish.size > 0) return now + RESULT_GRACE_MS;
  return 0;
}

/** 最終順位。ゴール済みはタイム順、未ゴールは進行度順。 */
export function computeResults(room) {
  const list = [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    char: p.char,
    time: room.finish.has(p.id) ? room.finish.get(p.id) : null,
    progress: p.progress || 0,
  }));
  list.sort((a, b) => {
    if (a.time !== null && b.time !== null) return a.time - b.time;
    if (a.time !== null) return -1;
    if (b.time !== null) return 1;
    return b.progress - a.progress;
  });
  list.forEach((r, i) => (r.rank = i + 1));
  return list;
}

/** レース終了後にロビーへ戻す */
export function resetToLobby(room) {
  room.status = 'lobby';
  room.resultDeadline = 0;
  room.hardDeadline = 0;
  for (const p of room.players.values()) {
    p.ready = false;
    p.progress = 0;
  }
}

/**
 * state / event メッセージを、その id の持ち主が送ってきたものか検証する。
 * CPU の分はホストだけが送れる。
 */
export function mayActAs(room, clientId, targetId) {
  const owner = room.players.get(targetId);
  if (!owner) return false;
  return owner.cpu ? room.hostId === clientId : targetId === clientId;
}

// ---------- 永続化（Cloudflare Durable Object 用） ----------

export function serializeRoom(room) {
  return {
    code: room.code,
    mode: room.mode,
    status: room.status,
    hostId: room.hostId,
    players: [...room.players.values()],
    spectators: [...room.spectators],
    course: room.course,
    laps: room.laps,
    finish: [...room.finish],
    raceStartedAt: room.raceStartedAt,
    resultDeadline: room.resultDeadline,
    hardDeadline: room.hardDeadline,
  };
}

export function deserializeRoom(data) {
  const room = makeRoom(data.code, data.mode);
  room.status = data.status;
  room.hostId = data.hostId;
  for (const p of data.players || []) room.players.set(p.id, p);
  room.spectators = new Set(data.spectators || []);
  room.course = data.course;
  room.laps = data.laps;
  room.finish = new Map(data.finish || []);
  room.raceStartedAt = data.raceStartedAt || 0;
  room.resultDeadline = data.resultDeadline || 0;
  room.hardDeadline = data.hardDeadline || 0;
  return room;
}

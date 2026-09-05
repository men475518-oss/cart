// 汎用ユーティリティ（数学・乱数・角度）
export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** 角度差を [-PI, PI] に正規化 */
export function wrapAngle(a) {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

/** 角度 a を b に向けて最大 maxStep だけ回転 */
export function approachAngle(a, b, maxStep) {
  const d = wrapAngle(b - a);
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}

/** 指数減衰補間（フレームレート非依存） */
export function damp(a, b, lambda, dt) {
  return lerp(a, b, 1 - Math.exp(-lambda * dt));
}

export function dampAngle(a, b, lambda, dt) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
}

/** 決定論的乱数（mulberry32）。オンライン同期で同じ seed から同じ結果を得るために使う */
export function makeRng(seed) {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (a, b) => a + (b - a) * rng();
  rng.int = (n) => Math.floor(rng() * n);
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  return rng;
}

/** 重み付き抽選 */
export function weightedPick(entries, rnd = Math.random()) {
  let total = 0;
  for (const e of entries) total += e.w;
  let r = rnd * total;
  for (const e of entries) {
    r -= e.w;
    if (r <= 0) return e.v;
  }
  return entries[entries.length - 1].v;
}

export function formatTime(sec) {
  if (sec == null || !isFinite(sec)) return '--:--.---';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec * 1000) % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export function rankLabel(rank) {
  return `${rank}位`;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export const isTouchDevice = () =>
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

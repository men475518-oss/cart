// アーケード風カート物理
import { clamp, lerp, wrapAngle, dampAngle } from '../core/Utils.js';
import { KART_WHEELS } from '../data/kartParts.js';

export const DRIFT_TIERS = [
  { time: 0.9, boost: 0.55, sfx: 'drift1', color: 0x4cc9f0 },
  { time: 2.0, boost: 0.95, sfx: 'drift2', color: 0xff9f1c },
  { time: 3.2, boost: 1.45, sfx: 'drift3', color: 0xc86bff },
];

/** キャラクター＋パーツから物理パラメータを作る */
export function buildParams(char, kartOpts = {}) {
  const s = char.stats;
  const w = KART_WHEELS.find((x) => x.id === kartOpts.wheels) || KART_WHEELS[0];
  const trait = char.trait?.id;
  return {
    maxSpeed: lerp(36, 46, s.speed) * w.mod.speed,
    accel: lerp(13, 26, s.accel) * w.mod.accel,
    handling: lerp(1.7, 2.9, s.handling) * w.mod.handling,
    weight: lerp(0.8, 2.6, s.weight),
    driftRate: lerp(0.8, 1.35, s.drift) * (trait === 'drift' ? 1.3 : 1),
    offroadMult: lerp(0.42, 0.62, s.offroad) * w.mod.offroad,
    boostMult: 1.38,
    boostDurMult: trait === 'lava' ? 1.2 : trait === 'balanced' ? 1.12 : 1,
    recovery: trait === 'quickstart' ? 0.7 : 1, // スピン時間の倍率
    traits: {
      snow: trait === 'snow',
      water: trait === 'water',
      lava: trait === 'lava',
      items: trait === 'items',
      tank: trait === 'tank',
      quickstart: trait === 'quickstart',
      drift: trait === 'drift',
    },
  };
}

export function createKartState() {
  return {
    x: 0, y: 0, z: 0,
    heading: 0,       // 向き
    moveHeading: 0,   // 実際の移動方向（グリップに応じて heading に追従）
    speed: 0,
    vy: 0,            // 垂直速度（ジャンプ用）
    hop: 0,
    drifting: false, driftDir: 0, driftCharge: 0, driftTier: -1,
    boostTime: 0, boostPower: 1,
    spinTime: 0, spinAngle: 0,
    squashTime: 0,
    starTime: 0,
    stunTime: 0,      // 爆発などで操作不能
    trackIndex: null, progress: 0, lateral: 0, surface: 'road', onBoost: false,
    totalProgress: 0, lap: 0, finished: false, finishTime: null,
    lastSurface: 'road',
    steerVis: 0,
    lavaCooldown: 0,
    knockVx: 0, knockVz: 0,
    goldenTime: 0,
    invincibleFlash: 0,
    reverseHint: 0,
  };
}

const _q = {};

/**
 * 1ステップ物理更新
 * @param k  kart オブジェクト { state, params, track }
 * @param input { steer, accel, brake, drift }
 * @param dt  秒
 * @param events  イベント配列（'driftTier', 'boost', 'lava', 'wall', 'water'...）を push する
 */
export function stepKart(k, input, dt, events, nightBonus = false) {
  const s = k.state;
  const p = k.params;
  const track = k.track;

  // タイマー
  const dec = (key) => (s[key] = Math.max(0, s[key] - dt));
  dec('boostTime');
  dec('spinTime');
  dec('squashTime');
  dec('starTime');
  dec('stunTime');
  dec('lavaCooldown');
  dec('goldenTime');

  const controllable = s.spinTime <= 0 && s.stunTime <= 0 && !s.finished;
  const steer = controllable ? input.steer : 0;
  const accel = controllable ? input.accel : s.finished ? 1 : 0;
  const brakeIn = controllable ? input.brake : 0;
  const driftBtn = controllable && input.drift;

  // サーフェス
  const q = track.query({ x: s.x, y: s.y, z: s.z }, s.trackIndex, _q);
  const surf = q.surface;
  s.surface = surf;
  let surfMult = 1;
  let grip = 9;
  if (surf === 'offroad') {
    surfMult = s.starTime > 0 || s.boostTime > 0 ? 0.85 : p.offroadMult;
  } else if (surf === 'ice') {
    if (!p.traits.snow) grip = 2.2;
    surfMult = p.traits.snow ? 1.04 : 0.96;
  } else if (surf === 'water') {
    surfMult = p.traits.water ? 1.1 : 0.62;
    if (s.lastSurface !== 'water') events.push({ type: 'water', kart: k });
  } else if (surf === 'lava') {
    if (!p.traits.lava && s.starTime <= 0 && s.lavaCooldown <= 0 && s.spinTime <= 0) {
      events.push({ type: 'lava', kart: k });
      s.lavaCooldown = 2.5;
    } else if (p.traits.lava) surfMult = 1.05;
  }
  if (nightBonus) surfMult *= 1.03;
  s.lastSurface = surf;

  // ダッシュ板
  if (q.onBoost && !s.onBoost) {
    applyBoost(k, 0.9, 1.35);
    events.push({ type: 'boostpad', kart: k });
  }
  s.onBoost = q.onBoost;

  // 速度目標
  const squash = s.squashTime > 0 ? 0.65 : 1;
  const star = s.starTime > 0 ? 1.25 : 1;
  let target = p.maxSpeed * surfMult * squash * star;
  if (s.boostTime > 0) target *= s.boostPower;

  // ドリフト
  const canDrift = Math.abs(s.speed) > p.maxSpeed * 0.45 && controllable;
  if (!s.drifting && driftBtn && canDrift && Math.abs(steer) > 0.25) {
    s.drifting = true;
    s.driftDir = Math.sign(steer);
    s.driftCharge = 0;
    s.driftTier = -1;
    s.hop = 0.9;
    s.vy = 4.5;
    events.push({ type: 'driftStart', kart: k });
  }
  if (s.drifting) {
    if (!driftBtn || Math.abs(s.speed) < p.maxSpeed * 0.3 || s.spinTime > 0 || s.stunTime > 0) {
      // ドリフト終了 → ミニターボ
      if (s.driftTier >= 0) {
        const tier = DRIFT_TIERS[s.driftTier];
        applyBoost(k, tier.boost * p.boostDurMult, 1.3);
        events.push({ type: 'miniTurbo', kart: k, tier: s.driftTier });
      }
      s.drifting = false;
      s.driftCharge = 0;
      s.driftTier = -1;
    } else {
      const tight = steer * s.driftDir; // -1..1 (内側に切るほど+)
      s.driftCharge += dt * p.driftRate * (0.75 + Math.max(0, tight) * 0.6);
      const nextTier = s.driftTier + 1;
      if (nextTier < DRIFT_TIERS.length && s.driftCharge >= DRIFT_TIERS[nextTier].time) {
        s.driftTier = nextTier;
        events.push({ type: 'driftTier', kart: k, tier: nextTier });
      }
    }
  }

  // 加減速
  const braking = brakeIn > 0 || (driftBtn && !s.drifting && Math.abs(steer) < 0.25);
  if (s.speed < target && accel > 0 && !braking) {
    const rate = p.accel * (s.boostTime > 0 ? 2.2 : 1) * (1 - (s.speed / target) * 0.4);
    s.speed = Math.min(target, s.speed + rate * accel * dt);
  } else if (s.speed > target) {
    s.speed = Math.max(target, s.speed - (surf === 'offroad' ? 45 : 18) * dt);
  }
  if (braking) {
    if (s.speed > 0) s.speed = Math.max(0, s.speed - 34 * dt);
    else if (accel === 0 && !s.drifting) s.speed = Math.max(-9, s.speed - 10 * dt);
  } else if (accel === 0 && s.speed > 0) {
    s.speed = Math.max(0, s.speed - 9 * dt);
  } else if (accel === 0 && s.speed < 0) {
    s.speed = Math.min(0, s.speed + 12 * dt);
  }
  if (s.drifting && !p.traits.drift) s.speed = Math.min(s.speed, target * 0.97);

  // ステアリング
  const speedNorm = clamp(Math.abs(s.speed) / p.maxSpeed, 0, 1);
  const steerAuthority = clamp(Math.abs(s.speed) / 6, 0, 1) * (1 - speedNorm * 0.35);
  let turn;
  if (s.drifting) {
    // 内側に切るほど鋭く、外側に切ればゆるく（ほぼ直進まで）曲がる
    const tight = steer * s.driftDir;
    const f = clamp(0.35 + 0.65 * tight, 0.05, 1.0);
    turn = s.driftDir * p.handling * f * 1.25;
  } else {
    turn = steer * p.handling * (surf === 'ice' && !p.traits.snow ? 0.8 : 1);
  }
  if (s.speed < 0) turn = -turn;
  s.heading -= turn * steerAuthority * dt;
  s.steerVis = lerp(s.steerVis, s.drifting ? s.driftDir * 0.8 + steer * 0.3 : steer, 1 - Math.exp(-12 * dt));

  // 移動方向はグリップに応じて追従（ドリフト・氷ですべる）
  const effGrip = s.drifting ? Math.min(grip, 3.5) : grip;
  s.moveHeading = dampAngle(s.moveHeading, s.heading, effGrip, dt);
  const slip = wrapAngle(s.heading - s.moveHeading);
  const fx = Math.sin(s.moveHeading);
  const fz = Math.cos(s.moveHeading);
  s.x += (fx * s.speed + s.knockVx) * dt;
  s.z += (fz * s.speed + s.knockVz) * dt;
  s.knockVx *= Math.exp(-4 * dt);
  s.knockVz *= Math.exp(-4 * dt);

  // ホップ / ジャンプ
  if (s.hop > 0 || s.vy > 0) {
    s.vy -= 22 * dt;
    s.hop = Math.max(0, s.hop + s.vy * dt);
    if (s.hop === 0) s.vy = 0;
  }

  // トラック拘束（壁）
  const q2 = track.query({ x: s.x, y: s.y, z: s.z }, q.index, _q);
  const wallDist = track.wallDist;
  if (Math.abs(q2.lateral) > wallDist) {
    const over = Math.abs(q2.lateral) - wallDist;
    const sign = Math.sign(q2.lateral);
    s.x -= q2.right.x * sign * (over + 0.05);
    s.z -= q2.right.z * sign * (over + 0.05);
    // 壁に沿う向きへ、速度ダウン
    const wallHeading = q2.heading;
    const rel = wrapAngle(s.heading - wallHeading);
    const impact = Math.abs(Math.sin(rel)) * Math.abs(s.speed);
    if (impact > 6) {
      events.push({ type: 'wall', kart: k, impact });
      s.speed *= 0.55;
    } else s.speed *= 0.985;
    s.heading = dampAngle(s.heading, wallHeading + (rel > 0 ? 0.15 : -0.15) * 0, 6, dt);
    s.moveHeading = s.heading;
    q2.lateral = sign * wallDist;
  }
  s.y = q2.height;
  s.trackIndex = q2.index;
  s.lateral = q2.lateral;
  // 進行度
  let d = q2.progress - s.progress;
  const N = track.N;
  if (d > N / 2) d -= N;
  if (d < -N / 2) d += N;
  if (s.trackIndex !== null && s.progress !== undefined) s.totalProgress += d;
  s.progress = q2.progress;
  // 逆走判定
  const fwd = Math.cos(wrapAngle(s.heading - q2.heading));
  s.reverseHint = fwd < -0.3 && s.speed > 5 ? s.reverseHint + dt : 0;

  // スピン演出
  if (s.spinTime > 0) s.spinAngle += dt * 12;
  else s.spinAngle = 0;

  return { slip, speedNorm };
}

export function applyBoost(k, duration, power = 1.35) {
  const s = k.state;
  s.boostTime = Math.max(s.boostTime, duration);
  s.boostPower = Math.max(power, s.boostTime > 0 ? s.boostPower : 1);
  if (s.speed < k.params.maxSpeed * 0.7) s.speed = Math.max(s.speed, k.params.maxSpeed * 0.7);
}

/** 被弾: スピン */
export function spinOut(k, strength = 1) {
  const s = k.state;
  if (s.starTime > 0) return false;
  s.spinTime = Math.max(s.spinTime, 1.1 * strength * k.params.recovery);
  s.speed *= 0.3;
  s.drifting = false;
  s.driftCharge = 0;
  s.driftTier = -1;
  s.boostTime = 0;
  return true;
}

/** 爆発などの吹き飛ばし */
export function knockBack(k, fromX, fromZ, power = 1) {
  const s = k.state;
  if (s.starTime > 0) return false;
  let dx = s.x - fromX;
  let dz = s.z - fromZ;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  const f = power * 22 / Math.sqrt(k.params.weight);
  s.knockVx += dx * f;
  s.knockVz += dz * f;
  s.stunTime = Math.max(s.stunTime, 1.2 * k.params.recovery);
  s.spinTime = Math.max(s.spinTime, 1.2 * k.params.recovery);
  s.hop = Math.max(s.hop, 0.5);
  s.vy = 9;
  s.speed *= 0.2;
  s.drifting = false;
  s.boostTime = 0;
  return true;
}

/** カート同士の衝突 */
export function resolveKartCollision(a, b, events) {
  const sa = a.state;
  const sb = b.state;
  const dx = sb.x - sa.x;
  const dz = sb.z - sa.z;
  const dist = Math.hypot(dx, dz);
  const minDist = 2.3;
  if (dist >= minDist || dist === 0) return;
  const nx = dx / dist;
  const nz = dz / dist;
  const overlap = minDist - dist;
  let wa = a.params.weight;
  let wb = b.params.weight;
  if (sa.squashTime > 0) wa *= 0.3;
  if (sb.squashTime > 0) wb *= 0.3;
  if (sa.starTime > 0) wa *= 4;
  if (sb.starTime > 0) wb *= 4;
  const total = wa + wb;
  sa.x -= nx * overlap * (wb / total);
  sa.z -= nz * overlap * (wb / total);
  sb.x += nx * overlap * (wa / total);
  sb.z += nz * overlap * (wa / total);
  // 相対速度で押し合い
  const relSpeed = Math.abs(sa.speed - sb.speed) + 4;
  const push = Math.min(14, relSpeed * 0.5);
  sa.knockVx -= nx * push * (wb / total) * 1.6;
  sa.knockVz -= nz * push * (wb / total) * 1.6;
  sb.knockVx += nx * push * (wa / total) * 1.6;
  sb.knockVz += nz * push * (wa / total) * 1.6;
  sa.speed *= 1 - 0.12 * (wb / total);
  sb.speed *= 1 - 0.12 * (wa / total);
  // スター接触 → 相手スピン
  if (sa.starTime > 0 && sb.starTime <= 0) {
    if (spinOut(b, 1)) events.push({ type: 'starHit', kart: b, by: a });
  } else if (sb.starTime > 0 && sa.starTime <= 0) {
    if (spinOut(a, 1)) events.push({ type: 'starHit', kart: a, by: b });
  }
  events.push({ type: 'bump', a, b, force: push });
}

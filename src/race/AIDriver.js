// CPU ドライバー
import { clamp, wrapAngle } from '../core/Utils.js';
import { DRIFT_TIERS } from './KartPhysics.js';

const LEVELS = {
  easy: { skill: 0.72, speed: 0.86, itemDelay: 4, driftSkill: 0.3, band: 0.05, corner: 0.85 },
  normal: { skill: 0.88, speed: 0.95, itemDelay: 2.5, driftSkill: 0.7, band: 0.08, corner: 1.0 },
  hard: { skill: 1.0, speed: 1.0, itemDelay: 1.2, driftSkill: 1.0, band: 0.1, corner: 1.1 },
};

export class AIDriver {
  constructor(kart, track, rng, level = 'normal') {
    this.kart = kart;
    this.track = track;
    this.rng = rng;
    this.level = LEVELS[level] || LEVELS.normal;
    this.laneOffset = rng.range(-0.5, 0.5) * track.halfWidth * 0.6;
    this.laneTimer = rng.range(2, 6);
    this.itemTimer = 0;
    this.noise = 0;
    this.noiseTimer = 0;
    this.input = { steer: 0, accel: 1, brake: 0, drift: false, item: false, itemPressed: false, accelHeldSince: -10 };
    this.driftHold = 0;
    this.personality = rng.range(0.8, 1.2); // 個体差（コーナリング速度など）
  }

  update(dt, ctx) {
    const k = this.kart;
    const s = k.state;
    const track = this.track;
    const inp = this.input;
    const lvl = this.level;
    if (s.trackIndex === null) return;

    // レーン変更（たまに）
    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      this.laneTimer = this.rng.range(3, 8);
      this.laneOffset = this.rng.range(-0.55, 0.55) * track.halfWidth * 0.6;
    }
    this.noiseTimer -= dt;
    if (this.noiseTimer <= 0) {
      this.noiseTimer = this.rng.range(0.3, 1.0);
      this.noise = this.rng.range(-0.12, 0.12) * (1.2 - lvl.skill);
    }

    // 危険物回避（バナナ・こうら・ボム）
    let avoid = 0;
    if (ctx.hazards) {
      for (const h of ctx.hazards) {
        if (h.type !== 'banana' && h.type !== 'bomb' && !(h.type === 'greenShell' && h.owner !== k)) continue;
        const dx = h.x - s.x;
        const dz = h.z - s.z;
        const fwd = dx * Math.sin(s.heading) + dz * Math.cos(s.heading);
        if (fwd < 2 || fwd > 34) continue;
        const sideR = -dx * Math.cos(s.heading) + dz * Math.sin(s.heading); // 右ベクトル (-cos, sin) 成分: 正 = 右側
        if (Math.abs(sideR) < 3.2) avoid += sideR >= 0 ? -3.5 : 3.5;
      }
    }
    // 特殊サーフェス回避（溶岩・水）
    const lookIdx = s.trackIndex + 10;
    const ahead = track.sample(lookIdx);
    if (ahead.surface === 'lava' && ahead.surfLat && !k.params.traits.lava) {
      const [a, b] = ahead.surfLat;
      const center = ((a + b) / 2) * track.halfWidth;
      avoid += center > 0 ? -track.halfWidth * 0.6 : track.halfWidth * 0.6;
    }

    // ターゲット位置
    const speedNorm = clamp(Math.abs(s.speed) / k.params.maxSpeed, 0, 1);
    const look = Math.round(6 + speedNorm * 14);
    const ts = track.sample(s.trackIndex + look);
    // カーブ内側寄り
    const curvSum = this._turnAhead(s.trackIndex, 30);
    const insideBias = clamp(-curvSum * 3, -1, 1) * track.halfWidth * 0.2;
    let lat = clamp(this.laneOffset + avoid + insideBias, -track.halfWidth * 0.62, track.halfWidth * 0.62);
    const tx = ts.pos.x + ts.right.x * lat;
    const tz = ts.pos.z + ts.right.z * lat;
    const desired = Math.atan2(tx - s.x, tz - s.z);
    const diff = wrapAngle(desired - s.heading);
    let steer = clamp(-diff * 2.4 * lvl.skill + this.noise, -1, 1); // heading は左折で増えるので符号反転

    // ドリフト判断
    const turn = this._turnAhead(s.trackIndex, 26);
    const wantDrift = Math.abs(turn) > 0.55 && speedNorm > 0.62 && this.rng() < lvl.driftSkill * 0.9 + 0.1;
    if (!s.drifting) {
      this.counterTime = 0;
      if (wantDrift && this.driftHold <= 0) {
        inp.drift = true;
        // driftDir は物理側で steer の符号から決まる → 内側へ切る
        steer = turn < 0 ? Math.max(steer, 0.5) : Math.min(steer, -0.5);
      } else inp.drift = false;
    } else {
      // ドリフト中: 直線に入った / ためすぎ / 内側に寄りすぎてカウンターを当て続けている → 解除
      this.counterTime = steer * s.driftDir < -0.6 ? (this.counterTime || 0) + dt : 0;
      // 最終段まで貯まったら、それ以上ためても得はないので抜ける
      const maxed = s.driftCharge > DRIFT_TIERS[DRIFT_TIERS.length - 1].time * 1.05;
      const done = Math.abs(turn) < 0.15 || maxed || speedNorm < 0.4 || this.counterTime > 0.3;
      inp.drift = !done;
      if (done) this.driftHold = 0.8;
    }
    this.driftHold = Math.max(0, this.driftHold - dt);

    inp.steer = steer;
    // ジャンプ中はトリック（1 回だけドリフトボタンを押す）
    inp.driftPressed = false;
    if (s.airborne && !s.tricked && s.hop > 0.6) {
      inp.driftPressed = true;
      inp.drift = false;
    }
    // コーナー速度制限: 先のカーブ半径から曲がり切れる速度を見積もる
    let maxCurv = 0;
    for (let i = 3; i < 24; i++) maxCurv = Math.max(maxCurv, Math.abs(track.sample(s.trackIndex + i).curvature));
    const radius = maxCurv > 1e-4 ? 1 / maxCurv : 1e9;
    const turnRate = k.params.handling * 0.7 * (s.drifting ? 1.5 : 1);
    const vLimit = Math.max(16, turnRate * radius) * lvl.corner * this.personality;
    // ブースト中は少しだけ上限を上げる。まるごと無視すると曲がり切れずに壁へ突っこむ
    const limit = s.boostTime > 0 ? vLimit * 1.15 : vLimit;
    inp.accel = s.speed > limit ? 0 : 1;
    inp.brake = s.speed > limit * 1.3 || (Math.abs(diff) > 1.1 && speedNorm > 0.75) ? 1 : 0;
    if (s.reverseHint > 1) inp.brake = 1;

    // ラバーバンド: 人間の先頭との差に応じて速度係数
    const base = k.baseMaxSpeed;
    let scale = lvl.speed * this.personality;
    if (ctx.humanProgress !== undefined && ctx.humanProgress !== null) {
      const gap = (s.totalProgress - ctx.humanProgress) * track.segLen; // 正 = AI が前
      if (gap > 80) scale *= 1 - lvl.band * 1.2;
      else if (gap > 30) scale *= 1 - lvl.band * 0.6;
      else if (gap < -120) scale *= 1 + lvl.band * 1.4;
      else if (gap < -50) scale *= 1 + lvl.band * 0.8;
    }
    k.params.maxSpeed = base * clamp(scale, 0.75, 1.15);

    // アイテム使用
    inp.itemPressed = false;
    inp.item = false;
    inp.itemBack = false;
    if (k.items.length > 0 && !k.roulette) {
      this.itemTimer += dt;
      if (this.itemTimer >= lvl.itemDelay * this.rng.range(0.6, 1.4)) {
        const use = this._decideItem(k.items[0], ctx);
        if (use) {
          inp.itemPressed = true;
          inp.item = true;
          inp.itemBack = use === 'back';
          this.itemTimer = 0;
        }
      }
    } else this.itemTimer = 0;
  }

  _turnAhead(idx, n) {
    let sum = 0;
    for (let i = 4; i < n; i++) sum += this.track.sample(idx + i).curvature;
    return sum * this.track.segLen;
  }

  _decideItem(item, ctx) {
    const k = this.kart;
    const s = k.state;
    const rank = ctx.rankOf(k);
    const total = ctx.karts.length;
    const near = (maxDist, ahead) => {
      for (const o of ctx.karts) {
        if (o === k) continue;
        const dx = o.state.x - s.x;
        const dz = o.state.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d > maxDist) continue;
        const fwd = dx * Math.sin(s.heading) + dz * Math.cos(s.heading);
        if (ahead ? fwd > 0 : fwd < 0) return true;
      }
      return false;
    };
    const straight = Math.abs(this._turnAhead(s.trackIndex, 30)) < 0.3;
    switch (item.id) {
      case 'banana':
        return near(18, false) || this.itemTimer > 8 ? 'back' : false;
      case 'greenShell':
        return near(40, true) ? 'front' : near(14, false) ? 'back' : this.itemTimer > 7 ? 'front' : false;
      case 'redShell':
        return rank > 1 && near(90, true) ? 'front' : this.itemTimer > 10 ? 'front' : false;
      case 'mushroom':
      case 'tripleMushroom':
      case 'goldenMushroom':
        return straight || s.surface === 'offroad' ? 'front' : false;
      case 'star':
        return 'front';
      case 'lightning':
        return rank >= Math.min(3, total) ? 'front' : this.itemTimer > 6 ? 'front' : false;
      case 'bomb':
        return near(32, true) ? 'front' : this.itemTimer > 9 ? 'front' : false;
      case 'boomerang':
        return near(36, true) ? 'front' : this.itemTimer > 8 ? 'front' : false;
      case 'superHorn': {
        const threatened = ctx.hazards.some((h) => h.type === 'redShell' && h.target === k && Math.hypot(h.x - s.x, h.z - s.z) < 22);
        return threatened || near(8, false) || this.itemTimer > 12 ? 'front' : false;
      }
      default:
        return 'front';
    }
  }
}

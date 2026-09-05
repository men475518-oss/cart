// アイテムシステム: アイテムボックス / ルーレット / 使用 / 飛び道具・設置物（ハザード）
import * as THREE from 'three';
import { ITEMS, itemWeightsForRank } from '../data/items.js';
import { weightedPick, wrapAngle, clamp, uid } from '../core/Utils.js';
import { applyBoost, spinOut, knockBack } from './KartPhysics.js';
import { toonMat } from './Materials.js';

const KART_R = 1.2;

// ---------- ハザードのメッシュ ----------
function shellMesh(color) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), toonMat(color));
  g.add(top);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.55, 0.22, 12), toonMat(0xfff4d6));
  rim.position.y = -0.1;
  g.add(rim);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), toonMat(0xffffff));
    spot.position.set(Math.cos(a) * 0.38, 0.32, Math.sin(a) * 0.38);
    g.add(spot);
  }
  return g;
}
function bananaMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), toonMat(0xffe066));
  body.scale.set(1, 0.55, 1);
  g.add(body);
  for (let i = 0; i < 3; i++) {
    const peel = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 5), toonMat(0xffd23f));
    const a = (i / 3) * Math.PI * 2;
    peel.position.set(Math.cos(a) * 0.4, 0.45, Math.sin(a) * 0.4);
    peel.rotation.z = -Math.cos(a) * 0.9;
    peel.rotation.x = Math.sin(a) * 0.9;
    g.add(peel);
  }
  return g;
}
function bombMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 10), toonMat(0x2b2b3b));
  g.add(body);
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 5), toonMat(0xaaaaaa));
  fuse.position.y = 0.7;
  g.add(fuse);
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffaa00 }));
  spark.position.y = 0.92;
  g.add(spark);
  g.userData.spark = spark;
  const eyes = new THREE.Group();
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    e.position.set(s * 0.2, 0.1, 0.52);
    eyes.add(e);
  }
  g.add(eyes);
  return g;
}
function boomerangMesh() {
  const g = new THREE.Group();
  const m = toonMat(0xf4a261);
  const a = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.35), m);
  a.position.x = 0.5;
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 1.4), m);
  b.position.z = 0.5;
  g.add(a, b);
  return g;
}
let _qmarkTex = null;
function questionMarkTexture() {
  if (_qmarkTex) return _qmarkTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 52px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 32, 36);
  _qmarkTex = new THREE.CanvasTexture(c);
  _qmarkTex.colorSpace = THREE.SRGBColorSpace;
  return _qmarkTex;
}

export function itemBoxMesh() {
  const g = new THREE.Group();
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 1.5, 1.5),
    new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, emissive: 0x4488ff, emissiveIntensity: 0.6 })
  );
  g.add(cube);
  // 各面に「?」
  const qm = questionMarkTexture();
  const faces = [
    [0, 0, 0.77, 0, 0],
    [0, 0, -0.77, 0, Math.PI],
    [0.77, 0, 0, 0, Math.PI / 2],
    [-0.77, 0, 0, 0, -Math.PI / 2],
  ];
  for (const [x, y, z, rx, ry] of faces) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: qm, transparent: true, depthWrite: false }));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    cube.add(m);
  }
  const inner = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
  g.add(inner);
  g.userData.cube = cube;
  g.userData.inner = inner;
  return g;
}

export class ItemSystem {
  constructor({ track, scene, karts, rng, events, fx, particles, net = null }) {
    this.track = track;
    this.scene = scene;
    this.karts = karts;
    this.rng = rng;
    this.events = events;
    this.fx = fx;
    this.particles = particles;
    this.net = net; // { sendSpawn(desc), sendHazardHit(id), sendLightning(), sendHorn(x,z), sendExplode(id) }
    this.hazards = [];
    this.boxes = [];
    this.time = 0;
    for (const spot of track.itemBoxSpots) {
      const mesh = itemBoxMesh();
      mesh.position.copy(spot.pos);
      scene.add(mesh);
      this.boxes.push({ spot, mesh, active: true, respawn: 0 });
    }
  }

  capacity(kart) {
    return kart.params.traits.items ? 2 : 1;
  }

  update(dt, rankOf) {
    this.time += dt;
    // アイテムボックス
    for (const b of this.boxes) {
      if (!b.active) {
        b.respawn -= dt;
        if (b.respawn <= 0) {
          b.active = true;
          b.mesh.visible = true;
        }
        continue;
      }
      b.mesh.rotation.y += dt * 1.5;
      b.mesh.rotation.x += dt * 0.7;
      b.mesh.userData.inner.rotation.y -= dt * 3;
      b.mesh.userData.cube.material.emissive.setHSL((this.time * 0.3 + b.spot.lateral) % 1, 0.8, 0.5);
      for (const k of this.karts) {
        if (k.state.finished) continue;
        const dx = k.state.x - b.spot.pos.x;
        const dz = k.state.z - b.spot.pos.z;
        if (dx * dx + dz * dz < 2.2 * 2.2) {
          b.active = false;
          b.respawn = 3;
          b.mesh.visible = false;
          this.particles.burst(b.spot.pos.x, b.spot.pos.y, b.spot.pos.z, 12, [0xffffff, 0x88ccff, 0xffd23f], 6, 0.5, 4, 2);
          if (!k.remote && k.items.length + (k.roulette ? 1 : 0) < this.capacity(k)) {
            k.roulette = { t: 0, dur: 1.5, current: this.rng.pick(Object.keys(ITEMS)), tick: 0 };
            this.events.push({ type: 'itembox', kart: k });
          }
          break;
        }
      }
    }
    // ルーレット
    for (const k of this.karts) {
      if (!k.roulette) continue;
      const r = k.roulette;
      r.t += dt;
      r.tick += dt;
      if (r.tick > 0.09) {
        r.tick = 0;
        r.current = this.rng.pick(Object.keys(ITEMS));
        if (k.isHuman) this.events.push({ type: 'roulette', kart: k });
      }
      if (r.t >= r.dur) {
        const n = this.karts.length;
        const rank = rankOf(k);
        const frac = n > 1 ? (rank - 1) / (n - 1) : 0;
        const luck = k.params.traits.items ? 1.25 : 1;
        const id = weightedPick(itemWeightsForRank(frac, luck), this.rng());
        const def = ITEMS[id];
        k.items.push({ id, uses: def.uses || 1 });
        k.roulette = null;
        this.events.push({ type: 'itemGet', kart: k, item: id });
      }
    }
    // ゴールデンキノコの時間切れ
    for (const k of this.karts) {
      if (k.state.goldenActive && k.state.goldenTime <= 0) {
        k.state.goldenActive = false;
        const idx = k.items.findIndex((it) => it.id === 'goldenMushroom');
        if (idx >= 0) k.items.splice(idx, 1);
      }
    }
    // 構えているアイテムを持ち主の後ろに追従させる
    for (const h of this.hazards) {
      if (h.dead || !h.heldBy) continue;
      const os = h.heldBy.state;
      const back = h.type === 'banana' ? 2.6 : 2.9;
      h.x = os.x - Math.sin(os.heading) * back;
      h.z = os.z - Math.cos(os.heading) * back;
      const hq = this.track.query(h, os.trackIndex);
      h.y = hq.height + 0.5 + (os.hop || 0);
      h.index = hq.index;
      h.mesh.position.set(h.x, h.y, h.z);
      if (h.type !== 'banana') h.mesh.rotation.y += dt * 4;
    }
    // ハザード
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.age += dt;
      if (!h.heldBy) h.ttl -= dt;
      if (!h.heldBy) this._moveHazard(h, dt);
      if (h.ttl <= 0 && !h.dead) {
        if (h.type === 'bomb') this._explode(h);
        h.dead = true;
      }
      if (!h.dead) this._checkHits(h);
      if (h.dead) {
        this.scene.remove(h.mesh);
        this.hazards.splice(i, 1);
      }
    }
    // ハザード同士（こうらがバナナやこうらを壊す）
    for (let i = 0; i < this.hazards.length; i++) {
      const a = this.hazards[i];
      if (a.dead || (a.type !== 'greenShell' && a.type !== 'redShell')) continue;
      for (let j = 0; j < this.hazards.length; j++) {
        if (i === j) continue;
        const b = this.hazards[j];
        if (b.dead || b.type === 'boomerang') continue;
        if (a.heldBy && a.heldBy === b.heldBy) continue;
        if (Math.hypot(a.x - b.x, a.z - b.z) < 1.6) {
          if (b.heldBy) this.events.push({ type: 'shieldBlock', kart: b.heldBy });
          this._destroy(a, true);
          this._destroy(b, true);
        }
      }
    }
  }

  _moveHazard(h, dt) {
    const track = this.track;
    const q = {};
    switch (h.type) {
      case 'banana':
        break;
      case 'greenShell':
      case 'redShell': {
        if (h.type === 'redShell') this._homeRedShell(h, dt);
        h.x += h.vx * dt;
        h.z += h.vz * dt;
        track.query(h, h.index, q);
        h.index = q.index;
        if (Math.abs(q.lateral) > track.wallDist - 0.6) {
          const sign = Math.sign(q.lateral);
          const nx = q.right.x * sign;
          const nz = q.right.z * sign;
          const dot = h.vx * nx + h.vz * nz;
          if (dot > 0) {
            h.vx -= 2 * dot * nx;
            h.vz -= 2 * dot * nz;
            const over = Math.abs(q.lateral) - (track.wallDist - 0.6);
            h.x -= nx * over;
            h.z -= nz * over;
            h.bounces++;
            this.events.push({ type: 'shellBounce', x: h.x, z: h.z });
            if (h.type === 'redShell' || h.bounces > 5) this._destroy(h, true);
          }
        }
        h.y = q.height + 0.5;
        h.mesh.position.set(h.x, h.y, h.z);
        h.mesh.rotation.y += dt * 10;
        break;
      }
      case 'bomb': {
        if (!h.landed) {
          h.vy -= 24 * dt;
          h.x += h.vx * dt;
          h.z += h.vz * dt;
          h.y += h.vy * dt;
          track.query(h, h.index, q);
          h.index = q.index;
          if (Math.abs(q.lateral) > track.wallDist - 0.6) {
            h.vx *= -0.3;
            h.vz *= -0.3;
          }
          if (h.y <= q.height + 0.6 && h.vy < 0) {
            h.y = q.height + 0.6;
            h.landed = true;
            h.ttl = Math.min(h.ttl, 1.2);
            h.vx = h.vz = 0;
            this.events.push({ type: 'drop', x: h.x, z: h.z });
          }
        }
        const spark = h.mesh.userData.spark;
        if (spark) spark.visible = Math.floor(h.age * (h.landed ? 12 : 4)) % 2 === 0;
        h.mesh.position.set(h.x, h.y, h.z);
        break;
      }
      case 'boomerang': {
        const owner = h.owner;
        if (h.phase === 'out') {
          h.x += h.vx * dt;
          h.z += h.vz * dt;
          if (h.age > 0.75) h.phase = 'back';
          track.query(h, h.index, q);
          h.index = q.index;
          if (Math.abs(q.lateral) > track.wallDist - 0.6) h.phase = 'back';
        } else if (owner) {
          const dx = owner.state.x - h.x;
          const dz = owner.state.z - h.z;
          const d = Math.hypot(dx, dz) || 1;
          const sp = 62;
          h.x += (dx / d) * sp * dt;
          h.z += (dz / d) * sp * dt;
          if (d < 2.2) {
            h.dead = true;
            this.events.push({ type: 'boomerangCatch', kart: owner });
          }
          track.query(h, h.index, q);
          h.index = q.index;
        } else h.dead = true;
        h.y = (q.height ?? h.y) + 1.0;
        h.mesh.position.set(h.x, h.y, h.z);
        h.mesh.rotation.y += dt * 18;
        break;
      }
      default:
        break;
    }
  }

  _homeRedShell(h, dt) {
    const track = this.track;
    let target = h.target;
    if (target && (target.state.finished || target.state.starTime > 0 && h.age > 6)) target = null;
    let desired;
    const sp = Math.hypot(h.vx, h.vz) || 66;
    if (target) {
      const dx = target.state.x - h.x;
      const dz = target.state.z - h.z;
      const d = Math.hypot(dx, dz);
      if (d < 28) {
        desired = Math.atan2(dx, dz);
      } else {
        // トラックに沿って追いかける
        const s = track.sample(h.index + 7);
        const lat = clamp(target.state.lateral, -track.halfWidth * 0.8, track.halfWidth * 0.8);
        desired = Math.atan2(s.pos.x + s.right.x * lat - h.x, s.pos.z + s.right.z * lat - h.z);
      }
    } else {
      const s = track.sample(h.index + 7);
      desired = Math.atan2(s.pos.x - h.x, s.pos.z - h.z);
    }
    let cur = Math.atan2(h.vx, h.vz);
    const diff = wrapAngle(desired - cur);
    const maxTurn = 4.5 * dt;
    cur += clamp(diff, -maxTurn, maxTurn);
    h.vx = Math.sin(cur) * sp;
    h.vz = Math.cos(cur) * sp;
  }

  _checkHits(h) {
    for (const k of this.karts) {
      if (k.remote) continue; // リモートのカートは相手側で判定
      const s = k.state;
      if (s.finished && h.type !== 'banana') continue;
      if (h.heldBy === k) continue; // 構えている本人には当たらない
      if (h.owner === k && !h.heldBy && h.age < (h.type === 'boomerang' ? 0.5 : h.type === 'banana' ? 1.0 : 0.6)) continue;
      if (h.type === 'boomerang' && h.owner === k) continue;
      if (h.hitCooldown && h.hitCooldown.get(k) > this.time) continue;
      const dx = s.x - h.x;
      const dz = s.z - h.z;
      const r = KART_R + (h.type === 'boomerang' ? 1.4 : 0.9);
      if (dx * dx + dz * dz > r * r) continue;
      if (h.type === 'bomb') {
        if (h.landed || h.owner !== k) this._explode(h);
        return;
      }
      if (s.starTime > 0) {
        // スター中はハザードを弾き飛ばす
        if (h.type !== 'boomerang') this._destroy(h, true);
        continue;
      }
      if (h.type === 'boomerang') {
        if (spinOut(k, 0.8)) this.events.push({ type: 'hit', kart: k, by: h.owner, item: 'boomerang' });
        h.hitCooldown = h.hitCooldown || new Map();
        h.hitCooldown.set(k, this.time + 1.5);
        continue;
      }
      if (spinOut(k, h.type === 'banana' ? 0.9 : 1)) this.events.push({ type: 'hit', kart: k, by: h.owner, item: h.type });
      this._destroy(h, true);
      return;
    }
  }

  _destroy(h, notify) {
    if (h.dead) return;
    h.dead = true;
    this.particles.burst(h.x, h.y, h.z, 10, [0xffffff, 0xffd23f], 5, 0.4, 6, 3);
    if (notify && this.net && h.local) this.net.sendHazardHit(h.id);
  }

  _explode(h) {
    if (h.dead) return;
    h.dead = true;
    const pos = new THREE.Vector3(h.x, h.y, h.z);
    this.fx.explosion(pos, 7.5);
    this.events.push({ type: 'explosion', x: h.x, z: h.z });
    for (const k of this.karts) {
      if (k.remote) continue;
      const d = Math.hypot(k.state.x - h.x, k.state.z - h.z);
      if (d < 7.5) {
        if (knockBack(k, h.x, h.z, 1)) this.events.push({ type: 'hit', kart: k, by: h.owner, item: 'bomb' });
      }
    }
    if (this.net && h.local) this.net.sendHazardHit(h.id);
  }

  /** ネットワーク: 相手側でハザードが消えた */
  removeHazard(id) {
    const h = this.hazards.find((x) => x.id === id);
    if (h && !h.dead) {
      if (h.type === 'bomb') this._explode(h);
      else h.dead = true;
    }
  }

  /** ハザード生成（ローカル使用時 & ネットワーク受信時の両方） */
  spawnHazard(desc, local = true) {
    const { type, x, z, heading, ownerId, targetId } = desc;
    const owner = this.karts.find((k) => k.id === ownerId) || null;
    const target = targetId ? this.karts.find((k) => k.id === targetId) || null : null;
    let mesh;
    const h = { id: desc.id || uid(), type, x, y: 0, z, vx: 0, vz: 0, vy: 0, owner, ownerId, target, index: null, age: 0, ttl: 30, bounces: 0, dead: false, local };
    const q = this.track.query(h, owner ? owner.state.trackIndex : null);
    h.index = q.index;
    h.y = q.height + 0.6;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    switch (type) {
      case 'banana':
        mesh = bananaMesh();
        h.ttl = 40;
        break;
      case 'greenShell':
        mesh = shellMesh(0x3fb950);
        h.vx = fx * 70;
        h.vz = fz * 70;
        h.ttl = 9;
        break;
      case 'redShell':
        mesh = shellMesh(0xff4d4d);
        h.vx = fx * 66;
        h.vz = fz * 66;
        h.ttl = 12;
        break;
      case 'bomb':
        mesh = bombMesh();
        h.vx = fx * 26;
        h.vz = fz * 26;
        h.vy = 11;
        h.y += 0.8;
        h.ttl = 6;
        h.landed = false;
        break;
      case 'boomerang':
        mesh = boomerangMesh();
        h.vx = fx * 58;
        h.vz = fz * 58;
        h.phase = 'out';
        h.ttl = 4;
        break;
      default:
        return null;
    }
    mesh.position.set(h.x, h.y, h.z);
    h.mesh = mesh;
    this.scene.add(mesh);
    this.hazards.push(h);
    if (local && this.net) this.net.sendSpawn({ id: h.id, type, x, z, heading, ownerId, targetId });
    return h;
  }

  /** 持ち主が構えているハザード */
  heldOf(kart) {
    return this.hazards.find((h) => !h.dead && h.heldBy === kart) || null;
  }

  /** 構えていたアイテムを放す。前方向きなら投げ、後ろ向きならその場に置く */
  releaseHeld(kart, forward = true) {
    const h = this.heldOf(kart);
    if (!h) return false;
    const s = kart.state;
    h.heldBy = null;
    h.age = 0;
    if (h.type === 'banana') {
      h.ttl = 40;
    } else if (forward) {
      const fx = Math.sin(s.heading);
      const fz = Math.cos(s.heading);
      h.x = s.x + fx * 2.5;
      h.z = s.z + fz * 2.5;
      const sp = h.type === 'redShell' ? 66 : 70;
      h.vx = fx * sp;
      h.vz = fz * sp;
      h.ttl = h.type === 'redShell' ? 12 : 9;
      this.events.push({ type: 'itemUse', kart, item: h.type, sfx: 'shell' });
    } else {
      const sp = h.type === 'redShell' ? 66 : 70;
      h.vx = -Math.sin(s.heading) * sp;
      h.vz = -Math.cos(s.heading) * sp;
      h.ttl = 9;
      this.events.push({ type: 'itemUse', kart, item: h.type, sfx: 'shell' });
    }
    if (this.net) this.net.sendSpawn({ id: h.id, type: h.type, x: h.x, z: h.z, heading: Math.atan2(h.vx, h.vz), ownerId: kart.id, targetId: h.target?.id || null });
    return true;
  }

  /** 後ろに構えられるアイテムか */
  canHold(id) {
    return id === 'banana' || id === 'greenShell' || id === 'redShell';
  }

  /** アイテム使用。back = 後ろに投げる / hold = 後ろに構える */
  useItem(kart, back = false, rankOf = null, hold = false) {
    if (kart.items.length === 0) return false;
    const it = kart.items[0];
    // 構える（防御）: バナナ・こうらを後ろに保持して盾にする
    if (hold && this.canHold(it.id) && !this.heldOf(kart)) {
      const s0 = kart.state;
      let target = null;
      if (it.id === 'redShell' && rankOf) {
        const myRank = rankOf(kart);
        let best = null;
        for (const o of this.karts) {
          if (o === kart || o.state.finished) continue;
          const r = rankOf(o);
          if (r < myRank && (best === null || r > rankOf(best))) best = o;
        }
        target = best;
      }
      const h = this.spawnHazard(
        { id: uid(), type: it.id, x: s0.x - Math.sin(s0.heading) * 2.8, z: s0.z - Math.cos(s0.heading) * 2.8, heading: s0.heading, ownerId: kart.id, targetId: target ? target.id : null },
        false
      );
      if (h) {
        h.heldBy = kart;
        h.vx = h.vz = 0;
        it.uses--;
        if (it.uses <= 0) kart.items.shift();
        this.events.push({ type: 'itemHold', kart, item: it.id });
        return true;
      }
    }
    const s = kart.state;
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    const consume = () => {
      it.uses--;
      if (it.uses <= 0) kart.items.shift();
    };
    const spawnAt = (type, dist, heading, targetId) =>
      this.spawnHazard({ id: uid(), type, x: s.x + fx * dist, z: s.z + fz * dist, heading, ownerId: kart.id, targetId }, true);
    switch (it.id) {
      case 'banana':
        spawnAt('banana', back ? -3 : 3.5, s.heading);
        consume();
        this.events.push({ type: 'itemUse', kart, item: 'banana', sfx: 'drop' });
        return true;
      case 'greenShell':
        spawnAt('greenShell', back ? -2.5 : 2.5, back ? s.heading + Math.PI : s.heading);
        consume();
        this.events.push({ type: 'itemUse', kart, item: 'greenShell', sfx: 'shell' });
        return true;
      case 'redShell': {
        let target = null;
        if (!back && rankOf) {
          const myRank = rankOf(kart);
          let best = null;
          for (const o of this.karts) {
            if (o === kart || o.state.finished) continue;
            const r = rankOf(o);
            if (r < myRank && (best === null || r > rankOf(best))) best = o;
          }
          target = best;
        }
        spawnAt('redShell', back ? -2.5 : 2.5, back ? s.heading + Math.PI : s.heading, target ? target.id : null);
        consume();
        this.events.push({ type: 'itemUse', kart, item: 'redShell', sfx: 'shell' });
        return true;
      }
      case 'mushroom':
      case 'tripleMushroom':
        applyBoost(kart, 1.3 * kart.params.boostDurMult, 1.42);
        consume();
        this.events.push({ type: 'itemUse', kart, item: 'mushroom', sfx: 'mushroom' });
        return true;
      case 'goldenMushroom':
        if (!s.goldenActive) {
          s.goldenActive = true;
          s.goldenTime = 8;
          s.goldenCooldown = 0;
          this.events.push({ type: 'itemUse', kart, item: 'goldenMushroom', sfx: 'golden' });
        }
        if ((s.goldenCooldown || 0) <= this.time) {
          applyBoost(kart, 0.9 * kart.params.boostDurMult, 1.42);
          s.goldenCooldown = this.time + 0.35;
          this.events.push({ type: 'boost', kart });
        }
        return true;
      case 'star':
        s.starTime = 7.5;
        consume();
        this.events.push({ type: 'itemUse', kart, item: 'star', sfx: 'star' });
        return true;
      case 'lightning':
        consume();
        this.applyLightning(kart);
        if (this.net) this.net.sendLightning(kart.id);
        return true;
      case 'bomb':
        spawnAt('bomb', back ? -3 : 3, back ? s.heading + Math.PI : s.heading);
        consume();
        this.events.push({ type: 'itemUse', kart, item: 'bomb', sfx: 'throw' });
        return true;
      case 'boomerang':
        spawnAt('boomerang', 2, s.heading);
        consume();
        this.events.push({ type: 'itemUse', kart, item: 'boomerang', sfx: 'boomerang' });
        return true;
      case 'superHorn':
        consume();
        this.applyHorn(kart);
        if (this.net) this.net.sendHorn(kart.id, s.x, s.z);
        return true;
      default:
        consume();
        return false;
    }
  }

  applyLightning(from) {
    this.events.push({ type: 'lightning', kart: from });
    for (const k of this.karts) {
      if (k === from || k.remote) continue;
      const s = k.state;
      if (s.starTime > 0) continue;
      s.squashTime = 4.5;
      s.speed *= 0.4;
      s.boostTime = 0;
      s.drifting = false;
      this.events.push({ type: 'squashed', kart: k });
    }
  }

  applyHorn(from) {
    const s = from.state;
    this.fx.shockwave(new THREE.Vector3(s.x, s.y, s.z), 10);
    this.events.push({ type: 'horn', kart: from });
    for (const h of this.hazards) {
      if (h.dead) continue;
      if (Math.hypot(h.x - s.x, h.z - s.z) < 12) this._destroy(h, true);
    }
    for (const k of this.karts) {
      if (k === from || k.remote) continue;
      if (Math.hypot(k.state.x - s.x, k.state.z - s.z) < 9) {
        if (knockBack(k, s.x, s.z, 0.8)) this.events.push({ type: 'hit', kart: k, by: from, item: 'superHorn' });
      }
    }
  }

  dispose() {
    for (const h of this.hazards) this.scene.remove(h.mesh);
    for (const b of this.boxes) this.scene.remove(b.mesh);
    this.hazards = [];
    this.boxes = [];
  }
}

// コースのしかけ（ギミック）。course.gimmicks に並べた定義から作る。
//   roller   … 道を横切って転がる丸太。当たるとスピン
//   gate     … 開いたり閉じたりする門。閉まっているときに当たると弾かれる
//   pendulum … 左右にふれる鉄球。当たると弾かれる
//   geyser   … ときどき噴き上がる噴水・溶岩。乗っていると打ち上げられる
//   fan      … 横風を送る送風機。通ると横に押される
//   ring     … くぐるとダッシュできる光の輪（うれしいしかけ）
import * as THREE from 'three';
import { toonMat } from './Materials.js';
import { applyBoost, spinOut, knockBack } from './KartPhysics.js';

const HIT_R = 1.5; // カートの当たり判定の半径
const KART_HALF_W = 0.9; // カートの車幅の半分（すきまを通れるかの判定に使う）
const GATE_MIN_GAP = 2.1; // 門がいちばん狭いときのすきま（半分）。完全にはふさがない

/** 定義の at（制御点インデックス）からコース上の位置を求める */
function anchor(track, def) {
  const index = track.cpToIndex(def.at);
  const s = track.samples[index];
  const lat = (def.lane || 0) * track.halfWidth * 0.7;
  const pos = s.pos.clone().addScaledVector(s.right, lat);
  return { index, sample: s, pos, lat };
}

/** 周期のなかの位相 0..1 */
function phase(time, period, offset = 0) {
  const p = ((time / period + offset) % 1 + 1) % 1;
  return p;
}

export class GimmickSystem {
  constructor({ track, scene, karts, events, particles, course }) {
    this.track = track;
    this.scene = scene;
    this.karts = karts;
    this.events = events;
    this.particles = particles;
    this.time = 0;
    this.items = [];
    this.group = new THREE.Group();
    for (const def of course.gimmicks || []) {
      const made = this._build(def);
      if (made) {
        this.items.push(made);
        this.group.add(made.node);
      }
    }
    scene.add(this.group);
  }

  _build(def) {
    const a = anchor(this.track, def);
    const s = a.sample;
    const heading = s.heading;
    const period = def.period || 4;
    const offset = def.offset || 0;
    const node = new THREE.Group();
    node.position.copy(a.pos);
    node.rotation.y = heading;

    switch (def.type) {
      case 'roller': {
        // 道を横切って転がる丸太。丸太とふたをひとまとめにして左右に動かす
        const len = def.len || this.track.width * 0.5;
        const slider = new THREE.Group();
        const log = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, len, 10), toonMat(def.color ?? 0x8d5a2b));
        log.rotation.z = Math.PI / 2; // 横向きに寝かせる
        log.position.y = 1.0;
        slider.add(log);
        for (const e of [-1, 1]) {
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.25, 10), toonMat(0xd9a066));
          cap.rotation.z = Math.PI / 2;
          cap.position.set((e * len) / 2, 1.0, 0);
          slider.add(cap);
        }
        node.add(slider);
        const range = def.range ?? this.track.halfWidth * 0.75;
        return { def, node, kind: 'roller', slider, log, len, range, period, offset, r: 1.3, cool: new Map() };
      }
      case 'gate': {
        // 左右のとびらのあいだに、道を横切って動く「通れるすきま」ができる。
        // 完全にはふさがないので、位置さえ合えばいつでも通りぬけられる
        const half = this.track.halfWidth;
        const doors = [];
        for (const side of [-1, 1]) {
          const d = new THREE.Mesh(new THREE.BoxGeometry(half, 2.4, 0.5), toonMat(side < 0 ? 0xff5c8a : 0x4cc9f0));
          d.position.set(side * half * 1.5, 1.4, 0);
          node.add(d);
          doors.push({ mesh: d, side });
        }
        for (const side of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 4, 8), toonMat(0xdfe4ea));
          post.position.set(side * (half + 0.6), 2, 0);
          node.add(post);
        }
        return { def, node, kind: 'gate', doors, period, offset, half, cool: new Map() };
      }
      case 'pendulum': {
        // 上から吊るされて左右にふれる鉄球
        const arm = new THREE.Group();
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 7, 6), toonMat(0xaaaaaa));
        rope.position.y = -3.5;
        arm.add(rope);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(1.3, 14, 10), toonMat(def.color ?? 0x555a66));
        ball.position.y = -7;
        arm.add(ball);
        arm.position.y = 8.5;
        node.add(arm);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(this.track.width + 3, 0.4, 0.4), toonMat(0xdfe4ea));
        bar.position.y = 8.5;
        node.add(bar);
        return { def, node, kind: 'pendulum', arm, ball, swing: def.swing ?? 0.9, period, offset, r: 1.9 };
      }
      case 'geyser': {
        // ときどき噴き上がる。噴いている間に乗っていると打ち上げられる
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.3, 8, 20), toonMat(def.color ?? 0x7a6a5a));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.1;
        node.add(ring);
        // 蒸気は先が広がる形にして、上ほど薄くする
        const jet = new THREE.Mesh(
          new THREE.CylinderGeometry(2.2, 1.1, 8, 14, 1, true),
          new THREE.MeshBasicMaterial({
            color: def.jetColor ?? 0xdfe8ff,
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        );
        jet.position.y = 4;
        node.add(jet);
        return { def, node, kind: 'geyser', jet, period, offset, up: def.up ?? 13, r: 2.0, active: false };
      }
      case 'fan': {
        // 横風。羽根が回っていて、前を通ると横へ押される
        const side = def.side ?? -1;
        const body = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.8, 12), toonMat(0xdfe4ea));
        body.rotation.z = Math.PI / 2;
        const blades = new THREE.Group();
        for (let i = 0; i < 4; i++) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.6, 0.5), toonMat(def.color ?? 0x4cc9f0));
          b.rotation.x = (i / 4) * Math.PI * 2;
          blades.add(b);
        }
        blades.rotation.z = Math.PI / 2;
        const holder = new THREE.Group();
        holder.add(body, blades);
        holder.position.set(side * (this.track.halfWidth + 2.2), 2, 0);
        node.add(holder);
        return { def, node, kind: 'fan', blades, side, power: def.power ?? 15, span: def.span ?? 10 };
      }
      case 'ring': {
        // くぐるとダッシュできる光の輪
        const torus = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.28, 10, 24), toonMat(0xffd23f, { emissive: 0xffaa00, emissiveIntensity: 0.8 }));
        torus.position.y = 2.6;
        node.add(torus);
        return { def, node, kind: 'ring', torus, r: 2.6, cool: new Map() };
      }
      default:
        return null;
    }
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    for (const g of this.items) {
      switch (g.kind) {
        case 'roller':
          this._roller(g, t, dt);
          break;
        case 'gate':
          this._gate(g, t);
          break;
        case 'pendulum':
          this._pendulum(g, t);
          break;
        case 'geyser':
          this._geyser(g, t, dt);
          break;
        case 'fan':
          this._fan(g, t, dt);
          break;
        case 'ring':
          this._ring(g, t, dt);
          break;
        default:
          break;
      }
    }
  }

  /** そのしかけの中心から見たカートの位置（前後・左右）。node の向きに合わせて回す */
  _local(g, s) {
    const dx = s.x - g.node.position.x;
    const dz = s.z - g.node.position.z;
    const h = g.node.rotation.y;
    const sin = Math.sin(h);
    const cos = Math.cos(h);
    return { along: dx * sin + dz * cos, lat: dx * cos - dz * sin };
  }

  _forEachKart(fn, skipHurt = false) {
    for (const k of this.karts) {
      const s = k.state;
      if (s.finished || k.gone || k.remote) continue;
      // すでにぶつかって立ち直り中のカートは対象外。
      // これがないと同じしかけに毎フレーム当たりつづけて動けなくなる
      if (skipHurt && (s.spinTime > 0 || s.stunTime > 0)) continue;
      fn(k, s);
    }
  }

  _roller(g, t, dt) {
    const p = phase(t, g.period, g.offset);
    const x = Math.sin(p * Math.PI * 2) * g.range;
    g.slider.position.x = x;
    // 進む向きに合わせて転がる
    g.log.rotation.x -= dt * 3.2 * Math.cos(p * Math.PI * 2);
    this._forEachKart((k, s) => {
      const l = this._local(g, s);
      if (Math.abs(l.along) > g.r + HIT_R) return;
      if (Math.abs(l.lat - x) > g.len / 2 + HIT_R * 0.5) return;
      if ((s.hop || 0) > 1.6) return; // ジャンプで飛び越えられる
      if (t < (g.cool.get(k) || 0)) return;
      if (spinOut(k, 0.9)) {
        g.cool.set(k, t + 2);
        this.events.push({ type: 'gimmickHit', kart: k, gimmick: 'roller' });
      }
    }, true);
  }

  _gate(g, t) {
    const p = phase(t, g.period, g.offset);
    // すきまの中心が道を左右に行き来し、幅も少し伸び縮みする
    const travel = Math.max(0, g.half - GATE_MIN_GAP - 1.0);
    const center = Math.sin(p * Math.PI * 2) * travel;
    const gapHalf = GATE_MIN_GAP + 0.8 * (0.5 + 0.5 * Math.cos(p * Math.PI * 4));
    g.center = center;
    g.gapHalf = gapHalf;
    // とびらは幅 half*2 の板。内側のふちがすきまのふちに来るように置く
    for (const d of g.doors) {
      const inner = center + d.side * gapHalf;
      d.mesh.position.x = inner + (d.side * g.half) / 2;
    }
    this._forEachKart((k, s) => {
      const l = this._local(g, s);
      if (Math.abs(l.along) > 1.2 + HIT_R) return;
      // とびらは道の上だけをふさぐ。路肩まではみ出していないので、
      // 外へはじき出されたカートがここで永久に止まってしまうことはない
      if (Math.abs(l.lat) > this.track.halfWidth + 0.5) return;
      if (Math.abs(l.lat - center) + KART_HALF_W < gapHalf) return; // すきまを通れた
      // 一度はじかれたらしばらく当たらない。そうしないと、はじかれて戻ってきた
      // ところをまた同じとびらに当てられて、いつまでも先へ進めない
      if (t < (g.cool.get(k) || 0)) return;
      // とびらの少し先を押しどころにして、進行方向の逆へはじき返す。
      // とびらの中心を使うと、まん中で止まったとき押す向きが決まらない
      const h = g.node.rotation.y;
      if (knockBack(k, g.node.position.x + Math.sin(h) * 2.5, g.node.position.z + Math.cos(h) * 2.5, 0.8)) {
        g.cool.set(k, t + 2.5);
        this.events.push({ type: 'gimmickHit', kart: k, gimmick: 'gate' });
      }
    }, true);
  }

  _pendulum(g, t) {
    const a = Math.sin(phase(t, g.period, g.offset) * Math.PI * 2) * g.swing;
    g.arm.rotation.z = a;
    const bx = Math.sin(a) * 7;
    this._forEachKart((k, s) => {
      const l = this._local(g, s);
      if (Math.abs(l.along) > g.r + HIT_R) return;
      if (Math.abs(l.lat + bx) > g.r + HIT_R) return;
      const by = 8.5 - Math.cos(a) * 7; // 鉄球の高さ
      if (by > 2.6) return; // 高い位置なら下をくぐれる
      if (knockBack(k, g.node.position.x, g.node.position.z, 1.4)) {
        this.events.push({ type: 'gimmickHit', kart: k, gimmick: 'pendulum' });
      }
    }, true);
  }

  _geyser(g, t, dt) {
    const p = phase(t, g.period, g.offset);
    const on = p > 0.62; // 4割弱の時間だけ噴く
    const h = on ? Math.min(1, (p - 0.62) / 0.12) * (1 - Math.max(0, (p - 0.92) / 0.08)) : 0;
    g.jet.visible = h > 0.02;
    g.jet.scale.set(1, Math.max(0.05, h), 1);
    g.jet.position.y = 4 * Math.max(0.05, h);
    // 噴きだしの瞬間に蒸気のかたまりを飛ばす
    if (on && !g.active) {
      g.active = true;
      const p = g.node.position;
      if (this.particles) {
        for (let i = 0; i < 14; i++) {
          this.particles.emit(
            p.x + (Math.random() - 0.5) * 2.4,
            p.y + 1,
            p.z + (Math.random() - 0.5) * 2.4,
            (Math.random() - 0.5) * 4,
            9 + Math.random() * 7,
            (Math.random() - 0.5) * 4,
            0xffffff,
            2.6,
            1.1
          );
        }
      }
      this.events.push({ type: 'gimmickFire', gimmick: 'geyser', x: p.x, y: p.y, z: p.z });
    } else if (!on) g.active = false;
    // 噴いているあいだは少しゆらぐ
    if (g.jet.visible) {
      const w = 1 + Math.sin(t * 11) * 0.09;
      g.jet.scale.x = w;
      g.jet.scale.z = w;
      g.jet.material.opacity = 0.28 + h * 0.34;
    }
    if (h < 0.4) return;
    this._forEachKart((k, s) => {
      const l = this._local(g, s);
      if (Math.hypot(l.along, l.lat) > g.r + HIT_R) return;
      if (s.airborne) return;
      s.vy = Math.max(s.vy, g.up);
      s.airborne = true;
      s.airTime = 0;
      s.hop = Math.max(s.hop, 0.4);
      this.events.push({ type: 'gimmickLaunch', kart: k, gimmick: 'geyser' });
    });
  }

  _fan(g, t, dt) {
    g.blades.rotation.x += dt * 9;
    this._forEachKart((k, s) => {
      const l = this._local(g, s);
      if (Math.abs(l.along) > g.span) return;
      if ((s.hop || 0) > 2.5) return;
      // 風は道の横向き。node の向きに合わせて押す
      const h = g.node.rotation.y;
      const rx = Math.cos(h);
      const rz = -Math.sin(h);
      const fade = 1 - Math.abs(l.along) / g.span;
      const push = -g.side * g.power * fade * dt;
      s.x += rx * push;
      s.z += rz * push;
      s.knockVx += rx * push * 0.6;
      s.knockVz += rz * push * 0.6;
    });
  }

  _ring(g, t, dt) {
    g.torus.rotation.z += dt * 1.2;
    const pulse = 1 + Math.sin(t * 4) * 0.05;
    g.torus.scale.set(pulse, pulse, 1);
    this._forEachKart((k, s) => {
      const until = g.cool.get(k) || 0;
      if (t < until) return;
      const l = this._local(g, s);
      if (Math.abs(l.along) > 1.6) return;
      if (Math.abs(l.lat) > g.r) return;
      g.cool.set(k, t + 2);
      applyBoost(k, 1.0 * k.params.boostDurMult, 1.4);
      this.events.push({ type: 'gimmickBoost', kart: k, gimmick: 'ring' });
    });
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        if (o.material.dispose) o.material.dispose();
      }
    });
  }
}

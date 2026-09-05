// コイン: コース上に並んでいて、取ると最高速が少し上がる（最大 10 枚）。被弾すると 3 枚落とす
import * as THREE from 'three';
import { toonMat } from './Materials.js';
import { MAX_COINS } from './KartPhysics.js';

const RESPAWN_SEC = 25;
const PICK_RADIUS = 1.7;
const HIDE_NEAR_CAM = 6.2; // カメラのすぐそばに来たコインは画面いっぱいの黄色い板になるので消す

const _m4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisX = new THREE.Vector3(1, 0, 0);
const _tilt = new THREE.Quaternion().setFromAxisAngle(_axisX, Math.PI / 2);

export class CoinSystem {
  constructor({ track, scene, karts, events }) {
    this.track = track;
    this.scene = scene;
    this.karts = karts;
    this.events = events;
    this.spots = track.coinSpots;
    this.time = 0;
    const geo = new THREE.CylinderGeometry(0.55, 0.55, 0.14, 16);
    const mat = toonMat(0xffd23f, { emissive: 0x8a6a00, emissiveIntensity: 0.55 });
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, this.spots.length));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.state = this.spots.map(() => ({ active: true, respawn: 0 }));
    scene.add(this.mesh);
    this._layout(0);
  }

  _layout(angle, cams) {
    for (let i = 0; i < this.spots.length; i++) {
      const sp = this.spots[i];
      const st = this.state[i];
      const bob = Math.sin(angle * 1.3 + i) * 0.12;
      _pos.set(sp.pos.x, sp.pos.y + bob, sp.pos.z);
      _quat.setFromAxisAngle(_axisY, angle + i * 0.7).multiply(_tilt);
      let sc = st.active ? 1 : 0.0001;
      if (sc > 0.5 && cams) {
        for (const c of cams) {
          // カメラはカートから 8m 以上離れているので、取れる位置のコインは消えない
          if (_pos.distanceToSquared(c) < HIDE_NEAR_CAM * HIDE_NEAR_CAM) {
            sc = 0.0001;
            break;
          }
        }
      }
      _scale.set(sc, sc, sc);
      _m4.compose(_pos, _quat, _scale);
      this.mesh.setMatrixAt(i, _m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt, cams = null) {
    this.time += dt;
    const angle = this.time * 3;
    for (let i = 0; i < this.spots.length; i++) {
      const sp = this.spots[i];
      const st = this.state[i];
      if (!st.active) {
        st.respawn -= dt;
        if (st.respawn <= 0) st.active = true;
        continue;
      }
      for (const k of this.karts) {
        const s = k.state;
        if (s.finished || k.gone) continue;
        if ((s.hop || 0) > 1.6) continue; // 高く飛んでいる最中は取れない
        const dx = s.x - sp.pos.x;
        const dz = s.z - sp.pos.z;
        if (dx * dx + dz * dz > PICK_RADIUS * PICK_RADIUS) continue;
        st.active = false;
        st.respawn = RESPAWN_SEC;
        if (!k.remote) {
          if ((s.coins || 0) < MAX_COINS) s.coins = (s.coins || 0) + 1;
          this.events.push({ type: 'coin', kart: k, x: sp.pos.x, y: sp.pos.y, z: sp.pos.z });
        }
        break;
      }
    }
    this._layout(angle, cams);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

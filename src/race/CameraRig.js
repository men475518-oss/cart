// 追従カメラ
import * as THREE from 'three';
import { dampAngle, damp, lerp } from '../core/Utils.js';

export class CameraRig {
  constructor(aspect = 16 / 9) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.3, 1400);
    this.heading = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.fov = 62;
    this.portrait = false;
    this.initialized = false;
    this.flip = false;
    this.shake = 0;
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.portrait = aspect < 1;
    this.camera.updateProjectionMatrix();
  }

  snapTo(kart) {
    this.heading = kart.state.heading;
    this.initialized = false;
  }

  /** 追従 */
  follow(kart, dt, opts = {}) {
    const s = kart.state;
    const target = s.speed < -1 ? s.heading + Math.PI : s.heading;
    this.heading = this.initialized ? dampAngle(this.heading, target, s.drifting ? 3.5 : 5.5, dt) : target;
    const dist = (this.portrait ? 8.5 : 8) + (s.boostTime > 0 ? 1.2 : 0);
    const height = this.portrait ? 4.6 : 3.6;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const ideal = new THREE.Vector3(s.x - fx * dist, s.y + height, s.z - fz * dist);
    if (!this.initialized) {
      this.pos.copy(ideal);
      this.initialized = true;
    } else {
      this.pos.x = damp(this.pos.x, ideal.x, 9, dt);
      this.pos.y = damp(this.pos.y, ideal.y, 6, dt);
      this.pos.z = damp(this.pos.z, ideal.z, 9, dt);
    }
    // 地面の下に潜らないように
    if (kart.track) {
      const q = kart.track.query(this.pos, s.trackIndex);
      if (this.pos.y < q.height + 1.2) this.pos.y = q.height + 1.2;
    }
    const lookAhead = this.portrait ? 9 : 7;
    this.look.set(s.x + fx * lookAhead, s.y + 1.2 + s.hop * 0.5, s.z + fz * lookAhead);
    const targetFov = (this.portrait ? 80 : 62) + (s.boostTime > 0 || s.starTime > 0 ? 10 : 0);
    this.fov = damp(this.fov, targetFov, 4, dt);
    if (this.shake > 0) {
      this.pos.x += (Math.random() - 0.5) * this.shake;
      this.pos.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 2);
    }
    this._apply();
  }

  /** ゴール後や観戦: 周回するカメラ */
  orbit(kart, dt, time) {
    const s = kart.state;
    const a = time * 0.5;
    const ideal = new THREE.Vector3(s.x + Math.sin(a) * 9, s.y + 4, s.z + Math.cos(a) * 9);
    this.pos.x = damp(this.pos.x, ideal.x, 4, dt);
    this.pos.y = damp(this.pos.y, ideal.y, 4, dt);
    this.pos.z = damp(this.pos.z, ideal.z, 4, dt);
    this.look.set(s.x, s.y + 1, s.z);
    this.fov = damp(this.fov, this.portrait ? 70 : 55, 3, dt);
    this._apply();
  }

  /** レース前のコース紹介フライオーバー */
  intro(track, t) {
    const u = (0.92 + t * 0.06) % 1;
    const i = Math.floor(u * track.N) % track.N;
    const s = track.samples[i];
    const s2 = track.samples[(i + 25) % track.N];
    this.pos.set(s.pos.x - s.right.x * 14, s.pos.y + 12 - t * 6, s.pos.z - s.right.z * 14);
    this.look.copy(s2.pos);
    this.fov = this.portrait ? 78 : 60;
    this.heading = s.heading;
    this.initialized = false;
    this._apply();
  }

  _apply() {
    this.camera.position.copy(this.pos);
    this.camera.up.set(0, this.flip ? -1 : 1, 0);
    this.camera.lookAt(this.look);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

// パーティクル演出（ドリフト火花 / ブースト / 爆発 / 紙吹雪 など）
import * as THREE from 'three';

const MAX = 900;

export class ParticleSystem {
  constructor(scene, max = MAX) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.alive = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.colAttr = new THREE.BufferAttribute(this.col, 3);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setDrawRange(0, 0);
    this.geo = geo;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const grd = ctx.createRadialGradient(16, 16, 2, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(canvas);
    this.mat = new THREE.PointsMaterial({ size: 0.75, vertexColors: true, map: tex, transparent: true, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this._c = new THREE.Color();
  }

  emit(x, y, z, vx, vy, vz, colorHex, life = 0.6, gravity = 0) {
    if (this.alive >= this.max) return;
    const i = this.alive++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this._c.setHex(colorHex);
    this.col[i * 3] = this._c.r;
    this.col[i * 3 + 1] = this._c.g;
    this.col[i * 3 + 2] = this._c.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = gravity;
  }

  burst(x, y, z, count, colors, speed, life, gravity = 0, up = 0) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.3) * Math.PI;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.emit(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + up, Math.sin(a) * Math.cos(e) * s, colors[k % colors.length], life * (0.6 + Math.random() * 0.4), gravity);
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.alive) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = --this.alive;
        if (i !== last) {
          for (let k = 0; k < 3; k++) {
            this.pos[i * 3 + k] = this.pos[last * 3 + k];
            this.vel[i * 3 + k] = this.vel[last * 3 + k];
            this.col[i * 3 + k] = this.col[last * 3 + k];
          }
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.grav[i] = this.grav[last];
        }
        continue;
      }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      // フェードアウト（色を暗く）
      const f = this.life[i] / this.maxLife[i];
      if (f < 0.4) {
        const k = f / 0.4;
        this.col[i * 3] *= 0.5 + 0.5 * k;
        this.col[i * 3 + 1] *= 0.5 + 0.5 * k;
        this.col[i * 3 + 2] *= 0.5 + 0.5 * k;
      }
      i++;
    }
    this.geo.setDrawRange(0, this.alive);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  dispose() {
    this.points.parent?.remove(this.points);
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** キャラ固有のドリフト演出: スタイルごとの粒子パラメータ */
export const EFFECT_STYLES = {
  petals: { size: 1, gravity: 2, up: 3, spread: 3, life: 0.9 },
  clouds: { size: 1.6, gravity: -0.5, up: 1.5, spread: 2, life: 1.0 },
  paws: { size: 1, gravity: 4, up: 3, spread: 2.5, life: 0.6 },
  stars: { size: 1.1, gravity: 1, up: 4, spread: 3.5, life: 0.8 },
  bubbles: { size: 1.2, gravity: -2, up: 2, spread: 2, life: 1.1 },
  rocks: { size: 1.2, gravity: 9, up: 5, spread: 3, life: 0.7 },
  fire: { size: 1.3, gravity: -3, up: 2, spread: 2.5, life: 0.5 },
  smoke: { size: 1.8, gravity: -1.5, up: 2, spread: 2, life: 1.0 },
  feathers: { size: 1, gravity: 0.8, up: 2.5, spread: 3, life: 1.2 },
};

/** 爆発・衝撃波などの一時的なメッシュ演出 */
export class FxManager {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;
    this.items = [];
  }
  explosion(pos, radius = 7) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9 }));
    m.position.copy(pos);
    this.scene.add(m);
    this.items.push({ mesh: m, t: 0, dur: 0.5, update: (it, f) => {
      it.mesh.scale.setScalar(radius * (0.3 + f * 0.7));
      it.mesh.material.opacity = 0.9 * (1 - f);
      it.mesh.material.color.setHSL(0.08 - f * 0.08, 1, 0.55);
    } });
    this.particles.burst(pos.x, pos.y + 1, pos.z, 60, [0xff5500, 0xffaa00, 0xffff66, 0x442200], 14, 0.9, 10, 6);
  }
  shockwave(pos, radius = 9, color = 0x4cc9f0) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.25, 8, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    m.position.copy(pos);
    m.position.y += 0.8;
    m.rotation.x = Math.PI / 2;
    this.scene.add(m);
    this.items.push({ mesh: m, t: 0, dur: 0.45, update: (it, f) => {
      it.mesh.scale.setScalar(0.5 + radius * f);
      it.mesh.material.opacity = 0.9 * (1 - f);
    } });
  }
  splash(pos, color = 0x8fdcff) {
    this.particles.burst(pos.x, pos.y + 0.3, pos.z, 14, [color, 0xffffff], 5, 0.6, 12, 5);
  }
  lightningFlash(scene) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(400, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.BackSide, depthWrite: false, fog: false }));
    scene.add(m);
    this.items.push({ mesh: m, t: 0, dur: 0.35, update: (it, f) => (it.mesh.material.opacity = 0.6 * (1 - f)) });
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const f = Math.min(1, it.t / it.dur);
      it.update(it, f);
      if (f >= 1) {
        it.mesh.parent?.remove(it.mesh);
        it.mesh.geometry.dispose();
        it.mesh.material.dispose();
        this.items.splice(i, 1);
      }
    }
  }
  dispose() {
    for (const it of this.items) it.mesh.parent?.remove(it.mesh);
    this.items = [];
  }
}

// リザルト画面: 表彰台の 3D 演出 + 順位表
import * as THREE from 'three';
import { buildKartModel } from '../race/KartModel.js';
import { ParticleSystem } from '../race/Effects.js';
import { audio } from '../core/Audio.js';
import { formatTime } from '../core/Utils.js';

export class ResultsScreen {
  constructor({ renderer, root, results, course, onAction, online = false }) {
    this.renderer = renderer;
    this.results = results;
    this.onAction = onAction;
    this.time = 0;
    this.disposed = false;
    const pal = course.palette;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(pal.skyBottom);
    this.scene.fog = new THREE.Fog(pal.fog, 40, 140);
    this.scene.add(new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(5, 10, 8);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 32), new THREE.MeshLambertMaterial({ color: pal.ground }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    // 表彰台
    const podium = [
      { x: 0, h: 2.4, color: 0xffd23f },
      { x: -3.6, h: 1.7, color: 0xcfd8dc },
      { x: 3.6, h: 1.2, color: 0xcd7f32 },
    ];
    this.anims = [];
    podium.forEach((p, i) => {
      const box = new THREE.Mesh(new THREE.BoxGeometry(3.2, p.h, 3.2), new THREE.MeshLambertMaterial({ color: p.color }));
      box.position.set(p.x, p.h / 2, 0);
      this.scene.add(box);
      const r = results[i];
      if (!r) return;
      const model = buildKartModel(r.char, r.kartOpts || {});
      model.group.position.set(p.x, p.h, 0);
      model.group.rotation.y = Math.PI;
      this.scene.add(model.group);
      this.anims.push({ model, char: r.char, win: i === 0, rank: i + 1, base: p.h, x: p.x });
    });
    // 4位以降は後ろに並ぶ
    results.slice(3).forEach((r, i) => {
      const model = buildKartModel(r.char, r.kartOpts || {});
      model.group.position.set(-6 + i * 3.4, 0, -6);
      model.group.rotation.y = Math.PI;
      this.scene.add(model.group);
      this.anims.push({ model, char: r.char, win: false, rank: i + 4, base: 0, x: model.group.position.x });
    });
    this.particles = new ParticleSystem(this.scene, 600);
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 300);
    this.resize(renderer.domElement.clientWidth || window.innerWidth, renderer.domElement.clientHeight || window.innerHeight);

    // DOM
    const el = document.createElement('div');
    el.className = 'screen results-screen';
    const rows = results
      .map((r) => {
        const tag = r.isHuman ? (r.playerIndex !== null && r.playerIndex !== undefined ? `P${r.playerIndex + 1}` : 'YOU') : online && !r.isLocal ? 'NET' : 'CPU';
        return `<div class="res-row rank-${Math.min(r.rank, 4)}${r.isHuman ? ' me' : ''}"><span class="res-rank">${r.rank}</span><span class="res-char">${r.char.emoji}</span><span class="res-name">${escapeHtml(r.name)}</span><span class="res-tag">${tag}</span><span class="res-time">${r.time != null ? formatTime(r.time) : '--'}</span></div>`;
      })
      .join('');
    const winner = results[0];
    el.innerHTML = `
      <div class="results-panel">
        <h2 class="results-title">🏁 レース結果</h2>
        <div class="results-winner">${winner.char.emoji} <b>${escapeHtml(winner.name)}</b> の勝利！</div>
        <div class="res-list">${rows}</div>
        <div class="btn-row">
          <button class="btn primary" data-act="again">🔁 もう一度</button>
          <button class="btn" data-act="course">🗺 ${online ? 'ロビーへ' : 'コース選択'}</button>
          <button class="btn" data-act="title">🏠 タイトル</button>
        </div>
      </div>`;
    root.appendChild(el);
    this.el = el;
    el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      audio.sfx('select');
      onAction(b.dataset.act);
    }));
    audio.sfx('fanfare');
    const humans = results.filter((r) => r.isHuman);
    setTimeout(() => {
      if (this.disposed) return;
      audio.voice(winner.char, 'win');
      const loser = humans.find((r) => r.rank > Math.ceil(results.length / 2));
      if (loser && loser !== winner) setTimeout(() => !this.disposed && audio.voice(loser.char, 'lose'), 2200);
    }, 600);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.portrait = h > w;
    this.camera.fov = this.portrait ? 70 : 50;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    // カメラゆっくり回る
    const a = Math.sin(t * 0.3) * 0.35;
    this.camera.position.set(Math.sin(a) * 14, 5.5 + Math.sin(t * 0.5) * 0.3, Math.cos(a) * 14);
    this.camera.lookAt(0, 2.2, 0);
    // 紙吹雪
    if (Math.random() < 0.7) {
      this.particles.emit((Math.random() - 0.5) * 16, 11, (Math.random() - 0.5) * 8 - 2, (Math.random() - 0.5) * 2, -1, 0, [0xffd23f, 0xff5c8a, 0x4cc9f0, 0x7bff7b, 0xc86bff][Math.floor(Math.random() * 5)], 4, 1.5);
    }
    this.particles.update(dt);
    for (const an of this.anims) this._animate(an, t);
  }

  _animate(an, t) {
    const m = an.model;
    const g = m.group;
    const c = m.charGroup;
    const anim = an.win ? an.char.winAnim : an.rank <= 3 ? 'wobble' : an.char.loseAnim;
    g.position.y = an.base;
    c.rotation.set(0, 0, 0);
    c.position.y = 0.95;
    m.visual.rotation.y = 0;
    switch (anim) {
      case 'jump': {
        const ph = (t * 2.2) % 1;
        g.position.y = an.base + Math.abs(Math.sin(ph * Math.PI)) * 1.6;
        c.rotation.z = Math.sin(t * 8) * 0.15;
        break;
      }
      case 'spin':
        m.visual.rotation.y = t * 3;
        c.position.y = 0.95 + Math.abs(Math.sin(t * 4)) * 0.3;
        break;
      case 'dance':
        c.rotation.z = Math.sin(t * 6) * 0.3;
        c.position.y = 0.95 + Math.abs(Math.sin(t * 6)) * 0.25;
        m.visual.rotation.y = Math.sin(t * 3) * 0.3;
        break;
      case 'wobble':
        c.rotation.z = Math.sin(t * 3) * 0.12;
        c.position.y = 0.95 + Math.sin(t * 3) * 0.05;
        break;
      case 'flap':
        c.rotation.x = Math.sin(t * 10) * 0.1;
        c.position.y = 0.95 + Math.abs(Math.sin(t * 5)) * 0.5;
        m.visual.rotation.y = Math.sin(t * 2) * 0.5;
        break;
      case 'roar': {
        const s = 1 + Math.max(0, Math.sin(t * 2)) * 0.25;
        c.scale.setScalar(s);
        c.rotation.x = -Math.max(0, Math.sin(t * 2)) * 0.3;
        break;
      }
      case 'flame':
        c.position.y = 0.95 + Math.abs(Math.sin(t * 4)) * 0.3;
        if (Math.random() < 0.6) this.particles.emit(g.position.x + (Math.random() - 0.5), g.position.y + 2.2, g.position.z, (Math.random() - 0.5) * 2, 3 + Math.random() * 2, 0, Math.random() < 0.5 ? 0xff4d00 : 0xffb703, 0.6, -2);
        break;
      case 'hoot':
        c.position.y = 0.95 + Math.abs(Math.sin(t * 3)) * 0.2;
        c.rotation.y = Math.sin(t * 1.5) * 0.6;
        break;
      case 'droop':
        c.rotation.x = 0.45;
        c.position.y = 0.75 + Math.sin(t * 1.2) * 0.03;
        break;
      case 'sleep':
        c.rotation.z = 0.5;
        c.rotation.x = 0.2;
        c.position.y = 0.7;
        if (Math.random() < 0.05) this.particles.emit(g.position.x + 0.5, g.position.y + 2, g.position.z, 0.3, 1.2, 0, 0xffffff, 1.5, -0.3);
        break;
      default:
        break;
    }
  }

  render() {
    if (this.disposed) return;
    this.renderer.setScissorTest(false);
    const W = this.renderer.domElement.width / this.renderer.getPixelRatio();
    const H = this.renderer.domElement.height / this.renderer.getPixelRatio();
    this.renderer.setViewport(0, 0, W, H);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.el.remove();
    this.particles.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    this.scene.clear();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

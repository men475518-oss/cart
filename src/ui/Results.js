// リザルト画面: 表彰台の 3D 演出 + 順位表
import * as THREE from 'three';
import { buildKartModel } from '../race/KartModel.js';
import { ParticleSystem } from '../race/Effects.js';
import { audio } from '../core/Audio.js';
import { formatTime } from '../core/Utils.js';

const _numTex = new Map();
/** 表彰台の前面にはる順位の数字 */
function numberTexture(text) {
  if (_numTex.has(text)) return _numTex.get(text);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.font = 'bold 96px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.strokeText(text, 64, 70);
  g.fillStyle = '#fff';
  g.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _numTex.set(text, tex);
  return tex;
}

let _bannerTex = null;
/** 表彰台のうしろにかかる横断幕 */
function bannerTexture(course) {
  if (_bannerTex) return _bannerTex;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ff4d6d';
  g.fillRect(0, 0, 1024, 128);
  g.fillStyle = 'rgba(255,255,255,0.25)';
  for (let i = 0; i < 1024; i += 64) g.fillRect(i, 0, 32, 128);
  g.font = 'bold 70px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.fillText(`\u{1F3C6} ${course.name} \u{1F3C6}`, 512, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _bannerTex = tex;
  return tex;
}

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
    // 表彰台。1 位を中央に、2 位を左、3 位を右に置く
    const podium = [
      { x: 0, h: 2.4, color: 0xffd23f, label: '1' },
      { x: -3.6, h: 1.7, color: 0xcfd8dc, label: '2' },
      { x: 3.6, h: 1.2, color: 0xcd7f32, label: '3' },
    ];
    // 台の下の敷き板。表彰台が地面から生えているように見えないように
    const base = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.35, 4.4), new THREE.MeshLambertMaterial({ color: 0xf3f3f6 }));
    base.position.set(0, 0.175, 0);
    this.scene.add(base);
    this.anims = [];
    podium.forEach((p, i) => {
      const box = new THREE.Mesh(new THREE.BoxGeometry(3.2, p.h, 3.2), new THREE.MeshLambertMaterial({ color: p.color }));
      box.position.set(p.x, 0.35 + p.h / 2, 0);
      this.scene.add(box);
      // 段の前面に順位の数字
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 1.5),
        new THREE.MeshBasicMaterial({ map: numberTexture(p.label), transparent: true })
      );
      plate.position.set(p.x, 0.35 + p.h * 0.5, 1.61);
      this.scene.add(plate);
      const r = results[i];
      if (!r) return;
      const model = buildKartModel(r.char, r.kartOpts || {});
      model.group.position.set(p.x, 0.35 + p.h, 0);
      model.group.rotation.y = Math.PI;
      this.scene.add(model.group);
      this.anims.push({ model, char: r.char, win: i === 0, rank: i + 1, base: 0.35 + p.h, x: p.x });
    });
    // 4位以降は表彰台の後ろに左右対称に並ぶ
    const rest = results.slice(3);
    rest.forEach((r, i) => {
      const model = buildKartModel(r.char, r.kartOpts || {});
      const spread = 4.2;
      const x = (i - (rest.length - 1) / 2) * spread;
      model.group.position.set(x, 0, -11);
      model.group.rotation.y = Math.PI;
      this.scene.add(model.group);
      this.anims.push({ model, char: r.char, win: false, rank: i + 4, base: 0, x });
    });
    // 背景の横断幕。緑の地面だけだと表彰式に見えない
    const gate = new THREE.Group();
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 7, 8), new THREE.MeshLambertMaterial({ color: 0xdfe4ea }));
      pole.position.set(side * 8.5, 3.5, -6);
      gate.add(pole);
    }
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(17.6, 2.2, 0.3),
      new THREE.MeshLambertMaterial({ map: bannerTexture(course), color: 0xffffff })
    );
    banner.position.set(0, 6.2, -6);
    gate.add(banner);
    this.scene.add(gate);

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
    // カメラゆっくり回る。順位表のパネルは横画面なら右、縦画面なら下にあるので、
    // 表彰台がその裏に隠れないように画をずらす
    const a = Math.sin(t * 0.3) * 0.35;
    const dist = this.portrait ? 17 : 15;
    const eye = new THREE.Vector3(Math.sin(a) * dist, 5.6 + Math.sin(t * 0.5) * 0.3, Math.cos(a) * dist);
    const target = new THREE.Vector3(0, 2.4, 0);
    // 視線に対する右と上を求めて、その方向にカメラごと平行移動する
    const fwd = target.clone().sub(eye).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const halfH = dist * Math.tan((this.camera.fov * Math.PI) / 360);
    const halfW = halfH * this.camera.aspect;
    // 横画面: 表彰台を左寄せ / 縦画面: 上寄せ
    const panX = this.portrait ? 0 : halfW * 0.3;
    const panY = this.portrait ? -halfH * 0.42 : 0;
    const shift = right.multiplyScalar(panX).add(up.multiplyScalar(panY));
    eye.add(shift);
    target.add(shift);
    this.camera.position.copy(eye);
    this.camera.lookAt(target);
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

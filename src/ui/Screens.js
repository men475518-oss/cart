// メニュー画面群（タイトル / モード選択 / キャラ選択＋カートカスタム / コース選択 / オンラインロビー / 設定 / 遊び方 / ポーズ）
import * as THREE from 'three';
import { CHARACTERS, getCharacter } from '../data/characters.js';
import { COURSES, getCourse } from '../data/courses.js';
import { ITEMS } from '../data/items.js';
import { KART_COLORS, KART_WHEELS, KART_ACCESSORIES, DEFAULT_KART } from '../data/kartParts.js';
import { buildKartModel } from '../race/KartModel.js';
import { KEYMAP_LABELS } from '../core/Input.js';
import { settings } from '../core/Settings.js';
import { audio } from '../core/Audio.js';
import { defaultServerUrl, isStaticHost, hasServerConfigured } from '../net/NetClient.js';

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function click(el, sel, fn) {
  el.querySelectorAll(sel).forEach((b) =>
    b.addEventListener('click', (e) => {
      audio.sfx('click');
      fn(b, e);
    })
  );
}
export function showToast(msg, ms = 2500) {
  const t = document.getElementById('toast');
  if (!t) return;
  const item = h(`<div class="toast-item">${esc(msg)}</div>`);
  t.appendChild(item);
  setTimeout(() => item.classList.add('show'), 10);
  setTimeout(() => {
    item.classList.remove('show');
    setTimeout(() => item.remove(), 300);
  }, ms);
}

// ---------- 3D プレビュー ----------
export class KartPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.3));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(3, 6, 5);
    this.scene.add(sun);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    this.camera.position.set(0, 2.6, 6.2);
    this.camera.lookAt(0, 1.1, 0);
    this.model = null;
    this.running = true;
    this.t = 0;
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      this.t += 1 / 60;
      const w = canvas.clientWidth || 200;
      const hgt = canvas.clientHeight || 200;
      if (canvas.width !== Math.floor(w * this.renderer.getPixelRatio())) {
        this.renderer.setSize(w, hgt, false);
        this.camera.aspect = w / hgt;
        this.camera.updateProjectionMatrix();
      }
      if (this.model) {
        this.model.group.rotation.y = this.t * 0.8 + Math.PI * 0.85;
        this.model.charGroup.position.y = 0.95 + Math.sin(this.t * 3) * 0.05;
      }
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }
  set(char, kart) {
    if (this.model) this.scene.remove(this.model.group);
    this.model = buildKartModel(char, kart);
    this.scene.add(this.model.group);
  }
  dispose() {
    this.running = false;
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}

// ---------- タイトル ----------
export function titleScreen({ onStart }) {
  const el = h(`
    <div class="screen title-screen">
      <div class="title-bg"></div>
      <div class="title-chars">${CHARACTERS.map((c, i) => `<span style="--i:${i}">${c.emoji}</span>`).join('')}</div>
      <h1 class="logo"><span class="logo-top">もふもふ</span><span class="logo-main">カート</span></h1>
      <p class="title-tap">タップしてスタート</p>
      <p class="title-ver">v0.1 · スマホ対応 · 画面分割＆オンライン対戦</p>
    </div>`);
  const start = () => {
    audio.unlock();
    audio.sfx('select');
    onStart();
  };
  el.addEventListener('pointerdown', start, { once: true });
  const key = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      window.removeEventListener('keydown', key);
      start();
    }
  };
  window.addEventListener('keydown', key);
  return { el, dispose: () => window.removeEventListener('keydown', key) };
}

// ---------- モード選択 ----------
export function modeScreen({ onSelect }) {
  const el = h(`
    <div class="screen menu-screen">
      <h2 class="screen-title">モードをえらぶ</h2>
      <div class="mode-grid">
        <button class="mode-card" data-mode="single"><span class="mode-icon">🏁</span><b>ひとりで遊ぶ</b><small>CPU 7人と対戦（最大8人）</small></button>
        <button class="mode-card" data-mode="local"><span class="mode-icon">👥</span><b>ローカル対戦</b><small>1台の端末で画面分割 2〜4人</small></button>
        <button class="mode-card" data-mode="online"><span class="mode-icon">🌐</span><b>オンライン対戦</b><small>プライベート / カジュアル / 観戦 / LAN</small></button>
        <button class="mode-card" data-mode="timeattack"><span class="mode-icon">⏱</span><b>タイムアタック</b><small>ひとりでコース練習</small></button>
        <button class="mode-card small" data-mode="howto"><span class="mode-icon">📖</span><b>あそびかた</b></button>
        <button class="mode-card small" data-mode="settings"><span class="mode-icon">⚙️</span><b>設定</b></button>
      </div>
    </div>`);
  click(el, '.mode-card', (b) => onSelect(b.dataset.mode));
  return { el, dispose() {} };
}

// ---------- ローカル人数選択 ----------
export function localSetupScreen({ onNext, onBack }) {
  const el = h(`
    <div class="screen menu-screen">
      <h2 class="screen-title">なんにんで遊ぶ？</h2>
      <p class="hint">同じ端末の画面を分割して遊びます。2人のときは向かい合わせでも遊べます（設定で変更）。<br>キーボード: ${KEYMAP_LABELS.slice(0, 2).map((l) => `<code>${l}</code>`).join(' / ')}</p>
      <div class="mode-grid">
        ${[2, 3, 4].map((n) => `<button class="mode-card" data-n="${n}"><span class="mode-icon">${'🧑'.repeat(n)}</span><b>${n}人</b><small>${n === 2 ? '上下 2 分割' : '4 分割'}</small></button>`).join('')}
      </div>
      <div class="cpu-row"><label><input type="checkbox" id="local-cpu" checked> CPU で 8 人にする</label></div>
      <div class="btn-row"><button class="btn" data-act="back">← もどる</button></div>
    </div>`);
  click(el, '.mode-card', (b) => onNext(Number(b.dataset.n), el.querySelector('#local-cpu').checked));
  click(el, '[data-act=back]', () => onBack());
  return { el, dispose() {} };
}

// ---------- キャラクター選択 + カートカスタム ----------
export function characterScreen({ label, initialChar, initialKart, onNext, onBack, takenChars = [] }) {
  let charId = initialChar || settings.get('lastCharacter') || 'taro';
  if (takenChars.includes(charId)) charId = CHARACTERS.find((c) => !takenChars.includes(c.id))?.id || charId;
  let kart = { ...DEFAULT_KART, ...(initialKart || settings.get('lastKart') || {}) };
  const statBar = (v) => `<i style="width:${Math.round(v * 100)}%"></i>`;
  const el = h(`
    <div class="screen char-screen">
      <h2 class="screen-title">${esc(label || '')} キャラクターをえらぶ</h2>
      <div class="char-layout">
        <div class="char-grid">
          ${CHARACTERS.map((c) => `<button class="char-card type-${c.type}${takenChars.includes(c.id) ? ' taken' : ''}" data-id="${c.id}"><span class="char-emoji">${c.emoji}</span><b>${c.name}</b><small>${c.typeLabel}</small></button>`).join('')}
        </div>
        <div class="char-detail">
          <canvas class="char-preview"></canvas>
          <div class="char-info">
            <h3 class="char-name"></h3>
            <p class="char-desc"></p>
            <div class="char-trait"></div>
            <div class="stats">
              ${['accel:かそく', 'speed:さいこうそく', 'handling:ハンドリング', 'weight:おもさ', 'drift:ドリフト', 'offroad:オフロード'].map((s) => {
                const [k, n] = s.split(':');
                return `<div class="stat"><span>${n}</span><div class="bar" data-stat="${k}"></div></div>`;
              }).join('')}
            </div>
            <div class="voice-line">🔊 <span></span></div>
          </div>
          <div class="kart-custom">
            <h4>🛠 カートカスタマイズ</h4>
            <div class="custom-row"><span>カラー</span><div class="swatches">${KART_COLORS.map((c) => `<button class="swatch" data-color="${c.id}" title="${c.name}" style="background:${c.hex === null ? 'linear-gradient(135deg,#ff8fb1,#4cc9f0,#ffd23f)' : '#' + c.hex.toString(16).padStart(6, '0')}"></button>`).join('')}</div></div>
            <div class="custom-row"><span>タイヤ</span><div class="chips">${KART_WHEELS.map((w) => `<button class="chip" data-wheels="${w.id}" title="${w.desc}">${w.name}</button>`).join('')}</div></div>
            <div class="custom-row"><span>かざり</span><div class="chips">${KART_ACCESSORIES.map((a) => `<button class="chip" data-acc="${a.id}">${a.name}</button>`).join('')}</div></div>
            <p class="custom-desc"></p>
          </div>
        </div>
      </div>
      <div class="btn-row sticky">
        <button class="btn" data-act="back">← もどる</button>
        <button class="btn primary big" data-act="next">これでいく！ →</button>
      </div>
    </div>`);
  const preview = new KartPreview(el.querySelector('.char-preview'));
  const refresh = () => {
    const c = getCharacter(charId);
    el.querySelectorAll('.char-card').forEach((b) => b.classList.toggle('selected', b.dataset.id === charId));
    el.querySelector('.char-name').innerHTML = `${c.emoji} ${c.name} <small>（${c.species}・${c.typeLabel}）</small>`;
    el.querySelector('.char-desc').textContent = c.desc;
    el.querySelector('.char-trait').innerHTML = `<b>✨ ${esc(c.trait.label)}</b><span>${esc(c.trait.desc)}</span>`;
    el.querySelectorAll('.bar').forEach((b) => (b.innerHTML = statBar(c.stats[b.dataset.stat])));
    el.querySelector('.voice-line span').textContent = `「${c.lines.select}」`;
    el.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('selected', b.dataset.color === kart.color));
    el.querySelectorAll('[data-wheels]').forEach((b) => b.classList.toggle('selected', b.dataset.wheels === kart.wheels));
    el.querySelectorAll('[data-acc]').forEach((b) => b.classList.toggle('selected', b.dataset.acc === kart.accessory));
    const w = KART_WHEELS.find((x) => x.id === kart.wheels);
    el.querySelector('.custom-desc').textContent = w ? `${w.name}: ${w.desc}` : '';
    preview.set(c, kart);
  };
  click(el, '.char-card', (b) => {
    if (b.classList.contains('taken')) {
      showToast('そのキャラはほかのプレイヤーが選んでいます');
      return;
    }
    charId = b.dataset.id;
    audio.voice(getCharacter(charId), 'select', { minInterval: 0 });
    refresh();
  });
  click(el, '.swatch', (b) => {
    kart.color = b.dataset.color;
    refresh();
  });
  click(el, '[data-wheels]', (b) => {
    kart.wheels = b.dataset.wheels;
    refresh();
  });
  click(el, '[data-acc]', (b) => {
    kart.accessory = b.dataset.acc;
    refresh();
  });
  click(el, '[data-act=back]', () => onBack());
  click(el, '[data-act=next]', () => {
    audio.sfx('select');
    onNext(charId, { ...kart });
  });
  refresh();
  return { el, dispose: () => preview.dispose() };
}

// ---------- コース選択 ----------
function drawCoursePreview(canvas, course) {
  const ctx = canvas.getContext('2d');
  const pts = course.points;
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[2]);
  const minX = Math.min(...xs) - 10, maxX = Math.max(...xs) + 10, minZ = Math.min(...zs) - 10, maxZ = Math.max(...zs) + 10;
  const W = canvas.width, H = canvas.height;
  const sc = Math.min(W / (maxX - minX), H / (maxZ - minZ));
  const ox = (W - (maxX - minX) * sc) / 2 - minX * sc;
  const oy = (H - (maxZ - minZ) * sc) / 2 - minZ * sc;
  ctx.clearRect(0, 0, W, H);
  ctx.lineWidth = 9;
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  const path = () => {
    ctx.beginPath();
    // Catmull-Rom を簡易描画（各区間を 8 分割）
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        const t2 = t * t, t3 = t2 * t;
        const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        const z = 0.5 * (2 * p1[2] + (-p0[2] + p2[2]) * t + (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t2 + (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t3);
        if (i === 0 && k === 0) ctx.moveTo(x * sc + ox, z * sc + oy);
        else ctx.lineTo(x * sc + ox, z * sc + oy);
      }
    }
    ctx.closePath();
  };
  path();
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#' + course.palette.road.toString(16).padStart(6, '0');
  path();
  ctx.stroke();
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.arc(pts[0][0] * sc + ox, pts[0][2] * sc + oy, 4, 0, Math.PI * 2);
  ctx.fill();
}

export function courseScreen({ onSelect, onBack, initial, showLaps = true }) {
  let laps = settings.get('laps') || 3;
  const el = h(`
    <div class="screen course-screen">
      <h2 class="screen-title">コースをえらぶ</h2>
      <div class="course-grid">
        ${COURSES.map((c) => `<button class="course-card theme-${c.theme}" data-id="${c.id}" style="--sky:#${c.palette.skyTop.toString(16).padStart(6, '0')};--ground:#${c.palette.ground.toString(16).padStart(6, '0')}">
            <canvas width="160" height="120"></canvas>
            <div class="course-info"><b>${c.emoji} ${c.name}</b><span class="stars">${'★'.repeat(c.difficulty)}${'☆'.repeat(5 - c.difficulty)}</span><small>${c.desc}</small></div>
          </button>`).join('')}
      </div>
      ${showLaps ? `<div class="laps-row">周回数: ${[1, 2, 3, 4, 5].map((n) => `<button class="chip lap-chip" data-laps="${n}">${n}</button>`).join('')}</div>` : ''}
      <div class="btn-row"><button class="btn" data-act="back">← もどる</button></div>
    </div>`);
  el.querySelectorAll('.course-card').forEach((card) => drawCoursePreview(card.querySelector('canvas'), getCourse(card.dataset.id)));
  const refreshLaps = () => el.querySelectorAll('.lap-chip').forEach((b) => b.classList.toggle('selected', Number(b.dataset.laps) === laps));
  click(el, '.lap-chip', (b) => {
    laps = Number(b.dataset.laps);
    settings.set('laps', laps);
    refreshLaps();
  });
  refreshLaps();
  click(el, '.course-card', (b) => {
    audio.sfx('select');
    onSelect(b.dataset.id, laps);
  });
  click(el, '[data-act=back]', () => onBack());
  return { el, dispose() {} };
}

// ---------- オンラインロビー ----------
export function onlineScreen({ net, profile, onRace, onBack, onEditProfile }) {
  let spectating = false;
  let unsubs = [];
  const el = h(`
    <div class="screen online-screen">
      <h2 class="screen-title">🌐 オンライン対戦</h2>
      <div class="panel connect-panel">
        <div class="profile-row">
          <span class="profile-char">${getCharacter(profile.char).emoji}</span>
          <label>なまえ <input type="text" id="ol-name" maxlength="12" value="${esc(profile.name)}" placeholder="プレイヤー名"></label>
          <button class="btn small" data-act="editprofile">キャラ変更</button>
        </div>
        <p class="ol-notice" style="display:none"></p>
        <div class="ol-actions">
          <button class="btn primary" data-act="create">🏠 部屋を作る（プライベート）</button>
          <div class="join-row"><input type="text" id="ol-code" maxlength="4" placeholder="ルームコード" autocapitalize="characters"><button class="btn" data-act="join">🔑 参加</button><button class="btn" data-act="spectate">👀 観戦</button></div>
          <button class="btn" data-act="casual">🎲 カジュアルマッチ（だれでも）</button>
        </div>
        <details class="server-details"><summary>サーバー設定（LAN 対戦 / 自前サーバー）</summary>
          <label>サーバーアドレス <input type="text" id="ol-server" placeholder="例: 192.168.1.10:8787（空欄で標準）" value="${esc(settings.get('serverUrl') || '')}"></label>
          <p class="hint">インターネット越しに遊ぶには、対戦サーバーの URL（例 <code>https://mofukart-server.xxx.workers.dev</code>）を入れてください。<br>同じ Wi-Fi の端末同士なら、1台で <code>npm run server</code> を起動してその端末の IP を入力します（このときゲーム自体も同じ端末の <code>npm run dev</code> から開いてください）。</p>
        </details>
        <p class="ol-status"></p>
      </div>
      <div class="panel room-panel" style="display:none">
        <div class="room-head"><span>ルームコード</span><b class="room-code"></b><button class="btn small" data-act="copy">コピー</button></div>
        <div class="room-players"></div>
        <div class="room-host">
          <label>コース <select id="ol-course">${COURSES.map((c) => `<option value="${c.id}">${c.emoji} ${c.name}</option>`).join('')}</select></label>
          <label>周回 <select id="ol-laps">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}"${n === 3 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
          <label><input type="checkbox" id="ol-cpu" checked> CPU で 8 人にする</label>
          <button class="btn primary big" data-act="start">🏁 レース開始</button>
        </div>
        <div class="room-guest"><button class="btn primary big" data-act="ready">✅ 準備 OK</button><span class="hint">ホストがレースを開始するまで待ってね</span></div>
        <div class="room-spectator hint">👀 観戦中: レースが始まると自動で観戦画面になります</div>
        <p class="ol-status2"></p>
      </div>
      <div class="btn-row"><button class="btn" data-act="back">← もどる</button></div>
    </div>`);
  const q = (s) => el.querySelector(s);
  const status = (msg) => {
    q('.ol-status').textContent = msg;
    q('.ol-status2').textContent = msg;
  };
  const currentProfile = () => {
    const name = q('#ol-name').value.trim() || profile.name;
    settings.set('playerName', name);
    return { name, char: profile.char, kart: profile.kart };
  };
  const refreshNotice = () => {
    const need = isStaticHost() && !(q('#ol-server').value || '').trim();
    const el2 = q('.ol-notice');
    el2.style.display = need ? '' : 'none';
    el2.innerHTML = need
      ? 'このページは静的ホスティングで公開されているため、対戦サーバーが同居していません。<br>下の「サーバー設定」に対戦サーバーのアドレスを入れると、オンライン対戦が使えます。<br>サーバーなしでも「ひとりで遊ぶ」と「ローカル対戦（画面分割）」はそのまま遊べます。'
      : '';
    for (const b of el.querySelectorAll('[data-act=create],[data-act=join],[data-act=spectate],[data-act=casual]')) b.disabled = need;
    if (need) q('.server-details').open = true;
  };
  const ensureConnected = async () => {
    settings.set('serverUrl', q('#ol-server').value.trim());
    if (!hasServerConfigured()) {
      status('対戦サーバーのアドレスを入力してください');
      refreshNotice();
      return false;
    }
    if (net.connected) return true;
    status('サーバーに接続中…');
    try {
      await net.connect(defaultServerUrl(), currentProfile().name);
      status('接続しました');
      return true;
    } catch (e) {
      status('接続できません: ' + e.message + '（サーバーが起動しているか確認してください）');
      showToast('サーバーに接続できません');
      return false;
    }
  };
  const showRoom = (room) => {
    q('.connect-panel').style.display = room ? 'none' : '';
    q('.room-panel').style.display = room ? '' : 'none';
    if (!room) return;
    q('.room-code').textContent = room.code;
    const isHost = room.hostId === net.id && !spectating;
    q('.room-host').style.display = isHost ? '' : 'none';
    q('.room-guest').style.display = !isHost && !spectating ? '' : 'none';
    q('.room-spectator').style.display = spectating ? '' : 'none';
    const me = room.players.find((p) => p.id === net.id);
    q('[data-act=ready]').textContent = me?.ready ? '❎ 準備をやめる' : '✅ 準備 OK';
    q('.room-players').innerHTML = room.players
      .map((p) => `<div class="room-player${p.id === net.id ? ' me' : ''}${p.cpu ? ' cpu' : ''}"><span>${getCharacter(p.char).emoji}</span><b>${esc(p.name)}</b>${p.isHost ? '<i class="tag">ホスト</i>' : ''}${p.ready ? '<i class="tag ok">準備OK</i>' : ''}</div>`)
      .join('') + (room.spectators ? `<div class="hint">👀 観戦者 ${room.spectators} 人</div>` : '');
    if (isHost) {
      q('#ol-course').value = room.course;
      q('#ol-laps').value = String(room.laps);
    }
    const others = room.players.filter((p) => p.id !== net.id && !p.cpu);
    const allReady = others.every((p) => p.ready);
    q('[data-act=start]').disabled = !allReady;
    q('[data-act=start]').textContent = allReady ? '🏁 レース開始' : '⏳ 全員の準備待ち…';
  };
  unsubs.push(net.on('room', ({ room, spectating: sp }) => {
    if (sp) spectating = true;
    showRoom(room);
  }));
  unsubs.push(net.on('error', ({ msg }) => {
    if (msg && msg !== 'connection error') {
      showToast(msg);
      status(msg);
      if (/閉じられ/.test(msg)) showRoom(null);
    }
  }));
  unsubs.push(net.on('queue', ({ waiting, seconds }) => status(`カジュアルマッチ待機中… 現在 ${waiting} 人（あと約 ${seconds} 秒でスタート）`)));
  unsubs.push(net.on('start', (msg) => onRace(msg, spectating)));
  unsubs.push(net.on('disconnected', () => {
    status('切断されました');
    showToast('サーバーから切断されました');
    showRoom(null);
  }));

  click(el, '[data-act=create]', async () => {
    if (await ensureConnected()) net.createRoom(currentProfile());
  });
  click(el, '[data-act=join]', async () => {
    const code = q('#ol-code').value.trim().toUpperCase();
    if (code.length !== 4) return showToast('4文字のルームコードを入力してください');
    if (await ensureConnected()) net.joinRoom(code, currentProfile());
  });
  click(el, '[data-act=spectate]', async () => {
    const code = q('#ol-code').value.trim().toUpperCase();
    if (code.length !== 4) return showToast('4文字のルームコードを入力してください');
    if (await ensureConnected()) {
      spectating = true;
      net.spectate(code);
    }
  });
  click(el, '[data-act=casual]', async () => {
    if (await ensureConnected()) {
      spectating = false;
      net.joinCasual(currentProfile());
    }
  });
  click(el, '[data-act=copy]', () => {
    navigator.clipboard?.writeText(q('.room-code').textContent).then(() => showToast('ルームコードをコピーしました'));
  });
  click(el, '[data-act=ready]', () => {
    const me = net.room?.players.find((p) => p.id === net.id);
    net.setReady(!me?.ready);
  });
  click(el, '[data-act=start]', () => {
    net.startRace({ course: q('#ol-course').value, laps: Number(q('#ol-laps').value), cpuCount: q('#ol-cpu').checked ? 8 : 0 });
  });
  q('#ol-course').addEventListener('change', () => net.setCourse(q('#ol-course').value, Number(q('#ol-laps').value)));
  q('#ol-laps').addEventListener('change', () => net.setCourse(q('#ol-course').value, Number(q('#ol-laps').value)));
  click(el, '[data-act=editprofile]', () => onEditProfile());
  click(el, '[data-act=back]', () => {
    if (net.room) {
      net.leave();
      spectating = false;
      showRoom(null);
    } else onBack();
  });
  q('#ol-server').addEventListener('input', refreshNotice);
  refreshNotice();
  if (net.room) showRoom(net.room);
  return {
    el,
    dispose() {
      for (const u of unsubs) u();
    },
  };
}

// ---------- 設定 ----------
export function settingsScreen({ onBack, input }) {
  const s = settings;
  const el = h(`
    <div class="screen settings-screen">
      <h2 class="screen-title">⚙️ 設定</h2>
      <div class="settings-list">
        <label class="row"><span>プレイヤー名</span><input type="text" id="st-name" maxlength="12" value="${esc(s.get('playerName'))}"></label>
        <label class="row"><span>BGM 音量</span><input type="range" id="st-bgm" min="0" max="1" step="0.05" value="${s.get('bgmVolume')}"></label>
        <label class="row"><span>効果音 音量</span><input type="range" id="st-sfx" min="0" max="1" step="0.05" value="${s.get('sfxVolume')}"></label>
        <label class="row"><span>キャラクターボイス（音声合成）</span><input type="checkbox" id="st-voice" ${s.get('voice') ? 'checked' : ''}></label>
        <h3>操作</h3>
        <label class="row"><span>ジャイロ操作（傾けてハンドル）</span><input type="checkbox" id="st-gyro" ${s.get('gyro') ? 'checked' : ''}></label>
        <div class="row indent"><span>ジャイロ感度</span><input type="range" id="st-gyrosens" min="0.5" max="2" step="0.1" value="${s.get('gyroSensitivity')}"></div>
        <label class="row indent"><span>ジャイロ左右反転</span><input type="checkbox" id="st-gyroinv" ${s.get('gyroInvert') ? 'checked' : ''}></label>
        <div class="row indent"><span>いまの向きを基準にする</span><button class="btn small" data-act="calib">キャリブレーション</button></div>
        <label class="row"><span>自動アクセル（片手プレイ）</span><input type="checkbox" id="st-auto" ${s.get('autoAccel') ? 'checked' : ''}></label>
        <label class="row"><span>ボタン配置</span><select id="st-layout"><option value="right" ${s.get('controlLayout') === 'right' ? 'selected' : ''}>右手アクセル（標準）</option><option value="left" ${s.get('controlLayout') === 'left' ? 'selected' : ''}>左手アクセル</option></select></label>
        <label class="row"><span>2人対戦は向かい合わせ表示</span><input type="checkbox" id="st-face" ${s.get('faceToFace') ? 'checked' : ''}></label>
        <label class="row"><span>バイブレーション</span><input type="checkbox" id="st-haptic" ${s.get('hapticFeedback') ? 'checked' : ''}></label>
        <h3>ゲーム</h3>
        <label class="row"><span>CPU の強さ</span><select id="st-cpu"><option value="easy">やさしい</option><option value="normal">ふつう</option><option value="hard">つよい</option></select></label>
        <label class="row"><span>画質</span><select id="st-quality"><option value="auto">自動</option><option value="low">軽い</option><option value="high">きれい</option></select></label>
        <div class="row"><span>設定をリセット</span><button class="btn small" data-act="reset">リセット</button></div>
        <p class="hint">キーボード操作: ${KEYMAP_LABELS.map((l) => `<code>${l}</code>`).join('<br>')}</p>
      </div>
      <div class="btn-row sticky"><button class="btn primary" data-act="back">← もどる</button></div>
    </div>`);
  const q = (x) => el.querySelector(x);
  q('#st-cpu').value = s.get('cpuLevel');
  q('#st-quality').value = s.get('quality');
  q('#st-name').addEventListener('change', () => s.set('playerName', q('#st-name').value.trim()));
  q('#st-bgm').addEventListener('input', () => {
    s.set('bgmVolume', Number(q('#st-bgm').value));
    audio.applyVolumes();
  });
  q('#st-sfx').addEventListener('input', () => {
    s.set('sfxVolume', Number(q('#st-sfx').value));
    audio.applyVolumes();
    audio.sfx('click');
  });
  q('#st-voice').addEventListener('change', () => s.set('voice', q('#st-voice').checked));
  q('#st-gyro').addEventListener('change', async () => {
    if (q('#st-gyro').checked) {
      const ok = await input.enableGyro();
      if (!ok) {
        q('#st-gyro').checked = false;
        showToast('ジャイロを使えませんでした（対応端末・HTTPS が必要です）');
      } else {
        input.calibrateGyro();
        showToast('ジャイロ ON。端末を持つ向きで「キャリブレーション」を押してね');
      }
    } else input.disableGyro();
    s.set('gyro', q('#st-gyro').checked);
  });
  q('#st-gyrosens').addEventListener('input', () => s.set('gyroSensitivity', Number(q('#st-gyrosens').value)));
  q('#st-gyroinv').addEventListener('change', () => s.set('gyroInvert', q('#st-gyroinv').checked));
  click(el, '[data-act=calib]', () => {
    input.calibrateGyro();
    showToast('キャリブレーションしました');
  });
  q('#st-auto').addEventListener('change', () => s.set('autoAccel', q('#st-auto').checked));
  q('#st-layout').addEventListener('change', () => s.set('controlLayout', q('#st-layout').value));
  q('#st-face').addEventListener('change', () => s.set('faceToFace', q('#st-face').checked));
  q('#st-haptic').addEventListener('change', () => s.set('hapticFeedback', q('#st-haptic').checked));
  q('#st-cpu').addEventListener('change', () => s.set('cpuLevel', q('#st-cpu').value));
  q('#st-quality').addEventListener('change', () => s.set('quality', q('#st-quality').value));
  click(el, '[data-act=reset]', () => {
    s.reset();
    showToast('設定をリセットしました');
    onBack();
  });
  click(el, '[data-act=back]', () => onBack());
  return { el, dispose() {} };
}

// ---------- あそびかた ----------
export function howtoScreen({ onBack }) {
  const el = h(`
    <div class="screen howto-screen">
      <h2 class="screen-title">📖 あそびかた</h2>
      <div class="howto-body">
        <h3>🎮 スマホの操作</h3>
        <ul>
          <li><b>画面左側</b>をドラッグ → ハンドル（左右にスワイプ）</li>
          <li><b>🚀 アクセル</b> 押しっぱなしで加速</li>
          <li><b>💨 ドリフト/ブレーキ</b> ハンドルを切りながら押すとドリフト。ためると<span class="c1">青</span>→<span class="c2">オレンジ</span>→<span class="c3">むらさき</span>の火花でミニターボ！まっすぐのときはブレーキ</li>
          <li><b>🎁 アイテム</b> でアイテム使用。ドリフトボタンを押しながらだと後ろに投げる</li>
          <li>ドリフト中にハンドルをスワイプすると曲がりやすくなるよ</li>
          <li>設定で <b>ジャイロ操作</b>（傾けてハンドル）や <b>自動アクセル</b> も選べます</li>
          <li>スタート直前の「1」〜「GO!」の間にアクセルを押すと <b>ロケットスタート</b>！</li>
        </ul>
        <h3>⌨️ キーボード</h3>
        <ul>${KEYMAP_LABELS.map((l, i) => `<li>P${i + 1}: <code>${l}</code></li>`).join('')}</ul>
        <h3>🎁 アイテム</h3>
        <div class="item-list">${Object.values(ITEMS).map((it) => `<div class="item-row" style="--c:${it.color}"><span class="item-icon">${it.icon}${it.badge ? `<small>${it.badge}</small>` : ''}</span><b>${it.name}</b><span>${it.desc}</span></div>`).join('')}</div>
        <h3>🏆 キャラクター</h3>
        <div class="item-list">${CHARACTERS.map((c) => `<div class="item-row"><span class="item-icon">${c.emoji}</span><b>${c.name}</b><span>${c.typeLabel} / ${c.trait.label}: ${c.trait.desc}</span></div>`).join('')}</div>
      </div>
      <div class="btn-row sticky"><button class="btn primary" data-act="back">← もどる</button></div>
    </div>`);
  click(el, '[data-act=back]', () => onBack());
  return { el, dispose() {} };
}

// ---------- ポーズ ----------
export function pauseOverlay({ onResume, onRestart, onQuit }) {
  const el = h(`
    <div class="overlay pause-overlay">
      <div class="panel">
        <h2>⏸ ポーズ</h2>
        <button class="btn primary big" data-act="resume">▶ つづける</button>
        <button class="btn" data-act="restart">🔁 やりなおす</button>
        <button class="btn" data-act="quit">🏠 やめる</button>
      </div>
    </div>`);
  click(el, '[data-act=resume]', () => onResume());
  click(el, '[data-act=restart]', () => onRestart());
  click(el, '[data-act=quit]', () => onQuit());
  return { el, dispose() {} };
}

// ---------- ローディング ----------
export function loadingOverlay(text = 'コースをじゅんびちゅう…') {
  return h(`<div class="overlay loading-overlay"><div class="spinner">🏁</div><p>${esc(text)}</p></div>`);
}

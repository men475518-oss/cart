// 入力管理: キーボード / ゲームパッド / タッチ（ビューポートごと） / ジャイロ
import { clamp } from './Utils.js';
import { settings } from './Settings.js';

const KEYMAPS = [
  { left: ['ArrowLeft'], right: ['ArrowRight'], accel: ['ArrowUp'], brake: ['ArrowDown'], drift: ['ShiftLeft', 'ShiftRight', 'KeyZ'], item: ['Space', 'Enter', 'KeyX'] },
  { left: ['KeyA'], right: ['KeyD'], accel: ['KeyW'], brake: ['KeyS'], drift: ['KeyQ'], item: ['KeyE'] },
  { left: ['KeyJ'], right: ['KeyL'], accel: ['KeyI'], brake: ['KeyK'], drift: ['KeyU'], item: ['KeyO'] },
  { left: ['Numpad4'], right: ['Numpad6'], accel: ['Numpad8'], brake: ['Numpad5'], drift: ['Numpad7'], item: ['Numpad9'] },
];

export const KEYMAP_LABELS = [
  '← → ハンドル / ↑ アクセル / ↓ ブレーキ / Shift ドリフト / Space アイテム',
  'A D ハンドル / W アクセル / S ブレーキ / Q ドリフト / E アイテム',
  'J L ハンドル / I アクセル / K ブレーキ / U ドリフト / O アイテム',
  'テンキー 4 6 ハンドル / 8 アクセル / 5 ブレーキ / 7 ドリフト / 9 アイテム',
];

function emptyState() {
  return { steer: 0, accel: 0, brake: 0, drift: false, item: false, itemPressed: false, pause: false, pausePressed: false, any: false };
}

class PlayerInput {
  constructor(index) {
    this.index = index;
    this.keys = new Set();
    this.touch = null; // { steer, accel, brake, drift, item }
    this.gamepadIndex = null;
    this.state = emptyState();
    this._prevItem = false;
    this._prevPause = false;
    this.accelHeldSince = -1; // アクセルを押し始めた時刻（ロケットスタート判定用）
  }
}

export class InputManager {
  constructor() {
    this.players = [0, 1, 2, 3].map((i) => new PlayerInput(i));
    this.gyro = { enabled: false, steer: 0, offset: 0, raw: 0, supported: typeof DeviceOrientationEvent !== 'undefined' };
    this.now = 0;
    this._keys = new Set();
    this._edges = new Set(); // フレーム間に押されたキー（短押し取りこぼし防止）
    this._onKey = this._onKey.bind(this);
    this._onOrient = this._onOrient.bind(this);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onKey);
      window.addEventListener('keyup', this._onKey);
      window.addEventListener('blur', () => this._keys.clear());
      window.addEventListener('gamepadconnected', (e) => this._assignGamepad(e.gamepad));
    }
  }

  _onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.type === 'keydown') {
      if (!e.repeat) this._edges.add(e.code);
      this._keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    } else this._keys.delete(e.code);
  }

  _assignGamepad(gp) {
    for (const p of this.players) if (p.gamepadIndex === gp.index) return;
    const free = this.players.find((p) => p.gamepadIndex === null);
    if (free) free.gamepadIndex = gp.index;
  }

  /** ジャイロを有効化（iOS では許可ダイアログ） */
  async enableGyro() {
    if (typeof DeviceOrientationEvent === 'undefined') return false;
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') return false;
      }
    } catch (e) {
      return false;
    }
    window.addEventListener('deviceorientation', this._onOrient);
    this.gyro.enabled = true;
    return true;
  }
  disableGyro() {
    window.removeEventListener('deviceorientation', this._onOrient);
    this.gyro.enabled = false;
    this.gyro.steer = 0;
  }
  calibrateGyro() {
    this.gyro.offset = this.gyro.raw;
  }
  _onOrient(e) {
    const angle = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
    let tilt;
    if (angle === 90) tilt = e.beta ?? 0;
    else if (angle === -90 || angle === 270) tilt = -(e.beta ?? 0);
    else if (angle === 180) tilt = -(e.gamma ?? 0);
    else tilt = e.gamma ?? 0;
    this.gyro.raw = tilt;
    const range = 28 / (settings.get('gyroSensitivity') || 1);
    let s = clamp((tilt - this.gyro.offset) / range, -1, 1);
    if (settings.get('gyroInvert')) s = -s;
    this.gyro.steer = s;
  }

  /** タッチ操作オーバーレイからの入力を登録 */
  setTouch(playerIndex, touchState) {
    this.players[playerIndex].touch = touchState;
  }

  update(time) {
    this.now = time;
    const gps = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of this.players) {
      const km = KEYMAPS[p.index];
      const s = emptyState();
      // キーボード
      const kd = (codes) => codes.some((c) => this._keys.has(c));
      const edge = (codes) => codes.some((c) => this._edges.has(c));
      let itemEdge = edge(km.item);
      let pauseEdge = p.index === 0 && (this._edges.has('Escape') || this._edges.has('KeyP'));
      if (kd(km.left)) s.steer -= 1;
      if (kd(km.right)) s.steer += 1;
      if (kd(km.accel)) s.accel = 1;
      if (kd(km.brake)) s.brake = 1;
      if (kd(km.drift)) s.drift = true;
      if (kd(km.item)) s.item = true;
      if (p.index === 0 && (this._keys.has('Escape') || this._keys.has('KeyP'))) s.pause = true;
      // ゲームパッド
      if (p.gamepadIndex !== null && gps && gps[p.gamepadIndex]) {
        const g = gps[p.gamepadIndex];
        const ax = g.axes[0] || 0;
        if (Math.abs(ax) > 0.15) s.steer += ax;
        if (g.buttons[14]?.pressed) s.steer -= 1;
        if (g.buttons[15]?.pressed) s.steer += 1;
        if (g.buttons[0]?.pressed || (g.buttons[7]?.value || 0) > 0.2) s.accel = Math.max(s.accel, g.buttons[0]?.pressed ? 1 : g.buttons[7].value);
        if (g.buttons[1]?.pressed || (g.buttons[6]?.value || 0) > 0.2) s.brake = 1;
        if (g.buttons[5]?.pressed || g.buttons[1]?.pressed) s.drift = true;
        if (g.buttons[2]?.pressed || g.buttons[4]?.pressed) s.item = true;
        if (g.buttons[9]?.pressed) s.pause = true;
      }
      // タッチ
      if (p.touch) {
        const t = p.touch;
        s.steer += t.steer;
        if (t.accel) s.accel = 1;
        if (t.brake) s.brake = 1;
        if (t.drift) s.drift = true;
        if (t.item) s.item = true;
        if (t.itemEdge) {
          itemEdge = true;
          t.itemEdge = false;
        }
        if (t.pause) s.pause = true;
      }
      // ジャイロ（プレイヤー1のみ）
      if (p.index === 0 && this.gyro.enabled) s.steer += this.gyro.steer;
      if (p.index === 0 && settings.get('autoAccel') && !s.brake) s.accel = 1;

      s.steer = clamp(s.steer, -1, 1);
      s.itemPressed = (s.item && !p._prevItem) || itemEdge;
      s.pausePressed = (s.pause && !p._prevPause) || pauseEdge;
      p._prevItem = s.item;
      p._prevPause = s.pause;
      if (s.accel > 0) {
        if (p.accelHeldSince < 0) p.accelHeldSince = time;
      } else p.accelHeldSince = -1;
      s.accelHeldSince = p.accelHeldSince;
      s.any = s.accel > 0 || s.brake > 0 || s.drift || s.item || s.steer !== 0;
      p.state = s;
    }
    this._edges.clear();
  }

  get(playerIndex) {
    return this.players[playerIndex]?.state || emptyState();
  }

  /** 何かキーが押されたか（タイトル画面用） */
  anyKeyDown() {
    return this._keys.size > 0;
  }
}

/**
 * タッチ操作オーバーレイ。ビューポートごとに1つ生成する。
 * 左側: ステアリング（ドラッグ）、右側: アクセル / ドリフト / アイテム ボタン
 */
export class TouchControls {
  constructor(container, opts = {}) {
    this.container = container;
    this.flip = !!opts.flip;
    this.layout = opts.layout || settings.get('controlLayout') || 'right';
    this.state = { steer: 0, accel: false, brake: false, drift: false, item: false, itemEdge: false, pause: false };
    this._steerPointer = null;
    this._steerOrigin = 0;
    this._buttonPointers = new Map();
    this._build();
  }

  _build() {
    const root = document.createElement('div');
    root.className = 'touch-controls' + (this.layout === 'left' ? ' layout-left' : '');
    root.innerHTML = `
      <div class="tc-steer">
        <div class="tc-wheel"><div class="tc-wheel-inner">🏁</div></div>
        <div class="tc-steer-hint">← ここをドラッグでハンドル →</div>
      </div>
      <div class="tc-buttons">
        <button class="tc-btn tc-item" data-btn="item"><span>🎁</span><small>アイテム</small></button>
        <button class="tc-btn tc-drift" data-btn="drift"><span>💨</span><small>ドリフト/ブレーキ</small></button>
        <button class="tc-btn tc-accel" data-btn="accel"><span>🚀</span><small>アクセル</small></button>
      </div>`;
    this.container.appendChild(root);
    this.root = root;
    this.wheel = root.querySelector('.tc-wheel');
    const steerZone = root.querySelector('.tc-steer');

    const onDown = (e) => {
      if (this._steerPointer !== null) return;
      this._steerPointer = e.pointerId;
      this._steerOrigin = e.clientX;
      this._steerZoneWidth = steerZone.getBoundingClientRect().width || 200;
      steerZone.setPointerCapture?.(e.pointerId);
      steerZone.classList.add('active');
      e.preventDefault();
    };
    const onMove = (e) => {
      if (e.pointerId !== this._steerPointer) return;
      const dx = e.clientX - this._steerOrigin;
      let s = clamp(dx / (this._steerZoneWidth * 0.28), -1, 1);
      if (this.flip) s = -s;
      this.state.steer = s;
      this.wheel.style.transform = `rotate(${s * 90}deg)`;
      e.preventDefault();
    };
    const onUp = (e) => {
      if (e.pointerId !== this._steerPointer) return;
      this._steerPointer = null;
      this.state.steer = 0;
      this.wheel.style.transform = 'rotate(0deg)';
      steerZone.classList.remove('active');
    };
    steerZone.addEventListener('pointerdown', onDown);
    steerZone.addEventListener('pointermove', onMove);
    steerZone.addEventListener('pointerup', onUp);
    steerZone.addEventListener('pointercancel', onUp);
    steerZone.addEventListener('lostpointercapture', onUp);

    for (const btn of root.querySelectorAll('.tc-btn')) {
      const name = btn.dataset.btn;
      const press = (e) => {
        this.state[name] = true;
        if (name === 'item') this.state.itemEdge = true;
        btn.classList.add('pressed');
        this._buttonPointers.set(e.pointerId, name);
        btn.setPointerCapture?.(e.pointerId);
        if (settings.get('hapticFeedback') && navigator.vibrate && name !== 'accel') navigator.vibrate(8);
        e.preventDefault();
      };
      const release = (e) => {
        if (this._buttonPointers.get(e.pointerId) !== name) return;
        this._buttonPointers.delete(e.pointerId);
        this.state[name] = false;
        btn.classList.remove('pressed');
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    // ドリフトボタン = ブレーキ兼用（物理側で低速時はブレーキとして扱う）
    Object.defineProperty(this.state, 'brake', { get: () => this.state.drift, enumerable: true });
  }

  setVisible(v) {
    this.root.style.display = v ? '' : 'none';
  }
  destroy() {
    this.root.remove();
  }
}

// ビューポートごとの HUD（順位 / ラップ / アイテム / ミニマップ / メッセージ / タッチ操作）
import { TouchControls } from '../core/Input.js';
import { ITEMS } from '../data/items.js';
import { formatTime } from '../core/Utils.js';

export class HUD {
  constructor(root, opts) {
    this.opts = opts;
    this.root = root;
    const el = document.createElement('div');
    el.className = 'hud' + (opts.flip ? ' flip' : ''); // compact / short は setRect でビューポート実寸から決める
    el.innerHTML = `
      <div class="hud-label">${opts.label || ''}</div>
      <div class="hud-topleft">
        <div class="hud-pos"><span class="hud-pos-num">-</span><span class="hud-pos-suffix">位</span></div>
        <div class="hud-lap">LAP <span class="hud-lap-cur">1</span>/<span class="hud-lap-max">3</span></div>
        <div class="hud-coins"><span class="hud-coin-icon">🪙</span><span class="hud-coin-num">0</span></div>
        <div class="hud-time">0:00.000</div>
      </div>
      <div class="hud-items">
        <div class="hud-item"><div class="hud-item-icon">?</div><div class="hud-item-badge"></div></div>
        <div class="hud-item hud-item-2" style="display:none"><div class="hud-item-icon">?</div><div class="hud-item-badge"></div></div>
      </div>
      <div class="hud-minimap"><canvas width="140" height="140"></canvas></div>
      <div class="hud-lines"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="hud-center"></div>
      <div class="hud-sub"></div>
      <div class="hud-wrongway">⚠ 逆走！</div>
      <div class="hud-speed"><span>0</span> km/h</div>
      <div class="hud-flash"></div>
      <div class="hud-effect"></div>
      <button class="hud-pause" title="ポーズ">⏸</button>`;
    root.appendChild(el);
    this.el = el;
    this.q = (sel) => el.querySelector(sel);
    this.posNum = this.q('.hud-pos-num');
    this.lapCur = this.q('.hud-lap-cur');
    this.lapMax = this.q('.hud-lap-max');
    this.timeEl = this.q('.hud-time');
    this.coinEl = this.q('.hud-coin-num');
    this.coinBox = this.q('.hud-coins');
    this.itemEls = [this.q('.hud-item'), this.q('.hud-item-2')];
    this.centerEl = this.q('.hud-center');
    this.subEl = this.q('.hud-sub');
    this.wrongEl = this.q('.hud-wrongway');
    this.speedEl = this.q('.hud-speed span');
    this.flashEl = this.q('.hud-flash');
    this.effectEl = this.q('.hud-effect');
    this.linesEl = this.q('.hud-lines');
    this.pauseBtn = this.q('.hud-pause');
    this.mm = this.q('.hud-minimap canvas');
    this.mmCtx = this.mm.getContext('2d');
    this.setRect(opts.rect || { x: 0, y: 0, w: 1, h: 1 });
    this.touch = null;
    this.paused = false;
    this.pauseBtn.addEventListener('click', () => {
      this.paused = true;
    });
    if (opts.touch) {
      this.touch = new TouchControls(el, { flip: opts.flip });
      opts.input.setTouch(opts.playerIndex, this.touch.state);
    }
    if (opts.track) this._buildMinimapBase(opts.track);
    this._msgTimer = null;
    this._lastItemKey = '';
  }

  setRect(rect) {
    this.rect = rect;
    const s = this.el.style;
    s.left = rect.x * 100 + '%';
    s.top = rect.y * 100 + '%';
    s.width = rect.w * 100 + '%';
    s.height = rect.h * 100 + '%';
    // 画面分割ではビューポートが小さいので、そのビューポートの実寸でボタンの大きさを決める。
    // CSS のメディアクエリはウィンドウ全体しか見ないため、ここで判定する
    const vw = rect.w * (window.innerWidth || 800);
    const vh = rect.h * (window.innerHeight || 600);
    const compact = this.opts.compact || vh < 300 || vw < 320;
    this.el.classList.toggle('compact', compact);
    this.el.classList.toggle('short', !compact && vh < 460);
  }

  _buildMinimapBase(track) {
    const size = 140;
    const b = track.bounds;
    const w = b.max.x - b.min.x;
    const h = b.max.z - b.min.z;
    const scale = (size - 16) / Math.max(w, h);
    this.mmScale = scale;
    this.mmOff = { x: (size - w * scale) / 2 - b.min.x * scale, y: (size - h * scale) / 2 - b.min.z * scale };
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    for (let i = 0; i <= track.N; i++) {
      const s = track.samples[i % track.N];
      const x = s.pos.x * scale + this.mmOff.x;
      const y = s.pos.z * scale + this.mmOff.y;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
    // スタートライン
    const s0 = track.samples[0];
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(s0.pos.x * scale + this.mmOff.x, s0.pos.z * scale + this.mmOff.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    this.mmBase = c;
  }

  /** 毎フレーム更新 */
  update(v) {
    if (v.rank !== this._rank) {
      this._rank = v.rank;
      this.posNum.textContent = v.rank;
      this.posNum.parentElement.className = 'hud-pos rank-' + Math.min(v.rank, 4);
      this.posNum.parentElement.classList.add('pop');
      setTimeout(() => this.posNum.parentElement.classList.remove('pop'), 250);
    }
    if (v.lap !== this._lap || v.laps !== this._laps) {
      this._lap = v.lap;
      this._laps = v.laps;
      this.lapCur.textContent = Math.min(v.lap, v.laps);
      this.lapMax.textContent = v.laps;
    }
    this.timeEl.textContent = formatTime(v.time);
    if (v.coins !== this._coins) {
      const up = v.coins > (this._coins ?? 0);
      this._coins = v.coins;
      this.coinEl.textContent = v.coins;
      this.coinBox.classList.toggle('full', v.coins >= (v.maxCoins || 10));
      this.coinBox.classList.remove('pop', 'drop');
      void this.coinBox.offsetWidth;
      this.coinBox.classList.add(up ? 'pop' : 'drop');
    }
    this.speedEl.textContent = Math.round(Math.abs(v.speed) * 3.2);
    this.wrongEl.style.display = v.wrongWay ? '' : 'none';
    // アイテム
    this.itemEls[0].classList.toggle('held', !!v.held);
    const key = JSON.stringify([v.items.map((i) => i.id + i.uses), v.roulette ? v.roulette.current : null, v.capacity, v.golden]);
    if (key !== this._lastItemKey) {
      this._lastItemKey = key;
      for (let i = 0; i < 2; i++) {
        const el = this.itemEls[i];
        const icon = el.querySelector('.hud-item-icon');
        const badge = el.querySelector('.hud-item-badge');
        if (i >= v.capacity) {
          el.style.display = 'none';
          continue;
        }
        el.style.display = '';
        let it = v.items[i];
        let rolling = false;
        if (!it && v.roulette && i === v.items.length) {
          it = { id: v.roulette.current, uses: 1 };
          rolling = true;
        }
        el.classList.toggle('rolling', rolling);
        el.classList.toggle('has', !!it && !rolling);
        if (it) {
          const def = ITEMS[it.id];
          icon.textContent = def.icon;
          el.style.setProperty('--item-color', def.color);
          badge.textContent = it.id === 'goldenMushroom' && v.golden ? '★' : it.uses > 1 ? '×' + it.uses : def.badge || '';
        } else {
          icon.textContent = '?';
          badge.textContent = '';
          el.style.removeProperty('--item-color');
        }
      }
    }
    // ミニマップ
    if (this.mmBase && v.karts) {
      const ctx = this.mmCtx;
      ctx.clearRect(0, 0, 140, 140);
      ctx.drawImage(this.mmBase, 0, 0);
      for (const k of v.karts) {
        const x = k.x * this.mmScale + this.mmOff.x;
        const y = k.z * this.mmScale + this.mmOff.y;
        ctx.beginPath();
        ctx.arc(x, y, k.me ? 5.5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = k.color;
        ctx.fill();
        ctx.lineWidth = k.me ? 2 : 1;
        ctx.strokeStyle = k.me ? '#fff' : 'rgba(0,0,0,0.5)';
        ctx.stroke();
      }
    }
    // ステータス演出
    const eff = v.star ? 'star' : v.squash ? 'squash' : v.boost ? 'boost' : '';
    if (eff !== this._eff) {
      this._eff = eff;
      this.effectEl.className = 'hud-effect ' + eff;
      // ダッシュ中は放射状のスピードラインを流す
      this.linesEl.classList.toggle('on', eff === 'boost' || eff === 'star');
    }
  }

  message(text, cls = '', dur = 1.6) {
    this.centerEl.textContent = text;
    this.centerEl.className = 'hud-center show ' + cls;
    clearTimeout(this._msgTimer);
    if (dur > 0) this._msgTimer = setTimeout(() => (this.centerEl.className = 'hud-center'), dur * 1000);
  }
  sub(text, dur = 1.6) {
    this.subEl.textContent = text;
    this.subEl.className = 'hud-sub show';
    clearTimeout(this._subTimer);
    this._subTimer = setTimeout(() => (this.subEl.className = 'hud-sub'), dur * 1000);
  }
  countdown(text) {
    this.centerEl.textContent = text;
    this.centerEl.className = 'hud-center';
    void this.centerEl.offsetWidth; // アニメーションをリセット
    this.centerEl.className = 'hud-center show countdown' + (text === 'GO!' ? ' go' : '');
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => (this.centerEl.className = 'hud-center'), 900);
  }
  flash(color = 'rgba(255,255,255,0.8)') {
    this.flashEl.style.background = color;
    this.flashEl.classList.remove('on');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('on');
  }
  setTouchVisible(v) {
    if (this.touch) this.touch.setVisible(v);
  }
  destroy() {
    clearTimeout(this._msgTimer);
    if (this.touch) {
      this.opts.input.setTouch(this.opts.playerIndex, null);
      this.touch.destroy();
    }
    this.el.remove();
  }
}

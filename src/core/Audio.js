// オーディオエンジン: WebAudio による手続き型 BGM / 効果音 / エンジン音 / キャラクターボイス
import { settings } from './Settings.js';
import { clamp } from './Utils.js';

const NOTE = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// ---- BGM パターン（テーマごと） ----
// scale: 半音配列, root: MIDI ノート。lead/bass: スケール度数（null は休符, 負数可）。drums: 16分ステップ
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PENTA = [0, 2, 4, 7, 9];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];

const BGM = {
  meadow: {
    bpm: 126, root: 60, scale: PENTA, leadWave: 'square', bassWave: 'triangle', padWave: 'triangle', swing: 0,
    lead: [
      0, null, 2, null, 4, null, 2, 0, null, null, 4, null, 5, 4, 2, null,
      0, null, 2, null, 4, 5, 7, null, 5, null, 4, null, 2, null, null, null,
      7, null, 5, null, 4, null, 2, null, 4, null, 5, null, 7, null, 9, null,
      7, null, 5, 4, null, 2, null, 0, null, null, 2, null, 0, null, null, null,
    ],
    bass: [0, null, 0, null, 3, null, 3, null, 4, null, 4, null, 3, null, 4, null],
    chords: [[0, 2, 4], [3, 5, 7], [4, 6, 8], [3, 5, 7]],
    drums: { kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1], hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1] },
  },
  beach: {
    bpm: 112, root: 62, scale: MAJOR, leadWave: 'triangle', bassWave: 'sine', padWave: 'sawtooth', swing: 0.18,
    lead: [
      4, null, null, 6, null, null, 7, null, 6, null, 4, null, null, null, 2, null,
      4, null, null, 6, null, null, 7, null, 9, null, 7, null, null, null, null, null,
      7, null, null, 9, null, null, 11, null, 9, null, 7, null, 6, null, 4, null,
      2, null, 4, null, 6, null, 4, null, null, null, null, null, null, null, null, null,
    ],
    bass: [0, null, null, 0, null, 4, null, null, 3, null, null, 3, null, 4, null, null],
    chords: [[0, 2, 4, 6], [3, 5, 7, 9], [1, 3, 5, 7], [4, 6, 8, 10]],
    drums: { kick: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], hat: [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1] },
  },
  snow: {
    bpm: 120, root: 64, scale: MAJOR, leadWave: 'sine', bassWave: 'triangle', padWave: 'triangle', swing: 0, bell: true,
    lead: [
      7, null, 6, null, 4, null, null, null, 2, null, 4, null, 0, null, null, null,
      7, null, 6, null, 4, null, null, null, 9, null, 7, null, null, null, null, null,
      11, null, 9, null, 7, null, null, null, 6, null, 7, null, 9, null, null, null,
      7, null, 4, null, 2, null, null, null, 0, null, null, null, null, null, null, null,
    ],
    bass: [0, null, null, null, 0, null, null, null, 5, null, null, null, 4, null, null, null],
    chords: [[0, 2, 4], [5, 7, 9], [3, 5, 7], [4, 6, 8]],
    drums: { kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0] },
  },
  volcano: {
    bpm: 152, root: 57, scale: MINOR, leadWave: 'sawtooth', bassWave: 'sawtooth', padWave: 'square', swing: 0,
    lead: [
      0, null, 0, null, 7, null, 6, null, 5, null, null, null, 4, null, 3, null,
      0, null, 0, null, 7, null, 6, null, 5, null, 4, null, null, null, null, null,
      7, null, 7, null, 9, null, 7, null, 6, null, null, null, 5, null, 4, null,
      3, null, 4, null, 5, null, 4, null, 3, null, 2, null, 0, null, null, null,
    ],
    bass: [0, 0, null, 0, null, 0, 0, null, 0, 0, null, 0, null, 3, 4, null],
    chords: [[0, 2, 4], [0, 2, 4], [5, 7, 9], [4, 6, 8]],
    drums: { kick: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0], hat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
  },
  city: {
    bpm: 128, root: 57, scale: DORIAN, leadWave: 'sawtooth', bassWave: 'square', padWave: 'sawtooth', swing: 0, arp: true,
    lead: [
      0, 4, 7, 4, 0, 4, 7, 4, 2, 5, 9, 5, 2, 5, 9, 5,
      3, 5, 7, 5, 3, 5, 7, 5, 4, 6, 9, 6, 4, 6, 9, 6,
      0, 4, 7, 11, 7, 4, 0, 4, 2, 5, 9, 12, 9, 5, 2, 5,
      3, 7, 10, 7, 3, 7, 10, 7, 4, 7, 11, 7, 4, 7, 11, 7,
    ],
    bass: [0, null, 0, 0, null, 0, null, 0, 0, null, 0, 0, null, 0, null, 0],
    chords: [[0, 2, 4], [2, 4, 6], [3, 5, 7], [4, 6, 8]],
    drums: { kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0] },
  },
  menu: {
    bpm: 110, root: 60, scale: MAJOR, leadWave: 'triangle', bassWave: 'sine', padWave: 'triangle', swing: 0.1,
    lead: [
      4, null, null, null, 7, null, null, null, 6, null, 4, null, null, null, null, null,
      2, null, null, null, 4, null, null, null, 3, null, 2, null, null, null, null, null,
      4, null, null, null, 7, null, null, null, 9, null, 7, null, null, null, null, null,
      6, null, 4, null, 2, null, null, null, 0, null, null, null, null, null, null, null,
    ],
    bass: [0, null, null, null, null, null, 0, null, 3, null, null, null, 4, null, null, null],
    chords: [[0, 2, 4], [5, 7, 9], [3, 5, 7], [4, 6, 8]],
    drums: { kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0] },
  },
  star: {
    bpm: 170, root: 60, scale: MAJOR, leadWave: 'square', bassWave: 'square', padWave: 'triangle', swing: 0,
    lead: [
      0, 2, 4, 7, 4, 2, 0, null, 2, 4, 5, 9, 5, 4, 2, null,
      4, 5, 7, 11, 7, 5, 4, null, 7, 9, 11, 14, 11, 9, 7, null,
      0, 2, 4, 7, 4, 2, 0, null, 2, 4, 5, 9, 5, 4, 2, null,
      4, 5, 7, 11, 7, 5, 4, null, 7, 9, 11, 14, 11, 9, 7, null,
    ],
    bass: [0, 0, null, 0, 0, null, 3, 3, null, 3, 3, null, 4, 4, null, 4],
    chords: [[0, 2, 4], [3, 5, 7], [4, 6, 8], [0, 2, 4]],
    drums: { kick: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], hat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
  },
};

function degreeToMidi(root, scale, deg) {
  const n = scale.length;
  const oct = Math.floor(deg / n);
  const idx = ((deg % n) + n) % n;
  return root + scale[idx] + oct * 12;
}

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.bgm = { id: null, timer: null, step: 0, nextTime: 0, def: null, gain: null, prevId: null };
    this.engines = [];
    this._noiseBuf = null;
    this._voiceBusy = 0;
    this._lastLineAt = new Map();
    this._speechVoice = undefined;
  }

  /** ユーザー操作をきっかけに AudioContext を作成 */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.connect(this.master);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.connect(this.master);
    this.applyVolumes();
    this.enabled = true;
    // iOS: 無音を1回鳴らしてアンロック
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    g.gain.value = 0.0001;
    o.connect(g).connect(this.master);
    o.start();
    o.stop(this.ctx.currentTime + 0.05);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    });
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.bgmGain.gain.value = settings.get('bgmVolume');
    this.sfxGain.gain.value = settings.get('sfxVolume');
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  _noise() {
    if (this._noiseBuf) return this._noiseBuf;
    const len = this.ctx.sampleRate * 1.5;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
    return buf;
  }

  // ---------- 基本の音源ヘルパー ----------
  _tone({ freq, type = 'sine', t = this.now, dur = 0.2, vol = 0.3, attack = 0.005, decay, sweepTo, dest, detune = 0 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (detune) o.detune.value = detune;
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (decay || dur));
    o.connect(g).connect(dest || this.sfxGain);
    o.start(t);
    o.stop(t + (decay || dur) + 0.05);
    return o;
  }

  _noiseBurst({ t = this.now, dur = 0.2, vol = 0.3, filter = 'highpass', freq = 3000, q = 0.7, sweepTo, dest }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noise();
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest || this.sfxGain);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // ---------- 効果音 ----------
  sfx(name, opt = {}) {
    if (!this.enabled) return;
    const t = this.now;
    const v = opt.vol ?? 1;
    switch (name) {
      case 'click':
        this._tone({ freq: 880, type: 'square', dur: 0.06, vol: 0.12 * v });
        break;
      case 'select':
        this._tone({ freq: 660, type: 'square', dur: 0.08, vol: 0.12 * v });
        this._tone({ freq: 990, type: 'square', t: t + 0.07, dur: 0.12, vol: 0.12 * v });
        break;
      case 'back':
        this._tone({ freq: 660, type: 'square', dur: 0.08, vol: 0.1 * v });
        this._tone({ freq: 440, type: 'square', t: t + 0.07, dur: 0.12, vol: 0.1 * v });
        break;
      case 'count':
        this._tone({ freq: 440, type: 'square', dur: 0.25, vol: 0.25 * v });
        break;
      case 'go':
        this._tone({ freq: 880, type: 'square', dur: 0.7, vol: 0.3 * v });
        this._tone({ freq: 1320, type: 'square', dur: 0.7, vol: 0.12 * v });
        break;
      case 'itembox':
        [523, 659, 784, 1047].forEach((f, i) => this._tone({ freq: f, type: 'triangle', t: t + i * 0.06, dur: 0.18, vol: 0.2 * v }));
        break;
      case 'roulette':
        this._tone({ freq: 1200, type: 'square', dur: 0.03, vol: 0.06 * v });
        break;
      case 'itemGet':
        this._tone({ freq: 784, type: 'triangle', dur: 0.1, vol: 0.2 * v });
        this._tone({ freq: 1175, type: 'triangle', t: t + 0.08, dur: 0.25, vol: 0.2 * v });
        break;
      case 'throw':
        this._noiseBurst({ dur: 0.25, vol: 0.25 * v, filter: 'bandpass', freq: 800, sweepTo: 3000, q: 2 });
        break;
      case 'shell':
        this._tone({ freq: 300, type: 'sawtooth', dur: 0.2, vol: 0.15 * v, sweepTo: 900 });
        this._noiseBurst({ dur: 0.15, vol: 0.15 * v, filter: 'bandpass', freq: 1500, q: 3 });
        break;
      case 'drop':
        this._tone({ freq: 200, type: 'sine', dur: 0.12, vol: 0.25 * v, sweepTo: 80 });
        break;
      case 'hit':
        this._noiseBurst({ dur: 0.3, vol: 0.4 * v, filter: 'lowpass', freq: 2500, sweepTo: 300 });
        this._tone({ freq: 500, type: 'sawtooth', dur: 0.5, vol: 0.25 * v, sweepTo: 90 });
        break;
      case 'spin':
        for (let i = 0; i < 6; i++) this._tone({ freq: 500 - i * 60, type: 'square', t: t + i * 0.08, dur: 0.07, vol: 0.12 * v });
        break;
      case 'bump':
        this._noiseBurst({ dur: 0.12, vol: 0.3 * v, filter: 'lowpass', freq: 800 });
        this._tone({ freq: 120, type: 'sine', dur: 0.15, vol: 0.3 * v, sweepTo: 60 });
        break;
      case 'boost':
        this._tone({ freq: 200, type: 'sawtooth', dur: 0.5, vol: 0.2 * v, sweepTo: 1400 });
        this._noiseBurst({ dur: 0.5, vol: 0.15 * v, filter: 'bandpass', freq: 600, sweepTo: 4000, q: 1.5 });
        break;
      case 'drift1':
        this._tone({ freq: 660, type: 'square', dur: 0.12, vol: 0.12 * v });
        break;
      case 'drift2':
        this._tone({ freq: 660, type: 'square', dur: 0.1, vol: 0.12 * v });
        this._tone({ freq: 990, type: 'square', t: t + 0.1, dur: 0.12, vol: 0.12 * v });
        break;
      case 'drift3':
        [660, 990, 1320].forEach((f, i) => this._tone({ freq: f, type: 'square', t: t + i * 0.09, dur: 0.12, vol: 0.13 * v }));
        break;
      case 'star':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this._tone({ freq: f, type: 'square', t: t + i * 0.07, dur: 0.2, vol: 0.15 * v }));
        break;
      case 'lightning':
        this._noiseBurst({ dur: 1.2, vol: 0.6 * v, filter: 'lowpass', freq: 3000, sweepTo: 100 });
        this._tone({ freq: 2000, type: 'sawtooth', dur: 0.15, vol: 0.2 * v, sweepTo: 200 });
        break;
      case 'explosion':
        this._noiseBurst({ dur: 0.8, vol: 0.7 * v, filter: 'lowpass', freq: 1800, sweepTo: 80 });
        this._tone({ freq: 90, type: 'sine', dur: 0.7, vol: 0.5 * v, sweepTo: 30 });
        break;
      case 'horn':
        [0, 4, 7].forEach((s) => this._tone({ freq: NOTE(57 + s), type: 'sawtooth', dur: 0.5, vol: 0.18 * v, attack: 0.02 }));
        this._noiseBurst({ dur: 0.3, vol: 0.2 * v, filter: 'bandpass', freq: 1200, q: 1 });
        break;
      case 'boomerang':
        for (let i = 0; i < 10; i++) this._tone({ freq: 700 + (i % 2) * 200, type: 'triangle', t: t + i * 0.1, dur: 0.09, vol: 0.1 * v });
        break;
      case 'squash':
        this._tone({ freq: 800, type: 'square', dur: 0.4, vol: 0.2 * v, sweepTo: 150 });
        break;
      case 'unsquash':
        this._tone({ freq: 200, type: 'square', dur: 0.3, vol: 0.2 * v, sweepTo: 900 });
        break;
      case 'lap':
        this._tone({ freq: 1047, type: 'triangle', dur: 0.15, vol: 0.2 * v });
        this._tone({ freq: 1319, type: 'triangle', t: t + 0.12, dur: 0.3, vol: 0.2 * v });
        break;
      case 'warp':
        // 景色が切り替わるときの「シュワッ」
        this._tone({ freq: 220, type: 'sawtooth', dur: 0.5, vol: 0.14 * v, sweepTo: 1760 });
        this._tone({ freq: 330, type: 'sine', t: t + 0.05, dur: 0.45, vol: 0.1 * v, sweepTo: 2200 });
        this._noiseBurst({ t, dur: 0.5, vol: 0.1 * v, filter: 'bandpass', freq: 600, q: 1.5, sweepTo: 4500 });
        break;
      case 'finalLap':
        [784, 784, 1047].forEach((f, i) => this._tone({ freq: f, type: 'square', t: t + i * 0.13, dur: 0.15, vol: 0.2 * v }));
        break;
      case 'finish':
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this._tone({ freq: f, type: 'square', t: t + i * 0.12, dur: 0.25, vol: 0.2 * v }));
        break;
      case 'fanfare':
        [523, 523, 523, 659, 784, 1047].forEach((f, i) => {
          const dt = [0, 0.15, 0.3, 0.45, 0.6, 0.9][i];
          this._tone({ freq: f, type: 'square', t: t + dt, dur: i === 5 ? 0.9 : 0.16, vol: 0.2 * v });
          this._tone({ freq: f / 2, type: 'triangle', t: t + dt, dur: i === 5 ? 0.9 : 0.16, vol: 0.15 * v });
        });
        break;
      case 'lose':
        [392, 370, 349, 330].forEach((f, i) => this._tone({ freq: f, type: 'triangle', t: t + i * 0.3, dur: 0.35, vol: 0.18 * v }));
        break;
      case 'wrongway':
        this._tone({ freq: 220, type: 'square', dur: 0.15, vol: 0.12 * v });
        break;
      case 'pass':
        this._tone({ freq: 1200, type: 'triangle', dur: 0.08, vol: 0.1 * v, sweepTo: 1800 });
        break;
      case 'mushroom':
        this._tone({ freq: 400, type: 'square', dur: 0.3, vol: 0.18 * v, sweepTo: 1600 });
        break;
      case 'golden':
        [880, 1109, 1319, 1760].forEach((f, i) => this._tone({ freq: f, type: 'triangle', t: t + i * 0.05, dur: 0.3, vol: 0.15 * v }));
        break;
      case 'splash':
        this._noiseBurst({ dur: 0.35, vol: 0.25 * v, filter: 'bandpass', freq: 900, q: 0.8, sweepTo: 300 });
        break;
      case 'coin':
        this._tone({ freq: 988, type: 'sine', dur: 0.07, vol: 0.18 * v });
        this._tone({ freq: 1319, type: 'sine', t: t + 0.07, dur: 0.22, vol: 0.18 * v });
        break;
      case 'coinLoss':
        for (let i = 0; i < 3; i++) this._tone({ freq: 900 - i * 150, type: 'triangle', t: t + i * 0.07, dur: 0.1, vol: 0.12 * v });
        break;
      case 'jump':
        this._noiseBurst({ dur: 0.3, vol: 0.18 * v, filter: 'bandpass', freq: 500, sweepTo: 2500, q: 1.2 });
        break;
      case 'trick':
        this._noiseBurst({ dur: 0.25, vol: 0.2 * v, filter: 'bandpass', freq: 1500, sweepTo: 4000, q: 1.5 });
        [880, 1109, 1319].forEach((f, i) => this._tone({ freq: f, type: 'triangle', t: t + i * 0.06, dur: 0.18, vol: 0.14 * v }));
        break;
      case 'land':
        this._noiseBurst({ dur: 0.15, vol: 0.25 * v, filter: 'lowpass', freq: 900 });
        this._tone({ freq: 90, type: 'sine', dur: 0.12, vol: 0.25 * v, sweepTo: 50 });
        break;
      case 'shield':
        this._tone({ freq: 1760, type: 'triangle', dur: 0.25, vol: 0.18 * v, sweepTo: 880 });
        this._noiseBurst({ dur: 0.12, vol: 0.15 * v, filter: 'highpass', freq: 3000 });
        break;
      case 'confetti':
        for (let i = 0; i < 8; i++) this._tone({ freq: 800 + Math.random() * 1200, type: 'triangle', t: t + i * 0.05, dur: 0.1, vol: 0.06 * v });
        break;
      default:
        break;
    }
  }

  // ---------- エンジン音（プレイヤーごと） ----------
  createEngine() {
    if (!this.enabled) return { update() {}, stop() {} };
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o1.connect(f);
    o2.connect(f);
    f.connect(g).connect(this.sfxGain);
    o1.start();
    o2.start();
    // ドリフトのスキール音
    const skid = ctx.createBufferSource();
    skid.buffer = this._noise();
    skid.loop = true;
    const sf = ctx.createBiquadFilter();
    sf.type = 'bandpass';
    sf.frequency.value = 2200;
    sf.Q.value = 1.5;
    const sg = ctx.createGain();
    sg.gain.value = 0;
    skid.connect(sf).connect(sg).connect(this.sfxGain);
    skid.start();
    const eng = {
      update: (speedNorm, throttle, drifting, boosting) => {
        const now = ctx.currentTime;
        const base = 55 + speedNorm * 150 + (boosting ? 40 : 0);
        o1.frequency.setTargetAtTime(base, now, 0.05);
        o2.frequency.setTargetAtTime(base / 2, now, 0.05);
        f.frequency.setTargetAtTime(350 + speedNorm * 1500 + (boosting ? 800 : 0), now, 0.05);
        g.gain.setTargetAtTime(0.05 + 0.08 * (0.35 + 0.65 * throttle) * (0.5 + speedNorm), now, 0.05);
        sg.gain.setTargetAtTime(drifting ? 0.08 : 0, now, 0.05);
      },
      stop: () => {
        try {
          g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
          sg.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
          setTimeout(() => {
            o1.stop();
            o2.stop();
            skid.stop();
          }, 300);
        } catch (e) {
          /* already stopped */
        }
      },
    };
    this.engines.push(eng);
    return eng;
  }

  stopAllEngines() {
    for (const e of this.engines) e.stop();
    this.engines = [];
  }

  // ---------- BGM シーケンサ ----------
  playBgm(id) {
    if (!this.enabled) {
      this.bgm.id = id;
      return;
    }
    if (this.bgm.id === id && this.bgm.timer) return;
    this.stopBgm();
    const def = BGM[id];
    if (!def) return;
    this.bgm.id = id;
    this.bgm.def = def;
    this.bgm.tempoMult = 1;
    this.bgm.step = 0;
    this.bgm.nextTime = this.ctx.currentTime + 0.1;
    this.bgm.gain = this.ctx.createGain();
    this.bgm.gain.gain.value = 1;
    this.bgm.gain.connect(this.bgmGain);
    // ディレイ（雪山 / 都会用）
    const delay = this.ctx.createDelay(1.0);
    delay.delayTime.value = (60 / def.bpm) * 0.75;
    const dg = this.ctx.createGain();
    dg.gain.value = def.bell || def.arp ? 0.35 : 0.12;
    this.bgm.gain.connect(delay).connect(dg).connect(this.bgmGain);
    this.bgm.delayNodes = [delay, dg];
    this.bgm.timer = setInterval(() => this._schedule(), 30);
  }

  /** BGM のテンポ倍率（ファイナルラップで速くする） */
  setTempo(mult = 1) {
    this.bgm.tempoMult = mult;
  }

  /** スター用の一時 BGM 切り替え */
  pushBgm(id) {
    if (this.bgm.id === id) return;
    this.bgm.prevId = this.bgm.id;
    this.playBgm(id);
  }
  popBgm() {
    if (this.bgm.prevId) {
      const p = this.bgm.prevId;
      this.bgm.prevId = null;
      this.playBgm(p);
    }
  }

  stopBgm() {
    if (this.bgm.timer) clearInterval(this.bgm.timer);
    this.bgm.timer = null;
    if (this.bgm.gain) {
      const g = this.bgm.gain;
      g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      setTimeout(() => g.disconnect(), 500);
    }
    this.bgm.gain = null;
    this.bgm.id = null;
  }

  _schedule() {
    const b = this.bgm;
    if (!b.def || !this.ctx) return;
    const d = b.def;
    const stepDur = 60 / (d.bpm * (b.tempoMult || 1)) / 4;
    while (b.nextTime < this.ctx.currentTime + 0.15) {
      const i = b.step;
      const swing = i % 2 === 1 ? stepDur * d.swing : 0;
      const t = b.nextTime + swing;
      const dest = b.gain;
      const bar = Math.floor(i / 16) % d.chords.length;
      // ドラム
      const di = i % 16;
      if (d.drums.kick[di]) this._tone({ freq: 150, type: 'sine', t, dur: 0.18, vol: 0.5, sweepTo: 40, dest });
      if (d.drums.snare[di]) {
        this._noiseBurst({ t, dur: 0.14, vol: 0.22, filter: 'highpass', freq: 1500, dest });
        this._tone({ freq: 220, type: 'triangle', t, dur: 0.1, vol: 0.15, sweepTo: 120, dest });
      }
      if (d.drums.hat[di]) this._noiseBurst({ t, dur: 0.04, vol: 0.08, filter: 'highpass', freq: 7000, dest });
      // ベース
      const bdeg = d.bass[di];
      if (bdeg !== null && bdeg !== undefined) {
        const chordRoot = d.chords[bar][0];
        this._tone({ freq: NOTE(degreeToMidi(d.root - 24, d.scale, bdeg + chordRoot)), type: d.bassWave, t, dur: stepDur * 1.8, vol: 0.28, dest });
      }
      // パッド（小節頭）
      if (di === 0) {
        for (const cd of d.chords[bar]) {
          this._tone({ freq: NOTE(degreeToMidi(d.root - 12, d.scale, cd)), type: d.padWave, t, dur: stepDur * 16, vol: 0.05, attack: 0.3, detune: 4, dest });
          this._tone({ freq: NOTE(degreeToMidi(d.root - 12, d.scale, cd)), type: d.padWave, t, dur: stepDur * 16, vol: 0.05, attack: 0.3, detune: -4, dest });
        }
      }
      // リード
      const ldeg = d.lead[i % d.lead.length];
      if (ldeg !== null && ldeg !== undefined) {
        const midi = degreeToMidi(d.root, d.scale, ldeg);
        const dur = d.bell ? stepDur * 3 : d.arp ? stepDur * 0.9 : stepDur * 1.6;
        this._tone({ freq: NOTE(midi), type: d.leadWave, t, dur, vol: d.leadWave === 'sawtooth' ? 0.12 : 0.18, dest });
        if (d.bell) this._tone({ freq: NOTE(midi + 12), type: 'sine', t, dur: dur * 0.6, vol: 0.06, dest });
      }
      b.nextTime += stepDur;
      b.step++;
    }
  }

  // ---------- キャラクターボイス ----------
  /**
   * 鳴き声をその場で合成する。キャラごとの voice.cry で声質が決まる。
   * 動物の鳴き声らしさは、声道の共鳴（フォルマント）が 1 音のあいだに
   * どう動くかでほぼ決まるので、F1・F2 の 2 本を動かしながら鳴らす。
   *   f1 / f2 … 第1・第2フォルマントの [はじめ, おわり] (Hz)
   *   q1 / q2 … それぞれの鋭さ、a2 … F2 の混ぜ具合
   *   vib     … ビブラート（ひつじの「めー」、くまのうなり）
   *   glide   … 1 音のなかで基音がどれだけ上下するか（1 未満は下がる）
   *   arc     … いったん上がってから下がる（ねこの「にゃ〜お」）
   *   breath  … 息の音の量、bite … 頭の短いアタック（犬の「わんっ」）
   *   growl   … 声のざらつき（Hz。くま・ドラゴン・ペンギン）
   *   sub     … 1 オクターブ下を重ねる量（大型キャラの重み）
   */
  voice(char, key, opts = {}) {
    if (!this.enabled || !char) return;
    const now = performance.now();
    const k = `${char.id}:${key}`;
    const last = this._lastLineAt.get(k) || 0;
    if (now - last < (opts.minInterval ?? 2500)) return;
    this._lastLineAt.set(k, now);
    this._cry(char, key);
    if (settings.get('voice') && typeof speechSynthesis !== 'undefined' && char.lines[key] && !opts.noSpeech) {
      this._speak(char.lines[key], char.voice.pitch, char.voice.rate);
    }
  }

  /** 場面ごとの音程の並び。同じ場面でも 2〜3 通りから選んで単調にしない */
  _cryShape(key, seed) {
    const shapes = {
      // [音程の倍率, 長さの倍率, 音量の倍率]
      hit: [
        [[1.55, 0.7, 1.15], [0.95, 0.9, 0.8]],
        [[1.7, 0.55, 1.2], [1.1, 0.7, 0.9], [0.8, 1.1, 0.6]],
      ],
      drift: [[[1.05, 0.8, 0.7], [1.25, 1.0, 0.6]], [[1.15, 0.9, 0.65]]],
      boost: [
        [[0.85, 0.7, 0.85], [1.2, 0.7, 0.95], [1.6, 1.1, 1.0]],
        [[1.0, 0.6, 0.9], [1.5, 1.2, 1.0]],
      ],
      item: [[[1.2, 0.7, 0.85], [1.0, 0.9, 0.7]], [[1.35, 0.6, 0.9]]],
      pass: [[[1.0, 0.7, 0.8], [1.3, 0.7, 0.85], [1.15, 1.0, 0.7]], [[1.25, 0.8, 0.85], [1.05, 1.0, 0.7]]],
      win: [
        [[1.0, 0.7, 1.0], [1.25, 0.7, 1.0], [1.5, 0.7, 1.05], [2.0, 1.6, 1.1]],
        [[1.2, 0.6, 1.0], [1.5, 0.6, 1.0], [1.8, 0.6, 1.05], [2.4, 1.5, 1.1]],
      ],
      lose: [[[1.0, 1.0, 0.8], [0.85, 1.2, 0.7], [0.68, 1.8, 0.6]], [[0.9, 1.3, 0.75], [0.7, 2.0, 0.6]]],
      start: [[[1.0, 0.6, 0.9], [1.0, 0.6, 0.9], [1.5, 1.2, 1.05]], [[1.2, 0.7, 0.95], [1.6, 1.1, 1.05]]],
      select: [[[1.0, 0.8, 0.9], [1.3, 1.0, 0.9]], [[1.15, 0.9, 0.9], [1.45, 1.0, 0.9]]],
      lap: [[[1.3, 0.7, 0.9], [1.6, 1.0, 0.95]]],
    };
    const list = shapes[key] || [[[1.0, 0.9, 0.85], [1.2, 1.0, 0.8]]];
    return list[seed % list.length];
  }

  /** 鳴き声本体 */
  _cry(char, key) {
    const ctx = this.ctx;
    const v = char.voice;
    const c = v.cry || {};
    const f1 = c.f1 || [700, 700];
    const f2 = c.f2 || [1500, 1500];
    const vib = c.vib || { hz: 0, cents: 0 };
    const glide = c.glide === undefined ? 1.0 : c.glide;
    const arc = c.arc || 0;
    const breath = c.breath || 0;
    const sylDur = c.syl || 0.13;
    const gap = c.gap || 0.08;
    const wobble = c.wobble || 0;
    const seed = (this._crySeed = ((this._crySeed || 0) + 1) >>> 0);
    // 動物ごとに一度に鳴らす音の数はちがう。くまは長く 1〜2 声、
    // うさぎは短く何度も。場面の並びをその上限まで切りつめる
    let shape = this._cryShape(key, seed);
    if (c.maxSyl && shape.length > c.maxSyl) {
      // 最初と最後は残して、真ん中を間引く（上がり下がりの形はくずさない）
      const keep = [shape[0]];
      const step = (shape.length - 1) / (c.maxSyl - 1);
      for (let n = 1; n < c.maxSyl; n++) keep.push(shape[Math.round(n * step)]);
      shape = keep;
    }

    // 出口。ここに F1・F2 の 2 本を並列につなぐ
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.sfxGain);

    let t = this.now;
    shape.forEach(([mul, lenMul, volMul], i) => {
      // 音程は毎回すこしゆらす（何度聞いてもまったく同じにならないように）
      const jitter = 1 + (((seed * 37 + i * 61) % 21) / 10 - 1) * wobble;
      const f0 = v.base * mul * jitter;
      const dur = sylDur * lenMul;
      const vol = 0.16 * volMul;
      const end = t + dur;

      // --- 声道（フォルマント 2 本）。音のあいだに動かすのが鳴き声らしさの要 ---
      const tract = [];
      for (const [range, q, amp] of [
        [f1, c.q1 || 5, 1.0],
        [f2, c.q2 || 6, c.a2 === undefined ? 0.7 : c.a2],
      ]) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = q;
        bp.frequency.setValueAtTime(range[0], t);
        if (range[1] !== range[0]) bp.frequency.linearRampToValueAtTime(range[1], end);
        const bg = ctx.createGain();
        bg.gain.value = amp;
        bp.connect(bg).connect(out);
        tract.push(bp);
      }
      const toTract = (node) => {
        for (const bp of tract) node.connect(bp);
      };

      // --- 声帯（基音）---
      const o = ctx.createOscillator();
      o.type = v.timbre;
      o.frequency.setValueAtTime(f0, t);
      if (arc) {
        // いったん上がってから下がる（ねこの「にゃ〜お」）
        o.frequency.linearRampToValueAtTime(f0 * (1 + arc), t + dur * 0.3);
        o.frequency.exponentialRampToValueAtTime(Math.max(30, f0 * glide * 0.75), end);
      } else if (glide !== 1) {
        o.frequency.exponentialRampToValueAtTime(Math.max(30, f0 * glide), end);
      }
      const g = ctx.createGain();
      const attack = c.bite ? 0.004 : Math.min(0.035, dur * 0.25);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      o.connect(g);
      toTract(g);
      o.start(t);
      o.stop(end + 0.05);

      // ビブラート
      if (vib.hz > 0 && vib.cents > 0) {
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = vib.hz;
        lg.gain.value = vib.cents;
        lfo.connect(lg).connect(o.detune);
        lfo.start(t);
        lfo.stop(end + 0.05);
      }
      // 声のざらつき（うなり・かすれ）。音量を細かく揺らす
      if (c.growl) {
        const rough = ctx.createOscillator();
        const rg = ctx.createGain();
        rough.type = 'square';
        rough.frequency.value = c.growl;
        rg.gain.value = 0.45;
        rough.connect(rg).connect(g.gain);
        rough.start(t);
        rough.stop(end + 0.05);
      }
      // 1 オクターブ下を重ねて体の大きさを出す
      if (c.sub) {
        const so = ctx.createOscillator();
        so.type = 'sine';
        so.frequency.setValueAtTime(f0 / 2, t);
        if (glide !== 1) so.frequency.exponentialRampToValueAtTime(Math.max(20, (f0 / 2) * glide), end);
        const sg = ctx.createGain();
        sg.gain.setValueAtTime(0.0001, t);
        sg.gain.linearRampToValueAtTime(vol * c.sub, t + attack);
        sg.gain.exponentialRampToValueAtTime(0.0001, end);
        so.connect(sg).connect(out); // 低音は声道を通さずそのまま
        so.start(t);
        so.stop(end + 0.05);
      }
      // 息づかい。声道を通すので「はー」という声に聞こえる
      if (breath > 0) {
        const ns = ctx.createBufferSource();
        ns.buffer = this._noise();
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.0001, t);
        ng.gain.linearRampToValueAtTime(0.16 * breath * volMul, t + attack);
        ng.gain.exponentialRampToValueAtTime(0.0001, end);
        ns.connect(ng);
        toTract(ng);
        ns.start(t);
        ns.stop(end + 0.05);
      }
      // 頭の「カッ」というアタック（犬・ペンギン）
      if (c.bite && i === 0) {
        this._noiseBurst({ t, dur: 0.035, vol: 0.11 * c.bite, filter: 'bandpass', freq: f2[0], q: 1.0, dest: out });
      }
      t = end + gap;
    });
  }

  _speak(text, pitch, rate) {
    try {
      if (this._speechVoice === undefined) {
        const voices = speechSynthesis.getVoices();
        this._speechVoice = voices.find((vv) => vv.lang && vv.lang.startsWith('ja')) || null;
        if (voices.length === 0) {
          this._speechVoice = undefined;
          speechSynthesis.onvoiceschanged = () => {
            this._speechVoice = undefined;
          };
        }
      }
      if (speechSynthesis.speaking && this._voiceBusy > performance.now()) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      if (this._speechVoice) u.voice = this._speechVoice;
      u.pitch = clamp(pitch, 0, 2);
      u.rate = clamp(rate, 0.5, 2);
      u.volume = clamp(settings.get('sfxVolume'), 0, 1);
      this._voiceBusy = performance.now() + 1200;
      speechSynthesis.speak(u);
    } catch (e) {
      /* 音声合成が使えない環境 */
    }
  }
}

export const audio = new AudioEngine();
export { BGM as BGM_PATTERNS };

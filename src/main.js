// エントリポイント: 画面遷移・ゲームループ・レース起動
import * as THREE from 'three';
import './styles.css';
import { settings } from './core/Settings.js';
import { InputManager } from './core/Input.js';
import { audio } from './core/Audio.js';
import { Race } from './race/Race.js';
import { ResultsScreen } from './ui/Results.js';
import * as UI from './ui/Screens.js';
import { NetClient } from './net/NetClient.js';
import { getCourse, COURSES } from './data/courses.js';
import { CHARACTERS, getCharacter } from './data/characters.js';
import { isTouchDevice } from './core/Utils.js';

function detectQuality() {
  const q = settings.get('quality');
  if (q && q !== 'auto') return q;
  const cores = navigator.hardwareConcurrency || 4;
  const mobile = isTouchDevice() && Math.min(screen.width, screen.height) < 900;
  return mobile && cores <= 4 ? 'low' : 'high';
}

class App {
  constructor() {
    this.appEl = document.getElementById('app');
    this.canvas = document.getElementById('game');
    this.hudRoot = document.getElementById('hud-root');
    this.uiRoot = document.getElementById('ui-root');
    this.quality = detectQuality();
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.quality === 'high', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (this.quality !== 'low') {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    this.input = new InputManager();
    this.net = new NetClient();
    this.screen = null;
    this.race = null;
    this.results = null;
    this.pauseEl = null;
    this.lastConfig = null;
    this.onlineStart = null;
    this.setup = { players: [], cpuFill: true, mode: 'single' };
    this._last = performance.now();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 300));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.race && !this.race.net && this.race.state === 'racing') this.pause();
    });
    this.resize();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    if (settings.get('gyro')) this.input.enableGyro().then((ok) => !ok && settings.set('gyro', false));
    this.showTitle();
    this._registerSW();
    this._fullscreenButton();
  }

  _registerSW() {
    if ('serviceWorker' in navigator && import.meta.env && import.meta.env.PROD) {
      // サブパス配信（例: /cart/）でも正しいスコープで登録されるようページ相対で解決する
      const swUrl = new URL('sw.js', document.baseURI).href;
      window.addEventListener('load', () => navigator.serviceWorker.register(swUrl).catch(() => {}));
    }
  }
  _fullscreenButton() {
    if (!document.fullscreenEnabled || !isTouchDevice()) return;
    const btn = UI.h('<button class="fullscreen-btn" title="全画面">⛶</button>');
    btn.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    });
    this.appEl.appendChild(btn);
    this.fsBtn = btn;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.race) this.race.resize(w, h);
    if (this.results) this.results.resize(w, h);
  }

  _loop(now) {
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    const race = this.race;
    if (race) {
      race.update(dt);
      if (this.race === race) race.render(); // update 中にリザルトへ遷移した場合は描画しない
      return;
    }
    const results = this.results;
    if (results) {
      results.update(dt);
      if (this.results === results) results.render();
    }
  }

  // ---------- 画面管理 ----------
  show(screenObj) {
    if (this.screen) {
      this.screen.dispose();
      this.screen.el.remove();
    }
    this.screen = screenObj;
    if (screenObj) this.uiRoot.appendChild(screenObj.el);
    if (this.fsBtn) this.fsBtn.style.display = this.race ? 'none' : '';
  }

  showTitle() {
    this._leaveRace();
    if (this.net.room) this.net.leave();
    this.show(UI.titleScreen({ onStart: () => this.showMode() }));
  }

  showMode() {
    audio.playBgm('menu');
    this.show(
      UI.modeScreen({
        onSelect: (mode) => {
          this.setup = { players: [], cpuFill: true, mode };
          switch (mode) {
            case 'single':
            case 'timeattack':
              this.showCharacter(0, 1);
              break;
            case 'local':
              this.show(
                UI.localSetupScreen({
                  onNext: (n, cpu) => {
                    this.setup.cpuFill = cpu;
                    this.showCharacter(0, n);
                  },
                  onBack: () => this.showMode(),
                })
              );
              break;
            case 'online':
              this.showOnline();
              break;
            case 'settings':
              this.show(UI.settingsScreen({ onBack: () => this.showMode(), input: this.input }));
              break;
            case 'howto':
              this.show(UI.howtoScreen({ onBack: () => this.showMode() }));
              break;
            default:
              break;
          }
        },
      })
    );
  }

  showCharacter(index, total) {
    const taken = this.setup.players.slice(0, index).map((p) => p.charId);
    const prev = this.setup.players[index];
    this.show(
      UI.characterScreen({
        label: total > 1 ? `P${index + 1}:` : '',
        initialChar: prev?.charId || (index === 0 ? settings.get('lastCharacter') : null),
        initialKart: prev?.kart || (index === 0 ? settings.get('lastKart') : null),
        takenChars: taken,
        onNext: (charId, kart) => {
          this.setup.players[index] = { playerIndex: index, charId, kart };
          if (index === 0) {
            settings.set('lastCharacter', charId);
            settings.set('lastKart', kart);
          }
          if (index + 1 < total) this.showCharacter(index + 1, total);
          else this.showCourse();
        },
        onBack: () => (index > 0 ? this.showCharacter(index - 1, total) : this.showMode()),
      })
    );
  }

  showCourse() {
    this.show(
      UI.courseScreen({
        onSelect: (courseId, laps) => {
          settings.set('lastCourse', courseId);
          this.startOfflineRace(courseId, laps);
        },
        onBack: () => this.showCharacter(this.setup.players.length - 1, this.setup.players.length),
      })
    );
  }

  // ---------- オフラインレース ----------
  startOfflineRace(courseId, laps) {
    const humans = this.setup.players.map((p, i) => ({ id: `p${i}`, type: 'human', playerIndex: p.playerIndex, charId: p.charId, kart: p.kart, name: this.setup.players.length > 1 ? `P${i + 1} ${getCharacter(p.charId).name}` : settings.get('playerName') || getCharacter(p.charId).name }));
    const players = [];
    const wantCpu = this.setup.mode === 'timeattack' ? 0 : this.setup.mode === 'single' || this.setup.cpuFill ? 8 - humans.length : 0;
    const usedChars = new Set(humans.map((h) => h.charId));
    const pool = CHARACTERS.filter((c) => !usedChars.has(c.id));
    for (let i = 0; i < wantCpu; i++) {
      const c = pool.length ? pool.splice(Math.floor(Math.random() * pool.length), 1)[0] : CHARACTERS[i % CHARACTERS.length];
      players.push({ id: `ai${i}`, type: 'ai', charId: c.id, name: c.name, kart: { color: 'default', wheels: ['standard', 'offroad', 'slick', 'roller'][Math.floor(Math.random() * 4)], accessory: ['none', 'flag', 'antenna', 'spoiler', 'roof'][Math.floor(Math.random() * 5)] } });
    }
    players.push(...humans);
    this.lastConfig = { courseId, laps, players, seed: Math.floor(Math.random() * 1e9) };
    this.startRace(this.lastConfig);
  }

  startRace(config, opts = {}) {
    this._leaveRace();
    this.show(null);
    const loading = UI.loadingOverlay(`${getCourse(config.courseId).name} をじゅんびちゅう…`);
    this.uiRoot.appendChild(loading);
    setTimeout(() => {
      loading.remove();
      this.appEl.classList.add('in-race');
      this.race = new Race({
        renderer: this.renderer,
        hudRoot: this.hudRoot,
        input: this.input,
        course: getCourse(config.courseId),
        laps: config.laps,
        players: config.players,
        cpuLevel: settings.get('cpuLevel'),
        quality: this.quality,
        seed: config.seed,
        net: opts.net || null,
        spectate: !!opts.spectate,
        onFinish: (results) => this.showResults(results, config, opts),
        onPause: () => this.pause(),
      });
      this.resize();
      if (this.fsBtn) this.fsBtn.style.display = 'none';
    }, 60);
  }

  _leaveRace() {
    if (this.pauseEl) {
      this.pauseEl.remove();
      this.pauseEl = null;
    }
    if (this.race) {
      this.race.dispose();
      this.race = null;
    }
    if (this.results) {
      this.results.dispose();
      this.results = null;
    }
    this.appEl.classList.remove('in-race');
    this.hudRoot.innerHTML = '';
  }

  pause() {
    if (!this.race || this.race.paused) return;
    this.race.paused = true;
    const ov = UI.pauseOverlay({
      onResume: () => {
        ov.el.remove();
        this.pauseEl = null;
        this.race.paused = false;
      },
      onRestart: () => {
        ov.el.remove();
        this.pauseEl = null;
        this.startRace({ ...this.lastConfig, seed: Math.floor(Math.random() * 1e9) });
      },
      onQuit: () => {
        ov.el.remove();
        this.pauseEl = null;
        this.showTitle();
      },
    });
    this.pauseEl = ov.el;
    this.uiRoot.appendChild(ov.el);
  }

  showResults(results, config, opts) {
    const online = !!opts.net;
    if (this.race) {
      this.race.dispose();
      this.race = null;
    }
    this.hudRoot.innerHTML = '';
    audio.stopBgm();
    this.results = new ResultsScreen({
      renderer: this.renderer,
      root: this.uiRoot,
      results,
      course: getCourse(config.courseId),
      online,
      onAction: (act) => {
        if (online) {
          this._leaveRace();
          this.showOnline();
          return;
        }
        if (act === 'again') this.startRace({ ...config, seed: Math.floor(Math.random() * 1e9) });
        else if (act === 'course') {
          this._leaveRace();
          audio.playBgm('menu');
          this.showCourse();
        } else this.showTitle();
      },
    });
    this.resize();
  }

  // ---------- オンライン ----------
  showOnline() {
    audio.playBgm('menu');
    const p0 = this.setup.players[0] || { charId: settings.get('lastCharacter'), kart: settings.get('lastKart') };
    const profile = { name: settings.get('playerName') || getCharacter(p0.charId).name, char: p0.charId, kart: p0.kart };
    this.show(
      UI.onlineScreen({
        net: this.net,
        profile,
        onBack: () => {
          this.net.close();
          this.showMode();
        },
        onEditProfile: () => {
          this.show(
            UI.characterScreen({
              label: '',
              initialChar: profile.char,
              initialKart: profile.kart,
              onNext: (charId, kart) => {
                this.setup.players[0] = { playerIndex: 0, charId, kart };
                settings.set('lastCharacter', charId);
                settings.set('lastKart', kart);
                if (this.net.room) this.net.updateProfile({ char: charId, kart });
                this.showOnline();
              },
              onBack: () => this.showOnline(),
            })
          );
        },
        onRace: (msg, spectating) => this.startOnlineRace(msg, spectating),
      })
    );
  }

  startOnlineRace(msg, spectating) {
    const myId = this.net.id;
    const players = msg.players.map((p) => {
      let type = 'remote';
      let playerIndex = null;
      if (!spectating && p.id === myId) {
        type = 'human';
        playerIndex = 0;
      } else if (p.cpu && msg.hostId === myId && !spectating) type = 'ai';
      return { id: p.id, type, playerIndex, charId: p.char, kart: p.kart, name: p.name };
    });
    // CPU を前列、人間（自分・リモート）を後列のグリッドへ（オフラインと同じ並び）
    players.sort((a, b) => (a.type === 'ai' ? 0 : 1) - (b.type === 'ai' ? 0 : 1));
    const config = { courseId: msg.course, laps: msg.laps, players, seed: msg.seed };
    this.lastConfig = config;
    this.startRace(config, { net: this.net, spectate: spectating });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.__app = new App();
  window.__audio = audio; // 動作確認用（test/voicecheck から鳴らして確かめる）
});

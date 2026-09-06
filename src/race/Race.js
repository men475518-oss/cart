// レース制御: シーン構築、カート更新、順位・ラップ、演出、分割画面レンダリング、ネット同期
import * as THREE from 'three';
import { Track } from './Track.js';
import { buildScenery, buildLights } from './Scenery.js';
import { buildKartModel } from './KartModel.js';
import { buildParams, createKartState, stepKart, applyBoost, spinOut, resolveKartCollision, DRIFT_TIERS, MAX_COINS } from './KartPhysics.js';
import { CoinSystem } from './Coins.js';
import { AIDriver } from './AIDriver.js';
import { ItemSystem } from './ItemSystem.js';
import { ParticleSystem, FxManager, EFFECT_STYLES } from './Effects.js';
import { CameraRig } from './CameraRig.js';
import { HUD } from '../ui/HUD.js';
import { getCharacter } from '../data/characters.js';
import { audio } from '../core/Audio.js';
import { settings } from '../core/Settings.js';
import { makeRng, clamp, lerp, damp, dampAngle, wrapAngle } from '../core/Utils.js';

const NET_RATE = 1 / 15;

function hexToCss(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

/** ビューポート矩形（左上原点・割合） */
export function layoutViewports(n, portrait) {
  if (n <= 1) return [{ x: 0, y: 0, w: 1, h: 1 }];
  if (n === 2) return [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }];
  if (portrait) {
    const h = 1 / n;
    return Array.from({ length: n }, (_, i) => ({ x: 0, y: i * h, w: 1, h }));
  }
  return [
    { x: 0, y: 0, w: 0.5, h: 0.5 },
    { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    { x: 0, y: 0.5, w: 0.5, h: 0.5 },
    { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
  ].slice(0, n);
}

export class Race {
  constructor(opts) {
    this.opts = opts;
    this.renderer = opts.renderer;
    this.input = opts.input;
    this.course = opts.course;
    this.laps = opts.laps || opts.course.laps || 3;
    this.net = opts.net || null;
    this.spectate = !!opts.spectate;
    this.onFinish = opts.onFinish || (() => {});
    this.onPause = opts.onPause || (() => {});
    this.quality = opts.quality || 'high';
    this.rng = makeRng(opts.seed || 1);
    this.events = [];
    this.time = 0; // レース開始からの時間（GO 以降）
    this.clock = 0; // シーン全体の経過時間
    this.state = 'intro';
    this.stateTime = 0;
    this.paused = false;
    this.results = null;
    this.netAccum = 0;
    this.starBgm = false;
    this.hudRoot = opts.hudRoot;
    this.disposed = false;

    // シーン
    this.scene = new THREE.Scene();
    const pal = this.course.palette;
    this.scene.background = new THREE.Color(pal.skyBottom);
    this.scene.fog = new THREE.Fog(pal.fog, pal.fogNear, pal.fogFar);
    this.track = new Track(this.course);
    this.scene.add(this.track.buildMesh(pal, this.quality));
    const sc = buildScenery(this.track, this.course, this.quality);
    this.scene.add(sc.group);
    this.sceneryAnim = sc.anim;
    this.lights = buildLights(pal, this.quality);
    this.scene.add(this.lights.group);
    this.particles = new ParticleSystem(this.scene, this.quality === 'low' ? 400 : 900);
    this.fx = new FxManager(this.scene, this.particles);

    // カート
    this.karts = [];
    this.kartById = new Map();
    this._createKarts(opts.players);

    // アイテム
    const netHooks = this.net
      ? {
          sendSpawn: (desc) => this.net.sendEvent({ k: 'spawn', desc }),
          sendHazardHit: (id) => this.net.sendEvent({ k: 'hazardHit', id }),
          sendLightning: (from) => this.net.sendEvent({ k: 'lightning', from }),
          sendHorn: (from, x, z) => this.net.sendEvent({ k: 'horn', from, x, z }),
        }
      : null;
    this.items = new ItemSystem({ track: this.track, scene: this.scene, karts: this.karts, rng: this.rng, events: this.events, fx: this.fx, particles: this.particles, net: netHooks });
    this.coins = new CoinSystem({ track: this.track, scene: this.scene, karts: this.karts, events: this.events });

    // ビューポート（ローカル人間プレイヤー or 観戦）
    this.viewports = [];
    this._createViewports();
    this.resize(this.renderer.domElement.clientWidth || window.innerWidth, this.renderer.domElement.clientHeight || window.innerHeight);

    if (this.net) this._bindNet();
    audio.playBgm(this.course.bgm);
    this.rankOf = (k) => k.rank || 1;
  }

  // ---------- 生成 ----------
  _createKarts(players) {
    players.forEach((p, i) => {
      const char = getCharacter(p.charId);
      const kartOpts = p.kart || {};
      const params = buildParams(char, kartOpts);
      const state = createKartState();
      const slot = this.track.gridSlot(i);
      state.x = slot.pos.x;
      state.y = slot.pos.y;
      state.z = slot.pos.z;
      state.heading = slot.heading;
      state.moveHeading = slot.heading;
      const q = this.track.query(state, null);
      state.trackIndex = q.index;
      state.progress = q.progress;
      state.totalProgress = q.progress - this.track.N; // スタートライン手前（負）
      if (state.totalProgress < -this.track.N / 2) state.totalProgress += this.track.N;
      const model = buildKartModel(char, kartOpts);
      model.group.position.set(state.x, state.y, state.z);
      model.group.rotation.y = state.heading;
      this.scene.add(model.group);
      const kart = {
        id: p.id || `k${i}`,
        name: p.name || char.name,
        char,
        kartOpts,
        params,
        baseMaxSpeed: params.maxSpeed,
        state,
        track: this.track,
        model,
        items: [],
        roulette: null,
        isHuman: p.type === 'human',
        isAI: p.type === 'ai',
        remote: p.type === 'remote',
        playerIndex: p.playerIndex ?? null,
        ai: null,
        engine: null,
        rank: i + 1,
        prevRank: i + 1,
        prevLap: 0,
        visScale: 1,
        starWas: false,
        netTarget: null,
        color: hexToCss(char.colors.kart),
        lastStateSent: 0,
      };
      if (kart.isAI) kart.ai = new AIDriver(kart, this.track, makeRng((this.opts.seed || 1) * 31 + i), this.opts.cpuLevel || settings.get('cpuLevel'));
      this.karts.push(kart);
      this.kartById.set(kart.id, kart);
    });
  }

  _createViewports() {
    const humans = this.karts.filter((k) => k.isHuman && k.playerIndex !== null).sort((a, b) => a.playerIndex - b.playerIndex);
    const n = this.spectate ? 1 : Math.max(1, humans.length);
    const portrait = window.innerHeight > window.innerWidth;
    const rects = layoutViewports(n, portrait);
    const touch = this.opts.touch ?? ('ontouchstart' in window || navigator.maxTouchPoints > 0);
    const faceToFace = n === 2 && settings.get('faceToFace') && touch;
    for (let i = 0; i < n; i++) {
      const kart = this.spectate ? null : humans[i];
      const flip = faceToFace && i === 0;
      const rig = new CameraRig();
      rig.flip = flip;
      const hud = new HUD(this.hudRoot, {
        rect: rects[i],
        flip,
        touch: !this.spectate && touch,
        playerIndex: kart ? kart.playerIndex : 0,
        input: this.input,
        label: n > 1 ? `P${(kart?.playerIndex ?? i) + 1}` : this.spectate ? '観戦中' : '',
        track: this.track,
        compact: n > 2,
      });
      const engine = kart && !this.spectate ? audio.createEngine() : null;
      if (kart) kart.engine = engine;
      this.viewports.push({ index: i, kart, rig, hud, rect: rects[i], engine, spectateIdx: 0, spectateTimer: 0 });
    }
  }

  _bindNet() {
    const net = this.net;
    this._netHandlers = {
      state: ({ id, s }) => {
        const k = this.kartById.get(id);
        if (!k || !k.remote) return;
        k.netTarget = { ...s, t: this.clock };
        if (k.netFirst === undefined) {
          k.netFirst = true;
          k.state.x = s.x;
          k.state.z = s.z;
          k.state.heading = s.h;
          k.state.moveHeading = s.h;
        }
      },
      event: ({ id, e }) => this._onNetEvent(id, e),
      results: ({ results }) => this._finishWithServerResults(results),
      left: ({ id }) => {
        const k = this.kartById.get(id);
        if (k && k.remote) {
          k.gone = true;
          k.model.group.visible = false;
        }
      },
    };
    for (const [t, h] of Object.entries(this._netHandlers)) net.on(t, h);
  }

  _onNetEvent(fromId, e) {
    const from = this.kartById.get(e.from || fromId);
    switch (e.k) {
      case 'spawn':
        if (!this.items.hazards.some((h) => h.id === e.desc.id)) this.items.spawnHazard(e.desc, false);
        this.events.push({ type: 'itemUse', kart: from, item: e.desc.type, sfx: e.desc.type === 'banana' ? 'drop' : e.desc.type === 'bomb' ? 'throw' : 'shell', remote: true });
        break;
      case 'hazardHit':
        this.items.removeHazard(e.id);
        break;
      case 'lightning':
        if (from) this.items.applyLightning(from);
        break;
      case 'horn':
        if (from) {
          from.state.x = e.x;
          from.state.z = e.z;
          this.items.applyHorn(from);
        }
        break;
      case 'finish': {
        const k = this.kartById.get(fromId === e.id ? fromId : e.id || fromId);
        if (k && !k.state.finished) {
          k.state.finished = true;
          k.state.finishTime = e.time;
        }
        break;
      }
      case 'voice':
        if (from) audio.voice(from.char, e.key, { noSpeech: true });
        break;
      default:
        break;
    }
  }

  // ---------- ライフサイクル ----------
  resize(w, h) {
    this.width = w;
    this.height = h;
    const portrait = h > w;
    const n = this.viewports.length;
    const rects = layoutViewports(n, portrait);
    this.viewports.forEach((vp, i) => {
      vp.rect = rects[i];
      vp.hud.setRect(vp.rect);
      const vw = Math.max(1, w * vp.rect.w);
      const vh = Math.max(1, h * vp.rect.h);
      vp.rig.setAspect(vw / vh);
    });
  }

  setState(s) {
    this.state = s;
    this.stateTime = 0;
  }

  update(dt) {
    if (this.disposed) return;
    dt = Math.min(dt, 1 / 20);
    this.clock += dt;
    this.stateTime += dt;
    this.input.update(this.clock);

    // ポーズ要求
    for (const vp of this.viewports) {
      if (vp.hud.paused) {
        vp.hud.paused = false;
        if (!this.net) this.onPause();
      }
    }
    if (this.input.get(0).pausePressed && !this.net && this.state === 'racing') this.onPause();
    if (this.paused) return;

    // 状態遷移
    switch (this.state) {
      case 'intro': {
        const skip = this.viewports.some((vp) => vp.kart && this.input.get(vp.kart.playerIndex).any) || this.spectate;
        if (this.stateTime > 3.2 || (skip && this.stateTime > 0.8)) {
          this.setState('countdown');
          this.countdownStep = -1;
          for (const vp of this.viewports) vp.rig.snapTo(vp.kart || this.karts[0]);
        }
        break;
      }
      case 'countdown': {
        const step = Math.floor(this.stateTime);
        if (step !== this.countdownStep) {
          this.countdownStep = step;
          const label = ['3', '2', '1', 'GO!'][step];
          if (label) {
            for (const vp of this.viewports) vp.hud.countdown(label);
            audio.sfx(step === 3 ? 'go' : 'count');
            if (step === 0) for (const vp of this.viewports) if (vp.kart) audio.voice(vp.kart.char, 'start');
          }
          if (step === 3) {
            this._go();
            this.setState('racing');
          }
        }
        break;
      }
      case 'racing':
      case 'finishing':
        this.time += dt;
        break;
      case 'results':
        break;
      default:
        break;
    }

    const racing = this.state === 'racing' || this.state === 'finishing';
    const canMove = racing || this.state === 'results';

    // ---------- カート更新 ----------
    const humanProgress = this._bestHumanProgress();
    const aiCtx = { karts: this.karts, hazards: this.items.hazards, rankOf: this.rankOf, humanProgress };
    for (const k of this.karts) {
      const s = k.state;
      if (k.remote) {
        this._interpolateRemote(k, dt);
        continue;
      }
      let inp;
      if (k.ai) {
        k.ai.update(dt, aiCtx);
        inp = k.ai.input;
      } else if (k.isHuman) {
        inp = this.input.get(k.playerIndex);
      } else inp = { steer: 0, accel: 0, brake: 0, drift: false, item: false };
      if (!canMove) inp = { ...inp, accel: 0, brake: 0, drift: false, item: false, itemPressed: false, steer: this.state === 'countdown' ? inp.steer : 0 };
      const res = stepKart(k, inp, dt, this.events, this.course.palette.night && k.params.traits.items);
      k.slip = res.slip;
      // アイテム: 押した瞬間に使用（構えられるものは後ろに保持）、離すと放つ
      if (racing) {
        const held = this.items.heldOf(k);
        if (inp.itemPressed && !held && (k.items.length > 0 || s.goldenActive)) {
          const back = k.ai ? !!inp.itemBack : !!(inp.drift || inp.brake);
          // 人間は押しっぱなしで構える。CPU は後ろ向き指定のときだけ構える
          const hold = k.ai ? !!inp.itemBack : true;
          this.items.useItem(k, back, this.rankOf, hold);
        } else if (held && (k.ai ? inp.itemReleased : inp.itemReleased)) {
          this.items.releaseHeld(k, !(inp.drift || inp.brake));
        }
      }
      if (k.isHuman && s.spinTime > 0 && !k._spinning) audio.voice(k.char, 'hit');
      k._spinning = s.spinTime > 0;
    }

    // ---------- 衝突 ----------
    for (let i = 0; i < this.karts.length; i++) {
      for (let j = i + 1; j < this.karts.length; j++) {
        const a = this.karts[i];
        const b = this.karts[j];
        if (a.gone || b.gone) continue;
        if (a.remote && b.remote) continue;
        const ax = a.state.x, az = a.state.z, bx = b.state.x, bz = b.state.z;
        resolveKartCollision(a, b, this.events);
        // リモートカートは動かさない
        if (a.remote) {
          a.state.x = ax;
          a.state.z = az;
          a.state.knockVx = a.state.knockVz = 0;
        }
        if (b.remote) {
          b.state.x = bx;
          b.state.z = bz;
          b.state.knockVx = b.state.knockVz = 0;
        }
      }
    }

    // ---------- アイテム・コイン ----------
    if (racing) {
      this.items.update(dt, this.rankOf);
      this.coins.update(dt, this.viewports.map((vp) => vp.rig.camera.position));
    }

    // ---------- ラップ・順位・ゴール ----------
    this._updateRanks();
    if (racing) this._updateLapsAndFinish();

    // ---------- イベント処理 ----------
    this._processEvents();

    // ---------- 表示同期 ----------
    for (const k of this.karts) this._syncModel(k, dt);
    this.particles.update(dt);
    this.fx.update(dt);
    const camPos = this.viewports[0]?.rig.pos;
    for (const fn of this.sceneryAnim) fn(dt, camPos, this.clock);
    this.lights.update(this.viewports[0]?.kart?.state || camPos);

    // ---------- カメラ / HUD ----------
    for (const vp of this.viewports) this._updateViewport(vp, dt);

    // ---------- ファイナルラップでテンポアップ ----------
    const viewKart = this.viewports[0]?.kart;
    const finalLap = !!viewKart && viewKart.state.lap >= this.laps && !viewKart.state.finished;
    if (finalLap !== this._finalLapTempo) {
      this._finalLapTempo = finalLap;
      audio.setTempo(finalLap ? 1.12 : 1);
    }

    // ---------- スター BGM ----------
    const anyStar = this.viewports.some((vp) => vp.kart && vp.kart.state.starTime > 0);
    if (anyStar !== this.starBgm) {
      this.starBgm = anyStar;
      if (anyStar) audio.pushBgm('star');
      else audio.popBgm();
    }

    // ---------- ネット送信 ----------
    if (this.net) {
      this.netAccum += dt;
      if (this.netAccum >= NET_RATE) {
        this.netAccum = 0;
        for (const k of this.karts) {
          if (k.remote) continue;
          const s = k.state;
          this.net.sendState(k.id, {
            x: +s.x.toFixed(2), z: +s.z.toFixed(2), h: +s.heading.toFixed(3), v: +s.speed.toFixed(1),
            tp: +s.totalProgress.toFixed(1), lap: s.lap,
            sp: s.spinTime > 0 ? 1 : 0, sq: s.squashTime > 0 ? 1 : 0, st: s.starTime > 0 ? 1 : 0,
            bo: s.boostTime > 0 ? 1 : 0, dr: s.drifting ? s.driftDir : 0, dt: s.driftTier, hop: +s.hop.toFixed(2),
            fin: s.finished ? 1 : 0, it: k.items[0]?.id || null, co: s.coins || 0, air: s.airborne ? 1 : 0,
          });
        }
      }
    }

    // ---------- レース終了判定 ----------
    if (this.state === 'racing' || this.state === 'finishing') this._checkRaceEnd();
    if (this.state === 'results' && this.stateTime > 2.6 && !this._finishedCalled) {
      this._finishedCalled = true;
      this.onFinish(this.results);
    }
  }

  _go() {
    this.time = 0;
    for (const k of this.karts) {
      if (!k.isHuman) continue;
      const inp = this.input.get(k.playerIndex);
      const held = inp.accelHeldSince;
      if (held >= 0) {
        const heldFor = this.clock - held;
        const window = k.params.traits.quickstart ? 1.0 : 0.6;
        if (heldFor <= window) {
          applyBoost(k, 1.1, 1.4);
          this.events.push({ type: 'rocketStart', kart: k });
        } else if (heldFor > 1.6) {
          // 早すぎ → ホイールスピン（少し遅れる）
          k.state.stunTime = 0.7;
          this.events.push({ type: 'burnout', kart: k });
        }
      }
    }
  }

  _bestHumanProgress() {
    let best = null;
    for (const k of this.karts) if (k.isHuman && !k.state.finished) best = best === null ? k.state.totalProgress : Math.max(best, k.state.totalProgress);
    if (best === null) for (const k of this.karts) if (k.isHuman) best = best === null ? k.state.totalProgress : Math.max(best, k.state.totalProgress);
    return best;
  }

  _interpolateRemote(k, dt) {
    const s = k.state;
    const t = k.netTarget;
    if (!t) return;
    const age = clamp(this.clock - t.t, 0, 0.4);
    const px = t.x + Math.sin(t.h) * t.v * age;
    const pz = t.z + Math.cos(t.h) * t.v * age;
    const dist = Math.hypot(px - s.x, pz - s.z);
    if (dist > 25) {
      s.x = px;
      s.z = pz;
      s.heading = t.h;
    } else {
      s.x = damp(s.x, px, 10, dt);
      s.z = damp(s.z, pz, 10, dt);
      s.heading = dampAngle(s.heading, t.h, 10, dt);
    }
    s.moveHeading = s.heading;
    s.speed = t.v;
    s.totalProgress = t.tp;
    s.lap = t.lap;
    s.spinTime = t.sp ? 1 : 0;
    if (t.sp) s.spinAngle += dt * 12;
    else s.spinAngle = 0;
    s.squashTime = t.sq ? 1 : 0;
    s.starTime = t.st ? 1 : 0;
    s.boostTime = t.bo ? 1 : 0;
    s.drifting = !!t.dr;
    s.driftDir = t.dr || 0;
    s.driftTier = t.dt ?? -1;
    s.hop = t.hop || 0;
    s.coins = t.co || 0;
    s.airborne = !!t.air;
    if (t.fin && !s.finished) {
      s.finished = true;
      s.finishTime = s.finishTime ?? this.time;
    }
    k.items = t.it ? [{ id: t.it, uses: 1 }] : [];
    const q = this.track.query(s, s.trackIndex);
    s.trackIndex = q.index;
    s.progress = q.progress;
    s.lateral = q.lateral;
    s.y = q.height;
    s.surface = q.surface;
    s.steerVis = lerp(s.steerVis, s.drifting ? s.driftDir : 0, 1 - Math.exp(-8 * dt));
  }

  _updateRanks() {
    const sorted = [...this.karts].filter((k) => !k.gone).sort((a, b) => {
      const fa = a.state.finished, fb = b.state.finished;
      if (fa && fb) return a.state.finishTime - b.state.finishTime;
      if (fa) return -1;
      if (fb) return 1;
      return b.state.totalProgress - a.state.totalProgress;
    });
    sorted.forEach((k, i) => {
      k.prevRank = k.rank;
      k.rank = i + 1;
    });
  }

  _updateLapsAndFinish() {
    const N = this.track.N;
    for (const k of this.karts) {
      const s = k.state;
      if (k.remote) continue;
      const lap = Math.floor(s.totalProgress / N) + 1;
      if (lap !== s.lap) {
        const wasLap = s.lap;
        s.lap = lap;
        if (lap > wasLap && lap > 1 && lap <= this.laps) this.events.push({ type: 'lap', kart: k, lap });
      }
      if (!s.finished && s.totalProgress >= this.laps * N) {
        s.finished = true;
        s.finishTime = this.time;
        this.events.push({ type: 'finish', kart: k });
        if (k.isHuman) {
          k.ai = new AIDriver(k, this.track, makeRng(99 + k.rank), 'normal');
        }
        if (this.net) this.net.sendEvent({ k: 'finish', id: k.id, time: s.finishTime });
      }
    }
  }

  _checkRaceEnd() {
    const locals = this.karts.filter((k) => !k.remote && k.isHuman);
    const all = this.karts.filter((k) => !k.gone);
    const allFinished = all.every((k) => k.state.finished);
    const localsDone = this.spectate ? allFinished : locals.every((k) => k.state.finished);
    if (this.state === 'racing' && localsDone) {
      this.setState('finishing');
      this.finishingStart = this.time;
    }
    if (this.state === 'finishing') {
      const waited = this.time - this.finishingStart;
      const limit = this.net ? 45 : 12;
      if (allFinished || waited > limit) {
        if (this.net && !allFinished && waited <= limit) return;
        this._finalizeResults();
      }
    }
  }

  _finalizeResults(serverResults = null) {
    if (this.state === 'results') return;
    this._updateRanks();
    const sorted = [...this.karts].filter((k) => !k.gone).sort((a, b) => a.rank - b.rank);
    this.results = sorted.map((k) => ({
      id: k.id,
      rank: k.rank,
      name: k.name,
      char: k.char,
      kartOpts: k.kartOpts,
      time: k.state.finished ? k.state.finishTime : null,
      isHuman: k.isHuman,
      isLocal: !k.remote,
      playerIndex: k.playerIndex,
    }));
    if (serverResults) {
      // サーバー確定順位で上書き
      const byId = new Map(serverResults.map((r) => [r.id, r]));
      for (const r of this.results) {
        const sr = byId.get(r.id);
        if (sr) {
          r.rank = sr.rank;
          r.time = sr.time ?? r.time;
        }
      }
      this.results.sort((a, b) => a.rank - b.rank);
    }
    this.setState('results');
    for (const vp of this.viewports) {
      vp.hud.setTouchVisible(false);
      if (vp.kart) {
        const r = this.results.find((x) => x.id === vp.kart.id);
        vp.hud.message(`${r.rank}位`, r.rank === 1 ? 'gold' : '', 0);
      }
    }
    for (const k of this.karts) k.model.setStar(null);
  }

  _finishWithServerResults(results) {
    for (const k of this.karts) {
      const r = results.find((x) => x.id === k.id);
      if (r && !k.state.finished) {
        k.state.finished = true;
        k.state.finishTime = r.time ?? this.time;
      }
    }
    this._finalizeResults(results);
  }

  // ---------- イベント → 演出 ----------
  _near(x, z) {
    // ビューポートのカートからの距離で音量
    let best = 0;
    for (const vp of this.viewports) {
      const k = vp.kart || this.karts[vp.spectateIdx] || this.karts[0];
      if (!k) continue;
      const d = Math.hypot(k.state.x - x, k.state.z - z);
      best = Math.max(best, clamp(1 - d / 60, 0, 1));
    }
    return best;
  }
  _isView(k) {
    return this.viewports.some((vp) => vp.kart === k);
  }
  _hudOf(k) {
    return this.viewports.filter((vp) => vp.kart === k).map((vp) => vp.hud);
  }
  _shake(k, amt) {
    for (const vp of this.viewports) if (vp.kart === k) vp.rig.shake = Math.max(vp.rig.shake, amt);
  }

  _processEvents() {
    const ev = this.events;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      const k = e.kart;
      const near = k ? this._near(k.state.x, k.state.z) : e.x !== undefined ? this._near(e.x, e.z) : 1;
      const isView = k ? this._isView(k) : false;
      switch (e.type) {
        case 'itembox':
          if (isView) audio.sfx('itembox');
          break;
        case 'roulette':
          if (isView) audio.sfx('roulette', { vol: 0.6 });
          break;
        case 'itemGet':
          if (isView) audio.sfx('itemGet');
          break;
        case 'itemUse':
          if (near > 0) audio.sfx(e.sfx || 'throw', { vol: isView ? 1 : near * 0.6 });
          if (isView && k) audio.voice(k.char, 'item');
          if (k && e.item === 'star') {
            if (isView) audio.voice(k.char, 'boost');
          }
          break;
        case 'hit':
          if (near > 0) audio.sfx('hit', { vol: isView ? 1 : near * 0.7 });
          if (k) {
            this._shake(k, 0.5);
            if (isView) audio.voice(k.char, 'hit');
            else if (near > 0.5 && k.char) audio.voice(k.char, 'hit', { noSpeech: true });
            this.particles.burst(k.state.x, k.state.y + 1, k.state.z, 12, [0xffffff, 0xffd23f], 6, 0.5, 8, 4);
            const lost = k.state.coinsLost || 0;
            if (lost > 0) {
              k.state.coinsLost = 0;
              if (isView) audio.sfx('coinLoss', { vol: 0.6 });
              this.particles.burst(k.state.x, k.state.y + 1, k.state.z, lost * 4, [0xffd23f, 0xfff3b0], 7, 0.9, 9, 5);
            }
          }
          if (e.by && this._isView(e.by) && e.by !== k) audio.voice(e.by.char, 'pass');
          break;
        case 'starHit':
          if (near > 0) audio.sfx('hit', { vol: near });
          if (k) this._shake(k, 0.4);
          break;
        case 'driftStart':
          if (isView) audio.voice(k.char, 'drift', { minInterval: 6000 });
          break;
        case 'driftTier':
          if (isView) audio.sfx(DRIFT_TIERS[e.tier].sfx);
          break;
        case 'miniTurbo':
          if (near > 0) audio.sfx('boost', { vol: isView ? 0.9 : near * 0.4 });
          if (isView && e.tier >= 1) audio.voice(k.char, 'boost', { minInterval: 5000 });
          this._boostBurst(k);
          break;
        case 'boostpad':
        case 'rocketStart':
          if (near > 0) audio.sfx('boost', { vol: isView ? 1 : near * 0.4 });
          if (e.type === 'rocketStart' && isView) {
            for (const h of this._hudOf(k)) h.sub('ロケットスタート！');
            audio.voice(k.char, 'boost');
          }
          this._boostBurst(k);
          break;
        case 'burnout':
          if (isView) for (const h of this._hudOf(k)) h.sub('はやすぎ…！');
          break;
        case 'boost':
          if (isView) audio.sfx('mushroom', { vol: 0.7 });
          this._boostBurst(k);
          break;
        case 'lava':
          if (spinOut(k, 1)) {
            if (near > 0) audio.sfx('hit', { vol: isView ? 1 : near * 0.6 });
            this.particles.burst(k.state.x, k.state.y + 0.5, k.state.z, 20, [0xff4e00, 0xffb703], 8, 0.6, 10, 6);
            if (isView) audio.voice(k.char, 'hit');
            this._shake(k, 0.5);
          }
          break;
        case 'water':
          if (near > 0) audio.sfx('splash', { vol: isView ? 0.8 : near * 0.4 });
          this.fx.splash(new THREE.Vector3(k.state.x, k.state.y, k.state.z));
          break;
        case 'wall':
          if (isView) {
            audio.sfx('bump', { vol: clamp(e.impact / 30, 0.3, 1) });
            this._shake(k, 0.3);
          }
          break;
        case 'bump':
          if (this.clock - (this._lastBump || 0) > 0.15) {
            this._lastBump = this.clock;
            const n = Math.max(this._near(e.a.state.x, e.a.state.z), this._near(e.b.state.x, e.b.state.z));
            if (n > 0) audio.sfx('bump', { vol: n * 0.7 });
            this.particles.burst((e.a.state.x + e.b.state.x) / 2, e.a.state.y + 0.8, (e.a.state.z + e.b.state.z) / 2, 6, [0xffffff], 4, 0.3, 6, 3);
          }
          break;
        case 'explosion':
          if (near > 0) audio.sfx('explosion', { vol: Math.max(near, 0.3) });
          for (const vp of this.viewports) if (vp.kart && Math.hypot(vp.kart.state.x - e.x, vp.kart.state.z - e.z) < 15) vp.rig.shake = 0.9;
          break;
        case 'lightning':
          audio.sfx('lightning');
          this.fx.lightningFlash(this.scene);
          for (const vp of this.viewports) vp.hud.flash('rgba(220,200,255,0.85)');
          break;
        case 'squashed':
          if (isView) {
            audio.sfx('squash');
            audio.voice(k.char, 'hit');
          }
          break;
        case 'horn':
          if (near > 0) audio.sfx('horn', { vol: Math.max(near, 0.4) });
          break;
        case 'shellBounce':
          if (near > 0.2) audio.sfx('bump', { vol: near * 0.4 });
          break;
        case 'drop':
          if (near > 0.2) audio.sfx('drop', { vol: near * 0.6 });
          break;
        case 'coin':
          if (isView) audio.sfx('coin', { vol: 0.7 });
          this.particles.burst(e.x, e.y, e.z, 8, [0xffd23f, 0xfff3b0], 4, 0.4, 4, 2);
          break;
        case 'jump':
          if (near > 0) audio.sfx('jump', { vol: isView ? 0.8 : near * 0.4 });
          break;
        case 'trick':
          if (near > 0) audio.sfx('trick', { vol: isView ? 1 : near * 0.5 });
          if (isView) {
            for (const h of this._hudOf(k)) h.sub('トリック！');
            audio.voice(k.char, 'boost', { minInterval: 4000 });
          }
          this.particles.burst(k.state.x, k.state.y + k.state.hop + 1, k.state.z, 16, [0xffd23f, 0xffffff, 0x4cc9f0], 7, 0.6, 2, 3);
          break;
        case 'land':
          if (near > 0) audio.sfx('land', { vol: isView ? 0.7 : near * 0.4 });
          if (e.trick) this._boostBurst(k);
          this.particles.burst(k.state.x, k.state.y + 0.2, k.state.z, 8, [0xffffff, 0xdddddd], 4, 0.35, 5, 1);
          break;
        case 'itemHold':
          if (isView) audio.sfx('itemGet', { vol: 0.5 });
          break;
        case 'shieldBlock':
          if (near > 0) audio.sfx('shield', { vol: isView ? 1 : near * 0.5 });
          if (isView) for (const h of this._hudOf(k)) h.sub('ガード！');
          break;
        case 'boomerangCatch':
          if (isView) audio.sfx('itemGet', { vol: 0.5 });
          break;
        case 'lap':
          if (isView) {
            const final = e.lap === this.laps;
            audio.sfx(final ? 'finalLap' : 'lap');
            // ファイナルラップはキャラの気合いの声を重ねる（セリフはなく鳴き声だけ）
            if (final) audio.voice(k.char, 'lap', { noSpeech: true, minInterval: 0 });
            for (const h of this._hudOf(k)) h.message(final ? 'FINAL LAP!' : `LAP ${e.lap}`, final ? 'final' : '', 1.6);
          }
          break;
        case 'finish':
          if (isView) {
            audio.sfx('finish');
            for (const h of this._hudOf(k)) h.message(`FINISH!  ${k.rank}位`, k.rank === 1 ? 'gold' : '', 4);
            audio.voice(k.char, k.rank <= Math.ceil(this.karts.length / 2) ? 'win' : 'lose');
          }
          this.particles.burst(k.state.x, k.state.y + 2, k.state.z, 40, [0xffd23f, 0xff5c8a, 0x4cc9f0, 0x7bff7b], 9, 1.2, 6, 6);
          break;
        default:
          break;
      }
    }
    ev.length = 0;
    // 順位変動（追い抜き）
    for (const vp of this.viewports) {
      const k = vp.kart;
      if (!k || this.state !== 'racing') continue;
      if (k.rank < k.prevRank && this.time > 3) {
        audio.sfx('pass');
        audio.voice(k.char, 'pass', { minInterval: 8000 });
      }
    }
  }

  _boostBurst(k) {
    const s = k.state;
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    const cols = k.char.boostEffect.colors;
    for (let i = 0; i < 12; i++) {
      this.particles.emit(s.x - fx * 1.4, s.y + 0.5, s.z - fz * 1.4, -fx * 4 + (Math.random() - 0.5) * 5, 1 + Math.random() * 3, -fz * 4 + (Math.random() - 0.5) * 5, cols[i % cols.length], 0.4, 2);
    }
  }

  // ---------- モデル同期 ----------
  _syncModel(k, dt) {
    const s = k.state;
    const m = k.model;
    m.group.position.set(s.x, s.y, s.z);
    m.group.rotation.y = s.heading;
    m.setSpin(s.spinAngle);
    m.setHop(s.hop);
    m.setSteer(s.steerVis);
    m.roll(s.speed * dt);
    let roll = -s.steerVis * 0.07 - (s.drifting ? s.driftDir * 0.1 : 0) - clamp(k.slip || 0, -0.5, 0.5) * 0.15;
    let pitch = s.boostTime > 0 ? -0.06 : s.hop > 0 ? -0.1 : 0;
    if (s.airborne) {
      // 上昇中は機首上げ、落下中は下げ。トリック中は大きく傾ける
      pitch = clamp(-s.vy * 0.02, -0.25, 0.25);
      if (s.tricked) {
        k.trickSpin = (k.trickSpin || 0) + dt * 9;
        roll += Math.sin(k.trickSpin) * 0.55;
        pitch += Math.cos(k.trickSpin) * 0.2;
      }
    } else k.trickSpin = 0;
    m.setTilt(roll, pitch);
    const targetScale = s.squashTime > 0 ? 0.5 : 1;
    k.visScale = damp(k.visScale, targetScale, 10, dt);
    m.setSquash(k.visScale);
    m.setLandSquash(s.landSquash || 0);
    if (s.starTime > 0) {
      m.setStar(this.clock);
      k.starWas = true;
      if (Math.random() < 0.5) this.particles.emit(s.x + (Math.random() - 0.5) * 2, s.y + 0.5 + Math.random() * 1.5, s.z + (Math.random() - 0.5) * 2, 0, 2, 0, [0xffd23f, 0xff5c8a, 0x4cc9f0, 0x7bff7b][Math.floor(Math.random() * 4)], 0.5, 0);
    } else if (k.starWas) {
      k.starWas = false;
      m.setStar(null);
    }
    // ドリフト火花
    if (s.drifting && !s.airborne && s.hop <= 0 && (this.quality !== 'low' || Math.random() < 0.5)) {
      const eff = k.char.driftEffect;
      const st = EFFECT_STYLES[eff.style] || EFFECT_STYLES.stars;
      const colors = s.driftTier >= 0 ? [DRIFT_TIERS[s.driftTier].color, ...eff.colors] : eff.colors;
      const rx = Math.cos(s.heading);
      const rz = -Math.sin(s.heading);
      const fx = Math.sin(s.heading);
      const fz = Math.cos(s.heading);
      for (const side of [-1, 1]) {
        const px = s.x + rx * side * 0.8 - fx * 0.9;
        const pz = s.z + rz * side * 0.8 - fz * 0.9;
        this.particles.emit(px, s.y + 0.2, pz, -fx * 4 + rx * side * st.spread * 0.6 + (Math.random() - 0.5) * 2, Math.random() * st.up, -fz * 4 + rz * side * st.spread * 0.6 + (Math.random() - 0.5) * 2, colors[Math.floor(Math.random() * colors.length)], st.life, st.gravity);
      }
    }
    // ブースト炎
    if (s.boostTime > 0 && (this.quality !== 'low' || Math.random() < 0.5)) {
      const cols = k.char.boostEffect.colors;
      const st = EFFECT_STYLES[k.char.boostEffect.style] || EFFECT_STYLES.fire;
      const fx = Math.sin(s.heading);
      const fz = Math.cos(s.heading);
      if (Math.random() < 0.8) {
        const i = Math.floor(Math.random() * cols.length);
        this.particles.emit(s.x - fx * 1.5 + (Math.random() - 0.5) * 0.6, s.y + 0.5, s.z - fz * 1.5 + (Math.random() - 0.5) * 0.6, -fx * 3 + (Math.random() - 0.5) * 2, 1 + Math.random() * 2, -fz * 3 + (Math.random() - 0.5) * 2, cols[i], st.life * 0.5, st.gravity);
      }
    }
    // 走行中の土煙（オフロード）
    if (s.surface === 'offroad' && Math.abs(s.speed) > 8 && Math.random() < 0.4) {
      const fx = Math.sin(s.heading);
      const fz = Math.cos(s.heading);
      this.particles.emit(s.x - fx, s.y + 0.2, s.z - fz, (Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3, this.course.theme === 'snow' ? 0xffffff : 0x9c7a4d, 0.6, 3);
    }
  }

  // ---------- ビューポート ----------
  _updateViewport(vp, dt) {
    let k = vp.kart;
    if (this.spectate || !k) {
      // 観戦: 先頭を追う（数秒ごとに切り替え）
      vp.spectateTimer += dt;
      const alive = this.karts.filter((x) => !x.gone);
      if (!alive.length) return;
      if (vp.spectateTimer > 8 || !vp.spectateKart) {
        vp.spectateTimer = 0;
        vp.spectateKart = alive.sort((a, b) => a.rank - b.rank)[vp.spectateIdx % alive.length];
        vp.spectateIdx = (vp.spectateIdx + 1) % Math.min(3, alive.length);
      }
      k = vp.spectateKart;
    }
    const s = k.state;
    if (this.state === 'intro') vp.rig.intro(this.track, this.stateTime / 3.2);
    else if (this.state === 'results') vp.rig.orbit(k, dt, this.clock);
    else vp.rig.follow(k, dt);

    const laps = this.laps;
    vp.hud.update({
      rank: k.rank,
      total: this.karts.length,
      lap: Math.max(1, s.lap),
      laps,
      time: this.time,
      speed: s.speed,
      items: k.items,
      roulette: k.roulette,
      capacity: this.items.capacity(k),
      golden: s.goldenActive,
      wrongWay: s.reverseHint > 0.8 && !s.finished,
      star: s.starTime > 0,
      squash: s.squashTime > 0,
      boost: s.boostTime > 0,
      coins: s.coins || 0,
      maxCoins: MAX_COINS,
      held: !!this.items.heldOf(k),
      karts: this.karts.filter((x) => !x.gone).map((x) => ({ x: x.state.x, z: x.state.z, me: x === k, color: x.color })),
    });
    if (vp.engine) {
      const inp = vp.kart ? this.input.get(vp.kart.playerIndex) : { accel: 0 };
      vp.engine.update(clamp(Math.abs(s.speed) / k.params.maxSpeed, 0, 1.2), s.finished ? 0.5 : inp.accel, s.drifting, s.boostTime > 0);
    }
  }

  render() {
    if (this.disposed) return;
    const r = this.renderer;
    const W = r.domElement.width;
    const H = r.domElement.height;
    const dpr = r.getPixelRatio();
    const w = W / dpr;
    const h = H / dpr;
    r.setScissorTest(this.viewports.length > 1);
    for (const vp of this.viewports) {
      const x = Math.floor(vp.rect.x * w);
      const y = Math.floor((1 - vp.rect.y - vp.rect.h) * h);
      const vw = Math.floor(vp.rect.w * w);
      const vh = Math.floor(vp.rect.h * h);
      r.setViewport(x, y, vw, vh);
      r.setScissor(x, y, vw, vh);
      r.render(this.scene, vp.rig.camera);
    }
    r.setScissorTest(false);
  }

  dispose() {
    this.disposed = true;
    for (const vp of this.viewports) {
      vp.hud.destroy();
      if (vp.engine) vp.engine.stop();
    }
    audio.stopAllEngines();
    audio.setTempo(1);
    if (this.starBgm) audio.popBgm();
    this.items.dispose();
    this.coins.dispose();
    this.particles.dispose();
    this.fx.dispose();
    if (this.net && this._netHandlers) for (const [t, h] of Object.entries(this._netHandlers)) this.net.off(t, h);
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
    this.scene.clear();
  }
}

// 手すりのないコース（レインボーロード）の「落ちたら戻される」の検証。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../src/race/Track.js';
import { getCourse, COURSES } from '../src/data/courses.js';
import { getCharacter } from '../src/data/characters.js';
import { buildParams, createKartState, stepKart, rescueKart, FALL_RESCUE_TIME } from '../src/race/KartPhysics.js';
import { AIDriver } from '../src/race/AIDriver.js';
import { makeRng } from '../src/core/Utils.js';

const course = getCourse('rainbow');
const track = new Track(course);

function makeKart(tr = track, at = 40) {
  const char = getCharacter('taro');
  const params = buildParams(char, {});
  const state = createKartState();
  const s = tr.samples[at];
  state.x = s.pos.x;
  state.y = s.pos.y;
  state.z = s.pos.z;
  state.heading = s.heading;
  state.moveHeading = s.heading;
  const q = tr.query(state, null);
  state.trackIndex = q.index;
  state.progress = q.progress;
  state.totalProgress = q.progress;
  return { id: 'k', char, params, state, track: tr, baseMaxSpeed: params.maxSpeed, items: [], roulette: null };
}
const drive = { steer: 0, accel: 1, brake: 0, drift: false, driftPressed: false };
const coast = { steer: 0, accel: 0, brake: 0, drift: false, driftPressed: false };

/** 道のふちの外へ押し出す */
function shoveOff(k, side = 1) {
  const s = k.state;
  const smp = k.track.samples[s.trackIndex];
  const out = k.track.halfWidth + 1.5;
  s.x = smp.pos.x + smp.right.x * side * out;
  s.z = smp.pos.z + smp.right.z * side * out;
}

test('ふちの外に出ると落ちはじめる', () => {
  const k = makeKart();
  const ev = [];
  for (let i = 0; i < 30; i++) stepKart(k, drive, 1 / 60, ev); // 走って安全地点を覚えさせる
  assert.equal(k.state.falling, false);
  assert.ok(k.state.safeIndex != null, '安全地点を覚えていない');
  shoveOff(k);
  stepKart(k, drive, 1 / 60, ev);
  assert.equal(k.state.falling, true, '落ちはじめていない');
  assert.ok(ev.some((e) => e.type === 'fall'), 'fall イベントが出ていない');
});

test('落ちているあいだは下がりつづけて、操作もできない', () => {
  const k = makeKart();
  const ev = [];
  for (let i = 0; i < 30; i++) stepKart(k, drive, 1 / 60, ev);
  shoveOff(k);
  stepKart(k, drive, 1 / 60, ev);
  const y0 = k.state.y;
  const speed0 = k.state.speed;
  for (let i = 0; i < 20; i++) stepKart(k, drive, 1 / 60, ev);
  assert.ok(k.state.y < y0 - 1, `落ちていない（${y0.toFixed(1)} → ${k.state.y.toFixed(1)}）`);
  assert.ok(k.state.speed <= speed0, 'アクセルが効いてしまっている');
  assert.equal(k.state.falling, true);
});

test('しばらくすると落ちる前の場所に戻される', () => {
  const k = makeKart();
  const ev = [];
  for (let i = 0; i < 60; i++) stepKart(k, drive, 1 / 60, ev);
  const safe = k.state.safeIndex;
  const totalBefore = k.state.totalProgress;
  shoveOff(k);
  ev.length = 0;
  stepKart(k, coast, 1 / 60, ev); // この 1 歩で落ちはじめる
  assert.equal(k.state.falling, true, '落ちはじめていない');
  let t = 1 / 60;
  while (k.state.falling && t < 5) {
    stepKart(k, coast, 1 / 60, ev);
    t += 1 / 60;
  }
  assert.equal(k.state.falling, false, '戻ってこない');
  assert.ok(Math.abs(t - FALL_RESCUE_TIME) < 0.1, `戻るまで ${t.toFixed(2)} 秒（${FALL_RESCUE_TIME} 秒のはず）`);
  assert.ok(ev.some((e) => e.type === 'respawn'), 'respawn イベントが出ていない');
  // 落ちる前のコース位置に戻っている
  assert.equal(k.state.trackIndex, safe, '戻された場所が違う');
  assert.ok(Math.abs(k.state.totalProgress - totalBefore) < 2, '進行度がずれた');
  // 道の上にいる
  assert.equal(track.query(k.state, k.state.trackIndex).surface, 'road', '道の上に戻っていない');
  assert.ok(Math.abs(k.state.lateral) < track.halfWidth, 'コースの外に戻された');
  assert.equal(k.state.speed, 0, '止まった状態で戻らない');
  assert.ok(k.state.respawnTime > 0, '戻った直後の無敵時間がない');
});

test('戻された直後にまた落ちない（何度も落ちつづけない）', () => {
  const k = makeKart();
  const ev = [];
  for (let i = 0; i < 60; i++) stepKart(k, drive, 1 / 60, ev);
  shoveOff(k);
  for (let i = 0; i < 200; i++) stepKart(k, coast, 1 / 60, ev);
  assert.equal(k.state.falling, false);
  const falls = ev.filter((e) => e.type === 'fall').length;
  assert.equal(falls, 1, `${falls} 回落ちた（戻された先でまた落ちている）`);
});

/**
 * いまのコース位置のまま、道のふち寄りへ横づけする。
 * サンプル点へ置きなおすと前後の位置まで巻きもどって進まなくなるので、
 * 真横へずらすぶんだけ動かす
 */
function hugEdge(k, frac) {
  const st = k.state;
  const q = k.track.query(st, st.trackIndex);
  const smp = k.track.samples[q.index];
  const d = k.track.halfWidth * frac - q.lateral;
  st.x += smp.right.x * d;
  st.z += smp.right.z * d;
}

test('ふちギリギリを走ってから落ちると、ふちに寄る前の場所に戻される', () => {
  const k = makeKart();
  const ev = [];
  for (let i = 0; i < 60; i++) stepKart(k, drive, 1 / 60, ev);
  const centerTotal = k.state.totalProgress;
  const centerIndex = k.state.trackIndex;
  // 落ちる寸前のふち（安全地点として覚えない範囲）を走りつづける
  for (let i = 0; i < 60; i++) {
    hugEdge(k, 0.96);
    stepKart(k, drive, 1 / 60, ev);
    assert.equal(k.state.falling, false, 'まだ道の上なのに落ちた');
  }
  assert.ok(k.state.totalProgress > centerTotal + 1, 'ふち走行で進んでいない（前提がくずれた）');
  assert.ok(k.state.trackIndex !== centerIndex, 'コース位置が動いていない（前提がくずれた）');
  const edgeTotal = k.state.totalProgress;
  const edgeIndex = k.state.trackIndex;

  shoveOff(k);
  for (let i = 0; i < 150; i++) stepKart(k, coast, 1 / 60, ev);
  assert.equal(k.state.falling, false, '戻ってこない');
  // ふちに寄ってからの進みぶんは戻される（ふちにぶら下がって稼げない）
  assert.ok(k.state.totalProgress < edgeTotal, `進行度が戻っていない（${edgeTotal.toFixed(1)} → ${k.state.totalProgress.toFixed(1)}）`);
  // 巻きもどしすぎない。ふちに寄る前の地点より手前には戻さない
  assert.ok(
    k.state.totalProgress >= centerTotal,
    `戻しすぎ（${centerTotal.toFixed(1)} より手前の ${k.state.totalProgress.toFixed(1)} に戻った）`
  );
  assert.notEqual(k.state.trackIndex, edgeIndex, 'ふちにいた場所にそのまま戻された');
  assert.ok(k.state.trackIndex >= centerIndex, '戻された場所が手前すぎる');
  // 戻される位置は道のじゅうぶん内側（ふちに戻すとまた落ちる）
  assert.ok(
    Math.abs(k.state.lateral) <= track.halfWidth * 0.5 + 1e-6,
    `ふち寄りに戻された（lateral ${k.state.lateral.toFixed(2)} / 上限 ${(track.halfWidth * 0.5).toFixed(2)}）`
  );
});

test('ふち寄りを走っていても、戻されるのは道の内側', () => {
  const k = makeKart();
  const ev = [];
  for (let i = 0; i < 30; i++) stepKart(k, drive, 1 / 60, ev);
  // 安全地点として覚える範囲の中でいちばんふち寄り（0.92 未満）を走る
  for (let i = 0; i < 60; i++) {
    hugEdge(k, 0.9);
    stepKart(k, drive, 1 / 60, ev);
  }
  assert.ok(Math.abs(k.state.safeLat) > track.halfWidth * 0.5, 'ふち寄りの安全地点を覚えていない（前提がくずれた）');
  shoveOff(k);
  for (let i = 0; i < 150; i++) stepKart(k, coast, 1 / 60, ev);
  assert.equal(k.state.falling, false, '戻ってこない');
  assert.ok(
    Math.abs(k.state.lateral) <= track.halfWidth * 0.5 + 1e-6,
    `ふちすれすれに戻された（lateral ${k.state.lateral.toFixed(2)} / 上限 ${(track.halfWidth * 0.5).toFixed(2)}）`
  );
  // 戻ったあとそのまま走ってもすぐには落ちない
  const fallsBefore = ev.filter((e) => e.type === 'fall').length;
  for (let i = 0; i < 120; i++) stepKart(k, drive, 1 / 60, ev);
  assert.equal(ev.filter((e) => e.type === 'fall').length, fallsBefore, '戻された直後にまた落ちた');
});

test('戻された場所は落ちたところより先へ進まない', () => {
  const k = makeKart();
  const ev = [];
  for (let i = 0; i < 90; i++) stepKart(k, drive, 1 / 60, ev);
  const before = k.state.totalProgress;
  shoveOff(k);
  for (let i = 0; i < 120; i++) stepKart(k, coast, 1 / 60, ev);
  assert.ok(k.state.totalProgress <= before + 1, '落ちたのに進んでいる（ショートカットになる）');
});

test('壁のあるコースでは落ちずに壁で止まる', () => {
  const meadow = new Track(getCourse('meadow'));
  const k = makeKart(meadow, 40);
  const ev = [];
  for (let i = 0; i < 30; i++) stepKart(k, drive, 1 / 60, ev);
  shoveOff(k);
  for (let i = 0; i < 60; i++) stepKart(k, drive, 1 / 60, ev);
  assert.equal(k.state.falling, false, '壁のあるコースで落ちてしまった');
  assert.ok(Math.abs(k.state.lateral) <= meadow.wallDist + 0.1, '壁を越えた');
});

test('rescueKart は安全地点を覚えていなくても落ちない', () => {
  const k = makeKart();
  k.state.safeIndex = null;
  rescueKart(k);
  assert.ok(Number.isFinite(k.state.x) && Number.isFinite(k.state.z), '座標がおかしい');
  assert.equal(track.query(k.state, k.state.trackIndex).surface, 'road');
});

test('CPU は手すりがなくても落ちずに 1 周できる', () => {
  for (const c of COURSES.filter((x) => x.shoulder === 0)) {
    const tr = new Track(c);
    const k = makeKart(tr, 0);
    const slot = tr.gridSlot(0);
    k.state.x = slot.pos.x;
    k.state.y = slot.pos.y;
    k.state.z = slot.pos.z;
    k.state.heading = slot.heading;
    k.state.moveHeading = slot.heading;
    const q = tr.query(k.state, null);
    k.state.trackIndex = q.index;
    k.state.progress = q.progress;
    k.state.totalProgress = q.progress - tr.N;
    const ai = new AIDriver(k, tr, makeRng(5), 'normal');
    const ctx = { karts: [k], hazards: [], rankOf: () => 1, humanProgress: null };
    const ev = [];
    let t = 0;
    while (k.state.totalProgress < tr.N && t < 120) {
      ai.update(1 / 60, ctx);
      stepKart(k, ai.input, 1 / 60, ev);
      t += 1 / 60;
    }
    assert.ok(k.state.totalProgress >= tr.N, `${c.id}: 1周できなかった`);
    const falls = ev.filter((e) => e.type === 'fall').length;
    assert.equal(falls, 0, `${c.id}: CPU が ${falls} 回落ちた`);
  }
});

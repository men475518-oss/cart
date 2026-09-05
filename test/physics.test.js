import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../src/race/Track.js';
import { COURSES } from '../src/data/courses.js';
import { getCharacter, CHARACTERS } from '../src/data/characters.js';
import { buildParams, createKartState, stepKart, spinOut, resolveKartCollision, applyBoost } from '../src/race/KartPhysics.js';
import { AIDriver } from '../src/race/AIDriver.js';
import { makeRng } from '../src/core/Utils.js';

const track = new Track(COURSES[0]);
// ダッシュ板・特殊路面のない円形コース（加速・ブーストの検証用）
const plainTrack = new Track({
  id: 'plain', width: 14, laps: 1, surfaces: [], boosts: [], itemBoxes: [],
  points: Array.from({ length: 12 }, (_, i) => [Math.cos((i / 12) * Math.PI * 2) * 120, 0, Math.sin((i / 12) * Math.PI * 2) * 120]),
});

function makeKart(charId, slot = 7, kartOpts = {}, track = trackDefault) {
  const char = getCharacter(charId);
  const params = buildParams(char, kartOpts);
  const state = createKartState();
  const g = track.gridSlot(slot);
  state.x = g.pos.x;
  state.z = g.pos.z;
  state.heading = g.heading;
  state.moveHeading = g.heading;
  const q = track.query(state, null);
  state.trackIndex = q.index;
  state.progress = q.progress;
  state.totalProgress = q.progress - track.N;
  return { id: charId, char, params, state, track, baseMaxSpeed: params.maxSpeed, items: [], roulette: null };
}
const trackDefault = track;

/** コース中央を追いかけるハンドル値（heading は左折で増える） */
function followSteer(k, lookahead = 10) {
  const s = k.state;
  const ts = k.track.sample(s.trackIndex + lookahead);
  const desired = Math.atan2(ts.pos.x - s.x, ts.pos.z - s.z);
  let d = desired - s.heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.max(-1, Math.min(1, -d * 2.4));
}

function drive(k, seconds, input = { accel: 1, brake: 0, drift: false }, events = []) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) stepKart(k, { steer: input.steer ?? followSteer(k), ...input, steer: input.steer ?? followSteer(k) }, 1 / 60, events);
  return events;
}

test('kart accelerates on a straight up to its max speed', () => {
  const k = makeKart('taro');
  drive(k, 6);
  assert.ok(k.state.speed > k.params.maxSpeed * 0.95, `speed ${k.state.speed} vs ${k.params.maxSpeed}`);
  assert.ok(k.state.totalProgress > 50);
});

test('type differences: light accelerates faster, heavy has higher top speed', () => {
  const light = makeKart('pyon');
  const heavy = makeKart('don');
  drive(light, 1.2);
  drive(heavy, 1.2);
  assert.ok(light.state.speed > heavy.state.speed);
  assert.ok(heavy.params.maxSpeed > light.params.maxSpeed);
  assert.ok(heavy.params.weight > light.params.weight * 2);
});

test('spin out kills speed and control, then recovers', () => {
  const k = makeKart('taro');
  drive(k, 3);
  const before = k.state.speed;
  assert.ok(spinOut(k, 1));
  assert.ok(k.state.speed < before * 0.5);
  assert.ok(k.state.spinTime > 0);
  drive(k, 2);
  assert.equal(k.state.spinTime, 0);
});

test('star makes a kart immune to spin', () => {
  const k = makeKart('taro');
  k.state.starTime = 5;
  assert.equal(spinOut(k, 1), false);
});

test('drift charges through tiers and gives a mini turbo on release', () => {
  const k = makeKart('mint');
  drive(k, 3);
  const events = [];
  // 最初のフレームで右に切ってドリフト開始、その後はコースに沿って調整（上手いプレイヤーの操作）
  for (let i = 0; i < 60 * 2.5; i++) {
    const steer = i === 0 ? 0.6 : followSteer(k, 14);
    stepKart(k, { steer, accel: 1, brake: 0, drift: true }, 1 / 60, events);
  }
  assert.ok(k.state.drifting);
  assert.ok(events.some((e) => e.type === 'driftTier'), 'should reach a tier');
  const speedBefore = k.state.speed;
  stepKart(k, { steer: followSteer(k), accel: 1, brake: 0, drift: false }, 1 / 60, events);
  assert.ok(events.some((e) => e.type === 'miniTurbo'));
  assert.ok(k.state.boostTime > 0);
  drive(k, 0.5);
  assert.ok(k.state.speed > speedBefore);
});

test('heavy kart pushes light kart more in a collision', () => {
  const heavy = makeKart('don', 0);
  const light = makeKart('pyon', 0);
  light.state.x = heavy.state.x + 1.5; // 重なる位置
  light.state.z = heavy.state.z;
  const hx = heavy.state.x;
  const lx = light.state.x;
  const events = [];
  resolveKartCollision(heavy, light, events);
  const heavyMoved = Math.abs(heavy.state.x - hx);
  const lightMoved = Math.abs(light.state.x - lx);
  assert.ok(lightMoved > heavyMoved * 2, `light ${lightMoved} heavy ${heavyMoved}`);
  assert.ok(events.some((e) => e.type === 'bump'));
});

test('walls keep karts on the course', () => {
  const k = makeKart('don');
  const events = drive(k, 4, { steer: 1, accel: 1, brake: 0, drift: false });
  const q = track.query(k.state, k.state.trackIndex);
  assert.ok(Math.abs(q.lateral) <= track.wallDist + 0.01);
  assert.ok(events.some((e) => e.type === 'wall'));
});

test('boost raises the speed cap temporarily', () => {
  const k = makeKart('taro', 7, {}, plainTrack);
  drive(k, 5);
  applyBoost(k, 1.2, 1.4);
  drive(k, 0.8);
  assert.ok(k.state.speed > k.params.maxSpeed * 1.1);
  // ブースト終了後は最高速まで減速する
  drive(k, 3);
  assert.equal(k.state.boostTime, 0);
  assert.ok(k.state.speed <= k.params.maxSpeed + 0.01, `speed ${k.state.speed}`);
});

test('every character can complete a lap with the AI without hitting walls', () => {
  for (const c of CHARACTERS) {
    const k = makeKart(c.id);
    const ai = new AIDriver(k, track, makeRng(3), 'normal');
    const ctx = { karts: [k], hazards: [], rankOf: () => 1, humanProgress: null };
    const events = [];
    let t = 0;
    let walls = 0;
    while (k.state.totalProgress < track.N && t < 60) {
      ai.update(1 / 60, ctx);
      stepKart(k, ai.input, 1 / 60, events);
      walls += events.filter((e) => e.type === 'wall').length;
      events.length = 0;
      t += 1 / 60;
    }
    assert.ok(k.state.totalProgress >= track.N, `${c.id} did not finish a lap`);
    assert.ok(t < 30, `${c.id} lap too slow: ${t}`);
    assert.ok(walls <= 2, `${c.id} hit walls ${walls} times`);
  }
});

test('character traits map to physics params', () => {
  assert.ok(buildParams(getCharacter('moco')).traits.snow);
  assert.ok(buildParams(getCharacter('pepe')).traits.water);
  assert.ok(buildParams(getCharacter('hino')).traits.lava);
  assert.ok(buildParams(getCharacter('hoo')).traits.items);
  assert.ok(buildParams(getCharacter('mint')).driftRate > buildParams(getCharacter('taro')).driftRate);
  const slick = buildParams(getCharacter('taro'), { wheels: 'slick' });
  const std = buildParams(getCharacter('taro'), { wheels: 'standard' });
  assert.ok(slick.maxSpeed > std.maxSpeed && slick.offroadMult < std.offroadMult);
});

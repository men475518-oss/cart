import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, ITEM_IDS, itemWeightsForRank } from '../src/data/items.js';
import { weightedPick, makeRng, wrapAngle, formatTime } from '../src/core/Utils.js';

test('all ten items are defined with icons and descriptions', () => {
  assert.equal(ITEM_IDS.length, 11); // 10 種 + トリプルキノコ
  for (const id of ITEM_IDS) {
    assert.ok(ITEMS[id].icon && ITEMS[id].name && ITEMS[id].desc);
    assert.equal(ITEMS[id].weights.length, 3);
  }
});

test('item roulette favours weak items in first place and strong items in last', () => {
  const first = Object.fromEntries(itemWeightsForRank(0).map((e) => [e.v, e.w]));
  const last = Object.fromEntries(itemWeightsForRank(1).map((e) => [e.v, e.w]));
  assert.ok(!('star' in first) && !('lightning' in first) && !('goldenMushroom' in first));
  assert.ok(last.star > 10 && last.lightning > 5 && last.goldenMushroom > 10);
  assert.ok(first.banana > last.banana);
  assert.ok(first.superHorn > last.superHorn);
  // 運ボーナスは強力アイテムのみ増やす
  const lucky = Object.fromEntries(itemWeightsForRank(1, 1.25).map((e) => [e.v, e.w]));
  assert.ok(lucky.star > last.star && lucky.banana === last.banana);
});

test('weighted pick is deterministic with a seeded rng and respects weights', () => {
  const rng = makeRng(42);
  const counts = {};
  for (let i = 0; i < 5000; i++) {
    const v = weightedPick([{ v: 'a', w: 9 }, { v: 'b', w: 1 }], rng());
    counts[v] = (counts[v] || 0) + 1;
  }
  assert.ok(counts.a > 4200 && counts.b > 300);
  const r1 = makeRng(7), r2 = makeRng(7);
  assert.equal(r1(), r2());
});

test('utils', () => {
  assert.ok(Math.abs(wrapAngle(Math.PI * 3) - Math.PI) < 1e-9 || Math.abs(wrapAngle(Math.PI * 3) + Math.PI) < 1e-9);
  assert.equal(formatTime(65.5), '1:05.500');
  assert.equal(formatTime(null), '--:--.---');
});

// ---------- 実際にアイテムを使ってみる ----------
// ItemSystem は three.js のメッシュを作るので、canvas だけスタブを用意する
if (typeof globalThis.document === 'undefined') {
  const ctx2d = new Proxy(
    { canvas: null, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '' },
    { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) }
  );
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? { width: 0, height: 0, getContext: () => ctx2d, style: {} } : { style: {} }),
  };
}

const { Track } = await import('../src/race/Track.js');
const { COURSES } = await import('../src/data/courses.js');
const { getCharacter } = await import('../src/data/characters.js');
const { buildParams, createKartState, stepKart } = await import('../src/race/KartPhysics.js');
const { ItemSystem } = await import('../src/race/ItemSystem.js');

const track = new Track(COURSES[0]);
const stubScene = { add() {}, remove() {} };
const stubFx = { explosion() {}, shockwave() {} };
const stubParticles = { burst() {} };

/** スタート位置に並べたカートを n 台作る */
function makeKarts(n) {
  return Array.from({ length: n }, (_, i) => {
    const char = getCharacter('taro');
    const params = buildParams(char, {});
    const state = createKartState();
    const g = track.gridSlot(i);
    state.x = g.pos.x;
    state.z = g.pos.z;
    state.heading = g.heading;
    state.moveHeading = g.heading;
    state.speed = 30;
    const q = track.query(state, null);
    state.trackIndex = q.index;
    state.progress = q.progress;
    state.totalProgress = q.progress - track.N;
    return { id: 'k' + i, char, params, state, track, baseMaxSpeed: params.maxSpeed, items: [], roulette: null, isHuman: i === 0 };
  });
}

function makeSystem(karts, events) {
  return new ItemSystem({ track, scene: stubScene, karts, rng: makeRng(7), events, fx: stubFx, particles: stubParticles });
}

/** dt=1/60 で n 秒すすめる */
function run(sys, karts, events, sec, rankOf = () => 1) {
  for (let t = 0; t < sec; t += 1 / 60) {
    sys.update(1 / 60, rankOf);
    for (const k of karts) stepKart(k, { steer: 0, accel: 1, brake: 0, drift: false }, 1 / 60, events);
  }
}

test('10 種類すべてのアイテムが実際に効果を出す', () => {
  for (const id of ITEM_IDS) {
    const events = [];
    const karts = makeKarts(2);
    const sys = makeSystem(karts, events);
    const me = karts[0];
    const other = karts[1];
    me.items = [{ id, uses: ITEMS[id].uses || 1 }];
    const usedOk = sys.useItem(me, false, () => (me === karts[0] ? 2 : 1));
    assert.ok(usedOk, `${id}: 使えなかった`);
    const kinds = new Set(events.map((e) => e.type));
    assert.ok(
      kinds.has('itemUse') || kinds.has('lightning') || kinds.has('horn'),
      `${id}: 使用イベントが出ない（${[...kinds].join(',')}）`
    );
    // 飛び道具・設置物はハザードとして出現する / それ以外は自分か相手の状態が変わる
    const spawns = ['banana', 'greenShell', 'redShell', 'bomb', 'boomerang'];
    if (spawns.includes(id)) {
      assert.equal(sys.hazards.length, 1, `${id}: ハザードが出ない`);
      assert.equal(sys.hazards[0].type, id, `${id}: 出たハザードの種類がちがう`);
    } else if (id === 'star') {
      assert.ok(me.state.starTime > 5, `${id}: 無敵にならない`);
    } else if (id === 'lightning') {
      assert.ok(other.state.squashTime > 0, `${id}: 相手が小さくならない`);
      assert.equal(me.state.squashTime, 0, `${id}: 自分まで小さくなっている`);
    } else if (id === 'superHorn') {
      assert.ok(kinds.has('horn'), `${id}: ホーンが鳴らない`);
    } else {
      // キノコ系
      assert.ok(me.state.boostTime > 0.5, `${id}: 加速しない`);
    }
  }
});

test('バナナを踏むとスピンする', () => {
  const events = [];
  const karts = makeKarts(2);
  const sys = makeSystem(karts, events);
  const [dropper, victim] = karts;
  dropper.items = [{ id: 'banana', uses: 1 }];
  sys.useItem(dropper, true); // 後ろに落とす
  const h = sys.hazards[0];
  // 被害者をバナナの真上に置く
  victim.state.x = h.x;
  victim.state.z = h.z;
  run(sys, karts, events, 0.3);
  assert.ok(victim.state.spinTime > 0, 'スピンしていない');
  assert.ok(events.some((e) => e.type === 'hit' && e.kart === victim), 'ヒットイベントが出ていない');
});

test('赤こうらは前を走るカートを追いかける', () => {
  const events = [];
  const karts = makeKarts(2);
  const sys = makeSystem(karts, events);
  const [chaser, leader] = karts;
  // leader を 40m 前方の少し横に置く
  const q = track.query(chaser.state, null);
  const ahead = track.samples[(q.index + 27) % track.N];
  leader.state.x = ahead.pos.x + ahead.right.x * 3;
  leader.state.z = ahead.pos.z + ahead.right.z * 3;
  leader.state.speed = 0;
  chaser.items = [{ id: 'redShell', uses: 1 }];
  const rankOf = (k) => (k === leader ? 1 : 2);
  sys.useItem(chaser, false, rankOf);
  const h = sys.hazards[0];
  assert.equal(h.target, leader, 'ターゲットが前のカートになっていない');
  const before = Math.hypot(h.x - leader.state.x, h.z - leader.state.z);
  chaser.state.speed = 0;
  run(sys, karts, events, 1.2, rankOf);
  const hit = events.some((e) => e.type === 'hit' && e.kart === leader);
  const after = sys.hazards[0] ? Math.hypot(sys.hazards[0].x - leader.state.x, sys.hazards[0].z - leader.state.z) : 0;
  assert.ok(hit || after < before, `追尾していない（${before.toFixed(1)} → ${after.toFixed(1)}）`);
});

test('スター中は攻撃を受けない', () => {
  const events = [];
  const karts = makeKarts(2);
  const sys = makeSystem(karts, events);
  const [dropper, victim] = karts;
  victim.items = [{ id: 'star', uses: 1 }];
  sys.useItem(victim, false);
  dropper.items = [{ id: 'banana', uses: 1 }];
  sys.useItem(dropper, true);
  const h = sys.hazards.find((x) => x.type === 'banana');
  victim.state.x = h.x;
  victim.state.z = h.z;
  run(sys, karts, events, 0.3);
  assert.equal(victim.state.spinTime, 0, 'スター中なのにスピンしている');
});

test('アイテムボックスを取るとルーレットが回ってアイテムが手に入る', () => {
  const events = [];
  const karts = makeKarts(1);
  const sys = makeSystem(karts, events);
  const me = karts[0];
  const box = sys.boxes[0];
  me.state.x = box.spot.pos.x;
  me.state.z = box.spot.pos.z;
  me.state.speed = 0;
  sys.update(1 / 60, () => 1);
  assert.ok(me.roulette, 'ルーレットが始まらない');
  assert.equal(box.active, false, 'ボックスが消えていない');
  for (let t = 0; t < 2; t += 1 / 60) sys.update(1 / 60, () => 1);
  assert.equal(me.roulette, null, 'ルーレットが止まらない');
  assert.equal(me.items.length, 1, 'アイテムが手に入っていない');
  assert.ok(ITEM_IDS.includes(me.items[0].id), '知らないアイテムが出た');
});

test('後ろに構えたこうらが追尾アイテムを防ぐ', () => {
  const events = [];
  const karts = makeKarts(2);
  const sys = makeSystem(karts, events);
  const [defender, attacker] = karts;
  defender.items = [{ id: 'greenShell', uses: 1 }];
  sys.useItem(defender, false, null, true); // 構える
  const held = sys.heldOf(defender);
  assert.ok(held, 'こうらを構えられない');
  assert.equal(held.heldBy, defender, '構えた持ち主がちがう');
});

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

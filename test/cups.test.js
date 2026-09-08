import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CUPS, CUP_POINTS, pointsForRank, cupStandings, getCup } from '../src/data/cups.js';
import { COURSES } from '../src/data/courses.js';

test('カップのコースはすべて実在する', () => {
  const ids = new Set(COURSES.map((c) => c.id));
  for (const cup of CUPS) {
    assert.ok(cup.courses.length >= 3, `${cup.id}: コースが少なすぎる`);
    for (const id of cup.courses) assert.ok(ids.has(id), `${cup.id}: 知らないコース ${id}`);
    assert.equal(new Set(cup.courses).size, cup.courses.length, `${cup.id}: 同じコースが 2 回ある`);
  }
});

test('全コースがどれかのカップに入っている', () => {
  const used = new Set(CUPS.flatMap((c) => c.courses));
  for (const c of COURSES) assert.ok(used.has(c.id), `${c.id} がどのカップにも入っていない`);
});

test('カップは難しい順にコースが並ぶ（最終戦がいちばん難しい）', () => {
  const diff = Object.fromEntries(COURSES.map((c) => [c.id, c.difficulty]));
  for (const cup of CUPS) {
    const last = diff[cup.courses[cup.courses.length - 1]];
    for (const id of cup.courses.slice(0, -1)) {
      assert.ok(diff[id] <= last, `${cup.id}: ${id}（★${diff[id]}）が最終戦（★${last}）より難しい`);
    }
  }
});

test('順位ポイントは上位ほど高い', () => {
  for (let i = 1; i < CUP_POINTS.length; i++) assert.ok(CUP_POINTS[i] < CUP_POINTS[i - 1]);
  assert.equal(pointsForRank(1), CUP_POINTS[0]);
  assert.equal(pointsForRank(8), CUP_POINTS[7]);
  // 8 人より多くても最下位のポイントは出る（0 やエラーにしない）
  assert.equal(pointsForRank(12), CUP_POINTS[CUP_POINTS.length - 1]);
});

test('総合順位はポイント順、同点なら 1 位の回数が多い方が上', () => {
  const r = cupStandings([
    { id: 'a', points: 20, finishes: [3, 3] },
    { id: 'b', points: 27, finishes: [2, 2] },
    { id: 'c', points: 27, finishes: [1, 4] },
  ]);
  assert.deepEqual(r.map((x) => x.id), ['c', 'b', 'a']);
  // 元の配列は書きかえない
  const src = [{ id: 'x', points: 1, finishes: [8] }, { id: 'y', points: 9, finishes: [1] }];
  cupStandings(src);
  assert.equal(src[0].id, 'x');
});

test('知らないカップ ID でも落ちない', () => {
  assert.equal(getCup('nope').id, CUPS[0].id);
});

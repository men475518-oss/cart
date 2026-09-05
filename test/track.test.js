import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../src/race/Track.js';
import { COURSES } from '../src/data/courses.js';

for (const course of COURSES) {
  test(`track ${course.id}: sampling, surfaces and no self-overlap`, () => {
    const t = new Track(course);
    assert.ok(t.N > 200);
    assert.ok(t.length > 500);
    // 位置クエリ: サンプル点上ではその index が返る
    for (let i = 0; i < t.N; i += 37) {
      const q = t.query(t.samples[i].pos, null);
      assert.equal(q.index, i);
      assert.ok(Math.abs(q.lateral) < 1e-6);
      assert.equal(q.surface, t.samples[i].surface === 'road' ? 'road' : q.surface);
    }
    // 右側にずらすと lateral が正
    const s = t.samples[10];
    const p = s.pos.clone().addScaledVector(s.right, 3);
    const q = t.query(p, 10);
    assert.ok(q.lateral > 2.9 && q.lateral < 3.1);
    assert.equal(q.surface, 'road');
    // 路肩・壁判定
    const off = s.pos.clone().addScaledVector(s.right, t.halfWidth + 2);
    assert.equal(t.query(off, 10).surface, 'offroad');
    const wall = s.pos.clone().addScaledVector(s.right, t.wallDist + 2);
    assert.equal(t.query(wall, 10).surface, 'wall');
    // コースが自分自身と重ならない（インデックスが離れた区間同士は壁幅以上離れている）
    let minSep = Infinity;
    for (let i = 0; i < t.N; i += 2) {
      for (let j = i + 60; j < t.N; j += 2) {
        const circ = Math.min(j - i, t.N - (j - i));
        if (circ < 60) continue;
        const d = t.samples[i].pos.distanceTo(t.samples[j].pos);
        if (d < minSep) minSep = d;
      }
    }
    assert.ok(minSep > t.wallDist * 2, `${course.id} overlaps itself (min separation ${minSep.toFixed(1)})`);
    // 特殊サーフェス
    const types = new Set(t.samples.map((x) => x.surface));
    for (const sf of course.surfaces || []) assert.ok(types.has(sf.type), `${course.id} should have ${sf.type}`);
    // アイテムボックス・ダッシュ板
    assert.equal(t.itemBoxSpots.length, course.itemBoxes.reduce((a, b) => a + b.lanes.length, 0));
    assert.equal(t.boostPads.length, course.boosts.length);
  });
}

test('grid slots are behind the start line and inside the road', () => {
  const t = new Track(COURSES[0]);
  for (let k = 0; k < 8; k++) {
    const g = t.gridSlot(k);
    const q = t.query(g.pos, null);
    assert.ok(q.index > t.N - 30, `slot ${k} index ${q.index}`);
    assert.ok(Math.abs(q.lateral) < t.halfWidth);
  }
});

// ---------- メッシュ生成の検証 ----------
// 手続きテクスチャが canvas を使うので、最低限のスタブを用意する
if (typeof globalThis.document === 'undefined') {
  const ctx2d = new Proxy(
    { canvas: null, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '' },
    { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) }
  );
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? { width: 0, height: 0, getContext: () => ctx2d, style: {} } : { style: {} }),
  };
}

for (const course of COURSES) {
  test(`track ${course.id}: mesh faces up and instance counts fit`, () => {
    const t = new Track(course);
    const group = t.buildMesh(course.palette, 'high');
    const road = group.getObjectByName('road');
    assert.ok(road, '路面メッシュがある');

    // 路面の法線がすべて上を向いていること（下向きだと背面カリングで消える）
    const nrm = road.geometry.attributes.normal;
    let down = 0;
    for (let i = 0; i < nrm.count; i++) if (nrm.getY(i) <= 0) down++;
    assert.equal(down, 0, `路面の法線が下を向いている頂点が ${down} 個ある`);

    // 座標に NaN や Infinity がないこと
    const pos = road.geometry.attributes.position;
    for (let i = 0; i < pos.array.length; i++) {
      assert.ok(Number.isFinite(pos.array[i]), '路面の座標が有限');
    }

    // InstancedMesh の描画数が確保数を超えないこと
    // （超えると余ったインスタンスがゼロ行列のまま描かれ、画面に巨大な三角形が出る）
    group.traverse((o) => {
      if (!o.isInstancedMesh) return;
      assert.ok(
        o.count <= o.instanceMatrix.count,
        `${o.geometry.type} の描画数 ${o.count} が確保数 ${o.instanceMatrix.count} を超えている`
      );
      for (let i = 0; i < o.count * 16; i++) {
        assert.ok(Number.isFinite(o.instanceMatrix.array[i]), `${o.geometry.type} のインスタンス行列が有限`);
      }
    });
  });
}

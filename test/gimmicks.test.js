// コースのしかけ（ギミック）の検証。実際にカートを置いて、ちゃんと効くかを見る。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COURSES, getCourse } from '../src/data/courses.js';
import { getCharacter } from '../src/data/characters.js';
import { buildParams, createKartState } from '../src/race/KartPhysics.js';

// three.js のメッシュを作るので canvas のスタブを用意する
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
const { GimmickSystem } = await import('../src/race/Gimmicks.js');

const course = getCourse('factory');
const track = new Track(course);
const stubScene = { add() {}, remove() {} };
const stubParticles = { emit() {} };

function makeKart() {
  const char = getCharacter('taro');
  const params = buildParams(char, {});
  const state = createKartState();
  state.speed = 25;
  return { id: 'k', char, params, state, track, baseMaxSpeed: params.maxSpeed, items: [], roulette: null };
}

/** しかけの真上にカートを置く */
function placeOn(kart, g, latOffset = 0) {
  const h = g.node.rotation.y;
  kart.state.x = g.node.position.x + Math.cos(h) * latOffset;
  kart.state.z = g.node.position.z - Math.sin(h) * latOffset;
  kart.state.y = g.node.position.y;
  kart.state.heading = h;
  kart.state.moveHeading = h;
}

function makeSystem(karts, events) {
  return new GimmickSystem({ track, scene: stubScene, karts, events, particles: stubParticles, course });
}

test('からくり工場に 6 種類のしかけが置かれている', () => {
  const kinds = new Set(makeSystem([], []).items.map((g) => g.kind));
  for (const k of ['roller', 'gate', 'pendulum', 'geyser', 'fan', 'ring']) {
    assert.ok(kinds.has(k), `${k} が置かれていない`);
  }
  assert.ok(makeSystem([], []).items.length >= 10, 'しかけの数が少ない');
});

test('転がる丸太にぶつかるとスピンする', () => {
  const events = [];
  const k = makeKart();
  const sys = makeSystem([k], events);
  const g = sys.items.find((x) => x.kind === 'roller');
  // 丸太が中央に来る位相まで進める
  sys.update(0.001);
  placeOn(k, g, g.slider.position.x);
  sys.update(1 / 60);
  assert.ok(k.state.spinTime > 0, 'スピンしていない');
  assert.ok(events.some((e) => e.type === 'gimmickHit' && e.gimmick === 'roller'), 'イベントが出ていない');
});

test('丸太はジャンプで飛び越えられる', () => {
  const events = [];
  const k = makeKart();
  const sys = makeSystem([k], events);
  const g = sys.items.find((x) => x.kind === 'roller');
  sys.update(0.001);
  placeOn(k, g, g.slider.position.x);
  k.state.hop = 2.5; // 高く飛んでいる
  sys.update(1 / 60);
  assert.equal(k.state.spinTime, 0, '飛んでいるのに当たっている');
});

test('門は「動くすきま」で、位置が合えば通れる・外れると弾かれる', () => {
  const events = [];
  const k = makeKart();
  const sys = makeSystem([k], events);
  const g = sys.items.find((x) => x.kind === 'gate');
  let everBlocked = false;
  let everPassed = false;
  let minGap = Infinity;
  for (let i = 0; i < 400; i++) {
    sys.update(1 / 60);
    minGap = Math.min(minGap, g.gapHalf);
    // すきまのまん中にいれば通れる
    placeOn(k, g, g.center);
    k.state.spinTime = 0;
    k.state.stunTime = 0;
    const n0 = events.length;
    sys.update(0);
    if (events.length === n0) everPassed = true;
    // すきまから外れていれば弾かれる
    placeOn(k, g, g.center + (g.gapHalf + 3) * (g.center > 0 ? -1 : 1));
    k.state.spinTime = 0;
    k.state.stunTime = 0;
    const n1 = events.length;
    sys.update(0);
    if (events.length > n1) everBlocked = true;
  }
  assert.ok(everPassed, 'すきまのまん中にいても通れない');
  assert.ok(everBlocked, 'すきまから外れても弾かれない');
  assert.ok(minGap > 0.9 + 0.3, `すきまが狭すぎて通れない瞬間がある（最小 ${minGap.toFixed(2)}）`);
});

test('門のすきまは道を横切って動く', () => {
  const sys = makeSystem([], []);
  const g = sys.items.find((x) => x.kind === 'gate');
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 400; i++) {
    sys.update(1 / 60);
    lo = Math.min(lo, g.center);
    hi = Math.max(hi, g.center);
  }
  assert.ok(hi - lo > track.halfWidth, `すきまがあまり動いていない（${lo.toFixed(1)}〜${hi.toFixed(1)}）`);
});

test('ふりこは下にいるときだけ当たる', () => {
  const events = [];
  const k = makeKart();
  const sys = makeSystem([k], events);
  const g = sys.items.find((x) => x.kind === 'pendulum');
  // 鉄球が真下に来る瞬間をさがす
  let hit = false;
  for (let i = 0; i < 600 && !hit; i++) {
    sys.update(1 / 60);
    const bx = Math.sin(g.arm.rotation.z) * 7;
    placeOn(k, g, -bx);
    k.state.spinTime = 0;
    k.state.stunTime = 0;
    sys.update(0);
    hit = events.some((e) => e.gimmick === 'pendulum');
  }
  assert.ok(hit, '真下に来ても当たらない');
});

test('噴きだしに乗ると打ち上げられる', () => {
  const events = [];
  const k = makeKart();
  const sys = makeSystem([k], events);
  const g = sys.items.find((x) => x.kind === 'geyser');
  placeOn(k, g, 0);
  let launched = false;
  for (let i = 0; i < 600 && !launched; i++) {
    sys.update(1 / 60);
    placeOn(k, g, 0);
    launched = k.state.airborne && k.state.vy > 5;
  }
  assert.ok(launched, '打ち上げられない');
  assert.ok(events.some((e) => e.type === 'gimmickLaunch'), 'イベントが出ていない');
});

test('送風機の前を通ると横に押される', () => {
  const k = makeKart();
  const sys = makeSystem([k], []);
  const g = sys.items.find((x) => x.kind === 'fan');
  placeOn(k, g, 0);
  const x0 = k.state.x;
  const z0 = k.state.z;
  for (let i = 0; i < 30; i++) {
    sys.update(1 / 60);
    k.state.knockVx = 0; // 押された量だけを見る
    k.state.knockVz = 0;
  }
  const moved = Math.hypot(k.state.x - x0, k.state.z - z0);
  assert.ok(moved > 1, `押されていない（${moved.toFixed(2)}m）`);
});

test('光の輪をくぐるとダッシュできる', () => {
  const events = [];
  const k = makeKart();
  const sys = makeSystem([k], events);
  const g = sys.items.find((x) => x.kind === 'ring');
  placeOn(k, g, 0);
  sys.update(1 / 60);
  assert.ok(k.state.boostTime > 0.5, 'ダッシュしない');
  assert.ok(events.some((e) => e.type === 'gimmickBoost'), 'イベントが出ていない');
  // 続けて何度も効かない
  k.state.boostTime = 0;
  sys.update(1 / 60);
  assert.equal(k.state.boostTime, 0, '連続で効いてしまう');
});

test('しかけのないコースでは何も作られない', () => {
  for (const c of COURSES.filter((x) => x.id !== 'factory')) {
    const t2 = new Track(c);
    const sys = new GimmickSystem({ track: t2, scene: stubScene, karts: [], events: [], particles: stubParticles, course: c });
    assert.equal(sys.items.length, 0, `${c.id} にしかけができている`);
  }
});

test('周回で景色が変わるコースにテーマが 3 つある', () => {
  const c = getCourse('timeloop');
  assert.ok(Array.isArray(c.lapThemes) && c.lapThemes.length === 3, 'テーマが 3 つない');
  for (const th of c.lapThemes) {
    assert.ok(th.label, 'テーマに名前がない');
    assert.ok(th.palette && th.palette.skyTop !== undefined, 'テーマに空の色がない');
    assert.ok(th.palette.ground !== undefined && th.palette.road !== undefined, 'テーマに地面・路面の色がない');
  }
  // 3 つとも見た目がはっきり違うこと
  const skies = new Set(c.lapThemes.map((t) => t.palette.skyTop));
  const grounds = new Set(c.lapThemes.map((t) => t.palette.ground));
  assert.equal(skies.size, 3, '空の色が同じテーマがある');
  assert.equal(grounds.size, 3, '地面の色が同じテーマがある');
});

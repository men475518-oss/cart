// キャラクターボイスの検証。
// Web Audio のノードを記録するにせものの AudioContext を使い、
// 「8体がちゃんと別々の声になっているか」を実際に合成させて確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS } from '../src/data/characters.js';

// ---------- にせものの Web Audio ----------
function makeParam(log, node, name, value = 0) {
  return {
    value,
    setValueAtTime: (v, t) => log.push({ node, param: name, op: 'set', v, t }),
    linearRampToValueAtTime: (v, t) => log.push({ node, param: name, op: 'lin', v, t }),
    exponentialRampToValueAtTime: (v, t) => {
      assert.ok(v > 0, `${node}.${name}: 指数カーブに 0 以下（${v}）は渡せない`);
      log.push({ node, param: name, op: 'exp', v, t });
    },
    cancelScheduledValues: () => {},
  };
}

function fakeContext() {
  const log = [];
  const nodes = [];
  const connect = (to) => to;
  const mk = (kind, extra = {}) => {
    const n = { kind, connect, disconnect() {}, ...extra };
    nodes.push(n);
    return n;
  };
  const ctx = {
    currentTime: 10,
    sampleRate: 48000,
    state: 'running',
    destination: mk('destination'),
    resume() {},
    suspend() {},
    createGain: () => {
      const n = mk('gain');
      n.gain = makeParam(log, 'gain', 'gain', 1);
      return n;
    },
    createOscillator: () => {
      const n = mk('osc');
      n.type = 'sine';
      n.frequency = makeParam(log, 'osc', 'frequency', 440);
      n.detune = makeParam(log, 'osc', 'detune', 0);
      n.start = (t) => (n.startedAt = t);
      n.stop = (t) => (n.stoppedAt = t);
      return n;
    },
    createBiquadFilter: () => {
      const n = mk('filter');
      n.type = 'lowpass';
      n.frequency = makeParam(log, 'filter', 'frequency', 350);
      n.Q = makeParam(log, 'filter', 'Q', 1);
      return n;
    },
    createBufferSource: () => {
      const n = mk('bufsrc');
      n.buffer = null;
      n.start = (t) => (n.startedAt = t);
      n.stop = (t) => (n.stoppedAt = t);
      return n;
    },
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
  };
  return { ctx, log, nodes };
}

/** audio モジュールを読み込んで、にせものの context でアンロックする */
async function makeAudio() {
  const { ctx, log, nodes } = fakeContext();
  globalThis.window = { AudioContext: function () { return ctx; }, addEventListener() {} };
  globalThis.document = { addEventListener() {}, hidden: false, createElement: () => ({ style: {}, getContext: () => null }) };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  const mod = await import('../src/core/Audio.js?v=' + Math.random());
  const audio = mod.audio;
  audio.unlock();
  return { audio, ctx, log, nodes };
}

const KEYS = ['select', 'start', 'item', 'hit', 'drift', 'boost', 'pass', 'win', 'lose'];

test('8体すべてに声のパラメータとセリフがそろっている', () => {
  assert.equal(CHARACTERS.length, 8);
  for (const c of CHARACTERS) {
    const v = c.voice;
    assert.ok(v && v.cry, `${c.id}: cry がない`);
    assert.ok(v.base > 80 && v.base < 900, `${c.id}: base が変（${v.base}）`);
    assert.ok(['sine', 'square', 'triangle', 'sawtooth'].includes(v.timbre), `${c.id}: timbre が変`);
    const cry = v.cry;
    assert.ok(cry.formant >= 1 && cry.formant <= 5, `${c.id}: formant が変（${cry.formant}）`);
    assert.ok(cry.q > 0 && cry.q <= 20, `${c.id}: q が変`);
    assert.ok(cry.glide > 0.3 && cry.glide < 2, `${c.id}: glide が変`);
    assert.ok(cry.syl > 0.03 && cry.syl < 0.5, `${c.id}: 1音の長さが変`);
    for (const k of KEYS) assert.ok(c.lines[k] && c.lines[k].length > 0, `${c.id}: ${k} のセリフがない`);
  }
});

test('どのキャラのどの場面でも鳴き声が音を出す', async () => {
  const { audio, nodes } = await makeAudio();
  for (const c of CHARACTERS) {
    for (const k of KEYS) {
      const before = nodes.length;
      audio.voice(c, k, { minInterval: 0, noSpeech: true });
      const made = nodes.slice(before);
      const oscs = made.filter((n) => n.kind === 'osc');
      assert.ok(oscs.length > 0, `${c.id}/${k}: 音が出ていない`);
      for (const o of oscs) {
        assert.ok(typeof o.startedAt === 'number', `${c.id}/${k}: start されていない発振器がある`);
        assert.ok(o.stoppedAt > o.startedAt, `${c.id}/${k}: stop の時刻がおかしい`);
      }
    }
  }
});

test('8体の声はそれぞれ別物になっている', async () => {
  const { audio, log, nodes } = await makeAudio();
  const prints = new Map();
  for (const c of CHARACTERS) {
    const beforeLog = log.length;
    const beforeNodes = nodes.length;
    audio.voice(c, 'win', { minInterval: 0, noSpeech: true });
    const made = nodes.slice(beforeNodes);
    const entries = log.slice(beforeLog);
    const freqs = entries.filter((e) => e.node === 'osc' && e.param === 'frequency').map((e) => Math.round(e.v));
    const filters = entries.filter((e) => e.node === 'filter').map((e) => Math.round(e.v));
    prints.set(c.id, {
      timbre: made.find((n) => n.kind === 'osc')?.type,
      freqs: freqs.join(','),
      filters: filters.join(','),
      noise: made.filter((n) => n.kind === 'bufsrc').length, // 息の音の量
      oscs: made.filter((n) => n.kind === 'osc').length, // ビブラート・低音の重ね
    });
  }
  // 音程の並びが他とまるかぶりのキャラがいないこと
  const seen = new Map();
  for (const [id, p] of prints) {
    const sig = p.freqs + '|' + p.filters;
    assert.ok(!seen.has(sig), `${id} と ${seen.get(sig)} の声がまったく同じ`);
    seen.set(sig, id);
  }
  // 声色（波形・共鳴・息・重ね）の組み合わせも 8 体で 6 通り以上に散らばっていること
  const timbres = new Set([...prints.values()].map((p) => p.timbre));
  assert.ok(timbres.size >= 3, `波形の種類が少なすぎる（${timbres.size}）`);
  const combos = new Set([...prints.values()].map((p) => `${p.timbre}/${p.filters}/${p.noise > 0}/${p.oscs}`));
  assert.ok(combos.size >= 6, `声色の組み合わせが少なすぎる（${combos.size}/8）`);
});

test('同じキャラでも場面ごとに鳴き方が変わる', async () => {
  const { audio, log } = await makeAudio();
  const c = CHARACTERS.find((x) => x.id === 'taro');
  // 音程には毎回すこしゆらぎが入るので、絶対値ではなく
  // 「何音か」と「上がるか下がるか」の並びで比べる
  const contour = (freqs) => {
    const steps = [];
    for (let i = 1; i < freqs.length; i++) {
      const r = freqs[i] / freqs[i - 1];
      steps.push(Math.abs(r - 1) < 0.08 ? '=' : r > 1 ? '↑' : '↓');
    }
    return freqs.length + ':' + steps.join('');
  };
  const sigs = new Map();
  for (const k of KEYS) {
    const before = log.length;
    audio.voice(c, k, { minInterval: 0, noSpeech: true });
    const freqs = log
      .slice(before)
      .filter((e) => e.node === 'osc' && e.param === 'frequency' && e.op === 'set')
      .map((e) => e.v);
    sigs.set(k, contour(freqs));
  }
  const uniq = new Set(sigs.values());
  assert.ok(uniq.size >= 6, `場面ごとの鳴き分けが少ない（${uniq.size}/${KEYS.length}: ${[...sigs].map(([k, v]) => k + '=' + v).join(' ')}）`);
  // 勝ったときは上がっていき、負けたときは下がっていくこと
  assert.ok(sigs.get('win').includes('↑') && !sigs.get('win').includes('↓'), `勝ちの声が上がっていない（${sigs.get('win')}）`);
  assert.ok(sigs.get('lose').includes('↓') && !sigs.get('lose').includes('↑'), `負けの声が下がっていない（${sigs.get('lose')}）`);
});

test('連続で同じ場面を鳴らしても毎回まったく同じにはならない', async () => {
  const { audio, log } = await makeAudio();
  const c = CHARACTERS.find((x) => x.id === 'mint');
  const sigs = new Set();
  for (let i = 0; i < 8; i++) {
    const before = log.length;
    audio.voice(c, 'boost', { minInterval: 0, noSpeech: true });
    const freqs = log.slice(before).filter((e) => e.node === 'osc' && e.param === 'frequency' && e.op === 'set').map((e) => e.v.toFixed(1));
    sigs.add(freqs.join(','));
  }
  assert.ok(sigs.size >= 2, '毎回まったく同じ音になっている');
});

test('声を鳴らしすぎないよう間隔があく', async () => {
  const { audio, nodes } = await makeAudio();
  const c = CHARACTERS[0];
  const before = nodes.length;
  audio.voice(c, 'hit', { noSpeech: true }); // 既定の 2.5 秒間隔
  const first = nodes.length - before;
  audio.voice(c, 'hit', { noSpeech: true });
  assert.equal(nodes.length - before, first, '間隔をあけずに続けて鳴っている');
});

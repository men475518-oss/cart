// BGM パターンの検証。
// 曲は手続き型（音階の度数配列）なので、配列の形がくずれると
// 音が出ない・和音が合わないといった形で静かに壊れる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BGM_PATTERNS } from '../src/core/Audio.js';
import { COURSES } from '../src/data/courses.js';

test('コースが指定する BGM は必ず存在する', () => {
  for (const c of COURSES) {
    assert.ok(BGM_PATTERNS[c.bgm], `${c.id} の BGM「${c.bgm}」がない（無音になる）`);
  }
});

test('メニューとスターの BGM がある', () => {
  for (const id of ['menu', 'star']) assert.ok(BGM_PATTERNS[id], `${id} の BGM がない`);
});

for (const [id, d] of Object.entries(BGM_PATTERNS)) {
  test(`BGM ${id}: パターンの形が正しい`, () => {
    assert.ok(d.bpm >= 60 && d.bpm <= 220, `bpm ${d.bpm} が現実的でない`);
    assert.ok(d.scale.length >= 5, 'スケールが短すぎる');
    assert.equal(d.lead.length, 64, 'メロディは 16 分 × 4 小節ぶん');
    assert.equal(d.bass.length, 16, 'ベースは 1 小節ぶん');
    assert.equal(d.chords.length, 4, 'コードは 4 小節ぶん');
    for (const k of ['kick', 'snare', 'hat']) {
      assert.equal(d.drums[k].length, 16, `${k} は 16 ステップ`);
      assert.ok(d.drums[k].every((x) => x === 0 || x === 1), `${k} に 0/1 以外が入っている`);
    }
    // メニュー曲のスネア抜きのような意図的な省略はあるが、
    // キックとハットまで消えるとリズムがなくなる
    assert.ok(d.drums.kick.some((x) => x), 'キックが全部 0（リズムが消える）');
    assert.ok(d.drums.hat.some((x) => x), 'ハットが全部 0（リズムが消える）');
    // 度数が整数で、オクターブが飛びすぎていないこと
    for (const n of d.lead) assert.ok(n === null || (Number.isInteger(n) && n >= -14 && n <= 21), `メロディに変な度数 ${n}`);
    for (const n of d.bass) assert.ok(n === null || (Number.isInteger(n) && n >= -7 && n <= 14), `ベースに変な度数 ${n}`);
    for (const ch of d.chords) {
      assert.ok(ch.length >= 3, 'コードは 3 音以上');
      for (const n of ch) assert.ok(Number.isInteger(n), `コードに変な度数 ${n}`);
    }
    // メロディが休符だけではない
    assert.ok(d.lead.filter((x) => x !== null).length >= 16, 'メロディの音数が少なすぎる');
    for (const w of [d.leadWave, d.bassWave, d.padWave]) {
      assert.ok(['sine', 'square', 'triangle', 'sawtooth'].includes(w), `知らない波形 ${w}`);
    }
  });
}

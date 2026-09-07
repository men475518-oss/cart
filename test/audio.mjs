// 音の大きさの検証。実ブラウザで書き出して、エンジン音が他をかき消していないかを測る。
// 実行: npm run check:audio
import { launchChromium } from './browser.mjs';

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4173';
let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ✔ ' + msg : '  ✘ ' + msg);
  if (!cond) failures++;
};

const browser = await launchChromium(['--autoplay-policy=no-user-gesture-required']);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(BASE);
await page.waitForSelector('.title-screen');
await page.click('.title-screen'); // ここで AudioContext がアンロックされる
await page.waitForSelector('.mode-grid');

const rows = await page.evaluate(async () => {
  const audio = window.__audio;
  // BGM は鳴りつづけていて、測るために音の経路を差し替えると
  // 本物のノードを差し替え先につなごうとして落ちる。先に止めておく
  audio.stopBgm();
  const real = { ctx: audio.ctx, sfx: audio.sfxGain, bgm: audio.bgmGain, eng: audio.engineGain };
  /** OfflineAudioContext に書き出して大きさを測る */
  const measure = async (setup, sec = 1.5) => {
    const off = new OfflineAudioContext(1, 44100 * sec, 44100);
    audio.ctx = off;
    audio.sfxGain = off.createGain();
    audio.sfxGain.connect(off.destination);
    audio.bgmGain = off.createGain();
    audio.bgmGain.connect(off.destination);
    audio.engineGain = off.createGain();
    audio.engineGain.connect(audio.sfxGain);
    audio.engines = [];
    audio._applyEngineVolume();
    audio._noiseBuf = null;
    await setup(off);
    const d = (await off.startRendering()).getChannelData(0);
    let sq = 0;
    let peak = 0;
    for (let i = 0; i < d.length; i++) {
      sq += d[i] * d[i];
      peak = Math.max(peak, Math.abs(d[i]));
    }
    return { rms: Math.sqrt(sq / d.length), peak };
  };
  const out = {};
  const engineAt = (n, speed, throttle, drifting) => async () => {
    for (let i = 0; i < n; i++) audio.createEngine().update(speed, throttle, drifting, false);
  };
  out.engineFull = await measure(engineAt(1, 1, 1, false));
  out.engineIdle = await measure(engineAt(1, 0, 0, false));
  out.engineDrift = await measure(engineAt(1, 0.8, 1, true));
  out.engineFour = await measure(engineAt(4, 1, 1, false));
  out.sfxItem = await measure(async () => audio.sfx('itemGet'));
  out.sfxShell = await measure(async () => audio.sfx('shell'));
  out.sfxBoost = await measure(async () => audio.sfx('boost'));
  audio.ctx = real.ctx;
  audio.sfxGain = real.sfx;
  audio.bgmGain = real.bgm;
  audio.engineGain = real.eng;
  audio.engines = [];
  audio._noiseBuf = null;
  return out;
});

const f = (v) => v.toFixed(4).padStart(8);
console.log('■ 音の大きさ（RMS = 平均 / ピーク = 最大）');
for (const [k, v] of Object.entries(rows)) console.log('  ', k.padEnd(12), 'RMS', f(v.rms), ' ピーク', v.peak.toFixed(3).padStart(7));

// エンジンは鳴りっぱなしなので、単発の効果音より前に出てはいけない
const sfxPeak = Math.max(rows.sfxItem.peak, rows.sfxShell.peak, rows.sfxBoost.peak);
check(rows.engineFull.peak < sfxPeak, `エンジンのピークが効果音より小さい（${rows.engineFull.peak.toFixed(3)} < ${sfxPeak.toFixed(3)}）`);
check(rows.engineFull.rms < 0.06, `エンジンが大きすぎない（RMS ${rows.engineFull.rms.toFixed(4)} < 0.06）`);
const sfxRms = Math.max(rows.sfxItem.rms, rows.sfxShell.rms, rows.sfxBoost.rms);
check(
  rows.engineFull.rms < sfxRms * 6,
  `効果音に対して出しゃばりすぎない（効果音の ${(rows.engineFull.rms / sfxRms).toFixed(1)} 倍 / 6 倍未満）`
);
check(rows.engineFull.rms > 0.02, `エンジンが小さすぎない（RMS ${rows.engineFull.rms.toFixed(4)} > 0.02）`);
check(rows.engineIdle.rms < rows.engineFull.rms * 0.5, `止まっているときは静か（${rows.engineIdle.rms.toFixed(4)} / 全開 ${rows.engineFull.rms.toFixed(4)}）`);
check(rows.engineDrift.rms < rows.engineFull.rms * 1.2, 'ドリフトのスキール音が出しゃばらない');

// 画面分割で台数が増えても、音量が足し算で増えないこと
const ratio = rows.engineFour.rms / rows.engineFull.rms;
check(ratio < 2.6, `4 台でも音量が足し算にならない（1 台の ${ratio.toFixed(1)} 倍 / 4 倍未満）`);

check(errors.length === 0, `JS エラーなし${errors.length ? ': ' + errors[0] : ''}`);
await browser.close();
console.log(failures === 0 ? '\n✅ 音のバランス OK' : `\n❌ ${failures} 件の問題`);
process.exit(failures ? 1 : 0);

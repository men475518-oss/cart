// キャラクターボイスを実ブラウザで実際に鳴らして、音として別物になっているかを測る。
// OfflineAudioContext でレンダリングし、音程・長さ・明るさを比べる。
// 実行: npm run check:voice （事前に npm run build && npx vite preview --port 4173）
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
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

await page.goto(BASE);
await page.waitForSelector('.title-screen');
await page.click('.title-screen'); // ここで AudioContext がアンロックされる
await page.waitForSelector('.mode-grid');
await page.click('[data-mode=single]');
await page.waitForSelector('.char-grid');
await page.click('[data-act=next]');
await page.waitForSelector('.course-grid');
await page.click('.course-card[data-id="meadow"]');
await page.waitForSelector('.hud', { timeout: 90000 });
await page.waitForFunction(() => window.__app?.race?.state === 'racing', null, { timeout: 120000 });

/** 全キャラの鳴き声を OfflineAudioContext に書き出して測る */
const rows = await page.evaluate(async (key) => {
  const audio = window.__audio;
  const chars = window.__app.race.karts.map((k) => k.char);
  const realCtx = audio.ctx;
  const realGain = audio.sfxGain;
  const out = [];
  for (const c of chars) {
    const off = new OfflineAudioContext(1, 44100 * 2, 44100);
    audio.ctx = off;
    audio.sfxGain = off.createGain();
    audio.sfxGain.connect(off.destination);
    audio._noiseBuf = null;
    audio._crySeed = 12345; // ゆらぎを固定して比べる
    audio._cry(c, key);
    const d = (await off.startRendering()).getChannelData(0);
    let sq = 0, zc = 0, nonzero = 0, hi = 0, prev = 0;
    for (let i = 0; i < d.length; i++) {
      sq += d[i] * d[i];
      if (i > 0 && (d[i - 1] < 0) !== (d[i] < 0)) zc++;
      if (Math.abs(d[i]) > 0.002) nonzero++;
      const h = d[i] - prev;
      prev = d[i];
      hi += h * h;
    }
    out.push({
      id: c.id,
      species: c.species,
      rms: Math.sqrt(sq / d.length),
      pitch: Math.round((zc / d.length) * 44100), // ゼロ交差からのだいたいの音程
      dur: nonzero / 44100,
      bright: hi / Math.max(1e-12, sq), // 高域の多さ
    });
  }
  audio.ctx = realCtx;
  audio.sfxGain = realGain;
  audio._noiseBuf = null;
  return out;
}, 'win');

console.log('■ 勝ちの声を鳴らして測る');
console.log('   キャラ   種族        音量      音程      長さ    明るさ');
for (const r of rows) {
  console.log(
    '  ',
    r.id.padEnd(7),
    r.species.padEnd(9),
    r.rms.toFixed(5).padStart(8),
    (r.pitch + 'Hz').padStart(8),
    (r.dur.toFixed(2) + 's').padStart(7),
    r.bright.toFixed(4).padStart(8)
  );
}

check(rows.length === 8, `8体ぶん鳴った（${rows.length}）`);
check(rows.every((r) => r.rms > 0.0005), '無音のキャラがいない');
check(rows.every((r) => r.dur > 0.05), `短すぎる声がない（最短 ${Math.min(...rows.map((r) => r.dur)).toFixed(2)}s）`);

const pitches = rows.map((r) => r.pitch).sort((a, b) => a - b);
check(pitches[pitches.length - 1] / pitches[0] >= 4, `音程が高い子と低い子で 4 倍以上ひらいている（${pitches[0]}〜${pitches[pitches.length - 1]}Hz）`);

const brights = rows.map((r) => r.bright).sort((a, b) => a - b);
check(brights[brights.length - 1] / brights[0] >= 5, `声の明るさにも差がある（${brights[0].toFixed(4)}〜${brights[brights.length - 1].toFixed(4)}）`);

const durs = rows.map((r) => r.dur).sort((a, b) => a - b);
check(durs[durs.length - 1] / durs[0] >= 2, `鳴きの長さにも差がある（${durs[0].toFixed(2)}〜${durs[durs.length - 1].toFixed(2)}s）`);

// どの 2 体をとっても、音程・長さ・明るさのどれかがはっきり違うこと
let tooClose = null;
for (let i = 0; i < rows.length && !tooClose; i++) {
  for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    const near = (x, y, tol) => Math.abs(x - y) / Math.max(x, y, 1e-9) < tol;
    if (near(a.pitch, b.pitch, 0.15) && near(a.dur, b.dur, 0.2) && near(a.bright, b.bright, 0.3)) {
      tooClose = `${a.id} と ${b.id}`;
      break;
    }
  }
}
check(!tooClose, tooClose ? `${tooClose} の声が似すぎている` : 'どの2体をくらべても声が区別できる');

// 場面ごとの鳴き分け（同じキャラで win と lose と hit を比べる）
const shapes = await page.evaluate(async () => {
  const audio = window.__audio;
  const c = window.__app.race.karts.find((k) => k.isHuman).char; // 毎回おなじキャラで比べる
  const realCtx = audio.ctx, realGain = audio.sfxGain;
  const out = {};
  for (const key of ['win', 'lose', 'hit', 'drift']) {
    const off = new OfflineAudioContext(1, 44100 * 2, 44100);
    audio.ctx = off;
    audio.sfxGain = off.createGain();
    audio.sfxGain.connect(off.destination);
    audio._noiseBuf = null;
    audio._crySeed = 999;
    audio._cry(c, key);
    const d = (await off.startRendering()).getChannelData(0);
    // バッファの大半は無音なので、鳴っている区間だけを取り出して前半と後半を比べる
    let lo = 0, hi = d.length - 1;
    while (lo < d.length && Math.abs(d[lo]) < 0.002) lo++;
    while (hi > lo && Math.abs(d[hi]) < 0.002) hi--;
    const mid = Math.floor((lo + hi) / 2);
    const zcr = (from, to) => {
      let z = 0, n = 0;
      for (let i = from + 1; i < to; i++) {
        if (Math.abs(d[i]) < 0.002) continue;
        n++;
        if ((d[i - 1] < 0) !== (d[i] < 0)) z++;
      }
      return n > 200 ? (z / n) * 44100 : -1; // だいたいの音程 (Hz)。区間が短すぎるときは -1
    };
    out[key] = { first: zcr(lo, mid), second: zcr(mid, hi), id: c.id, span: +((hi - lo) / 44100).toFixed(2) };
  }
  audio.ctx = realCtx;
  audio.sfxGain = realGain;
  audio._noiseBuf = null;
  return out;
});
console.log('■ 場面ごとの鳴き分け（' + shapes.win.id + '）');
for (const [k, v] of Object.entries(shapes)) {
  console.log(`   ${k.padEnd(6)} 前半 ${Math.round(v.first)}Hz → 後半 ${Math.round(v.second)}Hz  （鳴っている長さ ${v.span}s）`);
}
const measured = (v) => v.first > 0 && v.second > 0;
check(measured(shapes.win) && measured(shapes.lose), '前半・後半とも測れるだけ鳴っている');
check(
  measured(shapes.win) && shapes.win.second > shapes.win.first * 1.15,
  `勝ちの声は最後に上がる（${Math.round(shapes.win.first)}Hz → ${Math.round(shapes.win.second)}Hz）`
);
check(
  measured(shapes.lose) && shapes.lose.second < shapes.lose.first * 0.87,
  `負けの声は最後に下がる（${Math.round(shapes.lose.first)}Hz → ${Math.round(shapes.lose.second)}Hz）`
);

check(errors.length === 0, `JS エラーなし${errors.length ? ': ' + errors[0] : ''}`);
await browser.close();
console.log(failures === 0 ? '\n✅ キャラごとに声がちゃんと違う' : `\n❌ ${failures} 件の問題`);
process.exit(failures ? 1 : 0);

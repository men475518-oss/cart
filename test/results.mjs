// リザルト画面の検証。表彰台が順位表のパネルに隠れていないかを、
// 3D の位置を画面座標に投影して確かめる。
// 実行: npm run check:results
import { launchChromium } from './browser.mjs';

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4173';
let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ✔ ' + msg : '  ✘ ' + msg);
  if (!cond) failures++;
};

const browser = await launchChromium(['--autoplay-policy=no-user-gesture-required']);
for (const [name, vp] of [
  ['横画面', { width: 1280, height: 720 }],
  ['縦画面', { width: 390, height: 844 }],
]) {
  console.log('■', name);
  const ctx = await browser.newContext({ viewport: vp, hasTouch: name === '縦画面', isMobile: name === '縦画面' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(() => localStorage.setItem('mofukart.settings.v1', JSON.stringify({ laps: 1, bgmVolume: 0, sfxVolume: 0, voice: false })));
  await page.goto(BASE);
  await page.waitForSelector('.title-screen');
  await page.click('.title-screen');
  await page.waitForSelector('.mode-grid');
  await page.click('[data-mode=single]');
  await page.waitForSelector('.char-grid');
  await page.click('[data-act=next]');
  await page.waitForSelector('.course-grid');
  await page.click('.course-card[data-id="meadow"]');
  await page.waitForSelector('.hud', { timeout: 90000 });
  await page.waitForFunction(() => window.__app?.race?.state === 'racing', null, { timeout: 120000 });
  // 全員をゴール直前まで進めてリザルトへ
  await page.evaluate(() => {
    const r = window.__app.race;
    for (const k of r.karts) k.state.totalProgress = r.track.N * r.laps + 5;
  });
  await page.keyboard.down('ArrowUp');
  await page.waitForSelector('.results-screen', { timeout: 120000 });
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(2500);

  const info = await page.evaluate(() => {
    const res = window.__app.results;
    const cam = res.camera;
    const cv = document.querySelector('#game');
    const W = cv.clientWidth, H = cv.clientHeight;
    const panel = document.querySelector('.results-panel').getBoundingClientRect();
    // 表彰台の上位 3 台を画面座標へ投影する
    const top3 = res.anims.filter((a) => a.rank <= 3).sort((a, b) => a.rank - b.rank);
    const pts = top3.map((a) => {
      const v = a.model.group.position.clone();
      v.y += 1.0; // カートの中ほど
      v.project(cam);
      return { rank: a.rank, id: a.char.id, x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H, z: v.z };
    });
    const rows = [...document.querySelectorAll('.res-row')].map((r) => r.querySelector('.res-name').textContent);
    return { pts, W, H, panel: { l: panel.left, t: panel.top, r: panel.right, b: panel.bottom }, rows, names: top3.map((a) => a.char.name) };
  });

  check(info.rows.length === 8, `順位表が 8 行（${info.rows.length}）`);
  check(
    info.names.every((n, i) => n === info.rows[i]),
    `表彰台の 3 台が 1〜3 位と一致（台: ${info.names.join(',')} / 表: ${info.rows.slice(0, 3).join(',')}）`
  );
  for (const p of info.pts) {
    const onScreen = p.z < 1 && p.x > 0 && p.x < info.W && p.y > 0 && p.y < info.H;
    check(onScreen, `${p.rank}位が画面内にいる（x=${Math.round(p.x)} y=${Math.round(p.y)}）`);
    const hidden = p.x > info.panel.l && p.x < info.panel.r && p.y > info.panel.t && p.y < info.panel.b;
    check(!hidden, `${p.rank}位が順位表のパネルに隠れていない`);
  }
  check(errors.length === 0, `JS エラーなし${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}
await browser.close();
console.log(failures === 0 ? '\n✅ リザルトの表彰台がちゃんと見えている' : `\n❌ ${failures} 件の問題`);
process.exit(failures ? 1 : 0);

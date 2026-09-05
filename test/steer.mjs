// タッチのハンドルが指の動きどおりに効くかを確かめる
import { launchChromium } from './browser.mjs';

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4173';
let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ✔ ' + msg : '  ✘ ' + msg);
  if (!cond) failures++;
};

const browser = await launchChromium(['--autoplay-policy=no-user-gesture-required']);
for (const [name, viewport] of [['縦画面', { width: 390, height: 844 }], ['横画面', { width: 844, height: 390 }]]) {
  console.log('■', name);
  const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.waitForSelector('.title-screen');
  await page.tap('.title-screen');
  await page.waitForSelector('.mode-grid');
  await page.tap('[data-mode=single]');
  await page.waitForSelector('.char-grid');
  await page.tap('[data-act=next]');
  await page.waitForSelector('.course-grid');
  await page.tap('.course-card[data-id="meadow"]');
  await page.waitForSelector('.hud', { timeout: 90000 });
  await page.waitForFunction(() => window.__app?.race?.state === 'racing', null, { timeout: 120000 });

  const zone = await page.locator('.tc-steer').boundingBox();
  const cx = zone.x + zone.width / 2;
  const cy = zone.y + zone.height / 2;
  const steer = () => page.evaluate(() => +window.__app.race.viewports[0].hud.touch.state.steer.toFixed(3));

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  check((await steer()) === 0, '触れただけでは切れない');

  await page.mouse.move(cx + 5, cy);
  check(Math.abs(await steer()) < 0.01, '5px の手ぶれは遊びの中（切れない）');

  await page.mouse.move(cx + 40, cy);
  const half = await steer();
  check(half > 0.2 && half < 0.8, `40px 動かすと中くらい（${half}）`);

  await page.mouse.move(cx + 90, cy);
  check((await steer()) === 1, '90px 動かすと右いっぱい');

  // いっぱいまで切ったあと戻すと、すぐに効きが戻る（中心が指についてくる）
  await page.mouse.move(cx + 50, cy);
  const back = await steer();
  check(back > 0 && back < 0.9, `戻すとすぐゆるむ（${back}）`);

  await page.mouse.move(cx - 200, cy);
  check((await steer()) === -1, '大きく戻すと左いっぱい');

  await page.mouse.up();
  check((await steer()) === 0, '指を離すとまっすぐ');

  // ハンドルが指の位置に出てくる
  const tx = zone.x + zone.width * 0.75;
  const ty = zone.y + zone.height * 0.3;
  await page.mouse.move(tx, ty);
  await page.mouse.down();
  const w = await page.locator('.tc-wheel').boundingBox();
  const dist = Math.hypot(w.x + w.width / 2 - tx, w.y + w.height / 2 - ty);
  check(dist < 8, `ハンドルが指の位置に出る（ずれ ${dist.toFixed(0)}px）`);
  await page.mouse.up();

  // ボタンがハンドル領域と重なっていない
  const boxes = await page.evaluate(() =>
    ['.tc-steer', '.tc-accel', '.tc-drift', '.tc-item'].map((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { s, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
    })
  );
  const sz = boxes[0];
  for (const b of boxes.slice(1)) {
    const over = b.l < sz.r && b.r > sz.l && b.t < sz.b && b.b > sz.t;
    check(!over, `${b.s} がハンドル領域と重ならない`);
    check(Math.min(b.w, b.h) >= 44, `${b.s} が押しやすい大きさ（${Math.round(b.w)}×${Math.round(b.h)}）`);
    check(b.r <= viewport.width && b.b <= viewport.height && b.l >= 0 && b.t >= 0, `${b.s} が画面内に収まる`);
  }
  check(errors.length === 0, `JS エラーなし${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}
await browser.close();
console.log(failures === 0 ? '\n✅ タッチ操作 OK' : `\n❌ ${failures} 件の問題`);
process.exit(failures ? 1 : 0);

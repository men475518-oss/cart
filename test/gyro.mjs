// ジャイロ操作の検証。deviceorientation を作って流しこみ、
// 画面の向きごとに正しい方向へ曲がるか・手ぶれで曲がらないかを確かめる。
// 実行: npm run check:gyro
import { launchChromium } from './browser.mjs';

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4173';
let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ✔ ' + msg : '  ✘ ' + msg);
  if (!cond) failures++;
};

const browser = await launchChromium(['--autoplay-policy=no-user-gesture-required']);
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.addInitScript(() => {
  localStorage.setItem('mofukart.settings.v1', JSON.stringify({ gyro: true, bgmVolume: 0, sfxVolume: 0, voice: false }));
  // 画面の向きをテストから差し替えられるようにしておく
  window.__angle = 0;
  Object.defineProperty(window, 'orientation', { get: () => window.__angle, configurable: true });
});
await page.goto(BASE);
await page.waitForSelector('.title-screen');
await page.click('.title-screen');
await page.waitForSelector('.mode-grid');

/** 傾きを流しこんで、そのときのハンドルの値を返す */
const tilt = (deg, angle, axis) =>
  page.evaluate(
    ([deg, angle, axis]) => {
      window.__angle = angle;
      if (screen.orientation) Object.defineProperty(screen.orientation, 'angle', { get: () => angle, configurable: true });
      const inp = window.__app.input;
      const ev = new Event('deviceorientation');
      // gamma = 左右の傾き / beta = 前後の傾き
      Object.defineProperty(ev, 'gamma', { value: axis === 'gamma' ? deg : 0 });
      Object.defineProperty(ev, 'beta', { value: axis === 'beta' ? deg : 0 });
      window.dispatchEvent(ev);
      return inp.gyro.steer;
    },
    [deg, angle, axis]
  );
const settle = async (deg, angle, axis) => {
  let v = 0;
  for (let i = 0; i < 25; i++) v = await tilt(deg, angle, axis); // なまし込みが落ち着くまで
  return v;
};
const recal = () => page.evaluate(() => window.__app.input.requestGyroCalibration());

console.log('■ 有効になっているか');
const on = await page.evaluate(() => window.__app.input.gyro.enabled);
check(on, 'ジャイロが有効');

console.log('■ 持ち方を基準にする');
await recal();
await settle(35, 0, 'gamma'); // 35度傾けた状態を「まっすぐ」として遊びはじめる
const atRest = await settle(35, 0, 'gamma');
check(Math.abs(atRest) < 0.05, `寝ころんだ持ち方でもまっすぐ走る（${atRest.toFixed(3)}）`);

console.log('■ 手ぶれ');
const shake = await settle(35 + 2.5, 0, 'gamma');
check(Math.abs(shake) < 0.05, `2.5度のゆれでは曲がらない（${shake.toFixed(3)}）`);

console.log('■ 傾けた向きへ曲がる（画面の向きごと）');
for (const [name, angle, axis, sign] of [
  ['縦画面', 0, 'gamma', 1],
  ['横画面（右回し）', 90, 'beta', 1],
  ['横画面（左回し）', 270, 'beta', -1],
  ['さかさま', 180, 'gamma', -1],
]) {
  await recal();
  await settle(0, angle, axis);
  const right = await settle(30 * sign, angle, axis);
  const left = await settle(-30 * sign, angle, axis);
  check(right > 0.6, `${name}: 右に倒すと右へ（${right.toFixed(2)}）`);
  check(left < -0.6, `${name}: 左に倒すと左へ（${left.toFixed(2)}）`);
}

console.log('■ 傾きの大きさに応じて効く');
await recal();
await settle(0, 0, 'gamma');
const small = await settle(10, 0, 'gamma');
const big = await settle(30, 0, 'gamma');
check(small > 0.05 && small < big * 0.8, `少し傾ければ少しだけ曲がる（10度 ${small.toFixed(2)} / 30度 ${big.toFixed(2)}）`);
check(big >= 0.95, `いっぱい傾ければいっぱい曲がる（${big.toFixed(2)}）`);

console.log('■ 左右反転の設定');
await page.evaluate(() => window.__settings.set('gyroInvert', true));
await recal();
await settle(0, 0, 'gamma');
const inv = await settle(30, 0, 'gamma');
check(inv < -0.6, `反転をオンにすると逆に曲がる（${inv.toFixed(2)}）`);
await page.evaluate(() => window.__settings.set('gyroInvert', false));

console.log('■ 切ったら止まる');
await page.evaluate(() => window.__app.input.disableGyro());
const off = await settle(30, 0, 'gamma');
check(off === 0, `切るとハンドルが戻る（${off}）`);

check(errors.length === 0, `JS エラーなし${errors.length ? ': ' + errors[0] : ''}`);
await browser.close();
console.log(failures === 0 ? '\n✅ ジャイロ操作 OK' : `\n❌ ${failures} 件の問題`);
process.exit(failures ? 1 : 0);

// E2E スモークテスト（Playwright + headless Chromium / SwiftShader）
// 事前に: npx vite preview --port 4173 と node server/index.js を起動
// 実行:   node test/smoke.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4173';
const OUT = process.env.SMOKE_OUT || 'test/screenshots';
// 対戦サーバーの接続先。Cloudflare Worker 版を試すときは 127.0.0.1:8788 を指定する
const GAME_SERVER = process.env.SMOKE_SERVER || '127.0.0.1:8787';
// SMOKE_ONLY=online のように指定すると、その場面だけ実行する
const ONLY = process.env.SMOKE_ONLY || '';
const runs = (name) => !ONLY || ONLY === name;
const EXE = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
fs.mkdirSync(OUT, { recursive: true });

const args = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
const browser = await chromium.launch({ executablePath: EXE, args });
let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ✔', msg);
  else {
    console.log('  ✘', msg);
    failures++;
  }
};

async function newPage(ctxOpts = {}, name = 'page') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...ctxOpts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  page.errors = errors;
  page.ctxName = name;
  return page;
}

async function toMode(page) {
  await page.goto(BASE);
  await page.waitForSelector('.title-screen');
  await page.click('.title-screen');
  await page.waitForSelector('.mode-grid');
}

async function pickCharacter(page, charId) {
  await page.waitForSelector('.char-grid');
  if (charId) await page.click(`.char-card[data-id="${charId}"]`);
  await page.click('[data-act=next]');
}

async function waitRace(page) {
  await page.waitForSelector('.hud', { timeout: 90000 });
  // ソフトウェア描画では FPS が非常に低いので長めに待つ
  await page.waitForFunction(() => window.__app && window.__app.race && window.__app.race.state === 'racing', null, { timeout: 120000 });
}

// ---------- 1. ひとりで遊ぶ（キーボード操作 + HUD） ----------
if (runs('single')) {
  console.log('■ single race');
  const page = await newPage({}, 'single');
  await toMode(page);
  await page.screenshot({ path: `${OUT}/01-mode.png` });
  await page.click('.mode-card[data-mode=single]');
  await page.waitForSelector('.char-grid');
  await page.click('.char-card[data-id="mint"]');
  await page.screenshot({ path: `${OUT}/02-character.png` });
  await page.click('[data-act=next]');
  await page.waitForSelector('.course-grid');
  await page.screenshot({ path: `${OUT}/03-course.png` });
  await page.click('.course-card[data-id="meadow"]');
  await page.waitForSelector('.hud', { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/04-intro.png` });
  await page.keyboard.down('ArrowUp');
  await waitRace(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/05-race-start.png` });
  // 走らせる（ハンドルは CPU のように自動補正: 定期的に左右）
  // ソフトウェアレンダリングでは FPS が低いので、シミュレーション時間で 12 秒走らせる
  while ((await page.evaluate(() => window.__app.race.time)) < 12) {
    const info = await page.evaluate(() => {
      const r = window.__app.race;
      const k = r.karts.find((x) => x.isHuman);
      const s = k.state;
      const ts = r.track.sample(s.trackIndex + 10);
      const desired = Math.atan2(ts.pos.x - s.x, ts.pos.z - s.z);
      let d = desired - s.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return { d, speed: s.speed, idx: s.trackIndex, lap: s.lap, rank: k.rank, items: k.items.length };
    });
    if (info.d > 0.08) {
      // heading を増やす = 左折
      await page.keyboard.up('ArrowRight');
      await page.keyboard.down('ArrowLeft');
    } else if (info.d < -0.08) {
      await page.keyboard.up('ArrowLeft');
      await page.keyboard.down('ArrowRight');
    } else {
      await page.keyboard.up('ArrowRight');
      await page.keyboard.up('ArrowLeft');
    }
    if (info.items > 0) await page.keyboard.press('Space');
    await page.waitForTimeout(100);
  }
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('ArrowLeft');
  await page.screenshot({ path: `${OUT}/06-race-mid.png` });
  const st = await page.evaluate(() => {
    const r = window.__app.race;
    const k = r.karts.find((x) => x.isHuman);
    return { speed: k.state.speed, progress: k.state.totalProgress, karts: r.karts.length, hazards: r.items.hazards.length, rank: k.rank, time: r.time, hudRank: document.querySelector('.hud-pos-num').textContent, lap: document.querySelector('.hud-lap-cur').textContent, aiProgress: r.karts.filter((x) => x.isAI).map((x) => Math.round(x.state.totalProgress)) };
  });
  console.log('  state:', JSON.stringify(st));
  check(st.karts === 8, '8 karts on track');
  check(st.speed > 20, `human kart is moving (speed ${st.speed.toFixed(1)})`);
  check(st.progress > 100, `human kart progressed (${st.progress.toFixed(0)} samples)`);
  check(st.aiProgress.every((p) => p > 100), `all CPU karts progressed (${st.aiProgress.join(',')})`);
  check(String(st.rank) === st.hudRank, 'HUD rank matches');
  // ポーズ → 再開
  await page.keyboard.down('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.up('Escape');
  await page.waitForSelector('.pause-overlay');
  await page.screenshot({ path: `${OUT}/07-pause.png` });
  await page.click('[data-act=resume]');
  check(await page.evaluate(() => !window.__app.race.paused), 'resume works');
  // レース終了までワープしてリザルト確認
  await page.evaluate(() => {
    const r = window.__app.race;
    for (const k of r.karts) k.state.totalProgress = r.laps * r.track.N + 5;
  });
  await page.waitForSelector('.results-screen', { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/08-results.png` });
  const rows = await page.$$eval('.res-row', (els) => els.length);
  check(rows === 8, `results table has 8 rows (${rows})`);
  await page.click('[data-act=title]');
  await page.waitForSelector('.title-screen');
  check(page.errors.length === 0, 'no console/page errors (single)');
  if (page.errors.length) console.log(page.errors.slice(0, 10));
  await page.context().close();
}

// ---------- 2. ローカル 2 人 画面分割（モバイル縦画面・タッチ） ----------
if (runs('local')) {
  console.log('■ local split-screen (mobile portrait, touch)');
  const page = await newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, 'local');
  await toMode(page);
  await page.click('.mode-card[data-mode=local]');
  await page.click('.mode-card[data-n="2"]');
  await pickCharacter(page, 'pyon');
  await pickCharacter(page, 'don');
  await page.waitForSelector('.course-grid');
  await page.click('.course-card[data-id="snow"]');
  await page.waitForSelector('.hud', { timeout: 20000 });
  const huds = await page.$$eval('.hud', (els) => els.map((e) => ({ flip: e.classList.contains('flip'), touch: !!e.querySelector('.touch-controls') })));
  console.log('  huds:', JSON.stringify(huds));
  check(huds.length === 2, '2 HUD viewports');
  check(huds.every((h) => h.touch), 'touch controls in each viewport');
  // タッチでアクセル（P2 の下画面）
  await waitRace(page);
  const accel = (await page.$$('.tc-accel'))[1];
  const box = await accel.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/09-split-portrait.png` });
  const sp = await page.evaluate(() => window.__app.race.karts.filter((k) => k.isHuman).map((k) => +k.state.speed.toFixed(1)));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  console.log('  human speeds:', sp);
  check(sp[1] > 10, 'touch accel moves P2 kart');
  check(sp[0] < 1, 'P1 (no input) stays still');
  check(page.errors.length === 0, 'no console/page errors (local)');
  if (page.errors.length) console.log(page.errors.slice(0, 10));
  await page.context().close();
}

// ---------- 3. 4 人分割 横画面 + 火山 ----------
if (runs('local4')) {
  console.log('■ local 4 players landscape');
  const page = await newPage({ viewport: { width: 800, height: 450 } }, 'local4');
  await toMode(page);
  await page.click('.mode-card[data-mode=local]');
  await page.click('.mode-card[data-n="4"]');
  for (const c of ['taro', 'moco', 'hino', 'hoo']) await pickCharacter(page, c);
  await page.click('.course-card[data-id="volcano"]');
  await waitRace(page);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/10-split4.png` });
  const n = await page.$$eval('.hud', (els) => els.length);
  check(n === 4, '4 HUD viewports');
  check(page.errors.length === 0, 'no console/page errors (local4)');
  if (page.errors.length) console.log(page.errors.slice(0, 10));
  await page.context().close();
}

// ---------- 4. オンライン: 部屋作成 → 参加 → レース → 状態同期 ----------
if (runs('online')) {
  console.log('■ online private match');
  const mk = async (name) => {
    const page = await newPage({}, name);
    await page.addInitScript((SERVER) => localStorage.setItem('mofukart.settings.v1', JSON.stringify({ serverUrl: SERVER, playerName: '' })), GAME_SERVER);
    await toMode(page);
    await page.click('.mode-card[data-mode=online]');
    await page.waitForSelector('.online-screen');
    await page.fill('#ol-name', name);
    return page;
  };
  const A = await mk('ホストさん');
  const B = await mk('ゲストさん');
  await A.click('[data-act=create]');
  await A.waitForSelector('.room-panel:not([style*="display: none"]) .room-code', { timeout: 10000 });
  const code = (await A.textContent('.room-code')).trim();
  console.log('  room code', code);
  check(code.length === 4, 'room code received');
  await B.fill('#ol-code', code);
  await B.click('[data-act=join]');
  await B.waitForSelector('.room-panel:not([style*="display: none"])', { timeout: 10000 });
  await B.click('[data-act=ready]');
  await A.waitForFunction(() => !document.querySelector('[data-act=start]').disabled, null, { timeout: 10000 });
  await A.screenshot({ path: `${OUT}/11-lobby.png` });
  await A.selectOption('#ol-course', 'city');
  await A.click('[data-act=start]');
  await Promise.all([waitRace(A), waitRace(B)]);
  await A.keyboard.down('ArrowUp');
  await B.keyboard.down('ArrowUp');
  await A.waitForTimeout(4000);
  await A.screenshot({ path: `${OUT}/12-online-A.png` });
  await B.screenshot({ path: `${OUT}/13-online-B.png` });
  const stA = await A.evaluate(() => {
    const r = window.__app.race;
    return { karts: r.karts.length, ai: r.karts.filter((k) => k.isAI).length, remote: r.karts.filter((k) => k.remote).length, remoteMoved: r.karts.filter((k) => k.remote && k.netTarget).length, mySpeed: r.karts.find((k) => k.isHuman).state.speed };
  });
  const stB = await B.evaluate(() => {
    const r = window.__app.race;
    return { karts: r.karts.length, ai: r.karts.filter((k) => k.isAI).length, remote: r.karts.filter((k) => k.remote).length, remoteMoved: r.karts.filter((k) => k.remote && k.netTarget && Math.abs(k.state.speed) > 5).length, mySpeed: r.karts.find((k) => k.isHuman).state.speed };
  });
  console.log('  A:', JSON.stringify(stA), ' B:', JSON.stringify(stB));
  check(stA.karts === 8 && stB.karts === 8, 'both clients have 8 karts');
  check(stA.ai === 6 && stA.remote === 1, 'host runs 6 CPUs and sees 1 remote');
  check(stB.ai === 0 && stB.remote === 7, 'guest sees 7 remote karts');
  check(stB.remoteMoved >= 6, `guest receives moving remote states (${stB.remoteMoved})`);
  check(stA.remoteMoved === 1, 'host receives guest state');
  await A.keyboard.up('ArrowUp');
  await B.keyboard.up('ArrowUp');
  // 全員ゴール → サーバー結果
  for (const p of [A, B]) await p.evaluate(() => {
    const r = window.__app.race;
    for (const k of r.karts) if (!k.remote) k.state.totalProgress = r.laps * r.track.N + 5;
  });
  await Promise.all([A.waitForSelector('.results-screen', { timeout: 40000 }), B.waitForSelector('.results-screen', { timeout: 40000 })]);
  await A.waitForTimeout(800);
  await A.screenshot({ path: `${OUT}/14-online-results.png` });
  const rowsA = await A.$$eval('.res-row', (els) => els.length);
  check(rowsA === 8, `online results has 8 rows (${rowsA})`);
  check(A.errors.length === 0 && B.errors.length === 0, 'no console/page errors (online)');
  if (A.errors.length) console.log('A', A.errors.slice(0, 10));
  if (B.errors.length) console.log('B', B.errors.slice(0, 10));
  await A.context().close();
  await B.context().close();
}

await browser.close();
console.log(failures === 0 ? '\n✅ smoke OK' : `\n❌ ${failures} check(s) failed`);
process.exit(failures ? 1 : 0);

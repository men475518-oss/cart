// タッチ操作だけで各コースを 1 周できるかを確かめる。
// 自動アクセル（片手プレイ）を有効にして、ハンドルとドリフトボタンだけで走らせる。
// 実行: npm run check:drive   （事前に npm run build && npx vite preview --port 4173）
import { launchChromium } from './browser.mjs';
import { COURSES } from '../src/data/courses.js';

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4173';
const ONLY = process.env.DRIVE_COURSE || '';
// DRIVE_NODRIFT=1 でドリフトを使わずに走る（ドリフトが速いかを比べるため）
const NODRIFT = !!process.env.DRIVE_NODRIFT;

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ✔ ' + msg : '  ✘ ' + msg);
  if (!cond) failures++;
};

const browser = await launchChromium(['--autoplay-policy=no-user-gesture-required']);

for (const course of COURSES) {
  if (ONLY && course.id !== ONLY) continue;
  console.log('■', course.name);
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(() => {
    // 片手プレイ（自動アクセル）。音は鳴らさない
    localStorage.setItem('mofukart.settings.v1', JSON.stringify({ autoAccel: true, bgmVolume: 0, sfxVolume: 0, voice: false }));
  });
  await page.goto(BASE);
  await page.waitForSelector('.title-screen');
  await page.tap('.title-screen');
  await page.waitForSelector('.mode-grid');
  await page.tap('[data-mode=single]');
  await page.waitForSelector('.char-grid');
  await page.tap('[data-act=next]');
  await page.waitForSelector('.course-grid');
  await page.tap(`.course-card[data-id="${course.id}"]`);
  await page.waitForSelector('.hud', { timeout: 90000 });
  await page.waitForFunction(() => window.__app?.race?.state === 'racing', null, { timeout: 120000 });

  // 本物の pointerdown でキャプチャを取り、以降はページ内から pointermove を流す
  const zone = await page.locator('.tc-steer').boundingBox();
  const cx = Math.round(zone.x + zone.width / 2);
  const cy = Math.round(zone.y + zone.height / 2);
  await page.evaluate(() => {
    window.__pid = null;
    document.querySelector('.tc-steer').addEventListener('pointerdown', (e) => (window.__pid = e.pointerId), { once: true });
  });
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(80);

  const noDrift = NODRIFT;
  const stats = await page.evaluate(async ([cx, cy, noDrift]) => {
    const r = window.__app.race;
    const zone = document.querySelector('.tc-steer');
    const drift = document.querySelector('.tc-drift');
    const k = r.karts.find((x) => x.isHuman);
    const track = r.track;
    const TRAVEL = 78, DEAD = 7;
    const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
    // 12 サンプル先のコース中央をねらう単純な運転
    const steerFor = () => {
      const s = k.state;
      const q = track.query({ x: s.x, y: s.y, z: s.z }, s.trackIndex);
      const ahead = track.samples[(q.index + 12) % track.N].pos;
      const diff = wrap(Math.atan2(ahead.x - s.x, ahead.z - s.z) - s.heading);
      return { steer: Math.max(-0.98, Math.min(0.98, -diff * 2.4)), q };
    };
    const send = (steer) => {
      const dx = steer === 0 ? 0 : Math.sign(steer) * (DEAD + Math.abs(steer) * (TRAVEL - DEAD));
      zone.dispatchEvent(new PointerEvent('pointermove', { pointerId: window.__pid, clientX: cx + dx, clientY: cy, bubbles: true, cancelable: true }));
    };
    const driftBtn = (down) => {
      const type = down ? 'pointerdown' : 'pointerup';
      drift.dispatchEvent(new PointerEvent(type, { pointerId: 99, clientX: 0, clientY: 0, bubbles: true, cancelable: true }));
    };
    // グリッドはスタートラインの手前なので、まず 1 周目に入るのを待つ
    for (let i = 0; i < 4000 && k.state.lap < 1; i++) {
      await new Promise((res) => requestAnimationFrame(res));
      send(steerFor().steer);
    }
    const st = { walls: 0, offroad: 0, frames: 0, miniTurbo: 0, driftFrames: 0, maxCharge: 0, maxTier: -1 };
    const startLap = k.state.lap;
    const t0 = r.time;
    let holding = false;
    let wasDrifting = -1;
    let heldSince = 0;
    while (k.state.lap === startLap && r.time - t0 < 120 && st.frames < 20000) {
      await new Promise((res) => requestAnimationFrame(res));
      const { steer, q } = steerFor();
      send(steer);
      // コーナーではドリフトボタンを握る。ドリフト中はカート自身が曲がってくれるぶん
      // ハンドルを戻すので、ハンドルの量ではなくコーナーの長さで握りつづける
      const fast = k.state.speed > k.params.maxSpeed * 0.45;
      const want = noDrift
        ? false
        : holding
          ? fast && (r.time - heldSince < 1.4 || Math.abs(steer) > 0.2)
          : fast && Math.abs(steer) > 0.45;
      if (want !== holding) {
        holding = want;
        if (want) heldSince = r.time;
        driftBtn(want);
      }
      st.frames++;
      if (q.surface === 'offroad') st.offroad++;
      if (q.surface === 'wall') st.walls++;
      if (k.state.drifting) {
        st.driftFrames++;
        st.maxCharge = Math.max(st.maxCharge, k.state.driftCharge);
        st.maxTier = Math.max(st.maxTier, k.state.driftTier);
        wasDrifting = k.state.driftTier;
      } else if (wasDrifting >= 0) {
        st.miniTurbo++; // ミニターボが出る段まで貯めてからドリフトを抜けた
        wasDrifting = -1;
      }
    }
    if (holding) driftBtn(false);
    return {
      ...st,
      lap: +(r.time - t0).toFixed(1),
      maxCharge: +st.maxCharge.toFixed(2),
      finished: k.state.lap > startLap,
      offroadPct: Math.round((st.offroad / Math.max(1, st.frames)) * 100),
      driftPct: Math.round((st.driftFrames / Math.max(1, st.frames)) * 100),
    };
  }, [cx, cy, noDrift]);
  await page.mouse.up();

  check(stats.finished, `タッチ操作だけで 1 周できる（${stats.lap} 秒）`);
  check(stats.walls <= 3, `壁に当たるのは 3 回まで（${stats.walls} 回）`);
  check(stats.offroadPct <= 25, `コース外に出るのは 25% まで（${stats.offroadPct}%）`);
  if (!NODRIFT) {
    check(stats.driftFrames > 0, `ドリフトボタンでドリフトに入れる（${stats.driftPct}%）`);
    check(stats.miniTurbo > 0, `ミニターボが出る（${stats.miniTurbo} 回 / 最大チャージ ${stats.maxCharge} 段 ${stats.maxTier}）`);
  }
  check(errors.length === 0, `JS エラーなし${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}
await browser.close();
console.log(failures === 0 ? '\n✅ タッチ操作で全コース走れる' : `\n❌ ${failures} 件の問題`);
process.exit(failures ? 1 : 0);

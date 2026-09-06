// 追加した 2 ステージの検証。
//  - めぐりめぐる遺跡: 1 周ごとに景色（空・地面・路面・ライト）がまるごと入れかわる
//  - からくり工場: しかけが置かれ、実際に動いている
// 実行: npm run check:stages
import { launchChromium } from './browser.mjs';

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4173';
let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ✔ ' + msg : '  ✘ ' + msg);
  if (!cond) failures++;
};

const browser = await launchChromium(['--autoplay-policy=no-user-gesture-required']);

async function enter(page, courseId) {
  await page.goto(BASE);
  await page.waitForSelector('.title-screen');
  await page.click('.title-screen');
  await page.waitForSelector('.mode-grid');
  await page.click('[data-mode=single]');
  await page.waitForSelector('.char-grid');
  await page.click('[data-act=next]');
  await page.waitForSelector('.course-grid');
  const exists = (await page.$(`.course-card[data-id="${courseId}"]`)) !== null;
  check(exists, `コース一覧に ${courseId} がある`);
  await page.click(`.course-card[data-id="${courseId}"]`);
  await page.waitForSelector('.hud', { timeout: 90000 });
  await page.waitForFunction(() => window.__app?.race?.state === 'racing', null, { timeout: 120000 });
}

// ---------- 1周ごとに景色が変わるコース ----------
{
  console.log('■ めぐりめぐる遺跡（1周ごとに場所が変わる）');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(() => localStorage.setItem('mofukart.settings.v1', JSON.stringify({ bgmVolume: 0, sfxVolume: 0, voice: false })));
  await enter(page, 'timeloop');

  const snap = () =>
    page.evaluate(() => {
      const r = window.__app.race;
      return {
        n: r.sceneries.length,
        index: r.themeIndex,
        labels: r.sceneries.map((s) => s.label),
        visibleScenery: r.sceneries.map((s) => s.group.visible),
        visibleTrack: r.sceneries.map((s) => s.mesh.visible),
        sky: r.scene.background.getHex(),
        fog: r.scene.fog.color.getHex(),
        sun: r.lights.sun.color.getHex(),
        sunPower: +r.lights.sun.intensity.toFixed(3),
      };
    });

  const a = await snap();
  check(a.n === 3, `景色が 3 つ用意されている（${a.n}）`);
  check(a.labels.every((l) => l), `それぞれに名前がある（${a.labels.join(' / ')}）`);
  check(a.visibleScenery.filter(Boolean).length === 1, '出ている景色はいつも 1 つだけ');
  check(a.visibleTrack.filter(Boolean).length === 1, '出ている路面もいつも 1 つだけ');

  const seen = [a];
  for (let i = 1; i < 3; i++) {
    await page.evaluate((i) => window.__app.race._setTheme(i), i);
    seen.push(await snap());
  }
  for (let i = 1; i < 3; i++) {
    check(seen[i].index === i, `${i + 1} 周目の景色に切り替わる`);
    check(seen[i].visibleScenery[i] && seen[i].visibleTrack[i], `${i + 1} 周目は ${i + 1} 番目の景色と路面だけが出ている`);
  }
  check(new Set(seen.map((s) => s.sky)).size === 3, `空の色が 3 通りとも変わる（${seen.map((s) => s.sky.toString(16)).join(',')}）`);
  check(new Set(seen.map((s) => s.fog)).size === 3, '遠くのかすみの色も変わる');
  check(new Set(seen.map((s) => `${s.sun}:${s.sunPower}`)).size >= 2, `日ざしの色や強さも変わる（${seen.map((s) => s.sun.toString(16)).join(',')}）`);

  // 実際に周回すると切り替わること（ラップイベント経由）
  await page.evaluate(() => window.__app.race._setTheme(0));
  const after = await page.evaluate(async () => {
    const r = window.__app.race;
    const k = r.karts.find((x) => x.isHuman);
    r.events.push({ type: 'lap', kart: k, lap: 1 });
    await new Promise((res) => setTimeout(res, 300));
    return r.themeIndex;
  });
  check(after === 1, `1 周まわると次の景色に変わる（${after}）`);
  check(errors.length === 0, `JS エラーなし${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

// ---------- しかけだらけのコース ----------
{
  console.log('■ からくり工場（しかけだらけ）');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(() => localStorage.setItem('mofukart.settings.v1', JSON.stringify({ bgmVolume: 0, sfxVolume: 0, voice: false })));
  await enter(page, 'factory');

  const info = await page.evaluate(() => {
    const r = window.__app.race;
    const g = r.gimmicks;
    return { kinds: g.items.map((x) => x.kind), inScene: r.scene.children.includes(g.group), children: g.group.children.length };
  });
  const uniq = [...new Set(info.kinds)];
  check(uniq.length >= 6, `しかけが 6 種類以上ある（${uniq.join(',')}）`);
  check(info.kinds.length >= 10, `しかけの数が 10 個以上（${info.kinds.length}）`);
  check(info.inScene && info.children === info.kinds.length, 'しかけが画面に置かれている');

  // 時間を進めると実際に動く
  const moved = await page.evaluate(() => {
    const g = window.__app.race.gimmicks;
    const pick = (kind) => g.items.find((x) => x.kind === kind);
    const before = {
      roller: pick('roller').slider.position.x,
      gate: pick('gate').doors[0].mesh.position.x,
      pendulum: pick('pendulum').arm.rotation.z,
      fan: pick('fan').blades.rotation.x,
    };
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    return {
      roller: Math.abs(pick('roller').slider.position.x - before.roller),
      gate: Math.abs(pick('gate').doors[0].mesh.position.x - before.gate),
      pendulum: Math.abs(pick('pendulum').arm.rotation.z - before.pendulum),
      fan: Math.abs(pick('fan').blades.rotation.x - before.fan),
    };
  });
  check(moved.roller > 0.5, `丸太が転がって動く（${moved.roller.toFixed(2)}）`);
  check(moved.gate > 0.5, `門が開け閉めする（${moved.gate.toFixed(2)}）`);
  check(moved.pendulum > 0.1, `ふりこがふれる（${moved.pendulum.toFixed(2)}）`);
  check(moved.fan > 1, `送風機の羽根がまわる（${moved.fan.toFixed(2)}）`);

  // 噴きだしは周期的に出たり消えたりする
  const jet = await page.evaluate(() => {
    const g = window.__app.race.gimmicks;
    const gy = g.items.find((x) => x.kind === 'geyser');
    let on = 0, off = 0;
    for (let i = 0; i < 400; i++) {
      g.update(1 / 60);
      if (gy.jet.visible) on++;
      else off++;
    }
    return { on, off };
  });
  check(jet.on > 20 && jet.off > 20, `噴きだしが出たり止まったりする（出 ${jet.on} / 止 ${jet.off} フレーム）`);
  check(errors.length === 0, `JS エラーなし${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? '\n✅ 追加した 2 ステージ OK' : `\n❌ ${failures} 件の問題`);
process.exit(failures ? 1 : 0);

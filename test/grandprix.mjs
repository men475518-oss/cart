// グランプリの画面遷移の検証。
// レースそのものは走らせず、リザルトを合成して「1 戦おわり → 中間順位 →
// つぎの戦 → 表彰式 → メニューへ戻る」の流れだけを実際のコードで通す。
// ここは片づけ漏れが起きやすく、前のレースや表彰台が次の画面に
// 残ったままになる（実際にそのバグが出た）。
// 実行: npm run check:grandprix
import { launchChromium } from './browser.mjs';

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4173';
let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ✔ ' + msg : '  ✘ ' + msg);
  if (!cond) failures++;
};

const browser = await launchChromium(['--autoplay-policy=no-user-gesture-required']);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.addInitScript(() => localStorage.setItem('mofukart.settings.v1', JSON.stringify({ bgmVolume: 0, sfxVolume: 0, voice: false })));

/** いま画面に何が残っているか */
const snapshot = () =>
  page.evaluate(() => {
    const app = window.__app;
    const game = document.getElementById('game');
    return {
      screen: app.screen?.el?.className || null,
      hasRace: !!app.race,
      hasResults: !!app.results,
      inRace: app.appEl.classList.contains('in-race'),
      canvasVisible: getComputedStyle(game).display !== 'none',
      resultPanels: document.querySelectorAll('.results-screen').length,
      // リザルト画面自身も .screen なので、メニュー系の画面だけ数える
      menuScreens: document.querySelectorAll('#ui-root > .screen:not(.results-screen)').length,
      standings: document.querySelectorAll('.standings-screen').length,
      hudChildren: document.getElementById('hud-root').childElementCount,
      bgm: app.__bgmId ?? null,
      gp: app.gp ? { index: app.gp.index, races: app.gp.cup.courses.length } : null,
    };
  });

/** いま走っているレースを、順位を決め打ちして終わらせる */
const finishRace = () =>
  page.evaluate(() => {
    const app = window.__app;
    const results = app.gp.entries.map((e, i) => ({
      id: e.id, rank: i + 1, char: e.char, name: e.name,
      isHuman: e.isHuman, isLocal: true, time: 60 + i, bestLap: 20,
    }));
    app.showResults(results, app.lastConfig, {});
  });

async function enterCup() {
  await page.goto(BASE);
  await page.waitForSelector('.title-screen');
  await page.click('.title-screen');
  await page.waitForSelector('.mode-grid');
  await page.click('[data-mode=grandprix]');
  await page.waitForSelector('.cup-grid');
  await page.click('.cup-card');
  await page.waitForSelector('.char-grid');
  await page.click('[data-act=next]');
  await page.waitForSelector('.hud', { timeout: 90000 });
  await page.waitForFunction(() => window.__app?.race?.state === 'racing', null, { timeout: 120000 });
}

console.log('■ グランプリ 1 戦目 → 中間順位');
await enterCup();
const racing = await snapshot();
check(racing.hasRace, 'レースが始まっている');
check(racing.gp && racing.gp.index === 0, `第 1 戦から始まる（${racing.gp?.index}）`);
const races = racing.gp.races;

await finishRace();
await page.waitForSelector('.standings-panel', { timeout: 20000 });
await page.waitForTimeout(400);
const standings = await snapshot();
check(!standings.hasRace, '順位表ではレースが片づいている');
check(!standings.inRace, '順位表で #game を出したままにしない');
check(!standings.canvasVisible, '消したレースの最後の 1 コマが背景に残らない');
check(standings.hudChildren === 0, 'レース中の HUD が残らない');
check(standings.resultPanels === 0, 'リザルトのパネルが残らない');

console.log('■ つぎの戦へ');
await page.click('.standings-screen .btn.primary');
await page.waitForSelector('.hud', { timeout: 90000 });
await page.waitForFunction(() => window.__app?.race?.state === 'racing', null, { timeout: 120000 });
const race2 = await snapshot();
check(race2.hasRace, 'つぎのレースが始まる');
check(race2.gp.index === 1, `第 2 戦になっている（${race2.gp.index}）`);
check(race2.inRace && race2.canvasVisible, 'レース中は #game が出ている');

console.log('■ 最終戦 → 表彰式');
// 残りの戦を飛ばして最終戦にする
await page.evaluate((n) => (window.__app.gp.index = n - 1), races);
await finishRace();
await page.waitForSelector('.standings-panel', { timeout: 20000 });
await page.click('.standings-screen .btn.primary');
await page.waitForSelector('[data-act="again"]', { timeout: 20000 });
await page.waitForTimeout(500);
const ceremony = await snapshot();
check(ceremony.hasResults, '表彰式が出ている');
check(ceremony.inRace && ceremony.canvasVisible, '表彰台の 3D を出すために #game を出しなおす');
check(ceremony.menuScreens === 0, `表彰式のうしろにメニューが残らない（${ceremony.menuScreens} 枚）`);
check(ceremony.standings === 0, '順位表が表彰式のうしろに残らない');
check(ceremony.resultPanels === 1, `表彰台のパネルは 1 枚だけ（${ceremony.resultPanels} 枚）`);

console.log('■ 表彰式からカップ選択へ戻る');
await page.click('[data-act="again"]');
await page.waitForSelector('.cup-grid', { timeout: 20000 });
await page.waitForTimeout(600);
const back = await snapshot();
check(!back.hasResults, '表彰台を片づけている');
check(!back.inRace, '#game を出したままにしない');
check(!back.canvasVisible, '表彰台がカップ選択の背景に残らない');
check(back.resultPanels === 0, `古いリザルトのパネルが残らない（${back.resultPanels} 枚）`);
check(back.menuScreens === 1, `メニューの画面が 1 枚だけ（${back.menuScreens} 枚）`);
check(back.gp === null, 'グランプリの進行状態を片づけている');

console.log('■ 表彰式からタイトルへ戻る');
await enterCup();
await page.evaluate((n) => (window.__app.gp.index = n - 1), races);
await finishRace();
await page.waitForSelector('.standings-panel', { timeout: 20000 });
await page.click('.standings-screen .btn.primary');
await page.waitForSelector('[data-act="title"]', { timeout: 20000 });
await page.click('[data-act="title"]');
await page.waitForSelector('.title-screen', { timeout: 20000 });
await page.waitForTimeout(600);
const title = await snapshot();
check(!title.hasResults && !title.canvasVisible, 'タイトルにも表彰台が残らない');
check(title.resultPanels === 0, 'タイトルに古いパネルが残らない');
check(title.gp === null, 'グランプリの進行状態を片づけている');

console.log('■ 中間順位から「やめる」');
await enterCup();
await finishRace();
await page.waitForSelector('.standings-panel', { timeout: 20000 });
await page.click('.standings-screen .btn:not(.primary)');
await page.waitForSelector('.title-screen', { timeout: 20000 });
await page.waitForTimeout(400);
const quit = await snapshot();
check(!quit.hasRace && !quit.canvasVisible, 'やめたあとにレースが残らない');
check(quit.gp === null, 'グランプリの進行状態を片づけている');

check(errors.length === 0, `JS エラーなし${errors.length ? ': ' + errors[0] : ''}`);
await browser.close();
console.log(failures === 0 ? '\n✅ グランプリの行き来 OK' : `\n❌ ${failures} 件の問題`);
process.exit(failures ? 1 : 0);

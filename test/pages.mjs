// GitHub Pages と同じ「サブパス配信」でビルド結果が動くかを検証する。
// 使い方: npm run build && npm run check:pages
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, '..', 'dist');
const PREFIX = process.env.PAGES_PREFIX || '/cart'; // 公開先と同じサブパス
const PORT = Number(process.env.PAGES_PORT || 4180);
const OUT = path.join(ROOT, 'screenshots');
const EXE = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/ がありません。先に `npm run build` を実行してください。');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (!p.startsWith(PREFIX)) {
    res.writeHead(404);
    return res.end('outside base path');
  }
  p = p.slice(PREFIX.length) || '/';
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(DIST, p);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('not found: ' + p);
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}${PREFIX}/`;
console.log('配信中:', BASE);

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ✔ ' + msg : '  ✘ ' + msg);
  if (!cond) failures++;
};

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const badRequests = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
page.on('requestfailed', (r) => badRequests.push(`${r.url()} :: ${r.failure()?.errorText}`));
page.on('response', (r) => r.status() >= 400 && badRequests.push(`${r.status()} ${r.url()}`));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.title-screen', { timeout: 30000 });
check(true, 'タイトル画面が表示される（真っ白にならない）');
await page.screenshot({ path: path.join(OUT, '20-pages-title.png') });

await page.click('.title-screen');
await page.waitForSelector('.mode-grid', { timeout: 15000 });
check(true, 'モード選択に進める');

await page.click('.mode-card[data-mode=single]');
await page.waitForSelector('.char-grid');
await page.click('[data-act=next]');
await page.waitForSelector('.course-grid');
await page.click('.course-card[data-id="meadow"]');
await page.waitForSelector('.hud', { timeout: 90000 });
await page.keyboard.down('ArrowUp');
await page.waitForFunction(() => window.__app?.race?.state === 'racing', null, { timeout: 180000 });
await page.waitForFunction(() => window.__app.race.time > 5, null, { timeout: 180000 });
const st = await page.evaluate(() => {
  const r = window.__app.race;
  const k = r.karts.find((x) => x.isHuman);
  return { karts: r.karts.length, speed: +k.state.speed.toFixed(1) };
});
await page.keyboard.up('ArrowUp');
await page.screenshot({ path: path.join(OUT, '21-pages-race.png') });
check(st.karts === 8 && st.speed > 20, `サブパス配信でレースが動く（速度 ${st.speed}）`);

const scopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope));
check(scopes.some((s) => s.endsWith(PREFIX + '/')), `Service Worker のスコープが ${PREFIX}/ になる（${scopes.join(',') || 'なし'}）`);

check(badRequests.length === 0, `404 / 読み込み失敗なし${badRequests.length ? ': ' + badRequests.slice(0, 5).join(' | ') : ''}`);
check(errors.length === 0, `JS エラーなし${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);

await browser.close();
server.close();
console.log(failures === 0 ? '\n✅ GitHub Pages 相当の配信で正常に動作' : `\n❌ ${failures} 件の問題`);
process.exit(failures ? 1 : 0);

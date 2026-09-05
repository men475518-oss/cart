import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// NetClient.isStaticHost と同じ判定ロジック（location に依存せず検証する）
const STATIC_RE = /(\.github\.io|\.gitlab\.io|\.netlify\.app|\.pages\.dev|\.vercel\.app|\.web\.app|\.firebaseapp\.com|\.surge\.sh)$/;

test('静的ホスティングのドメインを判定できる', () => {
  for (const h of ['men475518-oss.github.io', 'foo.netlify.app', 'bar.pages.dev', 'baz.vercel.app', 'qux.gitlab.io']) {
    assert.ok(STATIC_RE.test(h), `${h} は静的ホスティングと判定されるべき`);
  }
  for (const h of ['localhost', '127.0.0.1', '192.168.1.10', 'mofukart.example.com', 'my-app.onrender.com']) {
    assert.equal(STATIC_RE.test(h), false, `${h} は静的ホスティングと判定されないべき`);
  }
});

test('NetClient に静的ホスティング用の分岐が実装されている', async () => {
  const src = await readFile(new URL('../src/net/NetClient.js', import.meta.url), 'utf8');
  assert.ok(src.includes('export function isStaticHost'));
  assert.ok(src.includes('export function hasServerConfigured'));
  assert.ok(src.includes('github\\.io'), 'github.io を判定対象に含むこと');
});

test('ビルド設定と HTML が相対パス配信になっている', async () => {
  const vite = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /base:\s*'\.\/'/, 'vite の base が相対パスであること');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!/(src|href)="\//.test(html), `index.html に絶対パス参照が残っている: ${html.match(/(src|href)="\/[^"]*"/g)}`);
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.start_url, './');
  for (const icon of manifest.icons) assert.ok(icon.src.startsWith('./'), `${icon.src} は相対パスであること`);
  const sw = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("new URL('./', self.location)"), 'Service Worker が自身の場所を基準にすること');
});

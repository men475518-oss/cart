// ブラウザテスト用の Chromium を探す。
//
// 依存は playwright-core にしている。ブラウザを同梱しないので `npm install` が軽く、
// Cloudflare Workers Builds や GitHub Actions でのビルドが速く・失敗しにくい。
// そのかわり実行ファイルの場所はこちらで見つける。
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

export function findChromium() {
  for (const p of CANDIDATES) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/** ソフトウェア描画でも 3D が動くようにした Chromium を起動する */
export async function launchChromium(extraArgs = []) {
  const executablePath = findChromium();
  if (!executablePath) {
    throw new Error(
      'Chromium / Google Chrome が見つかりませんでした。\n' +
        'Chrome をインストールするか、環境変数 CHROMIUM_PATH に実行ファイルのパスを指定してください。\n' +
        '（このテストはブラウザを同梱しない playwright-core を使っています）'
    );
  }
  return chromium.launch({
    executablePath,
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      ...extraArgs,
    ],
  });
}

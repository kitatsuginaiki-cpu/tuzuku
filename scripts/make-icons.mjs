// アプリアイコンを生成する（Playwright の Chromium で SVG/HTML を描画して PNG 化）。
// 使い方: node scripts/make-icons.mjs   （出力: public/icons/）
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = 'public/icons';
mkdirSync(out, { recursive: true });

// 「つ」＋緑の「。」をモチーフにしたシンプルなマーク
const mark = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#F7F7F4"/>
  <g transform="translate(256 256) scale(${1 - pad}) translate(-256 -256)">
    <text x="236" y="330" text-anchor="middle" font-family="Noto Sans CJK JP, Noto Sans JP, Hiragino Sans, sans-serif"
      font-weight="800" font-size="270" fill="#142B45">つ</text>
    <circle cx="372" cy="340" r="30" fill="none" stroke="#427C67" stroke-width="18"/>
  </g>
</svg>`;

writeFileSync(`${out}/icon.svg`, mark(0).trim());

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function render(svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `${out}/${file}`, omitBackground: false });
}
await render(mark(0), 192, 'icon-192.png');
await render(mark(0), 512, 'icon-512.png');
await render(mark(0.22), 512, 'icon-maskable-512.png'); // セーフゾーン内に収める
await render(mark(0.06), 180, 'apple-touch-icon.png');
await browser.close();
console.log('icons written to', out);

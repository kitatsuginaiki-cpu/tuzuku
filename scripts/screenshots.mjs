// 主要画面のスクリーンショットを docs/screenshots/ に保存する（v5 デザインとの見比べ用）。
// 前提: `npm run build && npm run preview` で http://localhost:4173 が起動していること。
// 表示内容はスクリーンショット用の一時データであり、実際の学習記録ではありません（毎回新しいブラウザで作成）。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const OUT = 'docs/screenshots';
mkdirSync(OUT, { recursive: true });
const NOW = new Date('2026-11-01T10:00:00+09:00');

const browser = await chromium.launch();
async function newPage(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const page = await ctx.newPage();
  await page.clock.install({ time: NOW.getTime() - 1000 });
  await page.clock.pauseAt(NOW);
  await page.goto(BASE);
  await page.locator('.screen').waitFor();
  return page;
}
const closeToasts = async (page) => {
  while (await page.locator('.toast-close').count()) await page.locator('.toast-close').first().click();
};
const shot = async (page, name) => {
  await page.waitForTimeout(250);
  await closeToasts(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' });
};
async function setNext(page, text) {
  await page.locator('.next-body').click();
  await page.locator('#edit-text').fill(text);
  await page.getByRole('button', { name: '保存する' }).click();
  await closeToasts(page);
}

for (const [w, h, tag] of [
  [390, 844, 'mobile'],
  [1440, 900, 'desktop'],
]) {
  const p = await newPage(w, h);
  await shot(p, `${tag}-01-first-run`);
  await setNext(p, '仕訳の基本を3問解く');
  await p.mouse.move(0, 0);
  await shot(p, `${tag}-02-home`);
  await p.getByRole('button', { name: '学習を始める' }).click();
  await p.clock.runFor(5 * 60_000);
  await shot(p, `${tag}-03-timer`);
  await p.getByRole('button', { name: '中断' }).click();
  await shot(p, `${tag}-03b-interrupt`);
  await p.keyboard.press('Escape');
  await p.clock.runFor(15 * 60_000);
  await p.getByRole('button', { name: '学習を終える' }).click();
  await p.locator('#next').fill('続きの仕訳を3問解く');
  await shot(p, `${tag}-04-finish`);
  await p.goto(`${BASE}#records`);
  await shot(p, `${tag}-06-records-empty`);
  await p.close();
}

// 再開ホーム・記録あり（スクリーンショット用の一時データ）
for (const [w, h, tag] of [
  [390, 844, 'mobile'],
  [1440, 900, 'desktop'],
]) {
  const p = await newPage(w, h);
  await setNext(p, '問題集 第12章の続き');
  await p.goto(`${BASE}#records`);
  for (const [date, min, title] of [
    ['2026-10-27', 25, '講義#14を見る'],
    ['2026-10-29', 40, '問題集 第11章'],
  ]) {
    await p.getByRole('button', { name: '計測しなかった学習を記録する' }).click();
    await p.locator('#rec-date').fill(date);
    await p.locator('#rec-min').fill(String(min));
    await p.locator('#rec-title').fill(title);
    await p.getByRole('button', { name: '記録する', exact: true }).click();
    await closeToasts(p);
  }
  await shot(p, `${tag}-07-records-list`);
  await p.goto(`${BASE}#`);
  await p.mouse.move(0, 0);
  await shot(p, `${tag}-05-resume`);
  await p.goto(`${BASE}#options`);
  await shot(p, `${tag}-08-settings`);
  await p.close();
}
await browser.close();
console.log('saved to', OUT);

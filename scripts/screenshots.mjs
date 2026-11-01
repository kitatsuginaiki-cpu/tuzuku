// 主要画面のスクリーンショットを docs/screenshots/ に保存する（設計画像との見比べ用）。
// 前提: `npm run build && npm run preview` で http://localhost:4173 が起動していること。
// 表示内容はスクリーンショット用の一時データ（毎回新しいブラウザで作成）であり、実際の学習記録ではありません。
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const OUT = 'docs/screenshots';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const NOW = new Date('2026-11-01T13:10:00+09:00');
const MIN = 60_000;

const browser = await browser_();
async function browser_() {
  return chromium.launch();
}
async function newPage(width, height, time = NOW) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const page = await ctx.newPage();
  await page.clock.install({ time: time.getTime() - 1000 });
  await page.clock.pauseAt(time);
  await page.goto(BASE);
  await page.locator('.screen').waitFor();
  return page;
}
const closeToasts = async (page) => {
  while (await page.locator('.toast-close').count()) await page.locator('.toast-close').first().click();
};
const shot = async (page, name, full = false) => {
  await page.waitForTimeout(200);
  await closeToasts(page);
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled', fullPage: full });
};
async function setupPlan(p) {
  await p.goto(`${BASE}#plan`);
  await p.locator('#plan-cue').fill('昼食後にコーヒーを淹れたら');
  await p.locator('#plan-nextAction').fill('第11章の仕訳問題を3問解く');
  await p.locator('#plan-smallAction').fill('1問だけ解く');
  await p.getByRole('button', { name: 'プランを保存' }).click();
  await p.locator('.home').waitFor();
}
async function manual(p, date, min, title) {
  await p.goto(`${BASE}#records`);
  await p.getByRole('button', { name: '計測しなかった学習を記録する' }).click();
  await p.locator('#rec-date').fill(date);
  await p.locator('#rec-min').fill(String(min));
  await p.locator('#rec-title').fill(title);
  await p.getByRole('button', { name: '記録する', exact: true }).click();
  await closeToasts(p);
}

for (const [w, h, tag] of [
  [390, 844, 'mobile'],
  [1440, 900, 'desktop'],
]) {
  // 1. 初回
  const p = await newPage(w, h);
  await shot(p, `${tag}-01-first-run`);
  // 2. プラン設定
  await p.goto(`${BASE}#plan`);
  await p.locator('#plan-cue').fill('昼食後にコーヒーを淹れたら');
  await p.locator('#plan-nextAction').fill('第11章の仕訳問題を3問解く');
  await p.locator('#plan-smallAction').fill('1問だけ解く');
  await shot(p, `${tag}-02-plan`, true);
  await p.getByRole('button', { name: 'プランを保存' }).click();
  await p.locator('.home').waitFor();
  // 3. ホーム（プランあり）
  await shot(p, `${tag}-03-home`);
  // 4. 学習中
  await p.getByRole('button', { name: 'この一手を始める' }).click();
  await p.clock.runFor(5 * MIN);
  await shot(p, `${tag}-04-timer`);
  // 5. 学習終了（しおりを挟む）
  await p.clock.runFor(15 * MIN);
  await p.getByRole('button', { name: '学習を終える' }).click();
  await p.getByRole('radio', { name: 'はい' }).click();
  await shot(p, `${tag}-05-finish`, true);
  await p.getByRole('button', { name: '続き：第11章の仕訳問題を3問解く' }).click();
  await p.getByRole('button', { name: '保存して終了' }).click();
  await p.locator('.home').waitFor();
  await shot(p, `${tag}-06-home-bookmarked`);
  // 小さな一手で開始
  await p.getByRole('button', { name: '小さく始める' }).click();
  await p.clock.runFor(5 * MIN + 10_000);
  await shot(p, `${tag}-07-small-over`);
  await p.close();

  // 再開・見直し（スクリーンショット用の一時データ）
  const q = await newPage(w, h);
  await setupPlan(q);
  await manual(q, '2026-10-24', 25, '講義#14を見る');
  await manual(q, '2026-10-29', 40, '問題集 第11章');
  await q.goto(BASE);
  await shot(q, `${tag}-08-resume`);
  await q.goto(`${BASE}#review`);
  await q.getByRole('radio', { name: 'きっかけを変える' }).check();
  await shot(q, `${tag}-09-review`, true);
  await q.goto(`${BASE}#records`);
  await shot(q, `${tag}-10-records`, true);
  await q.goto(`${BASE}#options`);
  await shot(q, `${tag}-11-settings`, true);
  await q.close();
}
await browser.close();
console.log('saved to', OUT);

import { expect, type Page } from '@playwright/test';

/** テスト基準時刻：2026-11-01 10:00 JST（日曜） */
export const NOW = new Date('2026-11-01T10:00:00+09:00');

export async function open(page: Page, path = '/') {
  // 時計を止めた状態で開始し、runFor() で明示的に進める（実時間のずれを排除）
  await page.clock.install({ time: NOW.getTime() - 1000 });
  await page.clock.pauseAt(NOW);
  await page.goto(path);
  await expect(page.locator('.screen')).toBeVisible();
}

export async function setNext(page: Page, text: string) {
  await page.locator('.next-body').click();
  await page.locator('#edit-text').fill(text);
  await page.getByRole('button', { name: '保存する' }).click();
  await expect(page.locator('.next-title')).toHaveText(text);
}

export const clock = (page: Page) => page.locator('.timer-clock');

async function nav(page: Page, name: string, hash: string) {
  const link = page.getByRole('navigation', { name: 'メイン' }).getByRole('link', { name }).first();
  if (await link.isVisible()) await link.click();
  else await page.goto(hash); // 設定画面には下部ナビがない
}

export async function gotoRecords(page: Page) {
  await nav(page, '記録', '/#records');
  await expect(page.getByRole('heading', { name: 'これまでの記録。' })).toBeVisible();
}

export async function gotoToday(page: Page) {
  await nav(page, '今日', '/#');
  await expect(page.locator('.home')).toBeVisible();
}

export async function addManual(page: Page, opts: { date: string; minutes: number; title: string; time?: string }) {
  await page.getByRole('button', { name: '計測しなかった学習を記録する' }).click();
  await page.locator('#rec-date').fill(opts.date);
  if (opts.time) await page.locator('#rec-time').fill(opts.time);
  await page.locator('#rec-min').fill(String(opts.minutes));
  await page.locator('#rec-title').fill(opts.title);
  await page.getByRole('button', { name: '記録する', exact: true }).click();
}


export async function noHorizontalOverflow(page: Page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, `scrollWidth ${r.sw} > clientWidth ${r.cw}`).toBeLessThanOrEqual(r.cw);
}

/** テストでは時計を止めているため通知が自動で消えない。必要に応じて閉じる */
export async function closeToasts(page: Page) {
  const btns = page.locator('.toast-close');
  while ((await btns.count()) > 0) await btns.first().click();
}

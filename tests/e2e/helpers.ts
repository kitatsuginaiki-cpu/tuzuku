import { expect, type Page } from '@playwright/test';

/** テスト基準時刻：2026-11-01 10:00 JST（日曜） */
export const NOW = new Date('2026-11-01T10:00:00+09:00');
export const MIN = 60_000;

export const TEMPLATE_NAMES = {
  morning: '朝8:00に起きて作業に入る',
  boki: '簿記3級',
  reading: '読書',
  room: '部屋をきれいに保つ',
  note: 'note更新',
} as const;
export type TemplateKey = keyof typeof TEMPLATE_NAMES;

export async function open(page: Page, path = '/', time: Date = NOW) {
  // 時計を止めた状態で開始し、runFor() で明示的に進める（実時間のずれを排除）
  await page.clock.install({ time: time.getTime() - 1000 });
  await page.clock.pauseAt(time);
  await page.goto(path);
  await expect(page.locator('.screen')).toBeVisible();
}

/** はじめての画面で案を選んで習慣を作る（UIから。データを直接書き込まない） */
export async function setup(page: Page, keys: TemplateKey[] = ['boki'], opts: { baseline?: boolean } = {}) {
  await expect(page.getByRole('heading', { name: '何をつづけますか？' })).toBeVisible();
  for (const k of keys) await page.locator('.ob-item', { hasText: TEMPLATE_NAMES[k] }).click();
  if (keys.includes('boki') && opts.baseline === false) await page.getByText(/確認済みの累計 17時間36分/).click();
  await page.getByRole('button', { name: `${keys.length}つの習慣ではじめる` }).click();
  await expect(page.locator('.habit-card')).toHaveCount(keys.length);
  await closeToasts(page);
}

export const card = (page: Page, name: string) => page.locator('.habit-card', { has: page.getByRole('heading', { name, exact: true }) });

export const clock = (page: Page) => page.locator('.timer-clock');

async function nav(page: Page, name: string, hash: string) {
  const link = page.getByRole('navigation', { name: 'メイン' }).getByRole('link', { name, exact: true }).first();
  if (await link.isVisible()) await link.click();
  else await page.goto(hash); // 設定画面などには下部ナビがない
}

export async function gotoRecords(page: Page, habit?: string) {
  await nav(page, '記録', '/#records');
  await expect(page.getByRole('heading', { name: '記録', level: 1 })).toBeVisible();
  if (habit && (await page.locator('.habit-pick').count())) await page.locator('.habit-pick').getByRole('radio', { name: habit }).click();
}

export async function gotoToday(page: Page) {
  await nav(page, '今日', '/#');
  await expect(page.locator('.home')).toBeVisible();
}

export async function gotoStack(page: Page) {
  await nav(page, '積み上げ', '/#stack');
  await expect(page.getByRole('heading', { name: '積み上げ', level: 1 })).toBeVisible();
}

export async function gotoFriends(page: Page) {
  await nav(page, '仲間', '/#friends');
  await expect(page.getByRole('heading', { name: '仲間', level: 1 })).toBeVisible();
}

/** 記録画面で「計測しなかった時間を記録する」（時間型） */
export async function addManual(page: Page, opts: { date: string; minutes: number; title: string; time?: string }) {
  await page.getByRole('button', { name: '計測しなかった時間を記録する' }).click();
  await page.locator('#rec-date').fill(opts.date);
  if (opts.time) await page.locator('#rec-time').fill(opts.time);
  await page.locator('#rec-min').fill(String(opts.minutes));
  await page.locator('#rec-title').fill(opts.title);
  await page.getByRole('button', { name: '記録する', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

/** 記録画面で「過去の日を記録する」（日数型） */
export async function addPastDay(page: Page, date: string, kind: 'やった' | '小さな一手' | '休むと決めた' = 'やった') {
  await page.getByRole('button', { name: '過去の日を記録する' }).click();
  await page.locator('#rec-date').fill(date);
  await page.getByRole('radio', { name: kind, exact: true }).click();
  await page.getByRole('button', { name: '記録する', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

export async function noHorizontalOverflow(page: Page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, `scrollWidth ${r.sw} > clientWidth ${r.cw}`).toBeLessThanOrEqual(r.cw);
}

/** テストでは時計を止めているため通知が自動で消えない。必要に応じて閉じる */
export async function closeToasts(page: Page) {
  // モーダルが開いている間は背面の通知を操作できないので触らない
  if (await page.locator('dialog[open]').count()) return;
  const btns = page.locator('.toast-close');
  while ((await btns.count()) > 0) await btns.first().click();
}

export async function editHabit(page: Page, name: string) {
  await card(page, name).getByRole('button', { name: `${name}を編集` }).click();
  await expect(page.locator('.habit-editor')).toBeVisible();
}

import { expect, test } from '@playwright/test';

/** 未設定時は「学習を始める」、しおりがあるときは「この一手を始める」 */
const START = /^(学習を始める|この一手を始める)$/;

test('Service Worker 登録後はオフラインでも起動し、記録できる', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('.home')).toBeVisible();
  // SW がページを制御するまで待つ
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    }
  });
  const manifest = await page.evaluate(async () => (await fetch('./manifest.webmanifest')).json());
  expect(manifest.name).toBe('つづく。');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.home')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('今日の一手');
  // オフラインでも保存できる（ローカル保存のみ）
  await page.getByRole('button', { name: START }).click();
  await page.getByRole('button', { name: '学習を終える' }).click();
  await page.locator('#minutes').fill('15');
  await page.getByRole('button', { name: '保存して終了' }).click();
  await expect(page.getByText('15分の学習を保存しました。')).toBeVisible();
  await context.setOffline(false);
});

test('desktop：3カラム（左ナビ・主操作・補助情報）', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.clock.install({ time: new Date('2026-11-01T10:00:00+09:00') });
  await page.goto('/');
  await expect(page.locator('.sidenav')).toBeVisible();
  await expect(page.locator('.info')).toBeVisible();
  await expect(page.locator('.info').getByText('この7日間')).toBeVisible();
  await expect(page.locator('.info').getByText('17時間36分')).toBeVisible();
  await expect(page.locator('.bottomnav')).toBeHidden();
  await expect(page.getByRole('link', { name: '今日' })).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: info.outputPath('desktop-home.png') });
  await page.getByRole('link', { name: '記録' }).click();
  await expect(page.getByRole('link', { name: '記録' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.info')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('desktop-records.png') });
  await page.getByRole('link', { name: '今日' }).click();
  await page.getByRole('button', { name: START }).click();
  await expect(page.locator('.sidenav')).toHaveCount(0); // 学習中はナビを出さない
  await page.screenshot({ path: info.outputPath('desktop-timer.png') });
});

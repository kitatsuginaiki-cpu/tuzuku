import { expect, test } from '@playwright/test';
import { card, setup } from './helpers';

test('Service Worker 登録後はオフラインでも起動し、記録できる', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('.home')).toBeVisible();
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
  await setup(page, ['boki', 'reading']);
  await card(page, '読書').getByRole('button', { name: 'やった', exact: true }).click();
  await card(page, '簿記3級').getByRole('button', { name: 'しおりから始める' }).click();
  await page.getByRole('button', { name: '終える', exact: true }).click();
  await page.locator('#minutes').fill('15');
  await page.getByRole('button', { name: '保存して終了' }).click();
  await expect(page.getByText('15分を積み上げました。')).toBeVisible();
  await page.reload();
  await expect(card(page, '簿記3級').locator('.hc-total .num')).toHaveText('17時間51分');
  await expect(card(page, '読書').getByText('今日はやった')).toBeVisible();
  await context.setOffline(false);
});

test('desktop：3カラム（左ナビ・主操作・補助情報）', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.clock.install({ time: new Date('2026-11-01T10:00:00+09:00') });
  await page.goto('/');
  await setup(page, ['boki', 'reading']);
  await expect(page.locator('.sidenav')).toBeVisible();
  await expect(page.locator('.info')).toBeVisible();
  await expect(page.locator('.info').getByText('積み上げ', { exact: true })).toBeVisible();
  await expect(page.locator('.info').getByText('17時間36分')).toBeVisible();
  await expect(page.locator('.bottomnav')).toBeHidden();
  const nav = page.getByRole('navigation', { name: 'メイン' });
  await expect(nav.getByRole('link', { name: '今日' })).toHaveAttribute('aria-current', 'page');
  for (const n of ['積み上げ', '仲間', '記録']) await expect(nav.getByRole('link', { name: n, exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('desktop-home.png') });
  await nav.getByRole('link', { name: '積み上げ' }).click();
  await expect(nav.getByRole('link', { name: '積み上げ' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.info')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('desktop-stack.png') });
  await nav.getByRole('link', { name: '今日' }).click();
  await card(page, '簿記3級').getByRole('button', { name: 'しおりから始める' }).click();
  await expect(page.locator('.sidenav')).toHaveCount(0);
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addManual, closeToasts, gotoRecords, open, setNext } from './helpers';

/** WCAG 2.0/2.1/2.2 A・AA のルールで自動監査（自動検査で分かる範囲のみ） */
async function audit(page: Page, label: string) {
  await closeToasts(page);
  await page.clock.resume(); // axe は内部でタイマーを使うため、止めていた仮想時計を動かす
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary, `${label}\n${summary.join('\n')}`).toEqual([]);
}

test('axe：主要画面・ダイアログに WCAG A/AA の自動検出違反がない', async ({ page }) => {
  await open(page);
  await audit(page, '今日（未設定）');
  await setNext(page, '仕訳の基本を3問解く');
  await audit(page, '今日');

  await page.locator('.next-body').click();
  await audit(page, '次の一歩ダイアログ');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '学習を始める' }).click();
  await page.clock.runFor(5 * 60_000);
  await audit(page, '学習中');
  await page.getByRole('button', { name: '一時停止' }).click();
  await audit(page, '一時停止中');
  await page.getByRole('button', { name: '中断' }).click();
  await audit(page, '中断ダイアログ');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '再開' }).click();
  await page.getByRole('button', { name: '学習を終える' }).click();
  await audit(page, '学習終了');
  await page.getByRole('button', { name: '保存して終了' }).click();

  await gotoRecords(page);
  await audit(page, '記録（一覧）');
  await addManual(page, { date: '2026-10-20', minutes: 30, title: '講義#14' });
  await closeToasts(page);
  await page.locator('.record-item').first().click();
  await audit(page, '記録の編集ダイアログ');
  await page.keyboard.press('Escape');

  await page.goto('/#options');
  await audit(page, '設定');
});

test('axe：記録0件の空状態', async ({ page }) => {
  await open(page, '/#records');
  await audit(page, '記録（空）');
});

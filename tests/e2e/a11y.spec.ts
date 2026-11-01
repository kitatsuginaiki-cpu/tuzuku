import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addManual, addPastDay, card, closeToasts, gotoFriends, gotoRecords, gotoStack, gotoToday, open, setup } from './helpers';
import { FakeBackend } from './fakeRemote';

/** WCAG 2.0/2.1/2.2 A・AA のルールで自動監査（自動検査で分かる範囲のみ） */
async function audit(page: Page, label: string) {
  await closeToasts(page);
  try {
    await page.clock.resume(); // axe は内部でタイマーを使うため、止めていた仮想時計を動かす
  } catch {
    /* 時計を入れていないページ */
  }
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary, `${label}\n${summary.join('\n')}`).toEqual([]);
}

test('axe：はじめて・今日・計測・終了・記録', async ({ page }) => {
  await open(page);
  await audit(page, 'はじめて');
  await setup(page, ['boki', 'reading', 'morning']);
  await card(page, '読書').getByRole('button', { name: 'やった', exact: true }).click();
  await audit(page, '今日（キャラクターあり）');
  await card(page, '簿記3級').getByRole('button', { name: 'できない日は' }).click();
  await audit(page, 'できない日の組ダイアログ');
  await page.keyboard.press('Escape');

  await page.clock.pauseAt(new Date('2026-11-01T10:00:05+09:00'));
  await card(page, '簿記3級').getByRole('button', { name: 'しおりから始める' }).click();
  await page.clock.runFor(5 * 60_000);
  await audit(page, '計測中');
  await page.clock.pauseAt(new Date('2026-11-01T10:06:00+09:00'));
  await page.getByRole('button', { name: '中断' }).click();
  await audit(page, '中断ダイアログ');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '終える', exact: true }).click();
  await audit(page, '終了');
  await page.getByRole('button', { name: '保存して終了' }).click();
  await expect(page.locator('.home')).toBeVisible();

  await gotoRecords(page, '簿記3級');
  await audit(page, '記録（時間型）');
  await page.locator('.record-item').first().click();
  await audit(page, '記録の編集ダイアログ');
  await page.keyboard.press('Escape');
  await gotoRecords(page, '読書');
  await page.getByRole('button', { name: '過去の日を記録する' }).click();
  await audit(page, '日数型の記録ダイアログ');
  await page.keyboard.press('Escape');
});

test('axe：積み上げ・習慣の編集・設定・見直し・プライバシー', async ({ page }) => {
  await open(page);
  await setup(page, ['boki', 'reading']);
  await gotoRecords(page, '簿記3級');
  await addManual(page, { date: '2026-10-28', minutes: 30, title: '問題集 第11章' });
  await gotoStack(page);
  await audit(page, '積み上げ');
  await page.goto('/#');
  await card(page, '読書').getByRole('button', { name: '読書を編集' }).click();
  await audit(page, '習慣の編集');
  await page.goto('/#');
  await page.getByRole('button', { name: '＋ 習慣を追加' }).click();
  await page.getByRole('button', { name: '＋ 組を追加' }).click();
  await page.getByRole('button', { name: '追加する' }).click();
  await audit(page, '習慣の追加（エラー表示）');
  await page.goto('/#options');
  await audit(page, '設定');
  await page.goto('/#review');
  await audit(page, '週の見直し');
  await page.goto('/#privacy');
  await audit(page, 'プライバシー');
  await page.goto('/#friends');
  await audit(page, '仲間（接続先なし）');
});

test('axe：仲間（ログイン・グループ）', async ({ browser }) => {
  const backend = new FakeBackend();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await backend.attach(ctx, 'X');
  const page = await ctx.newPage();
  await page.goto('/');
  await setup(page, ['boki']);
  await gotoFriends(page);
  await audit(page, 'ログイン（メール）');
  await page.locator('#si-email').fill('x@example.com');
  await page.getByRole('button', { name: 'コードを送る' }).click();
  await audit(page, 'ログイン（コード）');
  await page.locator('#si-code').fill('123456');
  await page.getByRole('button', { name: 'ログイン' }).click();
  await audit(page, 'ログイン（表示名）');
  await page.locator('#si-name').fill('えっくす');
  await page.getByRole('button', { name: 'はじめる' }).click();
  await page.getByRole('switch', { name: '簿記3級' }).check();
  await page.getByRole('button', { name: '作る' }).click();
  await expect(page.locator('.group')).toBeVisible();
  await audit(page, '仲間（グループ）');
  await page.getByRole('button', { name: 'アカウントを削除' }).click();
  await audit(page, 'アカウント削除ダイアログ');
});

test('axe：進化のお祝い・成長の段階', async ({ page }) => {
  await open(page);
  await setup(page, ['reading']);
  await gotoRecords(page);
  await addPastDay(page, '2026-10-30');
  await addPastDay(page, '2026-10-31');
  await gotoToday(page);
  await card(page, '読書').getByRole('button', { name: 'やった', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /レベルアップ/ })).toBeVisible();
  await audit(page, '進化のお祝い');
  await page.getByRole('button', { name: 'やったね！' }).click();
  await gotoStack(page);
  await audit(page, '成長の段階');
});

test('axe：保存の警告（保存できない／iPhone の Safari）・直前の状態に戻す', async ({ page, browser }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { get: () => undefined, configurable: true });
    Storage.prototype.setItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
  });
  await open(page);
  await expect(page.getByText('記録が保存されていません')).toBeVisible();
  await audit(page, '保存できない警告');

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  const ios = await ctx.newPage();
  await ios.goto('/');
  await expect(ios.getByText('ホーム画面に追加して使ってください')).toBeVisible();
  await audit(ios, 'iPhone の案内');
  await ios.locator('.ob-item').first().click();
  await ios.getByRole('button', { name: /つの習慣ではじめる/ }).click();
  await expect(ios.locator('.habit-card')).toHaveCount(1);
  await ios.goto('/#options');
  await ios.getByRole('button', { name: '記録と設定を消去…' }).click();
  await ios.getByRole('button', { name: '消去する' }).click();
  await expect(ios.locator('.home')).toBeVisible();
  await ios.goto('/#options');
  await expect(ios.getByRole('button', { name: '直前の状態に戻す' })).toBeVisible();
  await audit(ios, '設定（直前の状態あり）');
  await ctx.close();
});

import { expect, test, type Page } from '@playwright/test';
import { addManual, card, closeToasts, gotoRecords, gotoToday, open, setup } from './helpers';

/**
 * 単一端末モードの安全性（v7.1.1）。
 * - 同期は止まっている：サーバーへの通信も、送信待ち（outbox）も作らない
 * - 消去・復元はこの端末だけ。直前の状態に戻せる
 * - 保存できないとき・iPhone の Safari のままのときは、今日の画面で知らせる
 * 本番と同じビルド（.env.production あり）でも同じ結果になることを、TEST_REPORT の手順で確認する。
 */

async function idb<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(
    (src) =>
      new Promise<T>((resolve, reject) => {
        const req = indexedDB.open('tsuzuku-v5');
        req.onsuccess = () => {
          const db = req.result;
          // eslint-disable-next-line @typescript-eslint/no-implied-eval
          const run = new Function('db', 'resolve', 'reject', src) as (db: IDBDatabase, res: (v: T) => void, rej: (e: unknown) => void) => void;
          run(db, (v) => {
            db.close();
            resolve(v);
          }, reject);
        };
        req.onerror = () => reject(req.error);
      }),
    fn,
  );
}
const outboxCount = (page: Page) =>
  idb<number>(page, `const r = db.transaction('outbox').objectStore('outbox').count(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);`);

test('同期は止まっている：以前のログイン情報が残っていても、通信も送信待ちも作らない', async ({ page }) => {
  const remoteCalls: string[] = [];
  page.on('request', (r) => {
    if (/supabase\.co/.test(r.url())) remoteCalls.push(r.url());
  });
  await open(page);
  await setup(page, ['boki', 'reading']);
  // 以前ログインしていた端末を再現（アカウント情報だけが残っている）
  await idb(page, `const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ userId: 'u-old', email: 'me@example.com', displayName: 'me', avatar: 'green', lastPulledAt: null }, 'account'); tx.oncomplete = () => resolve(null); tx.onerror = () => reject(tx.error);`);
  await page.reload();
  await card(page, '読書').getByRole('button', { name: 'やった', exact: true }).click();
  await gotoRecords(page, '簿記3級');
  await addManual(page, { date: '2026-10-31', minutes: 30, title: '仕訳' });
  await page.locator('.record-item').click();
  await page.getByRole('button', { name: 'この記録を削除' }).click();
  await page.getByRole('button', { name: '削除する' }).click();
  await page.getByRole('button', { name: '元に戻す' }).click();
  await page.goto('/#friends');
  await expect(page.getByRole('heading', { name: '仲間と同期は、安全確認のため一時停止中です' })).toBeVisible();
  await expect(page.getByText('以前ログインしていても、同期は止まっています。')).toBeVisible();
  await expect(page.locator('#si-email')).toHaveCount(0);
  expect(await outboxCount(page)).toBe(0);
  expect(remoteCalls).toEqual([]);
});

test('消去はこの端末だけ。直前の状態に戻せ、記録と積み上げが元どおりになる', async ({ page }) => {
  await open(page);
  await setup(page, ['boki', 'reading']);
  await card(page, '読書').getByRole('button', { name: 'やった', exact: true }).click();
  await gotoRecords(page, '簿記3級');
  await addManual(page, { date: '2026-10-30', minutes: 25, title: '講義' });
  await page.goto('/#options');
  await closeToasts(page);
  await page.getByRole('button', { name: '記録と設定を消去…' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('習慣2件・記録2件');
  await page.getByRole('button', { name: '消去する' }).click();
  await expect(page.locator('.home')).toBeVisible();
  await expect(page.getByRole('heading', { name: '何をつづけますか？' })).toBeVisible();
  expect(await outboxCount(page)).toBe(0);

  await page.goto('/#options');
  await expect(page.getByText(/消去の直前の状態（習慣2件・記録2件）/)).toBeVisible();
  await page.getByRole('button', { name: '直前の状態に戻す' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '戻す' }).click();
  await expect(page.getByText('直前の状態に戻しました（記録2件）。')).toBeVisible();
  await page.reload();
  await gotoToday(page);
  await expect(card(page, '簿記3級').locator('.hc-total .num')).toHaveText('18時間1分');
  await expect(card(page, '読書').getByText('今日はやった')).toBeVisible();
});

test('バックアップを書き出すと「最後のバックアップ」が記録され、バージョンが表示される', async ({ page }) => {
  await open(page);
  await setup(page, ['boki']);
  await page.goto('/#options');
  await expect(page.locator('.backup-status')).toHaveText('最後のバックアップ：まだありません');
  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'バックアップを書き出す' }).click()]);
  await expect(page.locator('.backup-status')).toHaveText(/最後のバックアップ：11\/1 10:00/);
  await page.reload();
  await expect(page.locator('.backup-status')).toHaveText(/最後のバックアップ：11\/1 10:00/);
  await expect(page.getByText(/バージョン：7\.2\.0/)).toBeVisible();
});

test('保存できないブラウザでは、今日の画面ではっきり警告する', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { get: () => undefined, configurable: true });
    Storage.prototype.setItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
  });
  await open(page);
  const alert = page.getByRole('alert').filter({ hasText: '記録が保存されていません' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('画面を閉じると記録が消えます');
  await setup(page, ['reading']);
  await expect(alert).toBeVisible();
});

test('iPhone の Safari のままなら、ホーム画面への追加を案内する（閉じられる）', async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    locale: 'ja-JP',
  });
  const page = await ctx.newPage();
  await page.goto('/');
  const n = page.getByRole('region', { name: 'ホーム画面に追加して使ってください' });
  await expect(n).toBeVisible();
  await n.getByRole('button', { name: /あとで/ }).click();
  await expect(n).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: 'ホーム画面に追加して使ってください' })).toHaveCount(0);
  await ctx.close();
});

test('Android や PC では、ホーム画面への追加の案内は出さない', async ({ page }) => {
  await open(page);
  await expect(page.getByText('ホーム画面に追加して使ってください')).toHaveCount(0);
});

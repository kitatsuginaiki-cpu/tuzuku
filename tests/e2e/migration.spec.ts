import { expect, test, type Page } from '@playwright/test';

/**
 * 実際のブラウザ（Chromium）の IndexedDB で、v6 → v7 の移行を確かめる。
 * ※ ここで作る v6 のデータは、すべてテスト用の架空のデータ（実際の学習記録ではない）。
 */
async function makeV6(page: Page, settings: Record<string, unknown>, records: Record<string, unknown>[]) {
  await page.goto('/manifest.webmanifest'); // アプリを起動せずに同じオリジンを開く
  await page.evaluate(
    ({ settings, records }) =>
      new Promise<void>((res, rej) => {
        const req = indexedDB.open('tsuzuku-v5', 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('kv');
          req.result.createObjectStore('records', { keyPath: 'id' });
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['kv', 'records'], 'readwrite');
          tx.objectStore('kv').put(settings, 'settings');
          for (const r of records) tx.objectStore('records').put(r);
          tx.oncomplete = () => {
            db.close();
            res();
          };
          tx.onerror = () => rej(tx.error);
        };
      }),
    { settings, records },
  );
}
const v6rec = (id: string, studyDate: string, minutes: number) => ({
  id, studyDate, startedAt: null, endedAt: null, minutes, measuredSeconds: null, pausedSeconds: null,
  title: `テスト用 ${id}`, note: '', source: 'manual', createdAt: `${studyDate}T00:00:00.000Z`, updatedAt: `${studyDate}T00:00:00.000Z`,
});
const V6_SETTINGS = { subject: '簿記3級', nextAction: '第13講義', cue: '朝食後', smallAction: '1問だけ', smallMinutes: 5, planDays: [1, 2, 3, 4, 5], targetMinutes: 25, supportMode: 'plan', weeklyReview: true };

test('v6 で記録が0件なら、移行後も確認済みの 17時間36分 のまま（加算しない）', async ({ page }) => {
  await makeV6(page, V6_SETTINGS, []);
  await page.goto('/');
  const c = page.locator('.habit-card');
  await expect(c).toHaveCount(1);
  await expect(c.locator('.hc-name')).toHaveText('簿記3級');
  await expect(c.locator('.hc-total .num')).toHaveText('17時間36分');
  await expect(c.locator('.hc-plan')).toContainText('第13講義');
  await page.goto('/#records');
  await expect(page.getByText('0件')).toBeVisible();
});

test('v6 の記録は件数も分数も変えずに引き継ぎ、移行前のデータを端末に保存する', async ({ page }) => {
  await makeV6(page, V6_SETTINGS, [v6rec('a', '2026-10-28', 25), v6rec('b', '2026-10-30', 15)]);
  await page.goto('/');
  await expect(page.locator('.hc-total .num')).toHaveText('18時間16分'); // 1056 + 25 + 15（テスト用の記録）
  await page.goto('/#records');
  await expect(page.getByText('2件')).toBeVisible();
  await page.goto('/#options');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '移行前のデータを書き出す' }).click()]);
  const fs = await import('node:fs');
  const json = JSON.parse(fs.readFileSync((await dl.path())!, 'utf8'));
  expect(json.records.map((r: { id: string; minutes: number }) => [r.id, r.minutes])).toEqual([
    ['a', 25],
    ['b', 15],
  ]);
  // 2回目の起動で移行し直さない（習慣が増えない）
  await page.goto('/');
  await page.reload();
  await expect(page.locator('.habit-card')).toHaveCount(1);
});

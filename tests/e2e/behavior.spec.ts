import { expect, test, type Page } from '@playwright/test';
import { addManual, clock, closeToasts, gotoRecords, gotoToday, NOW, open } from './helpers';

const MIN = 60_000;

async function makePlan(page: Page, o: { cue?: string; next?: string; small?: string; smallMin?: string; days?: string[] } = {}) {
  await page.goto('/#plan');
  await page.locator('#plan-cue').fill(o.cue ?? '昼食後にコーヒーを淹れたら');
  await page.locator('#plan-nextAction').fill(o.next ?? '第11章の仕訳問題を3問解く');
  await page.locator('#plan-smallAction').fill(o.small ?? '1問だけ解く');
  if (o.smallMin) await page.locator('#plan-smallMinutes').fill(o.smallMin);
  for (const d of o.days ?? []) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'プランを保存' }).click();
  await expect(page.locator('.home')).toBeVisible();
  await closeToasts(page);
}

test.describe('プラン：もし〜なら → 一手 → できない日', () => {
  test('プランを1画面で作ると、ホームに文として表示される', async ({ page }) => {
    await open(page, '/#plan');
    // プレビューは入力に追従する
    await page.locator('#plan-cue').fill('帰宅して机に座ったら');
    await expect(page.locator('.plan-preview')).toContainText('もし 帰宅して机に座ったら');
    await page.getByRole('button', { name: '昼食後にコーヒーを淹れたら' }).click(); // 例のチップ
    await page.locator('#plan-nextAction').fill('第11章の仕訳問題を3問解く');
    await page.getByRole('button', { name: '1問だけ解く' }).click();
    await page.getByRole('button', { name: '土', exact: true }).click(); // 土を外す
    await page.getByRole('button', { name: '日', exact: true }).click(); // 日を外す
    await expect(page.locator('.plan-preview')).toContainText('予定：平日');
    await page.getByRole('button', { name: 'プランを保存' }).click();

    await expect(page.locator('.thread-cue')).toHaveText('昼食後にコーヒーを淹れたら');
    await expect(page.locator('.next-title')).toHaveText('第11章の仕訳問題を3問解く');
    await expect(page.getByRole('button', { name: 'この一手を始める' })).toBeVisible();
    await expect(page.locator('.small-what')).toContainText('1問だけ解く（5分）');
    await expect(page.locator('.today-line')).toContainText('予定外の日'); // 11/1 は日曜
    // 再読み込み後も保持
    await page.reload();
    await expect(page.locator('.thread-cue')).toHaveText('昼食後にコーヒーを淹れたら');
  });

  test('しおりから始めて、きっかけ通りか（任意）に答え、次のしおりを候補から挟む', async ({ page }) => {
    await open(page);
    await makePlan(page);
    await page.getByRole('button', { name: 'この一手を始める' }).click();
    await expect(page.locator('.session .eyebrow')).toContainText('しおりから');
    await page.clock.runFor(18 * MIN);
    await page.getByRole('button', { name: '学習を終える' }).click();
    await expect(page.getByText('きっかけ通りに始めましたか？')).toBeVisible();
    await page.getByRole('radio', { name: 'はい' }).click();
    await page.getByRole('button', { name: '続き：第11章の仕訳問題を3問解く' }).click();
    await expect(page.locator('#next')).toHaveValue('続き：第11章の仕訳問題を3問解く');
    await page.getByRole('button', { name: '保存して終了' }).click();
    await expect(page.locator('.next-title')).toHaveText('続き：第11章の仕訳問題を3問解く');
    await expect(page.getByText('しおりを挟みました')).toBeVisible();
    await gotoRecords(page);
    await expect(page.locator('.record-item .tag')).toHaveText(['しおりから']);
  });

  test('きっかけ通りの質問は答えなくても保存できる', async ({ page }) => {
    await open(page);
    await makePlan(page);
    await page.getByRole('button', { name: 'この一手を始める' }).click();
    await page.clock.runFor(10 * MIN);
    await page.getByRole('button', { name: '学習を終える' }).click();
    await page.getByRole('button', { name: '保存して終了' }).click();
    await expect(page.locator('.home')).toBeVisible();
  });

  test('できない日：事前に決めた小さな一手で始め、延長は任意。しおりは残る', async ({ page }) => {
    await open(page);
    await makePlan(page);
    await page.getByRole('button', { name: '小さく始める' }).click();
    await expect(page.getByRole('heading', { name: '1問だけ解く' })).toBeVisible();
    await expect(page.locator('.session .eyebrow')).toContainText('小さな一手');
    await expect(clock(page)).toHaveText('05:00');
    await page.clock.runFor(5 * MIN + 30_000);
    await expect(page.getByText(/小さな一手の5分になりました/)).toBeVisible();
    await expect(page.locator('.session')).toBeVisible(); // 自動で完了しない
    await page.getByRole('button', { name: '学習を終える' }).click();
    // しおり（まだ終えていない一手）はそのまま
    await expect(page.locator('#next')).toHaveValue('第11章の仕訳問題を3問解く');
    await expect(page.getByText('しおりはそのまま残っています')).toBeVisible();
    await page.getByRole('button', { name: '保存して終了' }).click();
    await expect(page.locator('.next-title')).toHaveText('第11章の仕訳問題を3問解く');
    await gotoRecords(page);
    await expect(page.locator('.record-item .tag')).toHaveText(['小さな一手']);
  });

  test('小さな一手が未設定なら従来どおり「2分だけ」', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: '2分だけ始める' }).click();
    await expect(clock(page)).toHaveText('02:00');
  });
});

test.describe('戻り方：再開と週の見直し', () => {
  test('再開画面から「プランを1つ変える」でプランへ', async ({ page }) => {
    await open(page);
    await makePlan(page);
    await gotoRecords(page);
    await addManual(page, { date: '2026-10-28', minutes: 30, title: '問題集 第11章' });
    await gotoToday(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('また、ここから。');
    await page.getByRole('button', { name: /小さな一手で始める/ }).click();
    await expect(page.getByRole('heading', { name: '1問だけ解く' })).toBeVisible();
    await page.getByRole('button', { name: 'ホームに戻る（計測は続きます）' }).click();
    await page.getByRole('button', { name: '学習中の画面に戻る' }).click();
    await page.getByRole('button', { name: '中断' }).click();
    await page.getByRole('button', { name: '記録せず終了' }).click();
    await page.getByRole('button', { name: /プランを1つ変える/ }).click();
    await expect(page.getByRole('heading', { name: 'いつ、何から始める？' })).toBeVisible();
  });

  test('週の見直し：7日後に静かに提案 → 事実のみ表示 → 1つ選ぶとその欄へ', async ({ page }) => {
    await open(page);
    await makePlan(page, { days: ['土', '日'] }); // 平日
    // 1日目（日曜）に1回学習（きっかけ通り）
    await page.getByRole('button', { name: 'この一手を始める' }).click();
    await page.clock.runFor(20 * MIN);
    await page.getByRole('button', { name: '学習を終える' }).click();
    await page.getByRole('radio', { name: 'はい' }).click();
    await page.getByRole('button', { name: '保存して終了' }).click();
    await expect(page.locator('.review-row')).toHaveCount(0); // まだ提案しない

    // 8日後
    await page.clock.setSystemTime(new Date(NOW.getTime() + 8 * 86400_000));
    await page.reload();
    await closeToasts(page);
    await expect(page.locator('.review-row')).toBeVisible();
    await page.getByRole('button', { name: '見直す' }).click();
    await expect(page.getByRole('heading', { name: '来週、ひとつだけ変えるなら？' })).toBeVisible();
    // 直近7日（11/3〜11/9）に学習はない：事実だけを示す
    await expect(page.locator('.facts')).toContainText('学習した日0日');
    await expect(page.locator('.facts')).toContainText('予定の5日のうち 0日');
    await page.getByRole('button', { name: '見直しを保存' }).click();
    await expect(page.getByText(/ひとつだけ変えることを選んでください/)).toBeVisible();
    await page.getByRole('radio', { name: 'きっかけを変える' }).check();
    await page.getByRole('radio', { name: '2' }).click();
    await page.getByRole('button', { name: '見直しを保存' }).click();
    await expect(page.getByRole('heading', { name: 'いつ、何から始める？' })).toBeVisible();
    await expect(page.locator('#plan-cue')).toBeFocused();
    await gotoToday(page);
    await expect(page.locator('.review-row')).toHaveCount(0);
    // 見直しはバックアップに含まれる
    const json = await page.evaluate(async () => {
      const req = indexedDB.open('tsuzuku-v5');
      const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
      return await new Promise((r) => {
        const g = db.transaction('kv').objectStore('kv').get('reviews');
        g.onsuccess = () => r(g.result);
      });
    });
    expect(json).toHaveLength(1);
    expect((json as { change: string; ease: number }[])[0]).toMatchObject({ change: 'cue', ease: 2 });
  });

  test('「今週はしない」で7日間は提案しない', async ({ page }) => {
    await open(page);
    await gotoRecords(page);
    await addManual(page, { date: '2026-10-31', minutes: 20, title: '講義' });
    await page.clock.setSystemTime(new Date(NOW.getTime() + 8 * 86400_000));
    await page.goto('/');
    await closeToasts(page);
    await page.getByRole('button', { name: '今週はしない' }).click();
    await expect(page.locator('.review-row')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.review-row')).toHaveCount(0);
  });
});

test.describe('記録中心モード（比較検証用）', () => {
  test('設定で切り替えると、プラン要素を出さない簡素なホームになる', async ({ page }) => {
    await open(page);
    await makePlan(page);
    await page.goto('/#options');
    await page.getByRole('radio', { name: /記録中心/ }).check();
    await gotoToday(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('次の一歩から。');
    await expect(page.locator('.thread')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '2分だけ始める' })).toBeVisible();
    await page.getByRole('button', { name: '学習を始める' }).click();
    await page.clock.runFor(10 * MIN);
    await page.getByRole('button', { name: '学習を終える' }).click();
    await expect(page.getByText('きっかけ通りに始めましたか？')).toHaveCount(0);
    await page.getByRole('button', { name: '保存して終了' }).click();
    await expect(page.locator('.home')).toBeVisible();
    // 元に戻せる
    await page.goto('/#options');
    await page.getByRole('radio', { name: /プラン表示/ }).check();
    await gotoToday(page);
    await expect(page.locator('.thread')).toBeVisible();
  });
});

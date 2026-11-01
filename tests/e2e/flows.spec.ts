import { expect, test } from '@playwright/test';
import { addManual, clock, closeToasts, gotoRecords, gotoToday, open, setNext } from './helpers';

/** 未設定時は「学習を始める」、しおりがあるときは「この一手を始める」 */
const START = /^(学習を始める|この一手を始める)$/;

const MIN = 60_000;

test.describe('初回・空状態', () => {
  test('未設定でも学習を始められ、架空の記録は表示しない', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('今日の一手');
    await expect(page.locator('.next-title')).toHaveText('次の一手は未設定');
    await expect(page.getByText('学習を始めてからでも決められます')).toBeVisible();
    await expect(page.getByRole('button', { name: START })).toBeEnabled();
    await expect(page.getByRole('button', { name: /きっかけを決める/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '2分だけ始める' })).toBeVisible();
    // 架空の学習履歴・再開回数・連続日数などを出さない
    await expect(page.getByText(/連続|再開回数|日目/)).toHaveCount(0);

    await gotoRecords(page);
    await expect(page.locator('.big-total')).toHaveAttribute('aria-label', '17時間36分');
    await expect(page.getByText('2026年10月7日時点までの記録')).toBeVisible();
    await expect(page.getByText('0件')).toBeVisible();
    await expect(page.getByText('日別の学習記録は')).toBeVisible();
    await expect(page.locator('.record-item')).toHaveCount(0);
    await expect(page.locator('.bars')).toHaveCount(0); // データがないのでグラフなし
  });

  test('未設定のまま開始 → 内容を終了時に入力 → 保存できる', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: START }).click();
    await expect(page.getByText('学習内容は終了時に入力できます')).toBeVisible();
    await page.clock.runFor(12 * MIN);
    await page.getByRole('button', { name: '学習を終える' }).click();
    await expect(page.locator('#did')).toHaveValue('');
    await expect(page.getByText('空欄の場合は「簿記3級の学習」として記録します')).toBeVisible();
    await page.locator('#did').fill('講義#14を見る');
    await page.getByRole('button', { name: '保存して終了' }).click();
    await expect(page.locator('.home')).toBeVisible();
    await expect(page.locator('.next-title')).toHaveText('次の一手は未設定');
    await gotoRecords(page);
    await expect(page.locator('.record-item')).toHaveCount(1);
    await expect(page.locator('.record-title')).toHaveText('講義#14を見る');
    await expect(page.locator('.big-total')).toHaveAttribute('aria-label', '17時間48分');
  });
});

test.describe('通常フロー', () => {
  test('ワンタップ開始・進捗と数値の整合・次の一歩の引き継ぎ・累計再計算', async ({ page }) => {
    await open(page);
    await setNext(page, '仕訳の基本を3問解く');
    await page.getByRole('button', { name: START }).click();
    await expect(page.getByRole('heading', { name: '仕訳の基本を3問解く' })).toBeVisible();
    await expect(clock(page)).toHaveText('20:00');
    await expect(page.locator('.bottomnav')).toHaveCount(0); // 学習中は下部ナビなし

    await page.clock.runFor(5 * MIN);
    await expect(clock(page)).toHaveText('15:00');
    await expect(page.getByText('残り時間 / 20:00')).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');

    await page.getByRole('button', { name: '学習を終える' }).click();
    await expect(page.getByRole('heading', { name: '学習を終えました。' })).toBeVisible();
    await expect(page.locator('.big-num .num')).toHaveText('5');
    await expect(page.locator('#did')).toHaveValue('仕訳の基本を3問解く');
    await page.locator('#next').fill('続きの仕訳を3問解く');
    await page.getByRole('button', { name: '保存して終了' }).click();

    await expect(page.locator('.home')).toBeVisible();
    await expect(page.locator('.next-title')).toHaveText('続きの仕訳を3問解く');
    await expect(page.getByText('5分の学習を保存しました。')).toBeVisible();
    await gotoRecords(page);
    await expect(page.locator('.big-total')).toHaveAttribute('aria-label', '17時間41分');
    await expect(page.getByText('1件')).toBeVisible();
    await expect(page.getByText('直近14日間')).toBeVisible();
  });

  test('実時間を保存前に修正できる', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: START }).click();
    await page.clock.runFor(40 * MIN);
    await page.getByRole('button', { name: '学習を終える' }).click();
    await page.getByRole('button', { name: '時間を修正' }).click();
    await page.locator('#minutes').fill('25');
    await page.getByRole('button', { name: '保存して終了' }).click();
    await gotoRecords(page);
    await expect(page.locator('.big-total')).toHaveAttribute('aria-label', '18時間1分');
  });

  test('1分未満の計測は切り上げず、分数の入力を求める', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: START }).click();
    await page.clock.runFor(20_000);
    await page.getByRole('button', { name: '学習を終える' }).click();
    await expect(page.getByText('計測は1分未満でした')).toBeVisible();
    await page.getByRole('button', { name: '保存して終了' }).click();
    await expect(page.locator('#minutes-err')).toBeVisible();
    await expect(page.locator('.finish')).toBeVisible();
  });

  test('終了画面から戻ると計測が再開し、終了画面にいた時間は含めない', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: START }).click();
    await page.clock.runFor(4 * MIN);
    await page.getByRole('button', { name: '学習を終える' }).click();
    await page.clock.runFor(3 * MIN);
    await page.getByRole('button', { name: '学習中の画面に戻る' }).click();
    await expect(clock(page)).toHaveText('16:00');
  });
});

test.describe('2分だけ始める', () => {
  test('2分経過しても自動で完了・記録しない', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: '2分だけ始める' }).click();
    await expect(clock(page)).toHaveText('02:00');
    await page.clock.runFor(2 * MIN + 30_000);
    await expect(page.getByText(/小さな一手の2分になりました/)).toBeVisible();
    await expect(clock(page)).toHaveText('02:30'); // 経過時間表示に切り替わる
    await expect(page.locator('.session')).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    await page.getByRole('button', { name: '目標を20分にする' }).click();
    await expect(clock(page)).toHaveText('17:30');
    // 記録はまだ0件
    await page.getByRole('button', { name: 'ホームに戻る（計測は続きます）' }).click();
    await expect(page.getByRole('button', { name: '学習中の画面に戻る' })).toBeVisible();
    await expect(page.getByRole('button', { name: '2分だけ始める' })).toHaveCount(0);
    await gotoRecords(page);
    await expect(page.getByText('0件')).toBeVisible();
  });
});

test.describe('一時停止・中断', () => {
  test('一時停止中は時間が進まず、再開で続きから', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: START }).click();
    await page.clock.runFor(3 * MIN);
    await page.getByRole('button', { name: '一時停止' }).click();
    await expect(page.locator('.topbar-title')).toHaveText('一時停止中');
    await page.clock.runFor(10 * MIN);
    await expect(clock(page)).toHaveText('17:00');
    await page.getByRole('button', { name: '再開' }).click();
    await page.clock.runFor(1 * MIN);
    await expect(clock(page)).toHaveText('16:00');
    await page.getByRole('button', { name: '学習を終える' }).click();
    await expect(page.locator('.big-num .num')).toHaveText('4');
    await expect(page.getByText('（一時停止 10分を除く）')).toBeVisible();
  });

  test('中断：戻る／記録して終了／記録せず終了（元に戻せる）', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: START }).click();
    await page.clock.runFor(6 * MIN);

    await page.getByRole('button', { name: '中断' }).click();
    const dlg = page.getByRole('alertdialog', { name: '学習を中断しますか？' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByText('今回の計測は破棄されます')).toBeVisible();
    await dlg.getByRole('button', { name: '戻る' }).click();
    await expect(dlg).toBeHidden();
    await expect(page.locator('.session')).toBeVisible();

    await page.getByRole('button', { name: '中断' }).click();
    await dlg.getByRole('button', { name: '記録せず終了' }).click();
    await expect(page.locator('.home')).toBeVisible();
    await expect(page.getByRole('button', { name: START })).toBeVisible();
    await page.getByRole('button', { name: '元に戻す' }).click();
    await expect(page.locator('.session')).toBeVisible();
    await expect(clock(page)).toHaveText('14:00');

    await page.getByRole('button', { name: '中断' }).click();
    await dlg.getByRole('button', { name: '記録して終了' }).click();
    await expect(page.getByRole('heading', { name: '学習を終えました。' })).toBeVisible();
  });
});

test.describe('復帰・永続化', () => {
  test('バックグラウンド復帰：経過時刻から再計算し、離れていた時間を知らせる', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: START }).click();
    await page.clock.runFor(2 * MIN);
    // タブを非表示にした状態を再現（setInterval は止まったと仮定し、時計だけ進める）
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(9 * MIN);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(clock(page)).toHaveText('09:00');
    await expect(page.getByText(/画面を離れていた約9分も計測に含まれています/)).toBeVisible();
  });

  test('再読み込み後も進行中セッションを復旧（一時停止状態も保持）', async ({ page }) => {
    await open(page);
    await setNext(page, '問題集 第12章');
    await page.getByRole('button', { name: START }).click();
    await page.clock.runFor(7 * MIN);
    await page.reload();
    await expect(page.locator('.session')).toBeVisible();
    await expect(page.getByText(/前回の計測を復元しました（10:00 開始）/)).toBeVisible();
    await expect(clock(page)).toHaveText('13:00');
    await expect(page.getByRole('heading', { name: '問題集 第12章' })).toBeVisible();

    await page.getByRole('button', { name: '一時停止' }).click();
    await page.clock.runFor(5 * MIN);
    await page.reload();
    await expect(page.locator('.topbar-title')).toHaveText('一時停止中');
    await expect(clock(page)).toHaveText('13:00');
  });

  test('保存の二重送信を防止（連打しても1件）', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: START }).click();
    await page.clock.runFor(10 * MIN);
    await page.getByRole('button', { name: '学習を終える' }).click();
    const btn = page.getByRole('button', { name: '保存して終了' });
    await btn.evaluate((b: HTMLButtonElement) => {
      b.click();
      b.click();
      b.click();
    });
    await expect(page.locator('.home')).toBeVisible();
    await gotoRecords(page);
    await expect(page.locator('.record-item')).toHaveCount(1);
    await expect(page.locator('.big-total')).toHaveAttribute('aria-label', '17時間46分');
  });

  test('保存失敗時は入力を保持し、再試行できる', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: START }).click();
    await page.clock.runFor(10 * MIN);
    await page.getByRole('button', { name: '学習を終える' }).click();
    await page.locator('#next').fill('残りの問題');
    // IndexedDB への書き込みを失敗させる
    await page.evaluate(() => {
      const w = window as unknown as { __origAdd: unknown };
      w.__origAdd = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function () {
        throw new DOMException('simulated', 'QuotaExceededError');
      };
    });
    await page.getByRole('button', { name: '保存して終了' }).click();
    await expect(page.getByText('保存できませんでした。入力は保持しています。もう一度お試しください。')).toBeVisible();
    await expect(page.locator('#next')).toHaveValue('残りの問題');
    await expect(page.locator('.finish')).toBeVisible();
    await page.evaluate(() => {
      IDBObjectStore.prototype.add = (window as unknown as { __origAdd: typeof IDBObjectStore.prototype.add }).__origAdd;
    });
    await page.getByRole('button', { name: 'もう一度保存する' }).click();
    await expect(page.locator('.home')).toBeVisible();
    await expect(page.locator('.next-title')).toHaveText('残りの問題');
    await page.reload();
    await gotoRecords(page);
    await expect(page.locator('.record-item')).toHaveCount(1);
  });
});

test.describe('記録の編集・削除・再計算', () => {
  test('手動追加 → 編集 → 削除（確認＋元に戻す）で累計が整合', async ({ page }) => {
    await open(page);
    await gotoRecords(page);
    await addManual(page, { date: '2026-10-20', minutes: 30, title: '講義#14', time: '20:15' });
    await expect(page.locator('.big-total')).toHaveAttribute('aria-label', '18時間6分');
    await expect(page.locator('.record-date')).toContainText('10月20日（火） 20:15');

    await closeToasts(page);
    await page.locator('.record-item').click();
    await page.locator('#rec-min').fill('45');
    await page.locator('#rec-note').fill('仕訳があいまい');
    await page.getByRole('button', { name: '変更を保存' }).click();
    await expect(page.locator('.big-total')).toHaveAttribute('aria-label', '18時間21分');
    await expect(page.locator('.record-note')).toHaveText('仕訳があいまい');

    await closeToasts(page);
    await page.locator('.record-item').click();
    await page.getByRole('button', { name: 'この記録を削除' }).click();
    await expect(page.getByText('を削除しますか？')).toBeVisible();
    await page.getByRole('button', { name: '削除する' }).click();
    await expect(page.locator('.big-total')).toHaveAttribute('aria-label', '17時間36分');
    await expect(page.getByText('0件')).toBeVisible();
    await page.getByRole('button', { name: '元に戻す' }).click();
    await expect(page.locator('.record-item')).toHaveCount(1);
    await expect(page.locator('.big-total')).toHaveAttribute('aria-label', '18時間21分');
    await page.reload();
    await expect(page.locator('.big-total')).toHaveAttribute('aria-label', '18時間21分');
  });

  test('基準日以前・未来・不正値は記録できない（二重計上防止）', async ({ page }) => {
    await open(page);
    await gotoRecords(page);
    await addManual(page, { date: '2026-10-07', minutes: 30, title: 'x' });
    await expect(page.locator('#rec-date-err')).toContainText('確認済みの累計」に含まれています');
    await page.locator('#rec-date').fill('2026-11-02');
    await page.getByRole('button', { name: '記録する', exact: true }).click();
    await expect(page.locator('#rec-date-err')).toContainText('未来の日付');
    await page.locator('#rec-date').fill('2026-10-30');
    await page.locator('#rec-min').fill('0');
    await page.getByRole('button', { name: '記録する', exact: true }).click();
    await expect(page.locator('#rec-min-err')).toBeVisible();
    await page.locator('#rec-min').fill('20');
    await page.locator('#rec-title').fill('あ'.repeat(101));
    await page.getByRole('button', { name: '記録する', exact: true }).click();
    await expect(page.locator('#rec-title-err')).toContainText('100文字以内');
    await page.keyboard.press('Escape');
    await expect(page.locator('.big-total')).toHaveAttribute('aria-label', '17時間36分');
  });
});

test.describe('入力', () => {
  test('次の一歩は80文字まで（仕様の文言でエラー）、HTMLは文字として扱う', async ({ page }) => {
    await open(page);
    await page.locator('.next-body').click();
    await page.locator('#edit-text').fill('あ'.repeat(81));
    await expect(page.getByText('次の一手は80文字以内で入力してください。')).toBeVisible();
    await expect(page.getByRole('button', { name: '保存する' })).toBeDisabled();
    await page.locator('#edit-text').fill('<img src=x onerror="window.__xss=1">');
    await page.getByRole('button', { name: '保存する' }).click();
    await expect(page.locator('.next-title')).toHaveText('<img src=x onerror="window.__xss=1">');
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test('きっかけを設定できる（ホームの空欄 → プラン）', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: /きっかけを決める/ }).click();
    await page.getByRole('button', { name: '昼食後にコーヒーを淹れたら' }).click();
    await page.getByRole('button', { name: 'プランを保存' }).click();
    await expect(page.locator('.thread-cue')).toHaveText('昼食後にコーヒーを淹れたら');
  });

  test('一手が曖昧なときは具体化のヒント（保存は妨げない）', async ({ page }) => {
    await open(page);
    await page.locator('.next-body').click();
    await page.locator('#edit-text').fill('簿記の勉強');
    await expect(page.locator('.hint')).toContainText('何を・どこまで');
    await page.locator('#edit-text').fill('第11章の問題を3問');
    await expect(page.locator('.hint')).toHaveCount(0);
    await page.locator('#edit-text').fill('簿記の勉強');
    await page.getByRole('button', { name: '保存する' }).click();
    await expect(page.locator('.next-title')).toHaveText('簿記の勉強');
  });
});

test.describe('再開ホーム', () => {
  test('最後の実記録から2日以上空くと「また、ここから。」', async ({ page }) => {
    await open(page);
    await setNext(page, '問題集 第12章の続き');
    await gotoRecords(page);
    await addManual(page, { date: '2026-10-30', minutes: 20, title: '問題集 第11章' });
    await gotoToday(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('また、ここから。');
    await expect(page.getByText('前回の続きから', { exact: true })).toBeVisible();
    await expect(page.getByText('最後の学習：10月30日（金）')).toBeVisible();
    await expect(page.getByRole('button', { name: /しおりから始める/ })).toContainText('問題集 第12章の続き');
    await expect(page.getByRole('button', { name: /小さな一手で始める/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /プランを1つ変える/ })).toBeVisible();
    // 空白日数・失敗の表示はしない
    await expect(page.getByText(/日ぶり|日空き|連続|失敗/)).toHaveCount(0);
    await page.getByRole('button', { name: /しおりから始める/ }).click();
    await expect(page.getByRole('heading', { name: '問題集 第12章の続き' })).toBeVisible();
  });

  test('昨日の記録なら通常ホーム', async ({ page }) => {
    await open(page);
    await gotoRecords(page);
    await addManual(page, { date: '2026-10-31', minutes: 20, title: '講義' });
    await gotoToday(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('今日の一手');
  });
});

test.describe('バックアップ・復元・移行', () => {
  test('JSON 書き出し → 消去 → 復元で同じ状態に戻る', async ({ page }) => {
    await open(page);
    await setNext(page, '第13講義');
    await gotoRecords(page);
    await addManual(page, { date: '2026-10-25', minutes: 50, title: '講義#13' });
    await page.goto('/#options');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'バックアップを書き出す' }).click()]);
    expect(dl.suggestedFilename()).toBe('tsuzuku-backup-2026-11-01.json');
    const path = await dl.path();
    const fs = await import('node:fs');
    const json = JSON.parse(fs.readFileSync(path!, 'utf8'));
    expect(json.format).toBe('tsuzuku-backup');
    expect(json.baseline).toEqual({ minutes: 1056, asOf: '2026-10-07' });
    expect(json.records).toHaveLength(1);
    expect(json.settings.nextAction).toBe('第13講義');

    await closeToasts(page);
    await page.getByRole('button', { name: '記録と設定を消去…' }).click();
    await page.getByRole('button', { name: '消去する' }).click();
    await gotoRecords(page);
    await expect(page.locator('.big-total')).toHaveAttribute('aria-label', '17時間36分'); // 基準値は残る

    await page.goto('/#options');
    await page.locator('input[type=file]').setInputFiles(path!);
    await expect(page.getByRole('alertdialog', { name: 'バックアップから復元しますか？' })).toBeVisible();
    await page.getByRole('button', { name: '置き換えて復元する' }).click();
    await expect(page.getByText('復元しました（記録1件）。')).toBeVisible();
    await gotoRecords(page);
    await expect(page.locator('.big-total')).toHaveAttribute('aria-label', '18時間26分');
  });

  test('ダウンロードできない環境向け：コピー → 貼り付けて復元', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page);
    await gotoRecords(page);
    await addManual(page, { date: '2026-10-28', minutes: 35, title: '問題集 第12章' });
    await page.goto('/#options');
    await closeToasts(page);
    await page.getByRole('button', { name: 'バックアップをコピー' }).click();
    await expect(page.getByText(/バックアップをコピーしました（記録1件）/)).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(JSON.parse(copied).records).toHaveLength(1);

    await closeToasts(page);
    await page.getByRole('button', { name: '記録と設定を消去…' }).click();
    await page.getByRole('button', { name: '消去する' }).click();
    await expect(page.getByText('記録と設定を消去しました。')).toBeVisible();
    await page.goto('/#options');
    await page.getByRole('button', { name: '貼り付けて復元' }).click();
    await page.locator('#paste-json').fill(copied);
    await page.getByRole('button', { name: '内容を確認する' }).click();
    await page.getByRole('button', { name: '置き換えて復元する' }).click();
    await gotoRecords(page);
    await expect(page.locator('.big-total')).toHaveAttribute('aria-label', '18時間11分');
  });

  test('ハッシュは単純な名前（#records 等）で、旧形式 #/records も開ける', async ({ page }) => {
    await open(page, '/#/records');
    await expect(page.getByRole('heading', { name: 'これまでの記録。' })).toBeVisible();
    await page.goto('/#options');
    await expect(page.getByRole('heading', { name: '設定' })).toBeVisible();
    await gotoToday(page);
    expect(new URL(page.url()).hash).not.toContain('/');
    await page.getByRole('button', { name: START }).click();
    await expect(page).toHaveURL(/#session$/);
  });

  test('不正なファイル・基準値の異なるファイルは読み込まない', async ({ page }) => {
    await open(page, '/#options');
    await page.locator('input[type=file]').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
    await expect(page.getByText('読み込めませんでした：JSONファイルとして読み込めませんでした。')).toBeVisible();
    const bad = { format: 'tsuzuku-backup', schemaVersion: 1, baseline: { minutes: 9999, asOf: '2026-10-07' }, settings: {}, records: [] };
    await page.locator('input[type=file]').setInputFiles({ name: 'y.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
    await expect(page.getByText(/一致しないため読み込めません/)).toBeVisible();
  });

  test('v3.1 データは明示的な操作で、基準日以前を除いて取り込む', async ({ page }) => {
    await open(page, '/#options');
    const v3 = {
      format: 'tsuzuku-v3', version: 3, baselineMinutes: 1056, baselineDate: '2026-10-07',
      settings: { goal: '日商簿記3級', nextStep: '第14講義の途中から', cue: '朝食後' },
      records: [
        { id: 'a', day: '2026-10-25', title: '講義#14', kind: '講義', note: '', minutes: 25, createdAt: '2026-10-25T03:00:00.000Z' },
        { id: 'b', day: '2026-10-05', title: '古い記録', kind: '問題演習', note: '', minutes: 30, createdAt: '2026-10-05T03:00:00.000Z' },
      ],
      pending: null, events: [],
    };
    await page.locator('input[type=file]').setInputFiles({ name: 'v3.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v3)) });
    const dlg = page.getByRole('dialog', { name: '試作版（v3.1）から取り込む' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByText(/二重計上を防ぐため取り込みません/)).toBeVisible();
    await dlg.getByRole('button', { name: '1件を取り込む' }).click();
    await expect(page.getByText('1件の記録を取り込みました。')).toBeVisible();
    await gotoRecords(page);
    await expect(page.locator('.big-total')).toHaveAttribute('aria-label', '18時間1分');
    await expect(page.locator('.record-date')).toContainText('講義');
    await gotoToday(page);
    // 取り込んだ最後の記録（10/25）から日が空いているので再開画面。しおりは引き継がれる
    await expect(page.getByRole('button', { name: /しおりから始める/ })).toContainText('第14講義の途中から');
  });
});

test.describe('キーボード操作', () => {
  test('Tab と Enter/Space だけで開始・一時停止・ダイアログ操作ができる', async ({ page }) => {
    await open(page);
    // 学習を始めるにフォーカスが届くまで Tab
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      if ((await page.evaluate(() => document.activeElement?.textContent)) === '学習を始める') break;
    }
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('学習を始める');
    // フォーカスが見える（box-shadow のフォーカスリング）
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement!).boxShadow);
    expect(ring).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(page.locator('.session')).toBeVisible();

    await page.getByRole('button', { name: '一時停止' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: '再開' })).toBeVisible();

    const stop = page.getByRole('button', { name: '中断' });
    await stop.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    // 初期フォーカスはダイアログ内
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toBeHidden();
    // 閉じたら元のボタンへ
    await expect(stop).toBeFocused();
  });
});

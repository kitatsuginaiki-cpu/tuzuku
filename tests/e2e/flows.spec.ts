import { expect, test } from '@playwright/test';
import { addManual, card, clock, closeToasts, editHabit, gotoRecords, gotoToday, MIN, open, setup } from './helpers';

const BOKI = '簿記3級';
const BOOKMARK = '問題集 第12章 問1〜3を解く';
const start = (page: import('@playwright/test').Page) => card(page, BOKI).getByRole('button', { name: /しおりから始める|^始める$/ }).click();
const total = (page: import('@playwright/test').Page) => page.locator('.big-total');

test.describe('初回・空状態', () => {
  test('はじめては習慣を選ぶだけ。架空の記録は作らない', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('heading', { name: '何をつづけますか？' })).toBeVisible();
    await expect(page.locator('.habit-card')).toHaveCount(0);
    await expect(page.locator('.buddy')).toHaveCount(0); // 習慣がないうちはキャラクターも出さない
    await expect(page.getByRole('button', { name: '習慣を選んでください' })).toBeDisabled();
    await setup(page, ['boki']);
    await expect(card(page, BOKI).getByText('17時間36分')).toBeVisible();
    await expect(page.getByText(/連続|日目|失敗/)).toHaveCount(0);
    await gotoRecords(page);
    await expect(total(page)).toHaveText('17時間36分');
    await expect(page.getByText('0件')).toBeVisible();
    await expect(page.locator('.record-item')).toHaveCount(0);
    await expect(page.locator('.bars')).toHaveCount(0);
  });

  test('基準値を含めない選択もできる（0から積み上げ）', async ({ page }) => {
    await open(page);
    await setup(page, ['boki'], { baseline: false });
    await expect(card(page, BOKI).locator('.hc-total .num')).toHaveText('0分');
  });

  test('しおりを空にしても始められ、内容は終了時に入力できる', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await editHabit(page, BOKI);
    await page.locator('#habit-nextAction').fill('');
    await page.getByRole('button', { name: '保存する' }).click();
    await card(page, BOKI).getByRole('button', { name: '始める', exact: true }).click();
    await expect(page.getByText('内容は終了時に入力できます')).toBeVisible();
    await page.clock.runFor(12 * MIN);
    await page.getByRole('button', { name: '終える', exact: true }).click();
    await expect(page.locator('#did')).toHaveValue('');
    await expect(page.getByText('空欄の場合は「簿記3級」として記録します')).toBeVisible();
    await page.locator('#did').fill('講義#14を見る');
    await page.getByRole('button', { name: '保存して終了' }).click();
    await expect(page.locator('.home')).toBeVisible();
    await gotoRecords(page);
    await expect(page.locator('.record-title')).toHaveText('講義#14を見る');
    await expect(total(page)).toHaveText('17時間48分');
  });
});

test.describe('通常フロー（時間で記録）', () => {
  test('しおりから開始・進捗と数値の整合・しおりの引き継ぎ・積み上げの再計算', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await start(page);
    await expect(page.getByRole('heading', { name: BOOKMARK })).toBeVisible();
    await expect(clock(page)).toHaveText('20:00');
    await expect(page.locator('.bottomnav')).toHaveCount(0);

    await page.clock.runFor(5 * MIN);
    await expect(clock(page)).toHaveText('15:00');
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');

    await page.getByRole('button', { name: '終える', exact: true }).click();
    await expect(page.getByRole('heading', { name: '簿記3級、おつかれさま。' })).toBeVisible();
    await expect(page.locator('.big-num .num')).toHaveText('5');
    await expect(page.locator('#did')).toHaveValue(BOOKMARK);
    await page.locator('#next').fill('問題集 第12章 問4〜6を解く');
    await page.getByRole('button', { name: '保存して終了' }).click();

    await expect(page.locator('.home')).toBeVisible();
    await expect(page.getByText('5分を積み上げました。')).toBeVisible();
    await expect(card(page, BOKI).locator('.hc-plan')).toContainText('問題集 第12章 問4〜6を解く');
    await expect(card(page, BOKI).locator('.hc-total .num')).toHaveText('17時間41分');
    await expect(card(page, BOKI).locator('.hc-status')).toHaveText('やった');
    await gotoRecords(page);
    await expect(total(page)).toHaveText('17時間41分');
    await expect(page.getByText('1件')).toBeVisible();
    await expect(page.getByText('直近14日間')).toBeVisible();
  });

  test('実時間を保存前に修正できる', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await start(page);
    await page.clock.runFor(40 * MIN);
    await page.getByRole('button', { name: '終える', exact: true }).click();
    await page.getByRole('button', { name: '時間を修正' }).click();
    await page.locator('#minutes').fill('25');
    await page.getByRole('button', { name: '保存して終了' }).click();
    await gotoRecords(page);
    await expect(total(page)).toHaveText('18時間1分');
  });

  test('1分未満の計測は切り上げず、分数の入力を求める', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await start(page);
    await page.clock.runFor(20_000);
    await page.getByRole('button', { name: '終える', exact: true }).click();
    await expect(page.getByText('計測は1分未満でした')).toBeVisible();
    await page.getByRole('button', { name: '保存して終了' }).click();
    await expect(page.locator('#minutes-err')).toBeVisible();
    await expect(page.locator('.finish')).toBeVisible();
  });

  test('終了画面から戻ると計測が再開し、終了画面にいた時間は含めない', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await start(page);
    await page.clock.runFor(4 * MIN);
    await page.getByRole('button', { name: '終える', exact: true }).click();
    await page.clock.runFor(3 * MIN);
    await page.getByRole('button', { name: '学習中の画面に戻る' }).click();
    await expect(clock(page)).toHaveText('16:00');
  });
});

test.describe('一時停止・中断', () => {
  test('一時停止中は時間が進まず、再開で続きから', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await start(page);
    await page.clock.runFor(3 * MIN);
    await page.getByRole('button', { name: '一時停止' }).click();
    await expect(page.locator('.topbar-title')).toHaveText('一時停止中');
    await page.clock.runFor(10 * MIN);
    await expect(clock(page)).toHaveText('17:00');
    await page.getByRole('button', { name: '再開' }).click();
    await page.clock.runFor(1 * MIN);
    await expect(clock(page)).toHaveText('16:00');
    await page.getByRole('button', { name: '終える', exact: true }).click();
    await expect(page.locator('.big-num .num')).toHaveText('4');
    await expect(page.getByText('（一時停止 10分を除く）')).toBeVisible();
  });

  test('中断：戻る／記録して終了／記録せず終了（元に戻せる）', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await start(page);
    await page.clock.runFor(6 * MIN);
    await page.getByRole('button', { name: '中断' }).click();
    const dlg = page.getByRole('alertdialog', { name: '計測を中断しますか？' });
    await expect(dlg.getByText('今回の計測は破棄されます')).toBeVisible();
    await dlg.getByRole('button', { name: '戻る' }).click();
    await expect(dlg).toBeHidden();

    await page.getByRole('button', { name: '中断' }).click();
    await dlg.getByRole('button', { name: '記録せず終了' }).click();
    await expect(page.locator('.home')).toBeVisible();
    await page.getByRole('button', { name: '元に戻す' }).click();
    await expect(page.locator('.session')).toBeVisible();
    await expect(clock(page)).toHaveText('14:00');

    await page.getByRole('button', { name: '中断' }).click();
    await dlg.getByRole('button', { name: '記録して終了' }).click();
    await expect(page.getByRole('heading', { name: '簿記3級、おつかれさま。' })).toBeVisible();
  });

  test('計測中は今日の画面に戻れ、別の時間型の習慣は同時に始めない', async ({ page }) => {
    await open(page);
    await setup(page, ['boki', 'reading']);
    await start(page);
    await page.getByRole('button', { name: 'ホームに戻る（計測は続きます）' }).click();
    await expect(page.locator('.active-row')).toContainText('簿記3級 計測中');
    await expect(card(page, BOKI).getByRole('button', { name: '計測中の画面へ' })).toBeVisible();
    // 日数型はタップで記録できる（計測とは独立）
    await card(page, '読書').getByRole('button', { name: 'やった', exact: true }).click();
    await expect(card(page, '読書').getByText('今日はやった')).toBeVisible();
  });
});

test.describe('復帰・永続化', () => {
  test('バックグラウンド復帰：経過時刻から再計算し、離れていた時間を知らせる', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await start(page);
    await page.clock.runFor(2 * MIN);
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
    await setup(page, ['boki']);
    await start(page);
    await page.clock.runFor(7 * MIN);
    await page.reload();
    await expect(page.locator('.session')).toBeVisible();
    await expect(page.getByText(/前回の計測を復元しました（10:00 開始）/)).toBeVisible();
    await expect(clock(page)).toHaveText('13:00');
    await page.getByRole('button', { name: '一時停止' }).click();
    await page.clock.runFor(5 * MIN);
    await page.reload();
    await expect(page.locator('.topbar-title')).toHaveText('一時停止中');
    await expect(clock(page)).toHaveText('13:00');
  });

  test('保存の二重送信を防止（連打しても1件）', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await start(page);
    await page.clock.runFor(10 * MIN);
    await page.getByRole('button', { name: '終える', exact: true }).click();
    await page.getByRole('button', { name: '保存して終了' }).evaluate((b: HTMLButtonElement) => {
      b.click();
      b.click();
      b.click();
    });
    await expect(page.locator('.home')).toBeVisible();
    await gotoRecords(page);
    await expect(page.locator('.record-item')).toHaveCount(1);
    await expect(total(page)).toHaveText('17時間46分');
  });

  test('保存失敗時は入力を保持し、再試行できる', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await start(page);
    await page.clock.runFor(10 * MIN);
    await page.getByRole('button', { name: '終える', exact: true }).click();
    await page.locator('#next').fill('残りの問題');
    await page.evaluate(() => {
      const w = window as unknown as { __origPut: unknown };
      w.__origPut = IDBObjectStore.prototype.put;
      const orig = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...a: Parameters<typeof orig>) {
        if (this.name === 'records') throw new DOMException('simulated', 'QuotaExceededError');
        return orig.apply(this, a);
      };
    });
    await page.getByRole('button', { name: '保存して終了' }).click();
    await expect(page.getByText('保存できませんでした。入力は保持しています。もう一度お試しください。')).toBeVisible();
    await expect(page.locator('#next')).toHaveValue('残りの問題');
    await page.evaluate(() => {
      IDBObjectStore.prototype.put = (window as unknown as { __origPut: typeof IDBObjectStore.prototype.put }).__origPut;
    });
    await page.getByRole('button', { name: 'もう一度保存する' }).click();
    await expect(page.locator('.home')).toBeVisible();
    await expect(card(page, BOKI).locator('.hc-plan')).toContainText('残りの問題');
    await page.reload();
    await gotoRecords(page);
    await expect(page.locator('.record-item')).toHaveCount(1);
  });
});

test.describe('記録の編集・削除・再計算', () => {
  test('手動追加 → 編集 → 削除（確認＋元に戻す）で積み上げが整合', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await gotoRecords(page);
    await addManual(page, { date: '2026-10-20', minutes: 30, title: '講義#14', time: '20:15' });
    await expect(total(page)).toHaveText('18時間6分');
    await expect(page.locator('.record-date')).toContainText('10月20日（火） 20:15');
    await closeToasts(page);
    await page.locator('.record-item').click();
    await page.locator('#rec-min').fill('45');
    await page.locator('#rec-note').fill('仕訳があいまい');
    await page.getByRole('button', { name: '変更を保存' }).click();
    await expect(total(page)).toHaveText('18時間21分');
    await closeToasts(page);
    await page.locator('.record-item').click();
    await page.getByRole('button', { name: 'この記録を削除' }).click();
    await page.getByRole('button', { name: '削除する' }).click();
    await expect(total(page)).toHaveText('17時間36分');
    await page.getByRole('button', { name: '元に戻す' }).click();
    await expect(page.locator('.record-item')).toHaveCount(1);
    await expect(total(page)).toHaveText('18時間21分');
    await page.reload();
    await expect(total(page)).toHaveText('18時間21分');
  });

  test('基準日以前・未来・不正値は記録できない（二重計上防止）', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await gotoRecords(page);
    await page.getByRole('button', { name: '計測しなかった時間を記録する' }).click();
    await page.locator('#rec-date').fill('2026-10-07');
    await page.locator('#rec-min').fill('30');
    await page.locator('#rec-title').fill('x');
    await page.getByRole('button', { name: '記録する', exact: true }).click();
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
    await expect(total(page)).toHaveText('17時間36分');
  });
});

test.describe('入力', () => {
  test('しおりは80文字まで、HTMLは文字として扱う', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await editHabit(page, BOKI);
    await page.locator('#habit-nextAction').fill('あ'.repeat(81));
    await page.getByRole('button', { name: '保存する' }).click();
    await expect(page.locator('#habit-nextAction-err')).toHaveText('しおりは80文字以内で入力してください。');
    await page.locator('#habit-nextAction').fill('<img src=x onerror="window.__xss=1">');
    await page.getByRole('button', { name: '保存する' }).click();
    await expect(card(page, BOKI).locator('.hc-plan')).toContainText('<img src=x onerror="window.__xss=1">');
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test('しおりが曖昧なときは具体化のヒント（保存は妨げない）', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await editHabit(page, BOKI);
    await page.locator('#habit-nextAction').fill('簿記の勉強');
    await expect(page.locator('#habit-next-help')).toContainText('何を・どこまで');
    await page.getByRole('button', { name: '保存する' }).click();
    await expect(card(page, BOKI).locator('.hc-plan')).toContainText('簿記の勉強');
  });
});

test.describe('再開', () => {
  test('最後の記録から2日以上空くと、その習慣に「また、ここから。」。空白日数や失敗は表示しない', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await gotoRecords(page);
    await addManual(page, { date: '2026-10-30', minutes: 20, title: '問題集 第11章' });
    await gotoToday(page);
    await expect(card(page, BOKI).locator('.hc-resume')).toHaveText('また、ここから。しおりは残っています。');
    await expect(page.getByText(/日ぶり|日空き|連続|失敗/)).toHaveCount(0);
    await start(page);
    await expect(page.getByRole('heading', { name: BOOKMARK })).toBeVisible();
  });

  test('昨日の記録なら再開表示は出ない', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await gotoRecords(page);
    await addManual(page, { date: '2026-10-31', minutes: 20, title: '講義' });
    await gotoToday(page);
    await expect(card(page, BOKI).locator('.hc-resume')).toHaveCount(0);
  });
});

test.describe('バックアップ・復元・移行', () => {
  test('JSON 書き出し → 消去 → 復元で同じ状態に戻る（習慣ごと）', async ({ page }) => {
    await open(page);
    await setup(page, ['boki', 'reading']);
    await card(page, '読書').getByRole('button', { name: 'やった', exact: true }).click();
    await gotoRecords(page, BOKI);
    await addManual(page, { date: '2026-10-25', minutes: 50, title: '講義#13' });
    await page.goto('/#options');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'バックアップを書き出す' }).click()]);
    expect(dl.suggestedFilename()).toBe('tsuzuku-backup-2026-11-01.json');
    const path = await dl.path();
    const fs = await import('node:fs');
    const json = JSON.parse(fs.readFileSync(path!, 'utf8'));
    expect(json.format).toBe('tsuzuku-backup');
    expect(json.schemaVersion).toBe(3);
    expect(json.baseline).toEqual({ minutes: 1056, asOf: '2026-10-07' });
    expect(json.habits).toHaveLength(2);
    expect(json.records).toHaveLength(2);

    await closeToasts(page);
    await page.getByRole('button', { name: '記録と設定を消去…' }).click();
    await page.getByRole('button', { name: '消去する' }).click();
    await gotoToday(page);
    await expect(page.getByRole('heading', { name: '何をつづけますか？' })).toBeVisible();

    await page.goto('/#options');
    await page.locator('input[type=file]').setInputFiles(path!);
    await expect(page.getByRole('alertdialog', { name: 'バックアップから復元しますか？' })).toBeVisible();
    await page.getByRole('button', { name: '置き換えて復元する' }).click();
    await expect(page.getByText('復元しました（記録2件）。')).toBeVisible();
    await gotoRecords(page, BOKI);
    await expect(total(page)).toHaveText('18時間26分');
    await gotoToday(page);
    await expect(card(page, '読書').getByText('今日はやった')).toBeVisible();
  });

  test('ダウンロードできない環境向け：コピー → 貼り付けて復元', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page);
    await setup(page, ['boki']);
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
    await expect(page.locator('.home')).toBeVisible();
    await page.goto('/#options');
    await page.getByRole('button', { name: '貼り付けて復元' }).click();
    await page.locator('#paste-json').fill(copied);
    await page.getByRole('button', { name: '内容を確認する' }).click();
    await page.getByRole('button', { name: '置き換えて復元する' }).click();
    await gotoRecords(page);
    await expect(total(page)).toHaveText('18時間11分');
  });

  test('v6 のバックアップ（単一プラン）も読み込め、簿記の習慣になる', async ({ page }) => {
    await open(page, '/#options');
    const v6 = {
      format: 'tsuzuku-backup',
      schemaVersion: 2,
      exportedAt: '2026-10-31T00:00:00.000Z',
      baseline: { minutes: 1056, asOf: '2026-10-07' },
      settings: { subject: '簿記3級', nextAction: '第13講義', cue: '朝食後', planDays: [1, 2, 3, 4, 5], supportMode: 'plan', weeklyReview: true },
      records: [{ id: 'v6a', studyDate: '2026-10-25', startedAt: null, endedAt: null, minutes: 50, measuredSeconds: null, pausedSeconds: null, title: '講義#13', note: '', source: 'manual', createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z' }],
      reviews: [],
    };
    await page.locator('input[type=file]').setInputFiles({ name: 'v6.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v6)) });
    await page.getByRole('button', { name: '置き換えて復元する' }).click();
    await gotoToday(page);
    await expect(card(page, BOKI).locator('.hc-plan')).toContainText('第13講義');
    await expect(card(page, BOKI).locator('.hc-total .num')).toHaveText('18時間26分');
  });

  test('ハッシュは単純な名前（#records 等）で、旧形式 #/records と v6 の #plan も開ける', async ({ page }) => {
    await open(page, '/#/records');
    await expect(page.getByRole('heading', { name: '記録', level: 1 })).toBeVisible();
    await page.goto('/#plan');
    await expect(page.locator('.home')).toBeVisible();
    await page.goto('/#stack');
    await expect(page.getByRole('heading', { name: '積み上げ', level: 1 })).toBeVisible();
    await page.goto('/#options');
    await expect(page.getByRole('heading', { name: '設定' })).toBeVisible();
  });

  test('不正なファイル・基準値の異なるファイルは読み込まない', async ({ page }) => {
    await open(page, '/#options');
    await page.locator('input[type=file]').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
    await expect(page.getByText('読み込めませんでした：JSONファイルとして読み込めませんでした。')).toBeVisible();
    const bad = { format: 'tsuzuku-backup', schemaVersion: 1, baseline: { minutes: 9999, asOf: '2026-10-07' }, settings: {}, records: [] };
    await page.locator('input[type=file]').setInputFiles({ name: 'y.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
    await expect(page.getByText(/一致しないため読み込めません/)).toBeVisible();
  });

  test('v3.1 データは明示的な操作で、基準日以前を除いて簿記に取り込む', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await page.goto('/#options');
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
    await expect(dlg.getByText(/二重計上を防ぐため取り込みません/)).toBeVisible();
    await dlg.getByRole('button', { name: '1件を取り込む' }).click();
    await expect(page.getByText('1件の記録を取り込みました。')).toBeVisible();
    await gotoRecords(page);
    await expect(total(page)).toHaveText('18時間1分');
  });
});

test.describe('キーボード操作', () => {
  test('Tab と Enter/Space だけで開始・一時停止・ダイアログ操作ができる', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      if ((await page.evaluate(() => document.activeElement?.textContent)) === 'しおりから始める') break;
    }
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('しおりから始める');
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
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toBeHidden();
    await expect(stop).toBeFocused();
  });
});

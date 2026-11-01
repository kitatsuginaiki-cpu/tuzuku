import { expect, test, type Page } from '@playwright/test';
import { addManual, addPastDay, card, clock, closeToasts, editHabit, gotoRecords, gotoStack, gotoToday, MIN, NOW, open, setup } from './helpers';

const BOKI = '簿記3級';
const READ = '読書';

test.describe('複数の習慣：時間で記録・日数で記録', () => {
  test('日数型は「やった」のワンタップ。取り消せる。1日1回', async ({ page }) => {
    await open(page);
    await setup(page, ['boki', 'reading', 'room']);
    await expect(page.locator('.habit-card')).toHaveCount(3);
    await expect(card(page, BOKI).getByRole('button', { name: 'しおりから始める' })).toBeVisible(); // 時間型は計測
    const r = card(page, READ);
    await r.getByRole('button', { name: 'やった', exact: true }).click();
    await expect(page.getByText('読書：やった日に記録しました。')).toBeVisible();
    await expect(r.getByText('今日はやった')).toBeVisible();
    await expect(r.locator('.hc-total .num')).toHaveText('1日');
    await expect(r.getByRole('button', { name: 'やった', exact: true })).toHaveCount(0);
    // 通知から取り消し
    await page.getByRole('button', { name: '取り消す' }).last().click();
    await expect(r.locator('.hc-total .num')).toHaveText('0日');
    await closeToasts(page);
    // カード内からも取り消せる
    await r.getByRole('button', { name: 'やった', exact: true }).click();
    await closeToasts(page);
    await r.getByRole('button', { name: '取り消す' }).click();
    await expect(r.getByRole('button', { name: 'やった', exact: true })).toBeVisible();
  });

  test('できない日の組：日数型は「代わりにやること」で記録、時間型は目安の分で計測を始める', async ({ page }) => {
    await open(page);
    await setup(page, ['boki', 'reading']);
    await card(page, READ).getByRole('button', { name: 'できない日は' }).click();
    const dlg = page.getByRole('dialog', { name: '読書：できない日は' });
    await expect(dlg.getByRole('button', { name: /眠いなら.*1ページ読んでしおりを挟む/ })).toBeVisible();
    await expect(dlg.locator('.choice')).toHaveCount(4); // 組3つ＋休む
    await dlg.getByRole('button', { name: /眠いなら/ }).click();
    await expect(card(page, READ).locator('.hc-status')).toHaveText('小さな一手');
    await expect(card(page, READ).locator('.hc-total .num')).toHaveText('1日'); // 小さな一手も1日に数える
    await closeToasts(page);

    await card(page, BOKI).getByRole('button', { name: 'できない日は' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /集中が続かないなら.*講義を5分見て1文メモ（5分）/ }).click();
    await expect(page.getByRole('heading', { name: '講義を5分見て1文メモ' })).toBeVisible();
    await expect(clock(page)).toHaveText('05:00');
    await page.clock.runFor(6 * MIN);
    await expect(page.getByText(/小さな一手の5分になりました/)).toBeVisible();
    await page.getByRole('button', { name: '終える', exact: true }).click();
    // 小さな一手のあとはしおりがそのまま残る
    await expect(page.locator('#next')).toHaveValue('問題集 第12章 問1〜3を解く');
    await page.getByRole('button', { name: '保存して終了' }).click();
    await expect(page.locator('.home')).toBeVisible();
    await gotoRecords(page, BOKI);
    await expect(page.locator('.record-note')).toHaveText('こんな日は：集中が続かない');
    await expect(page.locator('.tag')).toHaveText('小さな一手');
  });

  test('休むと決めた日：積み上げは減らず、途切れにも数えない', async ({ page }) => {
    await open(page);
    await setup(page, ['reading']);
    await card(page, READ).getByRole('button', { name: 'できない日は' }).click();
    await page.getByRole('button', { name: /今日は休むと決める/ }).click();
    await expect(page.getByText('読書：今日は休むと決めました。積み上げはそのままです。')).toBeVisible();
    await expect(card(page, READ).locator('.hc-status')).toHaveText('休みの日');
    await expect(card(page, READ).locator('.hc-total .num')).toHaveText('0日');
    await gotoStack(page);
    await expect(page.getByText('やった日 0日（うち小さな一手 0日）・休むと決めた日 1日')).toBeVisible();
    await expect(page.locator('.tiles .tile.is-rest')).toHaveCount(1);
  });

  test('習慣の追加・編集・しまう（記録は残る）。記録がある習慣は記録のしかたを変えられない', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await page.getByRole('button', { name: '＋ 習慣を追加' }).click();
    await expect(page.getByRole('heading', { name: '何を、いつ始める？' })).toBeVisible();
    await page.getByRole('button', { name: '追加する' }).click();
    await expect(page.locator('#habit-name-err')).toHaveText('名前を入力してください。');
    await page.locator('#habit-name').fill('ストレッチ');
    await expect(page.getByRole('radio', { name: /日数で記録/ })).toBeChecked(); // 新規は日数型が既定
    await page.locator('#habit-cue').fill('お風呂から出たら');
    await page.getByRole('button', { name: '＋ 組を追加' }).click();
    await page.locator('#habit-when0').fill('疲れている');
    await page.locator('#habit-instead0').fill('前屈を1回だけ');
    await expect(page.getByRole('switch', { name: 'この習慣を仲間に見せる' })).not.toBeChecked(); // 共有は既定オフ
    await page.getByRole('button', { name: '追加する' }).click();
    await expect(page.getByText('「ストレッチ」を追加しました。')).toBeVisible();
    const s = card(page, 'ストレッチ');
    await expect(s.locator('.hc-plan')).toContainText('お風呂から出たら');
    await s.getByRole('button', { name: 'やった', exact: true }).click();
    await closeToasts(page);

    await editHabit(page, 'ストレッチ');
    await expect(page.getByRole('radio', { name: /時間で記録/ })).toBeDisabled();
    await expect(page.getByText('記録があるため、記録のしかたは変えられません')).toBeVisible();
    await page.getByRole('button', { name: 'この習慣をしまう' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'しまう' }).click();
    await expect(page.locator('.habit-card')).toHaveCount(1);
    await gotoStack(page);
    await page.getByText('しまった習慣（1）').click();
    await expect(page.locator('.stack-archived')).toContainText('ストレッチ：1日');
  });
});

test.describe('積み上げ：減らない・節目', () => {
  test('時間型はブロック（基準値は土台として別の色）。節目を越えると一度だけ知らせる', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await gotoStack(page);
    await expect(page.locator('.stack-total')).toHaveText('17時間36分');
    await expect(page.locator('.blocks')).toHaveAttribute('aria-label', /30分のブロックが35個。うち35個は確認済みの累計（土台）。端数6分。/);
    await expect(page.locator('.block.is-base')).toHaveCount(35 + 1); // 凡例の1つを含む
    await expect(page.getByText(/次の節目 25時間 まで あと7時間24分/)).toBeVisible();

    await gotoRecords(page);
    await addManual(page, { date: '2026-10-31', minutes: 444, title: 'まとめて演習' });
    await expect(page.getByText('節目：簿記3級 が 25時間 に到達しました。')).toBeVisible();
    await gotoStack(page);
    await expect(page.locator('.stack-total')).toHaveText('25時間0分');
    await expect(page.getByText('到達した節目：25時間')).toBeVisible();
    await expect(page.getByText(/次の節目 50時間/)).toBeVisible();

    // 削除して戻して再び越えても、同じ節目は再通知しない
    await gotoRecords(page);
    await closeToasts(page);
    await page.locator('.record-item').click();
    await page.getByRole('button', { name: 'この記録を削除' }).click();
    await page.getByRole('button', { name: '削除する' }).click();
    await page.getByRole('button', { name: '元に戻す' }).click();
    await expect(page.locator('.record-item')).toHaveCount(1);
    await expect(page.getByText(/節目：/)).toHaveCount(0);
  });

  test('日数型はタイル。間があいても合計は減らない', async ({ page }) => {
    await open(page);
    await setup(page, ['reading']);
    await gotoRecords(page);
    await addPastDay(page, '2026-10-20');
    await addPastDay(page, '2026-10-21', '小さな一手');
    await closeToasts(page);
    await gotoStack(page);
    await expect(page.locator('.stack-total')).toHaveText('2日');
    await expect(page.locator('.tile.is-done')).toHaveCount(1 + 1); // 凡例を含む
    await expect(page.locator('.tile.is-small')).toHaveCount(1 + 1);
    await expect(page.getByText(/次の節目 10日 まで あと8日/)).toBeVisible();
    // 日数型は同じ日に2件記録できない
    await gotoRecords(page);
    await page.getByRole('button', { name: '過去の日を記録する' }).click();
    await page.locator('#rec-date').fill('2026-10-20');
    await page.getByRole('button', { name: '記録する', exact: true }).click();
    await expect(page.locator('#rec-date-err')).toContainText('この日はすでに記録があります');
  });
});

/** 10/25 に使い始め、11/1 に開き直す（その間は記録なし） */
async function startedAWeekAgo(page: Page, keys: Parameters<typeof setup>[1]) {
  await open(page, '/', new Date('2026-10-25T10:00:00+09:00'));
  await setup(page, keys);
  await card(page, READ).getByRole('button', { name: 'やった', exact: true }).click();
  await closeToasts(page);
  const p2 = await page.context().newPage();
  await page.close();
  await open(p2, '/', NOW);
  return p2;
}

test.describe('キャラクター「つづ」', () => {
  test('ふつう：予定の日に記録がない日が続くと心配。やると嬉しそうになる', async ({ page }) => {
    const p = await startedAWeekAgo(page, ['reading']);
    const buddy = p.locator('.buddy');
    await expect(buddy).toHaveClass(/is-worried/);
    await expect(buddy.getByRole('img', { name: 'つづ：心配そう' })).toBeVisible();
    await expect(buddy.getByText('予定の日に6日、記録がありません')).toBeVisible();
    await card(p, READ).getByRole('button', { name: 'やった', exact: true }).click();
    await expect(buddy).toHaveClass(/is-happy/);
    await expect(buddy.getByRole('img', { name: 'つづ：嬉しそう' })).toBeVisible();
  });

  test('きびしい：3日以上あくと怒る。小さな一手でもすぐ嬉しそうに戻る（再開を罰しない）', async ({ page }) => {
    const p = await startedAWeekAgo(page, ['reading']);
    await p.goto('/#options');
    await p.getByRole('radio', { name: /きびしい/ }).check();
    await gotoToday(p);
    await expect(p.locator('.buddy')).toHaveClass(/is-angry/);
    await expect(p.locator('.buddy-line')).not.toHaveText(/ダメ|失敗|サボ/);
    await card(p, READ).getByRole('button', { name: 'できない日は' }).click();
    await p.getByRole('button', { name: /眠いなら/ }).click();
    await expect(p.locator('.buddy')).toHaveClass(/is-happy/);
  });

  test('やさしい：怒り・心配の顔は出さない。キャラクターはオフにもできる', async ({ page }) => {
    const p = await startedAWeekAgo(page, ['reading']);
    await p.goto('/#options');
    await p.getByRole('radio', { name: /やさしい/ }).check();
    await gotoToday(p);
    await expect(p.locator('.buddy')).toHaveClass(/is-waiting/);
    await p.goto('/#options');
    await p.getByRole('switch', { name: '今日の画面にキャラクターを表示する' }).uncheck();
    await gotoToday(p);
    await expect(p.locator('.buddy')).toHaveCount(0);
  });

  test('休むと決めた日・予定のない日は途切れに数えない', async ({ page }) => {
    await open(page, '/', new Date('2026-10-30T10:00:00+09:00'));
    await setup(page, ['note']); // 日曜だけ
    const buddy = page.locator('.buddy');
    await expect(buddy).toHaveClass(/is-normal/);
    await expect(buddy.getByText('今日は予定のない日です')).toBeVisible();
  });

  test('設定画面で5つの表情を確認できる', async ({ page }) => {
    await open(page, '/#options');
    const g = page.getByRole('list', { name: '表情の一覧' });
    for (const l of ['嬉しそう', 'いつもどおり', '待っている', '心配そう', '怒っている']) await expect(g.getByText(l)).toBeVisible();
  });
});

test.describe('戻り方：週の見直し（習慣ごと）', () => {
  test('7日後に静かに提案 → 習慣を選んで事実を見る → 1つ選ぶとその習慣の該当欄へ', async ({ page }) => {
    const p = await startedAWeekAgo(page, ['boki', 'reading']);
    await expect(p.getByRole('heading', { name: '週の見直し（1分）' })).toBeVisible();
    await p.getByRole('button', { name: '見直す' }).click();
    await p.getByRole('radio', { name: READ }).click();
    await expect(p.locator('.facts')).toContainText('やった日');
    await expect(p.locator('.facts')).not.toContainText('時間'); // 日数型には時間の行がない
    await p.getByRole('radio', { name: /きっかけ/ }).check();
    await p.getByRole('button', { name: '見直しを保存' }).click();
    await expect(p.locator('.habit-editor')).toBeVisible();
    await expect(p.locator('#habit-name')).toHaveValue(READ);
    await expect(p.locator('#habit-cue')).toBeFocused();
    await gotoToday(p);
    await expect(p.getByRole('heading', { name: '週の見直し（1分）' })).toHaveCount(0);
  });
});

test.describe('表示・1日の区切り', () => {
  test('記録中心モードでは「もし〜」と週の見直しを出さない', async ({ page }) => {
    await open(page);
    await setup(page, ['boki']);
    await expect(card(page, BOKI).locator('.hc-plan')).toContainText('もし');
    await page.goto('/#options');
    await page.getByRole('radio', { name: /記録中心/ }).check();
    await gotoToday(page);
    await expect(card(page, BOKI).locator('.hc-plan')).not.toContainText('もし');
    await expect(card(page, BOKI).locator('.hc-plan')).toContainText('しおり');
  });

  test('区切りを3時にすると、深夜1時半の「やった」は前の日になる', async ({ page }) => {
    await open(page, '/', new Date('2026-11-02T01:30:00+09:00'));
    await setup(page, ['reading']);
    await expect(page.locator('.today-line')).toHaveText('11月2日（月）');
    await page.goto('/#options');
    await page.locator('#s-hour').selectOption('3');
    await gotoToday(page);
    await expect(page.locator('.today-line')).toHaveText('11月1日（日）');
    await card(page, READ).getByRole('button', { name: 'やった', exact: true }).click();
    await gotoRecords(page);
    await expect(page.locator('.record-date')).toContainText('11月1日（日）');
  });
});

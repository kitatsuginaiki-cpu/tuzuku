import { expect, test, type Browser, type Page } from '@playwright/test';
import { addManual, card, closeToasts, gotoFriends, gotoRecords, gotoToday, setup, type TemplateKey } from './helpers';
import { FakeBackend } from './fakeRemote';

/**
 * 仲間・同期は、実時間で動かす（同期は少し待ってから送るため、時計は止めない）。
 * サーバーは tests/e2e/fakeRemote.ts の偽物。規則の本体（RLS）は supabase/tests で実 DB に対して検証する。
 */
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

async function device(browser: Browser, backend: FakeBackend, client: string, width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await backend.attach(ctx, client);
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.locator('.screen')).toBeVisible();
  return page;
}

async function login(page: Page, email: string, name: string) {
  await gotoFriends(page);
  await page.locator('#si-email').fill(email);
  await page.getByRole('button', { name: 'コードを送る' }).click();
  await page.locator('#si-code').fill('123456');
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.locator('#si-name').fill(name);
  await page.getByRole('button', { name: 'はじめる' }).click();
  await expect(page.locator('.sync-line')).toContainText(name);
  await closeToasts(page);
}

async function syncNow(page: Page) {
  await page.getByRole('button', { name: '今すぐ同期' }).click();
  await expect(page.locator('.sync-line')).toContainText('同期済み');
}

async function newUser(browser: Browser, backend: FakeBackend, client: string, email: string, name: string, habits: TemplateKey[]) {
  const p = await device(browser, backend, client);
  await setup(p, habits);
  await login(p, email, name);
  return p;
}

test.describe('仲間：グループ・共有・スタンプ', () => {
  test('招待コードで参加し、共有をオンにした習慣の要約だけが見える。スタンプは1日3回まで', async ({ browser }) => {
    const backend = new FakeBackend();
    const a = await newUser(browser, backend, 'A1', 'aoi@example.com', 'あおい', ['boki', 'reading']);

    // 共有は既定でオフ
    const shareBoki = a.getByRole('switch', { name: '簿記3級' });
    await expect(shareBoki).not.toBeChecked();
    await shareBoki.check();
    await expect(shareBoki).toBeChecked();

    await a.locator('#gf-name').fill('朝活なかま');
    await a.getByRole('button', { name: '作る' }).click();
    await expect(a.getByText('「朝活なかま」を作りました。招待コードを仲間に送ってください。')).toBeVisible();
    const code = (await a.locator('.invite .code').textContent())!.trim();
    expect(code).toMatch(/^CODE\d{6}$/);

    // 自分の記録（メモつき）を残しておく。メモは仲間に見えない
    await gotoRecords(a, '簿記3級');
    await addManual(a, { date: today(), minutes: 30, title: '仕訳', time: '07:10' });
    await a.locator('.record-item').click();
    await a.locator('#rec-note').fill('秘密のメモ');
    await a.getByRole('button', { name: '変更を保存' }).click();
    await closeToasts(a);
    await gotoFriends(a);
    await syncNow(a);

    const b = await newUser(browser, backend, 'B1', 'beni@example.com', 'べに', ['reading']);
    await b.locator('#gf-code').fill('nope-0000');
    await b.getByRole('button', { name: '参加' }).click();
    await expect(b.locator('#gf-code-err')).toHaveText('招待コードが見つかりません。もう一度確かめてください。');
    await b.locator('#gf-code').fill(code.toLowerCase());
    await b.getByRole('button', { name: '参加' }).click();
    await expect(b.getByText('「朝活なかま」に参加しました。')).toBeVisible();

    const group = b.locator('.group', { hasText: '朝活なかま' });
    await expect(group.getByText('2/8人')).toBeVisible();
    const memberA = group.locator('.member', { hasText: 'あおい' });
    await expect(memberA.locator('.status')).toHaveCount(1); // 共有オフの「読書」は見えない
    const st = memberA.locator('.status', { hasText: '簿記3級' });
    await expect(st.locator('.status-today')).toHaveText('やった');
    await expect(st.locator('.status-meta')).toContainText('7日中1日・積み上げ 18時間6分');
    await expect(memberA.getByText('秘密のメモ')).toHaveCount(0);
    await expect(memberA.getByText('仕訳')).toHaveCount(0);
    // ランキング・コメントはない
    await expect(b.getByText(/ランキング|順位|位$/)).toHaveCount(1); // 説明文の「ランキングやコメントはありません」だけ
    await expect(b.locator('textarea, input[placeholder*="コメント"]')).toHaveCount(0);
    // サーバーに渡った共有データにもメモ・時刻・しおりは含まれない
    const sharedJson = JSON.stringify([...backend.shared.values()]);
    expect(sharedJson).not.toContain('秘密のメモ');
    expect(sharedJson).not.toContain('07:10');
    expect(sharedJson).not.toContain('問題集');

    // スタンプ：1日・相手ごとに3回まで
    for (const k of ['やろう', 'おつかれ', '見てるよ']) {
      await memberA.getByRole('button', { name: k }).click();
      await expect(b.getByText(`あおいさんに「${k}」を送りました。`)).toBeVisible();
      await closeToasts(b);
    }
    await expect(memberA.getByText('今日はもう送れません')).toBeVisible();
    await expect(memberA.getByRole('button', { name: 'やろう' })).toBeDisabled();
    // 自分にはスタンプを送れない
    await expect(group.locator('.member', { hasText: 'べに' }).getByRole('button', { name: 'やろう' })).toHaveCount(0);

    await syncNow(a);
    await expect(a.locator('.stamp-feed li')).toHaveCount(3);
    await expect(a.locator('.stamp-feed')).toContainText('べにさんから');

    // 共有をオフにすると、仲間の画面から消える
    await a.getByRole('switch', { name: '簿記3級' }).uncheck();
    await expect(a.locator('.sync-line')).toContainText('同期済み');
    await syncNow(b);
    await expect(memberA.getByText('共有中の習慣はありません。')).toBeVisible();

    // 抜ける
    await group.getByRole('button', { name: 'グループを抜ける' }).click();
    await b.getByRole('alertdialog').getByRole('button', { name: '抜ける' }).click();
    await expect(b.locator('.group')).toHaveCount(0);
    await syncNow(a);
    await expect(a.locator('.group').getByText('1/8人')).toBeVisible();
  });

  test('定員は8人まで', async ({ browser }) => {
    const backend = new FakeBackend();
    const a = await newUser(browser, backend, 'A1', 'aoi@example.com', 'あおい', ['reading']);
    await a.getByRole('button', { name: '作る' }).click();
    const code = (await a.locator('.invite .code').textContent())!.trim();
    backend.fillGroup(code, 7); // 8人になる
    const c = await newUser(browser, backend, 'C1', 'chika@example.com', 'ちか', ['reading']);
    await c.locator('#gf-code').fill(code);
    await c.getByRole('button', { name: '参加' }).click();
    await expect(c.locator('#gf-code-err')).toHaveText('このグループは定員（8人）に達しています。');
  });
});

test.describe('端末間の同期（PC とスマホ）', () => {
  test('同じアカウントでログインすると、もう一台に習慣と記録が届く。変更は双方向に反映', async ({ browser }) => {
    const backend = new FakeBackend();
    const phone = await newUser(browser, backend, 'phone', 'me@example.com', 'わたし', ['boki', 'reading']);
    await gotoRecords(phone, '簿記3級');
    await addManual(phone, { date: today(), minutes: 25, title: '講義#15' });
    await gotoFriends(phone);
    await syncNow(phone);

    const pc = await device(browser, backend, 'pc', 1280);
    await expect(pc.getByRole('heading', { name: '何をつづけますか？' })).toBeVisible();
    await login(pc, 'me@example.com', 'わたし');
    await gotoToday(pc);
    await expect(card(pc, '簿記3級').locator('.hc-total .num')).toHaveText('18時間1分');
    await expect(pc.locator('.habit-card')).toHaveCount(2);

    // PC で「読書」をやった → スマホへ
    await card(pc, '読書').getByRole('button', { name: 'やった', exact: true }).click();
    await gotoFriends(pc);
    await syncNow(pc);
    await gotoFriends(phone);
    await syncNow(phone);
    await gotoToday(phone);
    await expect(card(phone, '読書').getByText('今日はやった')).toBeVisible();
  });

  test('オフラインでも記録でき、つながったら自動で送られる', async ({ browser }) => {
    const backend = new FakeBackend();
    const p = await newUser(browser, backend, 'P', 'off@example.com', 'おふ', ['reading']);
    await syncNow(p);
    await p.context().setOffline(true);
    await gotoToday(p);
    await card(p, '読書').getByRole('button', { name: 'やった', exact: true }).click();
    await gotoFriends(p);
    await expect(p.locator('.sync-line')).toContainText('オフライン');
    const uid = backend.userIdOf('off@example.com')!;
    const records = () => [...(backend.data.get(uid)?.values() ?? [])].filter((r) => r.kind === 'record' && r.payload);
    expect(records()).toHaveLength(0);
    await p.context().setOffline(false);
    await expect.poll(() => records().length, { timeout: 10_000 }).toBe(1);
  });
});

test.describe('アカウント', () => {
  test('アカウントを削除すると、サーバー上のデータが消え、端末の記録は残る', async ({ browser }) => {
    const backend = new FakeBackend();
    const p = await newUser(browser, backend, 'D', 'del@example.com', 'でる', ['reading']);
    await gotoToday(p);
    await card(p, '読書').getByRole('button', { name: 'やった', exact: true }).click();
    await gotoFriends(p);
    await syncNow(p);
    const uid = backend.userIdOf('del@example.com')!;
    expect(backend.data.get(uid)?.size).toBeGreaterThan(0);
    await p.getByRole('button', { name: 'アカウントを削除' }).click();
    const dlg = p.getByRole('alertdialog', { name: 'アカウントを削除しますか？' });
    await expect(dlg.getByRole('button', { name: '完全に削除する' })).toBeDisabled();
    await dlg.locator('#del-confirm').fill('削除');
    await dlg.getByRole('button', { name: '完全に削除する' }).click();
    await expect(p.getByText('アカウントを削除しました。この端末の記録は残っています。')).toBeVisible();
    expect(backend.data.has(uid)).toBe(false);
    expect(backend.userIdOf('del@example.com')).toBeUndefined();
    await expect(p.locator('#si-email')).toBeVisible();
    await gotoToday(p);
    await expect(card(p, '読書').getByText('今日はやった')).toBeVisible();
  });

  test('接続先が未設定の公開版では、仲間タブは説明だけを出し、記録はそのまま使える', async ({ page }) => {
    await page.goto('/#friends');
    await expect(page.getByRole('heading', { name: 'この公開版では、共有の接続先がまだ設定されていません' })).toBeVisible();
    await page.getByRole('button', { name: '共有されるもの・されないもの（プライバシー）' }).click();
    await expect(page.getByRole('heading', { name: 'データの扱い' })).toBeVisible();
    await expect(page.getByText('既定はオフ')).toBeVisible();
  });
});

// 主要画面のスクリーンショットを docs/screenshots/ に保存する（設計確認・README 用）。
// 前提: `npm run build && npm run preview` で http://localhost:4173 が起動していること。
// 表示内容はスクリーンショット用の一時データ（毎回新しいブラウザで作成）であり、実際の記録ではありません。
// 「仲間」画面は、ブラウザ内だけで動く見本のサーバーを使います（見本のなかま＝架空の表示用データ）。
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const OUT = 'docs/screenshots';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const NOW = new Date('2026-11-01T13:10:00+09:00');
const MIN = 60_000;
const NAMES = { morning: '朝8:00に起きて作業に入る', boki: '簿記3級', reading: '読書', room: '部屋をきれいに保つ', note: 'note更新' };

const browser = await chromium.launch();

async function newContext(width, height, fakeRemote = false) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  if (fakeRemote) await ctx.addInitScript(sampleRemote);
  return ctx;
}
async function openAt(ctx, time, path = '') {
  const page = await ctx.newPage();
  await page.clock.install({ time: time.getTime() - 1000 });
  await page.clock.pauseAt(time);
  await page.goto(BASE + path);
  await page.locator('.screen').waitFor();
  return page;
}
const closeToasts = async (page) => {
  if (await page.locator('dialog[open]').count()) return;
  while (await page.locator('.toast-close').count()) await page.locator('.toast-close').first().click();
};
const shot = async (page, name, full = false) => {
  await page.waitForTimeout(150);
  await closeToasts(page);
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled', fullPage: full });
};
const card = (p, name) => p.locator('.habit-card', { has: p.getByRole('heading', { name, exact: true }) });
async function setup(p, keys) {
  for (const k of keys) await p.locator('.ob-item', { hasText: NAMES[k] }).click();
  await p.getByRole('button', { name: `${keys.length}つの習慣ではじめる` }).click();
  await p.locator('.habit-card').first().waitFor();
  await closeToasts(p);
}
async function manual(p, date, min, title) {
  await p.goto(`${BASE}#records`);
  await p.getByRole('radio', { name: NAMES.boki }).click();
  await p.getByRole('button', { name: '計測しなかった時間を記録する' }).click();
  await p.locator('#rec-date').fill(date);
  await p.locator('#rec-min').fill(String(min));
  await p.locator('#rec-title').fill(title);
  await p.getByRole('button', { name: '記録する', exact: true }).click();
  await p.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => p.waitForTimeout(500));
  await closeToasts(p);
}
async function pastDay(p, date, kind = 'やった') {
  await p.getByRole('button', { name: '過去の日を記録する' }).click();
  await p.locator('#rec-date').fill(date);
  await p.getByRole('radio', { name: kind, exact: true }).click();
  await p.getByRole('button', { name: '記録する', exact: true }).click();
  await p.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => p.waitForTimeout(500));
  await closeToasts(p);
}

for (const [w, h, tag] of [
  [390, 844, 'mobile'],
  [1440, 900, 'desktop'],
]) {
  const ctx = await newContext(w, h, true);
  const p = await openAt(ctx, NOW);
  await shot(p, `${tag}-01-first-run`, tag === 'mobile');
  await setup(p, ['morning', 'boki', 'reading']);
  await manual(p, '2026-10-30', 25, '問題集 第11章');
  await p.goto(`${BASE}#records`);
  await p.getByRole('radio', { name: '読書' }).click();
  await pastDay(p, '2026-10-29');
  await pastDay(p, '2026-10-30', '小さな一手');
  await pastDay(p, '2026-10-31');
  await p.goto(BASE + '#');
  await card(p, NAMES.morning).getByRole('button', { name: 'やった', exact: true }).click();
  await shot(p, `${tag}-02-today`, tag === 'mobile');
  await card(p, NAMES.reading).getByRole('button', { name: 'できない日は' }).click();
  await shot(p, `${tag}-03-coping`);
  await p.keyboard.press('Escape');
  await card(p, NAMES.boki).getByRole('button', { name: 'しおりから始める' }).click();
  await p.clock.runFor(8 * MIN);
  await shot(p, `${tag}-04-timer`);
  await p.clock.runFor(12 * MIN);
  await p.getByRole('button', { name: '終える', exact: true }).click();
  await p.locator('#next').fill('問題集 第12章 問4〜6を解く');
  await shot(p, `${tag}-05-finish`, tag === 'mobile');
  await p.getByRole('button', { name: '保存して終了' }).click();
  await p.locator('.home').waitFor();
  await p.goto(`${BASE}#stack`);
  await shot(p, `${tag}-06-stack`, true);
  // 仲間（見本のサーバー・見本のなかま）
  await p.goto(`${BASE}#friends`);
  await p.locator('#si-email').fill('me@example.com');
  await p.getByRole('button', { name: 'コードを送る' }).click();
  await p.locator('#si-code').fill('123456');
  await p.getByRole('button', { name: 'ログイン' }).click();
  await p.locator('#si-name').fill('わたし');
  await p.getByRole('button', { name: 'はじめる' }).click();
  await p.getByRole('switch', { name: NAMES.boki }).check();
  await p.getByRole('switch', { name: NAMES.morning }).check();
  await p.locator('#gf-name').fill('朝活なかま');
  await p.getByRole('button', { name: '作る' }).click();
  await p.locator('.group').waitFor();
  await p.getByRole('button', { name: '今すぐ同期' }).click();
  await p.waitForTimeout(300);
  await p.clock.runFor(2000);
  await shot(p, `${tag}-07-friends`, true);
  await p.goto(`${BASE}#records`);
  await shot(p, `${tag}-08-records`, tag === 'mobile');
  await p.goto(`${BASE}#options`);
  await shot(p, `${tag}-09-settings`, tag === 'mobile');
  await card(p, NAMES.boki).count();
  await p.goto(BASE + '#');
  await card(p, NAMES.reading).getByRole('button', { name: '読書を編集' }).click();
  await shot(p, `${tag}-10-habit-editor`, tag === 'mobile');
  await ctx.close();
}

// キャラクターの5つの表情（実際のルールで出したもの）
const MOODS = [
  ['happy', 'ふつう', '2026-11-01T10:00:00+09:00', 'done'],
  ['normal', 'ふつう', '2026-11-01T10:00:00+09:00', 'yesterday'],
  ['waiting', 'ふつう', '2026-11-01T19:00:00+09:00', 'yesterday'],
  ['worried', 'ふつう', '2026-11-01T10:00:00+09:00', 'gap'],
  ['angry', 'きびしい', '2026-11-01T10:00:00+09:00', 'gap'],
];
for (const [mood, strict, at, kind] of MOODS) {
  const ctx = await newContext(390, 400);
  const first = await openAt(ctx, new Date('2026-10-25T10:00:00+09:00'));
  await setup(first, ['reading']);
  await first.close();
  const p = await openAt(ctx, new Date(at));
  if (kind !== 'gap') {
    await p.goto(`${BASE}#records`);
    await pastDay(p, kind === 'done' ? '2026-11-01' : '2026-10-31');
  } else {
    await p.goto(`${BASE}#records`);
    await pastDay(p, '2026-10-25');
  }
  if (strict !== 'ふつう') {
    await p.goto(`${BASE}#options`);
    await p.getByRole('radio', { name: new RegExp(strict) }).check();
  }
  await p.goto(BASE + '#');
  await p.locator(`.buddy.is-${mood}`).waitFor();
  await closeToasts(p);
  await p.locator('.buddy').screenshot({ path: `${OUT}/mood-${mood}.png`, animations: 'disabled' });
  await ctx.close();
}

await browser.close();
console.log('saved to', OUT);

/** ブラウザ内だけで動く見本のサーバー（スクリーンショット専用。実際の通信はしない） */
function sampleRemote() {
  let me = null;
  let shared = [];
  const groups = [];
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  const sample = [
    { userId: 's1', displayName: '見本のなかま', avatar: 'blue', statuses: [{ habitId: 'x1', habitName: '英単語', trackingType: 'days', today: 'done', todayDate: today, weekDays: 5, total: 23, mood: 'happy', updatedAt: '' }] },
    { userId: 's2', displayName: '見本のなかま2', avatar: 'orange', statuses: [{ habitId: 'x2', habitName: 'ランニング', trackingType: 'time', today: 'none', todayDate: today, weekDays: 2, total: 410, mood: 'waiting', updatedAt: '' }] },
  ];
  window.__tsuzukuRemote = {
    available: true,
    async getUser() { return me; },
    async sendCode() {},
    async verifyCode(email) { me = { userId: 'me', email }; return me; },
    async signOut() { me = null; },
    async push() {},
    async pull() { return { items: [], serverTime: new Date().toISOString() }; },
    async saveProfile(n, a) { this._p = { n, a }; },
    async publishShared(s) { shared = s; },
    async myGroups() {
      return groups.map((g) => ({ ...g, members: [{ userId: 'me', displayName: this._p?.n ?? '', avatar: this._p?.a ?? 'green', statuses: shared }, ...sample] }));
    },
    async createGroup(name) { const g = { id: 'g1', name, inviteCode: 'K7MQ2XRA9P' }; groups.push(g); return { ...g, members: [] }; },
    async joinGroup() { throw Object.assign(new Error('見本'), { code: 'not_found' }); },
    async leaveGroup() {},
    async sendStamp() {},
    async stampsSentToday() { return { s1: 1 }; },
    async stampsReceived() { return [{ id: 'st1', groupId: 'g1', fromUser: 's1', toUser: 'me', kind: 'おつかれ', createdAt: new Date().toISOString() }]; },
    async deleteAccount() {},
  };
}

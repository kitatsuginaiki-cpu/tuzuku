import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { BASELINE } from '../../src/lib/config';
import { addDays } from '../../src/lib/dates';
import type { StudyRecord } from '../../src/lib/records';
import {
  DEFAULT_APP_SETTINGS,
  HABIT_TEMPLATES,
  blankHabit,
  habitFromTemplate,
  hasDayRecord,
  logicalDate,
  migrateFromV6,
  sanitizeAppSettings,
  sanitizeCoping,
  sanitizeHabit,
  sanitizeHabits,
  validateRecordFor,
  type AppSettings,
  type Habit,
} from '../../src/lib/model';
import { calendar, crossedMilestone, dayStatus, formatTotal, habitTotal, toBlocks } from '../../src/lib/accumulate';
import { accessoryAvailable, CHARACTER_RULES, growthOf, LEVELS, lineFor, MOOD_LINES, moodFor, toSharedMood } from '../../src/lib/character';
import { applyRemote, fullOutbox, sharedStatuses, SyncEngine } from '../../src/lib/sync';
import { memoryRepository } from '../../src/lib/storage';
import { DEFAULT_META } from '../../src/lib/plan';
import type { Remote, RemoteItem, SharedStatus } from '../../src/lib/remote';

const tpl = (k: string) => HABIT_TEMPLATES.find((t) => t.key === k)!;
const boki = (): Habit => ({ ...habitFromTemplate(tpl('boki'), 0, true), id: 'boki' });
const reading = (): Habit => ({ ...habitFromTemplate(tpl('reading'), 1, true), id: 'read' });
const note = (): Habit => ({ ...habitFromTemplate(tpl('note'), 2, true), id: 'note' }); // 日曜だけ

let seq = 0;
function rec(habitId: string, studyDate: string, p: Partial<StudyRecord> = {}): StudyRecord {
  return {
    id: `r${++seq}`,
    habitId,
    kind: 'done',
    studyDate,
    startedAt: null,
    endedAt: null,
    minutes: 0,
    measuredSeconds: null,
    pausedSeconds: null,
    title: 't',
    note: '',
    source: 'manual',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...p,
  };
}

const S = (p: Partial<AppSettings> = {}): AppSettings => ({ ...DEFAULT_APP_SETTINGS, ...p });

/* ------------------------------------------------------------------ model */

describe('habits model', () => {
  it('templates: only 簿記 can carry the confirmed baseline, and only when allowed', () => {
    expect(habitFromTemplate(tpl('boki'), 0, true).baseline).toBe(true);
    expect(habitFromTemplate(tpl('boki'), 0, false).baseline).toBe(false);
    expect(HABIT_TEMPLATES.filter((t) => t.baseline).map((t) => t.key)).toEqual(['boki']);
    for (const t of HABIT_TEMPLATES) {
      expect(t.copingPlans.length).toBeGreaterThan(0);
      expect(t.copingPlans.length).toBeLessThanOrEqual(3);
      expect(habitFromTemplate(t, 0, true).shared).toBe(false); // 共有は既定オフ
    }
  });
  it('sanitizeHabits keeps the baseline on the first habit only and drops duplicates', () => {
    const a = boki();
    const b = { ...boki(), id: 'boki2' };
    const out = sanitizeHabits([a, b, { ...a }, { id: '', name: 'x' }, { id: 'n', name: '' }]);
    expect(out.map((h) => h.id)).toEqual(['boki', 'boki2']);
    expect(out.map((h) => h.baseline)).toEqual([true, false]);
  });
  it('sanitizeHabit / sanitizeCoping clamp bad input', () => {
    const h = sanitizeHabit({ id: 'x', name: '  読書  ', trackingType: '???', planDays: [1, 1, 9, 3], targetMinutes: 9999, color: 'neon' })!;
    expect(h).toMatchObject({ name: '読書', trackingType: 'time', planDays: [1, 3], targetMinutes: 20, color: 'navy', shared: false });
    expect(sanitizeCoping([{ when: 'a', instead: '' }, { when: 'b', instead: 'c', minutes: 0 }, 1, 2, 3, { instead: 'z' }, { instead: 'y' }]).length).toBe(3);
    expect(sanitizeCoping([{ when: 'b', instead: 'c', minutes: 0 }])[0].minutes).toBeNull();
  });
  it('sanitizeAppSettings', () => {
    const s = sanitizeAppSettings({ strictness: 'brutal', dayStartHour: 9, milestonesTime: [50, 10, 10, -1], characterEnabled: false });
    expect(s.strictness).toBe('normal');
    expect(s.dayStartHour).toBe(0);
    expect(s.characterEnabled).toBe(false);
    expect(s.milestonesTime).toEqual([10, 50]);
  });
  it('logicalDate honours the day boundary', () => {
    const lateNight = new Date(2026, 10, 2, 1, 30).getTime(); // 11/2 1:30
    expect(logicalDate(lateNight, 0)).toBe('2026-11-02');
    expect(logicalDate(lateNight, 3)).toBe('2026-11-01');
  });
  it('validateRecordFor: baseline date rule only for the baseline habit; time needs minutes, days and rest do not', () => {
    const today = '2026-11-01';
    expect(validateRecordFor(rec('boki', '2026-10-05', { minutes: 20 }), boki(), today).studyDate).toMatch(/確認済みの累計/);
    expect(validateRecordFor(rec('read', '2026-10-05'), reading(), today).studyDate).toBeUndefined();
    expect(validateRecordFor(rec('boki', today, { minutes: 0 }), boki(), today).minutes).toBeTruthy();
    expect(validateRecordFor(rec('boki', today, { minutes: 0, kind: 'rest' }), boki(), today).minutes).toBeUndefined();
    expect(validateRecordFor(rec('read', today), reading(), today)).toEqual({});
    expect(validateRecordFor(rec('read', '2026-11-02'), reading(), today).studyDate).toMatch(/未来/);
    expect(validateRecordFor(rec('x', today), undefined, today).habitId).toBeTruthy();
  });
  it('hasDayRecord (days type: one per day)', () => {
    const rs = [rec('read', '2026-11-01')];
    expect(hasDayRecord(rs, 'read', '2026-11-01')).toBe(true);
    expect(hasDayRecord(rs, 'read', '2026-11-01', rs[0].id)).toBe(false);
    expect(hasDayRecord(rs, 'boki', '2026-11-01')).toBe(false);
  });
  it('migrateFromV6 never fabricates records', () => {
    const before = [rec('', '2026-10-20', { minutes: 30, habitId: undefined, kind: undefined })];
    const m = migrateFromV6({ nextAction: 'x' }, before);
    expect(m.records).toHaveLength(1);
    expect(m.records[0].minutes).toBe(30);
    expect(m.records[0].habitId).toBe(m.habits[0].id);
  });
});

/* ------------------------------------------------------------ accumulate */

describe('accumulation (never decreases on a gap)', () => {
  it('time type: baseline + app minutes; baseline blocks first', () => {
    const h = boki();
    const rs = [rec('boki', '2026-10-20', { minutes: 40 }), rec('boki', '2026-10-21', { minutes: 25, mode: 'small' }), rec('boki', '2026-10-22', { kind: 'rest' })];
    const t = habitTotal(h, rs);
    expect(t).toEqual({ type: 'time', minutes: BASELINE.minutes + 65, baselineMinutes: 1056, appMinutes: 65 });
    expect(formatTotal(t)).toBe('18時間41分');
    const b = toBlocks(t as Extract<typeof t, { type: 'time' }>, 30);
    expect(b.baselineBlocks).toBe(35); // 1056/30 = 35.2
    expect(b.baselineBlocks + b.appBlocks).toBe(Math.floor(1121 / 30));
    expect(b.remainder).toBe(1121 % 30);
  });
  it('time type without baseline starts at 0 (no fabricated history)', () => {
    const h = { ...boki(), baseline: false };
    expect(habitTotal(h, [])).toMatchObject({ minutes: 0 });
  });
  it('days type counts distinct days; small counts, rest does not', () => {
    const h = reading();
    const rs = [
      rec('read', '2026-10-20'),
      rec('read', '2026-10-20'),
      rec('read', '2026-10-21', { mode: 'small' }),
      rec('read', '2026-10-22', { kind: 'rest' }),
      rec('boki', '2026-10-23', { minutes: 20 }),
    ];
    expect(habitTotal(h, rs)).toEqual({ type: 'days', days: 2, smallDays: 1, restDays: 1 });
    expect(dayStatus('read', rs, '2026-10-21')).toBe('small');
    expect(dayStatus('read', rs, '2026-10-22')).toBe('rest');
    expect(dayStatus('read', rs, '2026-10-23')).toBeNull();
  });
  it('calendar: Monday-start weeks ending with today, statuses & planned flags', () => {
    const h = note(); // 日曜だけ
    const rows = calendar(h, [rec('note', '2026-11-01')], '2026-11-04', 2); // 11/4 = 水
    expect(rows).toHaveLength(2);
    expect(rows[0][0].date).toBe('2026-10-26'); // 月
    const sun = rows[0][6];
    expect(sun).toMatchObject({ date: '2026-11-01', status: 'done', planned: true });
    expect(rows[1][3]).toMatchObject({ date: '2026-11-05', future: true, status: null });
  });
  it('milestones fire once when crossing, in hours or days', () => {
    const s = S();
    const h = boki();
    const t = (m: number) => ({ type: 'time' as const, minutes: m, baselineMinutes: 1056, appMinutes: m - 1056 });
    expect(crossedMilestone(h, t(1150), t(1210), s)).toBeNull(); // 10h(600) は既に越えている、25h=1500 未満
    expect(crossedMilestone(h, t(1490), t(1510), s)).toBe(25);
    expect(crossedMilestone(h, t(1510), t(1600), s)).toBeNull();
    const r = reading();
    const d = (n: number) => ({ type: 'days' as const, days: n, smallDays: 0, restDays: 0 });
    expect(crossedMilestone(r, d(9), d(10), s)).toBe(10);
    expect(crossedMilestone(r, d(10), d(10), s)).toBeNull();
  });
});

/* ------------------------------------------------------------- character */

describe('character mood (rules, no AI)', () => {
  const today = '2026-11-10'; // 火
  const base = { settings: S(), today, hour: 10, firstUsedOn: '2026-10-01' };
  const daily = reading(); // 毎日予定

  it('happy when done today, during a session, or right after a milestone', () => {
    expect(moodFor({ ...base, habits: [daily], records: [rec('read', today)] }).mood).toBe('happy');
    expect(moodFor({ ...base, habits: [daily], records: [], sessionActive: true }).mood).toBe('focus');
    expect(moodFor({ ...base, habits: [daily], records: [], justMilestone: true }).mood).toBe('happy');
  });
  it('normal when yesterday was covered; waiting in the evening of a planned day', () => {
    const rs = [rec('read', addDays(today, -1))];
    expect(moodFor({ ...base, habits: [daily], records: rs }).mood).toBe('normal');
    expect(moodFor({ ...base, habits: [daily], records: rs, hour: CHARACTER_RULES.waitingHour }).mood).toBe('waiting');
  });
  it('worried after 2 missed planned days (normal), angry after 3 only when strict', () => {
    const two = [rec('read', addDays(today, -3))];
    const three = [rec('read', addDays(today, -4))];
    expect(moodFor({ ...base, habits: [daily], records: two }).mood).toBe('worried');
    expect(moodFor({ ...base, habits: [daily], records: three }).mood).toBe('worried'); // ふつうは怒らない
    expect(moodFor({ ...base, settings: S({ strictness: 'strict' }), habits: [daily], records: three }).mood).toBe('angry');
    expect(moodFor({ ...base, settings: S({ strictness: 'strict' }), habits: [daily], records: two }).mood).toBe('worried');
    expect(moodFor({ ...base, settings: S({ strictness: 'gentle' }), habits: [daily], records: three }).mood).toBe('waiting');
  });
  it('a rest day is not a miss; unplanned days are skipped; days before first use are not counted', () => {
    const rs = [rec('read', addDays(today, -1), { kind: 'rest' })];
    expect(moodFor({ ...base, settings: S({ strictness: 'strict' }), habits: [daily], records: rs }).missed).toBe(0);
    // 日曜だけの習慣：平日はカウントしない
    const sundayOnly = note();
    const r = moodFor({ ...base, settings: S({ strictness: 'strict' }), habits: [sundayOnly], records: [rec('note', '2026-11-01')] });
    expect(r.missed).toBe(1); // 11/8（日）だけ。11/9（月）は予定がないので数えない
    expect(r.mood).toBe('normal');
    expect(moodFor({ ...base, settings: S({ strictness: 'strict' }), habits: [daily], records: [], firstUsedOn: addDays(today, -1) }).missed).toBe(1);
  });
  it('never angry on the resume screen; starting again makes it happy immediately', () => {
    const three = [rec('read', addDays(today, -5))];
    const strict = { ...base, settings: S({ strictness: 'strict' }), habits: [daily], records: three };
    expect(moodFor(strict).mood).toBe('angry');
    expect(moodFor({ ...strict, context: 'resume' }).mood).toBe('waiting');
    expect(moodFor({ ...strict, sessionActive: true }).mood).toBe('focus');
    expect(moodFor({ ...strict, records: [...three, rec('read', today, { mode: 'small' })] }).mood).toBe('happy');
  });
  it('archived habits are ignored', () => {
    const arch = { ...daily, archived: true };
    expect(moodFor({ ...base, settings: S({ strictness: 'strict' }), habits: [arch], records: [] }).missed).toBe(0);
  });
  it('lines are short, deterministic per day, and contain no guilt / insult words', () => {
    expect(lineFor('happy', today)).toBe(lineFor('happy', today));
    const banned = ['ダメ', 'だめ', '失敗', 'サボ', '怠け', '最低', 'がっかり', '情けない', 'ばか', 'バカ'];
    for (const lines of Object.values(MOOD_LINES))
      for (const l of lines) {
        expect(l.length).toBeLessThanOrEqual(30);
        for (const b of banned) expect(l).not.toContain(b);
      }
  });
});

/* ------------------------------------------------------------------ sync */

describe('sync: shared summary, LWW merge, outbox', () => {
  it('sharedStatuses only includes shared, active habits and no private fields', () => {
    const now = new Date(2026, 10, 10, 9).getTime();
    const habits = [{ ...boki(), shared: true }, reading(), { ...note(), shared: true, archived: true }];
    const records = [rec('boki', '2026-11-10', { minutes: 30, note: '秘密のメモ' }), rec('boki', '2026-11-08', { minutes: 10 })];
    const out = sharedStatuses({ habits, records, settings: S(), meta: { ...DEFAULT_META, firstUsedOn: '2026-11-01' } }, now);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ habitId: 'boki', habitName: '簿記3級', today: 'done', weekDays: 2, total: 1056 + 40, mood: 'happy' });
    expect(Object.keys(out[0]).sort()).toEqual(['habitId', 'habitName', 'mood', 'today', 'todayDate', 'total', 'trackingType', 'updatedAt', 'weekDays'].sort());
    expect(JSON.stringify(out)).not.toContain('秘密');
    // キャラクターをオフにしたら表情も送らない
    expect(sharedStatuses({ habits, records, settings: S({ characterEnabled: false }), meta: DEFAULT_META }, now)[0].mood).toBeNull();
  });

  it('applyRemote: newer wins, older is ignored, pending local changes are not overwritten, tombstones delete', () => {
    const r1 = rec('boki', '2026-11-01', { id: 'a', minutes: 20, updatedAt: '2026-11-01T10:00:00.000Z' });
    const local = { habits: [boki()], records: [r1], reviews: [], settings: S({ updatedAt: '2026-11-01T00:00:00.000Z' }) };
    const items: RemoteItem[] = [
      { kind: 'record', id: 'a', payload: { ...r1, minutes: 5, updatedAt: '2026-11-01T09:00:00.000Z' }, updatedAt: '2026-11-01T09:00:00.000Z' }, // 古い
      { kind: 'record', id: 'b', payload: rec('boki', '2026-11-02', { id: 'b', minutes: 30, updatedAt: '2026-11-02T00:00:00.000Z' }), updatedAt: '2026-11-02T00:00:00.000Z' }, // 新規
      { kind: 'habit', id: 'boki', payload: { ...boki(), nextAction: '別端末のしおり', updatedAt: '2099-01-01T00:00:00.000Z' }, updatedAt: '2099-01-01T00:00:00.000Z' },
      { kind: 'settings', id: 'app', payload: S({ strictness: 'strict', updatedAt: '2026-11-02T00:00:00.000Z' }), updatedAt: '2026-11-02T00:00:00.000Z' },
    ];
    const { ops, changed } = applyRemote(local, items, new Set());
    expect(changed).toBe(3);
    expect(ops.find((o) => o.t === 'rec' && o.value.id === 'a')).toBeUndefined();
    expect(ops.find((o) => o.t === 'rec' && o.value.id === 'b')).toBeTruthy();
    const hOp = ops.find((o) => o.t === 'kv' && o.key === 'habits');
    expect(hOp && hOp.t === 'kv' && (hOp.value as Habit[])[0].nextAction).toBe('別端末のしおり');
    expect(ops.find((o) => o.t === 'kv' && o.key === 'appSettings')).toBeTruthy();

    // 送信待ちのキーは上書きしない
    const p = applyRemote(local, [{ kind: 'record', id: 'a', payload: { ...r1, minutes: 99, updatedAt: '2099-01-01T00:00:00.000Z' }, updatedAt: '2099-01-01T00:00:00.000Z' }], new Set(['record:a']));
    expect(p.changed).toBe(0);
    // 新しい削除は反映
    const del = applyRemote(local, [{ kind: 'record', id: 'a', payload: null, updatedAt: '2026-11-03T00:00:00.000Z' }], new Set());
    expect(del.ops).toEqual([{ t: 'recDel', id: 'a' }]);
  });

  it('applyRemote never gives the baseline to a second habit', () => {
    const local = { habits: [boki()], records: [], reviews: [], settings: S() };
    const other = { ...boki(), id: 'boki-b', updatedAt: '2099-01-01T00:00:00.000Z' };
    const { ops } = applyRemote(local, [{ kind: 'habit', id: other.id, payload: other, updatedAt: other.updatedAt }], new Set());
    const hs = (ops.find((o) => o.t === 'kv' && o.key === 'habits') as { value: Habit[] }).value;
    expect(hs.filter((h) => h.baseline)).toHaveLength(1);
  });

  it('SyncEngine pushes the outbox, clears what was sent, pulls, and publishes shared statuses', async () => {
    const repo = memoryRepository();
    await repo.load();
    const h = { ...reading(), shared: true };
    let state = {
      habits: [h],
      settings: S(),
      records: [rec('read', '2026-11-01', { id: 'x' })],
      reviews: [],
      meta: DEFAULT_META,
      account: { userId: 'u1', email: 'a@example.com', displayName: 'あ', avatar: 'green', lastPulledAt: null as string | null },
      active: null,
    };
    await repo.write(fullOutbox(state));
    expect((await repo.getOutbox()).length).toBe(3); // habit + record + settings
    const pushed: string[] = [];
    let published: SharedStatus[] = [];
    const fake: Partial<Remote> = {
      available: true,
      push: async (items) => {
        pushed.push(...items.map((i) => i.key));
      },
      pull: async () => ({
        items: [{ kind: 'record', id: 'y', payload: rec('read', '2026-11-02', { id: 'y', updatedAt: '2026-11-02T00:00:00.000Z' }), updatedAt: '2026-11-02T00:00:00.000Z' }],
        serverTime: '2026-11-02T00:00:01.000Z',
      }),
      publishShared: async (s) => {
        published = s;
      },
    };
    (globalThis as unknown as { window: unknown }).window = { __tsuzukuRemote: fake } as unknown;
    const statuses: string[] = [];
    let applied = 0;
    const eng = new SyncEngine({
      repo,
      getState: () => state,
      onStatus: (s) => statuses.push(s.status),
      onApplied: () => {
        applied++;
      },
    });
    await eng.run();
    expect(pushed.sort()).toEqual(['habit:read', 'record:x', 'settings:app']);
    expect(await repo.getOutbox()).toEqual([]);
    const d = await repo.load();
    expect(d.records.map((r) => r.id)).toContain('y');
    expect(d.account?.lastPulledAt).toBe('2026-11-02T00:00:01.000Z');
    expect(published.map((p) => p.habitId)).toEqual(['read']);
    expect(statuses).toContain('syncing');
    expect(statuses.at(-1)).toBe('idle');
    expect(applied).toBe(1);

    // ログアウト中は何もしない
    state = { ...state, account: null as never };
    await eng.run();
    expect(statuses.at(-1)).toBe('off');
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('SyncEngine keeps the outbox when the network fails (offline-first)', async () => {
    const repo = memoryRepository();
    await repo.load();
    const state = {
      habits: [reading()],
      settings: S(),
      records: [],
      reviews: [],
      meta: DEFAULT_META,
      account: { userId: 'u1', email: '', displayName: '', avatar: 'green', lastPulledAt: null },
      active: null,
    };
    await repo.write(fullOutbox(state));
    const fake: Partial<Remote> = {
      available: true,
      push: async () => {
        throw new Error('Failed to fetch');
      },
    };
    // getRemote はモジュール内でキャッシュされるため、同じオブジェクトの push を差し替える
    (globalThis as unknown as { window: unknown }).window = { __tsuzukuRemote: fake } as unknown;
    const { getRemote } = await import('../../src/lib/remote');
    const cached = (await getRemote()) as Remote & Record<string, unknown>;
    const origPush = cached.push;
    cached.push = fake.push!;
    const statuses: string[] = [];
    const eng = new SyncEngine({ repo, getState: () => state, onStatus: (s) => statuses.push(s.status), onApplied: () => undefined });
    await eng.run();
    expect(statuses.at(-1)).toBe('error');
    expect((await repo.getOutbox()).length).toBe(2);
    cached.push = origPush;
    delete (globalThis as unknown as { window?: unknown }).window;
  });
});

describe('blank habit', () => {
  it('defaults: days type, everyday, not shared, no baseline', () => {
    const h = blankHabit(3);
    expect(h).toMatchObject({ trackingType: 'days', planDays: [0, 1, 2, 3, 4, 5, 6], shared: false, baseline: false, order: 3 });
  });
});

describe('sendCodeError (Supabase のコード送信エラーの文言)', async () => {
  const { sendCodeError } = await import('../../src/lib/supabaseRemote');
  it('maps known Supabase auth errors to actionable Japanese messages', () => {
    expect(sendCodeError({ code: 'email_address_not_authorized', message: 'Email address "a@b.c" cannot be used as it is not authorized' }).message).toMatch(/チームメンバー/);
    expect(sendCodeError({ code: 'over_email_send_rate_limit', message: 'email rate limit exceeded', status: 429 }).message).toMatch(/上限/);
    expect(sendCodeError({ code: 'signup_disabled', message: 'Signups not allowed for otp' }).message).toMatch(/登録がオフ/);
    expect(sendCodeError({ code: 'email_provider_disabled', message: 'Email logins are disabled' }).message).toMatch(/メールでのログインが無効/);
    expect(sendCodeError({ code: 'unexpected_failure', message: 'Error sending magic link email' }).message).toMatch(/SMTP/);
    expect(sendCodeError(new TypeError('Failed to fetch')).message).toMatch(/通信/);
    expect(sendCodeError({ message: 'something new' }).message).toContain('something new');
  });
});

describe('つづきぼしの成長（Lv.1〜5）', () => {
  it('つづけた日（やった・小さな一手のある日、習慣をまたいで重複なし）で段階が決まる', () => {
    const rs = [
      rec('read', '2026-10-20'),
      rec('boki', '2026-10-20', { minutes: 20 }), // 同じ日は1日
      rec('read', '2026-10-21', { mode: 'small' }),
      rec('read', '2026-10-22', { kind: 'rest' }), // 休みは数えない
    ];
    const g = growthOf(rs);
    expect(g.days).toBe(2);
    expect(g.level.level).toBe(1);
    expect(g.next?.level).toBe(2);
    expect(g.left).toBe(1);
    const three = [...rs, rec('read', '2026-10-25')];
    expect(growthOf(three).level).toMatchObject({ level: 2, name: 'ならし' });
  });
  it('段階のしきい値は 0・3・10・30・66 日、Lv.5 で次はない', () => {
    expect(LEVELS.map((l) => l.days)).toEqual([0, 3, 10, 30, 66]);
    const many = Array.from({ length: 70 }, (_, i) => rec('read', addDays('2026-08-01', i)));
    const g = growthOf(many);
    expect(g.level.level).toBe(5);
    expect(g.next).toBeNull();
    expect(g.ratio).toBe(1);
    expect(growthOf(many.slice(0, 29)).level.level).toBe(3);
    expect(growthOf(many.slice(0, 30)).level.level).toBe(4);
  });
  it('アクセサリー：マフラーは12〜2月、学びの帽子は Lv.3 か節目で手に入る', () => {
    expect(accessoryAvailable('scarf', { today: '2026-12-01', level: 1, milestones: 0 }).ok).toBe(true);
    expect(accessoryAvailable('scarf', { today: '2026-02-28', level: 1, milestones: 0 }).ok).toBe(true);
    expect(accessoryAvailable('scarf', { today: '2026-11-01', level: 5, milestones: 3 }).ok).toBe(false);
    expect(accessoryAvailable('cap', { today: '2026-11-01', level: 2, milestones: 0 }).ok).toBe(false);
    expect(accessoryAvailable('cap', { today: '2026-11-01', level: 3, milestones: 0 }).ok).toBe(true);
    expect(accessoryAvailable('cap', { today: '2026-11-01', level: 1, milestones: 1 }).ok).toBe(true);
  });
  it('おやすみ：今日の予定の習慣をすべて休むと決めた日', () => {
    const today = '2026-11-10';
    const base = { settings: S(), today, hour: 10, firstUsedOn: '2026-10-01' };
    expect(moodFor({ ...base, habits: [reading()], records: [rec('read', today, { kind: 'rest' })] }).mood).toBe('rest');
    // 2つ予定があって片方だけ休み → おやすみにはしない
    expect(moodFor({ ...base, habits: [reading(), { ...boki(), planDays: [0, 1, 2, 3, 4, 5, 6] }], records: [rec('read', today, { kind: 'rest' }), rec('boki', addDays(today, -1), { minutes: 5 })] }).mood).not.toBe('rest');
  });
  it('仲間に送る表情はサーバーの許可リストの5種類に丸める', () => {
    expect(toSharedMood('focus')).toBe('happy');
    expect(toSharedMood('rest')).toBe('normal');
    expect(toSharedMood('angry')).toBe('angry');
  });
});

describe('学習時間の整合性（架空の加算をしない）', () => {
  it('基準値は 1,056分（2026-10-07）で、簿記の習慣だけが持つ', () => {
    expect(BASELINE).toEqual({ minutes: 1056, asOf: '2026-10-07' });
    expect(habitTotal(boki(), [])).toMatchObject({ minutes: 1056, appMinutes: 0 });
    expect(habitTotal(reading(), [])).toMatchObject({ days: 0 });
  });
  it('移行は、記録の件数と分数の合計を変えない（どんな入力でも）', () => {
    for (let t = 0; t < 50; t++) {
      const n = (t * 7) % 13;
      const rs = Array.from({ length: n }, (_, i) => rec('', addDays('2026-10-08', i), { habitId: undefined, kind: undefined, minutes: 1 + ((i * 37 + t) % 90) }));
      const m = migrateFromV6({ nextAction: 'x' }, rs);
      expect(m.records).toHaveLength(n);
      expect(m.records.reduce((s, r) => s + r.minutes, 0)).toBe(rs.reduce((s, r) => s + r.minutes, 0));
      expect(habitTotal(m.habits[0], m.records)).toMatchObject({ minutes: 1056 + rs.reduce((s, r) => s + r.minutes, 0) });
    }
  });
  it('記録0件で触っていない v6 は習慣を作らず、記録も作らない', () => {
    const m = migrateFromV6({}, []);
    expect(m.habits).toEqual([]);
    expect(m.records).toEqual([]);
  });
});

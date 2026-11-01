import { describe, expect, it } from 'vitest';
import { DEFAULT_META, type Meta } from '../../src/lib/plan';
import { DEFAULT_APP_SETTINGS, HABIT_TEMPLATES, habitFromTemplate, type Habit } from '../../src/lib/model';
import type { StudyRecord } from '../../src/lib/records';
import { habitsDueForReview, isHabitReviewDue, restStreak, resumeInfo, shouldPromptRest, todayView } from '../../src/lib/today';

const tpl = (k: string) => HABIT_TEMPLATES.find((t) => t.key === k)!;
const mk = (k: string, id: string, created = '2026-10-01T00:00:00.000Z'): Habit => ({ ...habitFromTemplate(tpl(k), 0, true), id, createdAt: created });
let n = 0;
const rec = (habitId: string, studyDate: string, p: Partial<StudyRecord> = {}): StudyRecord => ({
  id: `r${++n}`, habitId, kind: 'done', studyDate, startedAt: null, endedAt: null, minutes: 20, measuredSeconds: null, pausedSeconds: null,
  title: 't', note: '', source: 'manual', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...p,
});

describe('今日の並び', () => {
  it('今日の予定でまだ記録がない → 予定外 → 記録済み（休みを含む）の順。グループ内は習慣の順番', () => {
    const habits = [
      { ...mk('morning', 'm'), order: 0 },
      { ...mk('boki', 'b'), order: 1 },
      { ...mk('reading', 'r'), order: 2 },
      { ...mk('note', 'n'), order: 3 }, // 日曜だけ
      { ...mk('room', 'x'), order: 4 },
    ];
    const today = '2026-11-03'; // 火
    const v = todayView(habits, [rec('m', today), rec('x', today, { kind: 'rest' })], today);
    expect(v.todo.map((i) => i.habit.id)).toEqual(['b', 'r']);
    expect(v.unplanned.map((i) => i.habit.id)).toEqual(['n']);
    expect(v.done.map((i) => i.habit.id)).toEqual(['m', 'x']);
  });
  it('計測中の習慣は、予定外の日でも「今日やること」に置く。しまった習慣は出さない', () => {
    const habits = [{ ...mk('note', 'n') }, { ...mk('reading', 'r'), archived: true }];
    const v = todayView(habits, [], '2026-11-03', 'n');
    expect(v.todo.map((i) => i.habit.id)).toEqual(['n']);
    expect(v.unplanned).toEqual([]);
  });
});

describe('再開', () => {
  const daily = mk('reading', 'r');
  it('2日以上あき、そのあいだに予定日があったら再開。前回の日付も返す', () => {
    expect(resumeInfo(daily, [rec('r', '2026-10-30')], '2026-11-01')).toEqual({ lastDate: '2026-10-30', missedPlanned: 1 });
    expect(resumeInfo(daily, [rec('r', '2026-10-31')], '2026-11-01')).toBeNull(); // 昨日やった
    expect(resumeInfo(daily, [rec('r', '2026-10-30'), rec('r', '2026-11-01')], '2026-11-01')).toBeNull(); // 今日やった
  });
  it('一度も記録していない習慣は「再開」にしない', () => {
    expect(resumeInfo(daily, [], '2026-11-10')).toBeNull();
  });
  it('予定のない日しか挟んでいなければ再開にしない（日曜だけの習慣）', () => {
    const sun = mk('note', 'n');
    expect(resumeInfo(sun, [rec('n', '2026-11-01')], '2026-11-05')).toBeNull(); // 間は月〜水（予定なし）
    expect(resumeInfo(sun, [rec('n', '2026-11-01')], '2026-11-10')).toEqual({ lastDate: '2026-11-01', missedPlanned: 1 }); // 11/8（日）を挟む
  });
  it('休むと決めた日も「記録した日」として数える（休んだ翌日は再開扱いにしない）', () => {
    expect(resumeInfo(daily, [rec('r', '2026-10-25'), rec('r', '2026-10-31', { kind: 'rest' })], '2026-11-01')).toBeNull();
  });
});

describe('休みが続いたとき（罰ではなく見直しの案内）', () => {
  const daily = mk('reading', 'r');
  const rests = (dates: string[]) => dates.map((d) => rec('r', d, { kind: 'rest' }));
  it('予定日の「休む」が続いた数を数える。今日が休みなら今日から', () => {
    expect(restStreak(daily, rests(['2026-10-29', '2026-10-30', '2026-10-31']), '2026-11-01')).toEqual({ count: 3, start: '2026-10-29' });
    expect(restStreak(daily, rests(['2026-10-30', '2026-10-31', '2026-11-01']), '2026-11-01')).toEqual({ count: 3, start: '2026-10-30' });
    expect(restStreak(daily, [...rests(['2026-10-30', '2026-10-31']), rec('r', '2026-10-29')], '2026-11-01')?.count).toBe(2);
    expect(restStreak(daily, [], '2026-11-01')).toBeNull();
  });
  it('予定のない日は飛ばして数える', () => {
    const sun = mk('note', 'n');
    expect(restStreak(sun, [rec('n', '2026-10-18', { kind: 'rest' }), rec('n', '2026-10-25', { kind: 'rest' }), rec('n', '2026-11-01', { kind: 'rest' })], '2026-11-05')?.count).toBe(3);
  });
  it('3日で案内。「このままでいい」のあとは、同じ休みの続きでさらに4日続くまで出さない。新しい休みの続きなら3日でまた出す', () => {
    const s = (count: number, start = '2026-10-29') => ({ count, start });
    expect(shouldPromptRest(s(2), undefined)).toBe(false);
    expect(shouldPromptRest(s(3), undefined)).toBe(true);
    expect(shouldPromptRest(s(5), { start: '2026-10-29', at: 3 })).toBe(false);
    expect(shouldPromptRest(s(7), { start: '2026-10-29', at: 3 })).toBe(true);
    expect(shouldPromptRest(s(3, '2026-11-10'), { start: '2026-10-29', at: 3 })).toBe(true);
  });
});

describe('週の見直し（習慣ごと）', () => {
  const settings = { ...DEFAULT_APP_SETTINGS };
  const meta = (p: Partial<Meta> = {}): Meta => ({ ...DEFAULT_META, firstUsedOn: '2026-10-25', ...p });
  const b = mk('boki', 'b', '2026-10-25T00:00:00.000Z');
  const r = mk('reading', 'r', '2026-10-25T00:00:00.000Z');
  const recs = [rec('b', '2026-10-26'), rec('r', '2026-10-26')];
  it('記録があり、使い始めから7日たった習慣だけが見直し時期', () => {
    expect(isHabitReviewDue(b, settings, meta(), recs, '2026-10-31')).toBe(false);
    expect(habitsDueForReview([b, r], settings, meta(), recs, '2026-11-01').map((h) => h.id)).toEqual(['b', 'r']);
    expect(isHabitReviewDue(mk('room', 'x', '2026-10-25T00:00:00.000Z'), settings, meta(), recs, '2026-11-01')).toBe(false); // 記録なし
  });
  it('1つを見直しても、ほかの習慣の見直し時期は変わらない', () => {
    const m = meta({ reviewByHabit: { r: { lastReviewOn: '2026-11-01', snoozedOn: null } } });
    expect(habitsDueForReview([b, r], settings, m, recs, '2026-11-01').map((h) => h.id)).toEqual(['b']);
  });
  it('「今週はしない」は選んだ習慣だけ。v7.1 以前の全体の見直し日は初期値として引き継ぐ', () => {
    const m = meta({ reviewByHabit: { b: { lastReviewOn: null, snoozedOn: '2026-11-01' } } });
    expect(habitsDueForReview([b, r], settings, m, recs, '2026-11-02').map((h) => h.id)).toEqual(['r']);
    const legacy = meta({ lastReviewOn: '2026-10-30' });
    expect(habitsDueForReview([b, r], settings, legacy, recs, '2026-11-02')).toEqual([]);
  });
  it('あとから追加した習慣は、追加した日から7日', () => {
    const late = mk('room', 'x', '2026-10-31T00:00:00.000Z');
    expect(isHabitReviewDue(late, settings, meta(), [rec('x', '2026-10-31')], '2026-11-03')).toBe(false);
    expect(isHabitReviewDue(late, settings, meta(), [rec('x', '2026-10-31')], '2026-11-07')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_META,
  bookmarkSuggestions,
  isPlannedDay,
  isReviewDue,
  looksVague,
  planDaysLabel,
  sanitizeReviews,
  smallPlan,
  weekFacts,
} from '../../src/lib/plan';
import { DEFAULT_SETTINGS, sanitizeSettings, type StudyRecord } from '../../src/lib/records';
import { buildBackup, parseImportText } from '../../src/lib/backup';
import { sanitizeActive } from '../../src/lib/session';

const rec = (p: Partial<StudyRecord> = {}): StudyRecord => ({
  id: p.id ?? Math.random().toString(36).slice(2),
  studyDate: '2026-11-01',
  startedAt: null,
  endedAt: null,
  minutes: 20,
  measuredSeconds: null,
  pausedSeconds: null,
  title: 't',
  note: '',
  source: 'timer',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...p,
});

describe('settings v6 migration', () => {
  it('old (v5) settings get plan defaults without losing values', () => {
    const s = sanitizeSettings({ subject: '簿記3級', nextAction: '仕訳3問', cue: '昼食後', targetMinutes: 25 });
    expect(s.nextAction).toBe('仕訳3問');
    expect(s.cue).toBe('昼食後');
    expect(s.targetMinutes).toBe(25);
    expect(s.smallAction).toBe('');
    expect(s.planDays).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(s.supportMode).toBe('plan');
    expect(s.weeklyReview).toBe(true);
  });
  it('rejects bad plan values', () => {
    const s = sanitizeSettings({ planDays: [1, 1, 9, -1, 'x', 3], smallMinutes: 0, supportMode: 'weird', weeklyReview: 'no' });
    expect(s.planDays).toEqual([1, 3]);
    expect(s.smallMinutes).toBe(5);
    expect(s.supportMode).toBe('plan');
    expect(s.weeklyReview).toBe(true);
  });
  it('legacy two_minute session is restored as small', () => {
    const a = sanitizeActive(
      { id: 'x', mode: 'two_minute', startedAt: 1000, targetSeconds: 120, pausedMs: 0, status: 'running' },
      2000,
    );
    expect(a?.mode).toBe('small');
    expect(a?.fromBookmark).toBe(false);
  });
});

describe('small plan', () => {
  it('falls back to 2 minutes when not set', () => {
    expect(smallPlan(DEFAULT_SETTINGS)).toEqual({ label: '2分だけ', minutes: 2, custom: false });
  });
  it('uses the user-defined small action', () => {
    expect(smallPlan({ ...DEFAULT_SETTINGS, smallAction: '1問だけ解く', smallMinutes: 5 })).toEqual({ label: '1問だけ解く', minutes: 5, custom: true });
  });
});

describe('planned days', () => {
  const weekdays = { ...DEFAULT_SETTINGS, planDays: [1, 2, 3, 4, 5] };
  it('label', () => {
    expect(planDaysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('毎日');
    expect(planDaysLabel([1, 2, 3, 4, 5])).toBe('平日');
    expect(planDaysLabel([0, 6])).toBe('土日');
    expect(planDaysLabel([1, 3, 5])).toBe('月・水・金');
  });
  it('isPlannedDay uses local weekday', () => {
    expect(isPlannedDay(weekdays, '2026-11-01')).toBe(false); // 日
    expect(isPlannedDay(weekdays, '2026-11-02')).toBe(true); // 月
  });
});

describe('weekly review timing', () => {
  const today = '2026-11-10';
  it('not due without real records', () => {
    expect(isReviewDue(DEFAULT_SETTINGS, { ...DEFAULT_META, firstUsedOn: '2026-10-01' }, [], today)).toBe(false);
  });
  it('due 7 days after first use (with records)', () => {
    const rs = [rec({ studyDate: '2026-11-05' })];
    expect(isReviewDue(DEFAULT_SETTINGS, { ...DEFAULT_META, firstUsedOn: '2026-11-04' }, rs, today)).toBe(false);
    expect(isReviewDue(DEFAULT_SETTINGS, { ...DEFAULT_META, firstUsedOn: '2026-11-03' }, rs, today)).toBe(true);
  });
  it('respects last review, snooze, simple mode and opt-out', () => {
    const rs = [rec({ studyDate: '2026-11-05' })];
    const meta = { ...DEFAULT_META, firstUsedOn: '2026-10-01' };
    expect(isReviewDue(DEFAULT_SETTINGS, { ...meta, lastReviewOn: '2026-11-08' }, rs, today)).toBe(false);
    expect(isReviewDue(DEFAULT_SETTINGS, { ...meta, reviewSnoozedOn: '2026-11-09' }, rs, today)).toBe(false);
    expect(isReviewDue({ ...DEFAULT_SETTINGS, supportMode: 'simple' }, meta, rs, today)).toBe(false);
    expect(isReviewDue({ ...DEFAULT_SETTINGS, weeklyReview: false }, meta, rs, today)).toBe(false);
  });
});

describe('weekFacts (facts only)', () => {
  it('counts only records in the last 7 days', () => {
    const s = { ...DEFAULT_SETTINGS, planDays: [1, 2, 3, 4, 5] }; // 平日
    const rs = [
      rec({ studyDate: '2026-11-02', minutes: 20, fromBookmark: true, cueFollowed: 'yes', bookmarkLeft: true }), // 月
      rec({ studyDate: '2026-11-02', minutes: 5, mode: 'small', cueFollowed: 'no' }),
      rec({ studyDate: '2026-11-07', minutes: 30, source: 'manual' }), // 土
      rec({ studyDate: '2026-10-31', minutes: 99 }), // 範囲外
    ];
    const f = weekFacts(rs, s, '2026-11-07');
    expect(f.start).toBe('2026-11-01');
    expect(f.studyDays).toBe(2);
    expect(f.plannedDays).toBe(5);
    expect(f.plannedDone).toBe(1);
    expect(f.minutes).toBe(55);
    expect(f.fromBookmark).toBe(1);
    expect(f.small).toBe(1);
    expect(f.cueYes).toBe(1);
    expect(f.cueAnswered).toBe(2);
    expect(f.bookmarkLeft).toBe(1);
    expect(f.timerSessions).toBe(2);
  });
  it('does not count planned days before first use as missed', () => {
    const f = weekFacts([], { ...DEFAULT_SETTINGS }, '2026-11-07', '2026-11-06');
    expect(f.plannedDays).toBe(2);
    expect(f.plannedDone).toBe(0);
  });
});

describe('bookmark helpers', () => {
  it('suggestions are derived from today’s content only', () => {
    expect(bookmarkSuggestions('', '')).toEqual([]);
    expect(bookmarkSuggestions('第11章の仕訳問題を3問解く', '')).toEqual(['続き：第11章の仕訳問題を3問解く', '解き直し：第11章の仕訳問題を3問解く']);
    expect(bookmarkSuggestions('講義', '続き：講義')).toEqual(['解き直し：講義']);
  });
  it('vagueness hint', () => {
    expect(looksVague('')).toBe(false);
    expect(looksVague('簿記の勉強')).toBe(true);
    expect(looksVague('第11章の問題')).toBe(false);
    expect(looksVague('仕訳を3問')).toBe(false);
    expect(looksVague('テキストを最初から最後まで読み直して理解する')).toBe(false); // 長い文は判定しない
  });
});

describe('reviews & backup v2', () => {
  it('sanitizeReviews drops invalid entries and duplicates', () => {
    const r = sanitizeReviews([
      { id: 'a', date: '2026-11-08', change: 'cue', ease: 3, note: 'x' },
      { id: 'a', date: '2026-11-08', change: 'cue' },
      { id: 'b', date: 'bad' },
      { id: 'c', date: '2026-11-15', change: '???', ease: 9 },
    ]);
    expect(r.map((x) => x.id)).toEqual(['a', 'c']);
    expect(r[1].change).toBe('none');
    expect(r[1].ease).toBeNull();
  });
  it('round-trips reviews and behaviour facts; still reads v1 backups', () => {
    const records = [rec({ id: 'r1', mode: 'small', fromBookmark: true, cueFollowed: 'yes', openToStartSec: 42, plannedDay: true, bookmarkLeft: true, supportMode: 'plan' })];
    const reviews = sanitizeReviews([{ id: 'v', date: '2026-11-01', change: 'small', ease: 4, note: '' }]);
    const json = JSON.stringify(buildBackup({ ...DEFAULT_SETTINGS, smallAction: '1問だけ' }, records, reviews));
    const p = parseImportText(json, '2026-11-01');
    if (p.kind !== 'backup') throw new Error('kind');
    expect(p.records[0]).toMatchObject({ mode: 'small', fromBookmark: true, cueFollowed: 'yes', openToStartSec: 42, plannedDay: true, bookmarkLeft: true, supportMode: 'plan' });
    expect(p.reviews).toHaveLength(1);
    expect(p.settings.smallAction).toBe('1問だけ');

    const v1 = { format: 'tsuzuku-backup', schemaVersion: 1, baseline: { minutes: 1056, asOf: '2026-10-07' }, settings: { nextAction: 'x' }, records: [rec({ id: 'old' })] };
    const p1 = parseImportText(JSON.stringify(v1), '2026-11-01');
    if (p1.kind !== 'backup') throw new Error('kind');
    expect(p1.records).toHaveLength(1);
    expect(p1.reviews).toEqual([]);
    expect(p1.settings.supportMode).toBe('plan');
  });
});

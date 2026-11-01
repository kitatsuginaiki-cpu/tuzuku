import { describe, expect, it } from 'vitest';
import { BASELINE } from '../../src/lib/config';
import {
  addDays,
  dayDiff,
  formatClock,
  formatMinutes,
  isValidDateString,
  localDate,
} from '../../src/lib/dates';
import {
  beginCompleting,
  cancelCompleting,
  createSession,
  elapsedMs,
  isOverTarget,
  pause,
  pausedTotalMs,
  progressRatio,
  remainingMs,
  resume,
  sanitizeActive,
  setTarget,
  suggestedMinutes,
} from '../../src/lib/session';
import {
  DEFAULT_SETTINGS,
  appMinutes,
  homeMode,
  sanitizeSettings,
  sortRecords,
  summary14,
  totalMinutes,
  validateRecord,
  type StudyRecord,
} from '../../src/lib/records';
import { buildBackup, ImportError, parseImportText } from '../../src/lib/backup';

const T0 = new Date(2026, 10, 1, 14, 0, 0).getTime();
const MIN = 60_000;

function rec(p: Partial<StudyRecord> = {}): StudyRecord {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    studyDate: '2026-11-01',
    startedAt: null,
    endedAt: null,
    minutes: 20,
    measuredSeconds: null,
    pausedSeconds: null,
    title: 'テスト',
    note: '',
    source: 'manual',
    createdAt: '2026-11-01T05:00:00.000Z',
    updatedAt: '2026-11-01T05:00:00.000Z',
    ...p,
  };
}

describe('baseline', () => {
  it('is 1056 minutes as of 2026-10-07 = 17時間36分', () => {
    expect(BASELINE.minutes).toBe(1056);
    expect(BASELINE.asOf).toBe('2026-10-07');
    expect(formatMinutes(BASELINE.minutes)).toBe('17時間36分');
  });
  it('total with zero records equals baseline (no fabricated sessions)', () => {
    expect(totalMinutes([])).toBe(1056);
    expect(appMinutes([])).toBe(0);
  });
  it('total = baseline + records, and recalculates after edit/delete', () => {
    let rs = [rec({ id: 'a', minutes: 20 }), rec({ id: 'b', minutes: 35 })];
    expect(totalMinutes(rs)).toBe(1056 + 55);
    rs = rs.map((r) => (r.id === 'a' ? { ...r, minutes: 25 } : r));
    expect(totalMinutes(rs)).toBe(1056 + 60);
    rs = rs.filter((r) => r.id !== 'b');
    expect(totalMinutes(rs)).toBe(1056 + 25);
  });
});

describe('dates', () => {
  it('localDate uses local calendar, not UTC', () => {
    const d = new Date(2026, 10, 1, 0, 30); // 00:30 local
    expect(localDate(d)).toBe('2026-11-01');
  });
  it('dayDiff / addDays across month boundary', () => {
    expect(dayDiff('2026-10-30', '2026-11-02')).toBe(3);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
  it('rejects impossible dates', () => {
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(isValidDateString('2026-11-01')).toBe(true);
    expect(isValidDateString('2026/11/01')).toBe(false);
  });
  it('formatClock', () => {
    expect(formatClock(20 * MIN)).toBe('20:00');
    expect(formatClock(65 * MIN + 3000)).toBe('1:05:03');
  });
});

describe('session timing (wall-clock based)', () => {
  const s0 = createSession({ mode: 'standard', title: '仕訳', subject: '簿記3級', targetMinutes: 20, now: T0, id: 's1' });

  it('elapsed from timestamps, not tick count', () => {
    expect(elapsedMs(s0, T0 + 5 * MIN)).toBe(5 * MIN);
    expect(remainingMs(s0, T0 + 5 * MIN)).toBe(15 * MIN);
    expect(progressRatio(s0, T0 + 5 * MIN)).toBeCloseTo(0.25);
  });

  it('pause / resume excludes paused time', () => {
    let s = pause(s0, T0 + 5 * MIN);
    expect(elapsedMs(s, T0 + 30 * MIN)).toBe(5 * MIN); // paused: frozen
    s = resume(s, T0 + 10 * MIN);
    expect(elapsedMs(s, T0 + 12 * MIN)).toBe(7 * MIN);
    expect(pausedTotalMs(s, T0 + 12 * MIN)).toBe(5 * MIN);
  });

  it('background time while running counts as elapsed (user confirms at finish)', () => {
    // 画面を離れていても running なら時間は進む。setInterval が止まっていても復帰時に正しい値。
    expect(elapsedMs(s0, T0 + 47 * MIN)).toBe(47 * MIN);
    expect(isOverTarget(s0, T0 + 47 * MIN)).toBe(true);
    expect(progressRatio(s0, T0 + 47 * MIN)).toBe(1);
  });

  it('completing freezes the clock and cancel treats the gap as pause', () => {
    let s = beginCompleting(s0, T0 + 8 * MIN);
    expect(elapsedMs(s, T0 + 20 * MIN)).toBe(8 * MIN);
    s = cancelCompleting(s, T0 + 10 * MIN);
    expect(s.status).toBe('running');
    expect(elapsedMs(s, T0 + 11 * MIN)).toBe(9 * MIN);
  });

  it('completing from paused state does not count paused time and returns to paused', () => {
    let s = pause(s0, T0 + 4 * MIN);
    s = beginCompleting(s, T0 + 9 * MIN);
    expect(elapsedMs(s, T0 + 9 * MIN)).toBe(4 * MIN);
    s = cancelCompleting(s, T0 + 10 * MIN);
    expect(s.status).toBe('paused');
    expect(elapsedMs(s, T0 + 15 * MIN)).toBe(4 * MIN);
    s = resume(s, T0 + 15 * MIN);
    expect(elapsedMs(s, T0 + 16 * MIN)).toBe(5 * MIN);
  });

  it('target reached does not auto-complete', () => {
    const s = createSession({ mode: 'small', title: '', subject: '', targetMinutes: 2, now: T0 });
    expect(isOverTarget(s, T0 + 2 * MIN)).toBe(true);
    expect(s.status).toBe('running');
  });

  it('target can be changed', () => {
    const s = setTarget(s0, 30);
    expect(remainingMs(s, T0 + 5 * MIN)).toBe(25 * MIN);
  });

  it('suggestedMinutes does not round <30s up to 1 minute', () => {
    expect(suggestedMinutes(s0, T0 + 20_000)).toBe(0);
    expect(suggestedMinutes(s0, T0 + 20 * MIN + 10_000)).toBe(20);
  });

  it('sanitizeActive restores valid sessions and rejects broken ones', () => {
    expect(sanitizeActive(JSON.parse(JSON.stringify(s0)), T0 + MIN)).toEqual(s0);
    expect(sanitizeActive({ ...s0, status: 'paused', pausedAt: null }, T0)).toBeNull();
    expect(sanitizeActive({ ...s0, startedAt: T0 + 3600_000 }, T0)).toBeNull();
    expect(sanitizeActive(null, T0)).toBeNull();
  });
});

describe('record validation', () => {
  const today = '2026-11-01';
  it('accepts a valid record', () => {
    expect(validateRecord(rec(), today)).toEqual({});
  });
  it('rejects dates on/before baseline (prevents double counting)', () => {
    expect(validateRecord(rec({ studyDate: '2026-10-07' }), today).studyDate).toMatch(/確認済みの累計/);
    expect(validateRecord(rec({ studyDate: '2026-10-08' }), today)).toEqual({});
  });
  it('rejects future dates, bad minutes, empty / long title', () => {
    expect(validateRecord(rec({ studyDate: '2026-11-02' }), today).studyDate).toBeDefined();
    expect(validateRecord(rec({ minutes: 0 }), today).minutes).toBeDefined();
    expect(validateRecord(rec({ minutes: 1441 }), today).minutes).toBeDefined();
    expect(validateRecord(rec({ minutes: 2.5 }), today).minutes).toBeDefined();
    expect(validateRecord(rec({ title: '  ' }), today).title).toBeDefined();
    expect(validateRecord(rec({ title: 'あ'.repeat(101) }), today).title).toBeDefined();
  });
  it('settings sanitization truncates and defaults', () => {
    const s = sanitizeSettings({ nextAction: 'x'.repeat(200), cue: '\n昼食後\n', targetMinutes: 9999 });
    expect(s.nextAction.length).toBe(80);
    expect(s.cue).toBe('昼食後');
    expect(s.targetMinutes).toBe(20);
    expect(s.subject).toBe('簿記3級');
  });
});

describe('home mode', () => {
  const withNext = { ...DEFAULT_SETTINGS, nextAction: '仕訳を3問' };
  it('no records → never resume (baseline alone is not a "last study")', () => {
    expect(homeMode([], DEFAULT_SETTINGS, '2026-12-31')).toBe('empty');
    expect(homeMode([], withNext, '2026-12-31')).toBe('default');
  });
  it('resume when last record is ≥2 days ago', () => {
    const rs = [rec({ studyDate: '2026-10-30' })];
    expect(homeMode(rs, withNext, '2026-10-31')).toBe('default');
    expect(homeMode(rs, withNext, '2026-11-01')).toBe('resume');
    expect(homeMode(rs, withNext, '2026-11-01', 3)).toBe('default'); // threshold configurable
  });
});

describe('summary14 / sort', () => {
  it('aggregates only real records within 14 days', () => {
    const rs = [
      rec({ studyDate: '2026-11-01', minutes: 10 }),
      rec({ studyDate: '2026-11-01', minutes: 5 }),
      rec({ studyDate: '2026-10-19', minutes: 30 }),
      rec({ studyDate: '2026-10-18', minutes: 99 }), // outside window
    ];
    const s = summary14(rs, '2026-11-01');
    expect(s.days).toHaveLength(14);
    expect(s.studyDays).toBe(2);
    expect(s.minutes).toBe(45);
  });
  it('sorts newest first', () => {
    const rs = sortRecords([rec({ id: 'old', studyDate: '2026-10-20' }), rec({ id: 'new', studyDate: '2026-10-25' })]);
    expect(rs[0].id).toBe('new');
  });
});

describe('backup / restore', () => {
  const today = '2026-11-01';
  it('round-trips', () => {
    const rs = [rec({ id: 'a' }), rec({ id: 'b', studyDate: '2026-10-20', minutes: 45 })];
    const json = JSON.stringify(buildBackup({ ...DEFAULT_SETTINGS, nextAction: '次' }, rs));
    const parsed = parseImportText(json, today);
    expect(parsed.kind).toBe('backup');
    if (parsed.kind !== 'backup') return;
    expect(parsed.records).toHaveLength(2);
    expect(totalMinutes(parsed.records)).toBe(1056 + 65);
    expect(parsed.settings.nextAction).toBe('次');
  });
  it('rejects invalid JSON, foreign files, baseline mismatch, duplicates, bad records', () => {
    expect(() => parseImportText('{', today)).toThrow(ImportError);
    expect(() => parseImportText('{"hello":1}', today)).toThrow(/バックアップファイルではありません/);
    const good = buildBackup(DEFAULT_SETTINGS, [rec({ id: 'a' })]);
    expect(() => parseImportText(JSON.stringify({ ...good, baseline: { minutes: 2000, asOf: '2026-10-07' } }), today)).toThrow(/一致しない/);
    expect(() => parseImportText(JSON.stringify({ ...good, records: [rec({ id: 'x' }), rec({ id: 'x' })] }), today)).toThrow(/重複/);
    expect(() => parseImportText(JSON.stringify({ ...good, records: [rec({ studyDate: '2026-10-01' })] }), today)).toThrow(/確認済みの累計/);
    expect(() => parseImportText(JSON.stringify({ ...good, schemaVersion: 99 }), today)).toThrow(/新しいバージョン/);
  });
  it('strips script-like strings safely (stored as text only)', () => {
    const json = JSON.stringify(buildBackup(DEFAULT_SETTINGS, [rec({ id: 'a', title: '<img src=x onerror=alert(1)>' })]));
    const parsed = parseImportText(json, today);
    if (parsed.kind === 'backup') expect(parsed.records[0].title).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('legacy v3.1 migration', () => {
  const today = '2026-11-01';
  const v3 = {
    format: 'tsuzuku-v3',
    version: 3,
    baselineMinutes: 1056,
    baselineDate: '2026-10-07',
    settings: { goal: '日商簿記3級', nextStep: '第14講義の途中から', cue: '朝食後' },
    records: [
      { id: 'r1', day: '2026-10-25', title: '講義#14', kind: '講義', note: '', minutes: 25, endedAt: '2026-10-25T03:00:00.000Z', createdAt: '2026-10-25T03:00:00.000Z', source: 'timer' },
      { id: 'r2', day: '2026-10-05', title: '基準日以前', kind: '問題演習', note: '', minutes: 30, createdAt: '2026-10-05T03:00:00.000Z' },
      { id: 'r3', day: '2026-10-26', title: '', kind: 'その他', note: '', minutes: 10 },
    ],
    events: [{ at: 'x', type: 'open' }],
  };
  it('produces candidates; excludes baseline-period and invalid records', () => {
    const p = parseImportText(JSON.stringify(v3), today);
    expect(p.kind).toBe('legacy_v3');
    if (p.kind !== 'legacy_v3') return;
    const [a, b, c] = p.legacy.candidates;
    expect(a.include).toBe(true);
    expect(a.record.id).toBe('v3-r1');
    expect(a.record.category).toBe('講義');
    expect(a.record.source).toBe('import_v3');
    expect(b.blocked).toBe(true);
    expect(b.reason).toMatch(/二重計上/);
    expect(c.blocked).toBe(true);
    expect(p.legacy.nextAction).toBe('第14講義の途中から');
  });
});

/**
 * 積み上げ：途切れても減らない合計。数字と図は同じ関数から作る（不一致を防ぐ）。
 */
import { BASELINE } from './config';
import { addDays, parseLocalDate } from './dates';
import { isDone, type AppSettings, type Habit } from './model';
import type { StudyRecord } from './records';

export type Total =
  | { type: 'time'; minutes: number; baselineMinutes: number; appMinutes: number }
  | { type: 'days'; days: number; smallDays: number; restDays: number };

export function recordsOf(habitId: string, records: readonly StudyRecord[]): StudyRecord[] {
  return records.filter((r) => r.habitId === habitId);
}

export function habitTotal(habit: Habit, records: readonly StudyRecord[]): Total {
  const rs = recordsOf(habit.id, records);
  if (habit.trackingType === 'time') {
    const app = rs.filter(isDone).reduce((s, r) => s + r.minutes, 0);
    const base = habit.baseline ? BASELINE.minutes : 0;
    return { type: 'time', minutes: base + app, baselineMinutes: base, appMinutes: app };
  }
  const dates = new Set(rs.map((r) => r.studyDate));
  let days = 0;
  let smallDays = 0;
  let restDays = 0;
  for (const d of dates) {
    const s = dayStatus(habit.id, rs, d);
    if (s === 'done' || s === 'small') days++;
    if (s === 'small') smallDays++;
    if (s === 'rest') restDays++;
  }
  return { type: 'days', days, smallDays, restDays };
}

/** 比較用の数値（時間型＝分、日数型＝日） */
export function totalValue(t: Total): number {
  return t.type === 'time' ? t.minutes : t.days;
}

export function formatHM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}時間${m}分` : `${m}分`;
}

export function formatTotal(t: Total): string {
  return t.type === 'time' ? formatHM(t.minutes) : `${t.days}日`;
}

export type DayStatus = 'done' | 'small' | 'rest' | null;

export function dayStatus(habitId: string, records: readonly StudyRecord[], date: string): DayStatus {
  const rs = records.filter((r) => r.habitId === habitId && r.studyDate === date);
  if (rs.some((r) => isDone(r) && r.mode !== 'small')) return 'done';
  if (rs.some((r) => isDone(r))) return 'small';
  if (rs.some((r) => !isDone(r))) return 'rest';
  return null;
}

export interface Blocks {
  blockMinutes: number;
  baselineBlocks: number;
  appBlocks: number;
  /** ブロックにならない端数（分） */
  remainder: number;
}

/** 時間型の積み上げブロック。基準値は土台として先に積む */
export function toBlocks(t: Extract<Total, { type: 'time' }>, blockMinutes: number): Blocks {
  const all = Math.floor(t.minutes / blockMinutes);
  const base = Math.min(all, Math.floor(t.baselineMinutes / blockMinutes));
  return { blockMinutes, baselineBlocks: base, appBlocks: all - base, remainder: t.minutes - all * blockMinutes };
}

export interface CalendarDay {
  date: string;
  status: DayStatus;
  planned: boolean;
  future: boolean;
  /** 習慣を始める前の日（予定として扱わない） */
  before: boolean;
}

/** 日数型のタイル（直近 weeks 週・月曜はじまり） */
export function calendar(habit: Habit, records: readonly StudyRecord[], today: string, weeks = 6, since: string | null = null): CalendarDay[][] {
  const t = parseLocalDate(today);
  const dow = (t.getDay() + 6) % 7; // 月=0
  const start = addDays(today, -dow - (weeks - 1) * 7);
  const rows: CalendarDay[][] = [];
  for (let w = 0; w < weeks; w++) {
    const row: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, w * 7 + i);
      const before = !!since && d < since;
      row.push({
        date: d,
        status: d > today ? null : dayStatus(habit.id, records, d),
        planned: !before && habit.planDays.includes(parseLocalDate(d).getDay()),
        future: d > today,
        before,
      });
    }
    rows.push(row);
  }
  return rows;
}

/**
 * 記録の前後で越えた節目（時間型は「時間」、日数型は「日」で返す）。なければ null。
 */
export function crossedMilestone(habit: Habit, before: Total, after: Total, s: AppSettings): number | null {
  const list = habit.trackingType === 'time' ? s.milestonesTime.map((h) => h * 60) : s.milestonesDays;
  const b = totalValue(before);
  const a = totalValue(after);
  let hit: number | null = null;
  for (const m of list) if (b < m && a >= m) hit = m;
  if (hit == null) return null;
  return habit.trackingType === 'time' ? hit / 60 : hit;
}

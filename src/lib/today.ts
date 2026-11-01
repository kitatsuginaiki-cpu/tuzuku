/**
 * 今日の画面の並び・再開・休みが続いたときの見直し・週の見直し（習慣ごと）。
 * すべて本人の記録と予定の曜日だけから計算する（推定・AI は使わない）。
 */
import { RESUME_GAP_DAYS, REVIEW_INTERVAL_DAYS } from './config';
import { addDays, dayDiff, localDate } from './dates';
import { dayStatus, type DayStatus } from './accumulate';
import { isPlannedDay, type Meta } from './plan';
import type { AppSettings, Habit } from './model';
import type { StudyRecord } from './records';

export type TodayGroup = 'todo' | 'unplanned' | 'done';

export interface HabitToday {
  habit: Habit;
  status: DayStatus;
  planned: boolean;
  group: TodayGroup;
  resume: ResumeInfo | null;
  rest: RestStreak | null;
}

export interface ResumeInfo {
  /** 最後に記録（やった・休み）した日 */
  lastDate: string;
  /** その日から今日までのあいだの、記録のない予定日の数 */
  missedPlanned: number;
}

export interface RestStreak {
  /** 続いている「休むと決めた」予定日の数 */
  count: number;
  /** 続いている休みの最初の日（見直しの案内を一度だけ出す目印） */
  start: string;
}

/** 習慣を作った日（ローカル日付） */
export function createdOn(h: Habit): string {
  const t = Date.parse(h.createdAt);
  return Number.isNaN(t) ? '1970-01-01' : localDate(new Date(t));
}

/**
 * 再開：2日以上あき、そのあいだに予定日が1日以上あった（記録がある習慣だけ）。
 * まだ一度も記録していない習慣は「再開」ではないので出さない。
 */
export function resumeInfo(h: Habit, records: readonly StudyRecord[], today: string): ResumeInfo | null {
  let last: string | null = null;
  let hasToday = false;
  for (const r of records) {
    if (r.habitId !== h.id) continue;
    if (r.studyDate === today) hasToday = true;
    else if (r.studyDate < today && (!last || r.studyDate > last)) last = r.studyDate;
  }
  if (hasToday || !last) return null;
  if (dayDiff(last, today) < RESUME_GAP_DAYS) return null;
  let missed = 0;
  for (let d = addDays(last, 1); d < today; d = addDays(d, 1)) if (isPlannedDay(h, d)) missed++;
  return missed >= 1 ? { lastDate: last, missedPlanned: missed } : null;
}

/** 予定日に「休むと決めた」が何日続いているか（今日が休みなら今日から、そうでなければ昨日から数える） */
export function restStreak(h: Habit, records: readonly StudyRecord[], today: string, lookback = 60): RestStreak | null {
  let count = 0;
  let start = '';
  const first = dayStatus(h.id, records, today) === 'rest' ? today : addDays(today, -1);
  for (let k = 0, d = first; k < lookback; k++, d = addDays(d, -1)) {
    if (!isPlannedDay(h, d)) continue;
    const s = dayStatus(h.id, records, d);
    if (s !== 'rest') break;
    count++;
    start = d;
  }
  return count > 0 ? { count, start } : null;
}

export const REST_PROMPT_AT = 3;
/** 「このままでいい」を選んだあと、さらにこの日数続いたらもう一度だけ案内する */
export const REST_PROMPT_AGAIN = 4;

export function shouldPromptRest(streak: RestStreak | null, dismissed: { start: string; at: number } | undefined): boolean {
  if (!streak || streak.count < REST_PROMPT_AT) return false;
  if (!dismissed || dismissed.start !== streak.start) return true;
  return streak.count >= dismissed.at + REST_PROMPT_AGAIN;
}

/** 今日の画面の並び：①今日の予定でまだ記録がない ②予定外 ③今日は記録済み（休みを含む）。グループ内は習慣の順番 */
export function todayView(habits: readonly Habit[], records: readonly StudyRecord[], today: string, activeHabitId: string | null = null) {
  const list = habits.filter((h) => !h.archived).sort((a, b) => a.order - b.order);
  const out: Record<TodayGroup, HabitToday[]> = { todo: [], unplanned: [], done: [] };
  for (const h of list) {
    const status = dayStatus(h.id, records, today);
    const planned = isPlannedDay(h, today);
    // 計測中の習慣は「今日やること」に置く（まだ記録になっていないため）
    const group: TodayGroup = status ? 'done' : planned || h.id === activeHabitId ? 'todo' : 'unplanned';
    out[group].push({ habit: h, status, planned, group, resume: status ? null : resumeInfo(h, records, today), rest: restStreak(h, records, today) });
  }
  return out;
}

/* ------------------------------ 週の見直し（習慣ごと） ------------------------------ */

export interface HabitReviewState {
  lastReviewOn: string | null;
  snoozedOn: string | null;
}

export function reviewStateOf(meta: Meta, habitId: string): HabitReviewState {
  const s = meta.reviewByHabit?.[habitId];
  // v7.1 以前の全体の見直し日は、まだ個別の記録がない習慣の初期値として引き継ぐ
  return { lastReviewOn: s?.lastReviewOn ?? meta.lastReviewOn ?? null, snoozedOn: s?.snoozedOn ?? meta.reviewSnoozedOn ?? null };
}

/**
 * その習慣の見直し時期か：記録があり、使い始め（または前回の見直し）から7日以上たち、「今週はしない」から7日以上たっている。
 */
export function isHabitReviewDue(
  h: Habit,
  settings: Pick<AppSettings, 'supportMode' | 'weeklyReview'>,
  meta: Meta,
  records: readonly StudyRecord[],
  today: string,
): boolean {
  if (settings.supportMode !== 'plan' || !settings.weeklyReview || h.archived) return false;
  const mine = records.filter((r) => r.habitId === h.id);
  if (!mine.length) return false;
  const st = reviewStateOf(meta, h.id);
  const created = createdOn(h);
  const firstUse = meta.firstUsedOn && meta.firstUsedOn > created ? meta.firstUsedOn : created;
  const earliest = mine.reduce((m, r) => (r.studyDate < m ? r.studyDate : m), mine[0].studyDate);
  const since = st.lastReviewOn ?? (firstUse < earliest ? firstUse : earliest);
  if (dayDiff(since, today) < REVIEW_INTERVAL_DAYS) return false;
  if (st.snoozedOn && dayDiff(st.snoozedOn, today) < REVIEW_INTERVAL_DAYS) return false;
  return true;
}

export function habitsDueForReview(habits: readonly Habit[], settings: AppSettings, meta: Meta, records: readonly StudyRecord[], today: string): Habit[] {
  return habits.filter((h) => isHabitReviewDue(h, settings, meta, records, today)).sort((a, b) => a.order - b.order);
}

/**
 * プラン（きっかけ→一手、小さな一手）と「戻り方」（再開・週の見直し）のルール。
 * すべて本人が入力した内容と実際の記録だけから計算する。推定・AI は使わない。
 */
import { LIMITS, REVIEW_INTERVAL_DAYS, TWO_MINUTE_TARGET_MINUTES } from './config';
import { addDays, dayDiff, isValidDateString, parseLocalDate } from './dates';
import { cleanText, type Settings, type StudyRecord } from './records';

/* ---------------- メタ情報・週の見直し ---------------- */

export interface Meta {
  /** このアプリを最初に使った日（ローカル日付） */
  firstUsedOn: string | null;
  /** 最後に週の見直しをした日 */
  lastReviewOn: string | null;
  /** 「今週はしない」を選んだ日（その日から次の間隔まで提案しない） */
  reviewSnoozedOn: string | null;
}

export const DEFAULT_META: Meta = Object.freeze({ firstUsedOn: null, lastReviewOn: null, reviewSnoozedOn: null }) as Meta;

export type ReviewChange = 'cue' | 'action' | 'small' | 'days' | 'none';

export interface Review {
  id: string;
  /** 見直しをした日 */
  date: string;
  /** 対象期間の初日（7日前） */
  periodStart: string;
  /** 来週ひとつだけ変えること */
  change: ReviewChange;
  /** 任意：今週の始めやすさ 1〜5 */
  ease: number | null;
  note: string;
  createdAt: string;
}

export const REVIEW_CHANGE_LABEL: Record<ReviewChange, string> = {
  cue: 'きっかけを変える',
  action: 'しおりの一手を小さくする',
  small: '小さな一手を変える',
  days: '予定の曜日を変える',
  none: '今のままで続ける',
};

export function sanitizeMeta(raw: unknown): Meta {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = (v: unknown) => (isValidDateString(v) ? v : null);
  return { firstUsedOn: d(r.firstUsedOn), lastReviewOn: d(r.lastReviewOn), reviewSnoozedOn: d(r.reviewSnoozedOn) };
}

export function sanitizeReviews(raw: unknown): Review[] {
  if (!Array.isArray(raw)) return [];
  const out: Review[] = [];
  const ids = new Set<string>();
  for (const x of raw.slice(-500)) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    if (typeof r.id !== 'string' || ids.has(r.id) || !isValidDateString(r.date)) continue;
    const change = (['cue', 'action', 'small', 'days', 'none'] as const).find((c) => c === r.change) ?? 'none';
    const ease = typeof r.ease === 'number' && Number.isInteger(r.ease) && r.ease >= 1 && r.ease <= 5 ? r.ease : null;
    ids.add(r.id);
    out.push({
      id: r.id,
      date: r.date,
      periodStart: isValidDateString(r.periodStart) ? r.periodStart : addDays(r.date, -(REVIEW_INTERVAL_DAYS - 1)),
      change,
      ease,
      note: cleanText(r.note, LIMITS.reviewNote),
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    });
  }
  return out;
}

/**
 * 週の見直しを提案するか。
 * - プラン表示で、見直しをオンにしている
 * - 最初の利用から（または前回の見直しから）7日以上たっている
 * - 「今週はしない」から7日以内ではない
 * - 実際の記録が1件以上ある（何も事実がない状態で振り返りを求めない）
 */
export function isReviewDue(settings: Settings, meta: Meta, records: readonly StudyRecord[], today: string): boolean {
  if (settings.supportMode !== 'plan' || !settings.weeklyReview) return false;
  if (records.length === 0) return false;
  const since = meta.lastReviewOn ?? meta.firstUsedOn ?? earliest(records);
  if (!since || dayDiff(since, today) < REVIEW_INTERVAL_DAYS) return false;
  if (meta.reviewSnoozedOn && dayDiff(meta.reviewSnoozedOn, today) < REVIEW_INTERVAL_DAYS) return false;
  return true;
}

function earliest(records: readonly StudyRecord[]): string | null {
  let e: string | null = null;
  for (const r of records) if (e === null || r.studyDate < e) e = r.studyDate;
  return e;
}

export interface WeekFacts {
  start: string;
  end: string;
  /** 学習した日数（重複なし） */
  studyDays: number;
  /** 期間中の予定日の数 */
  plannedDays: number;
  /** 予定日のうち学習した日 */
  plannedDone: number;
  sessions: number;
  minutes: number;
  fromBookmark: number;
  small: number;
  /** きっかけ通りと答えた回数／回答した回数 */
  cueYes: number;
  cueAnswered: number;
  /** しおりを残した回数（タイマー記録のうち） */
  bookmarkLeft: number;
  timerSessions: number;
}

/**
 * 直近7日（today を含む）の事実だけを集計する。
 * 予定日は「アプリを使い始めた日（since）」以降だけを数える（使う前の日を「できなかった日」にしない）。
 */
export function weekFacts(records: readonly StudyRecord[], settings: Settings, today: string, since: string | null = null): WeekFacts {
  const start = addDays(today, -(REVIEW_INTERVAL_DAYS - 1));
  const inRange = records.filter((r) => r.studyDate >= start && r.studyDate <= today);
  const days = new Set(inRange.map((r) => r.studyDate));
  let plannedDays = 0;
  let plannedDone = 0;
  for (let i = 0; i < REVIEW_INTERVAL_DAYS; i++) {
    const d = addDays(start, i);
    if (since && d < since) continue;
    if (settings.planDays.includes(parseLocalDate(d).getDay())) {
      plannedDays++;
      if (days.has(d)) plannedDone++;
    }
  }
  const timer = inRange.filter((r) => r.source === 'timer');
  return {
    start,
    end: today,
    studyDays: days.size,
    plannedDays,
    plannedDone,
    sessions: inRange.length,
    minutes: inRange.reduce((s, r) => s + r.minutes, 0),
    fromBookmark: inRange.filter((r) => r.fromBookmark).length,
    small: inRange.filter((r) => r.mode === 'small').length,
    cueYes: inRange.filter((r) => r.cueFollowed === 'yes').length,
    cueAnswered: inRange.filter((r) => r.cueFollowed === 'yes' || r.cueFollowed === 'no').length,
    bookmarkLeft: timer.filter((r) => r.bookmarkLeft).length,
    timerSessions: timer.length,
  };
}

/* ---------------- 小さな一手 ---------------- */

export interface SmallPlan {
  label: string;
  minutes: number;
  /** 本人が設定したか（未設定なら従来の2分） */
  custom: boolean;
}

export function smallPlan(settings: Settings): SmallPlan {
  if (settings.smallAction) return { label: settings.smallAction, minutes: settings.smallMinutes, custom: true };
  return { label: `${TWO_MINUTE_TARGET_MINUTES}分だけ`, minutes: TWO_MINUTE_TARGET_MINUTES, custom: false };
}

export function isPlannedDay(settings: Settings, date: string): boolean {
  return settings.planDays.includes(parseLocalDate(date).getDay());
}

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

export function planDaysLabel(days: readonly number[]): string {
  if (days.length === 7) return '毎日';
  if (days.length === 0) return '曜日を決めていない';
  const set = new Set(days);
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return '平日';
  if (days.length === 2 && set.has(0) && set.has(6)) return '土日';
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => set.has(d)).map((d) => WEEKDAY_LABELS[d]).join('・');
}

/* ---------------- しおり（次の一手） ---------------- */

/**
 * しおりの候補。今日やったことから機械的に作る（根拠のない内容は作らない）。
 * 「解き直す」は検索練習（Dunlosky et al., 2013）に沿った候補。
 */
export function bookmarkSuggestions(didToday: string, current: string): string[] {
  const t = cleanText(didToday, LIMITS.nextAction - 6);
  if (!t) return [];
  const list = [`続き：${t}`, `解き直し：${t}`];
  return list.filter((s, i) => s !== current && list.indexOf(s) === i).map((s) => s.slice(0, LIMITS.nextAction));
}

/**
 * 一手が具体的でなさそうか（あくまでヒント。保存は妨げない）。
 * 数字・範囲・量を示す語が1つもなく、短い場合に true。
 */
export function looksVague(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[0-9０-９一二三四五六七八九十]/.test(t)) return false;
  if (/(章|問|ページ|頁|講|回|分|節|題|p\.|P\.|#|まで|から)/.test(t)) return false;
  return t.length <= 12;
}

import {
  BASELINE,
  LIMITS,
  RESUME_GAP_DAYS,
  DEFAULT_SUBJECT,
  DEFAULT_TARGET_MINUTES,
  DEFAULT_SMALL_MINUTES,
  DEFAULT_SMALL_WHEN,
} from './config';
import { addDays, dayDiff, isValidDateString } from './dates';

export type RecordSource = 'timer' | 'manual' | 'import_v3';

export interface StudyRecord {
  id: string;
  /** v7〜：どの習慣の記録か（v6 以前の記録は移行時に「簿記」へ付け替える） */
  habitId?: string;
  /** v7〜：done=やった（学習した）、rest=休むと決めた日（失敗ではない・積み上げに数えない） */
  kind?: 'done' | 'rest';
  /** ローカル日付 YYYY-MM-DD（学習を始めた日） */
  studyDate: string;
  startedAt: string | null;
  endedAt: string | null;
  /** ユーザーが確認した学習時間（分）。累計の根拠。 */
  minutes: number;
  /** タイマーで計測した秒数（参考値） */
  measuredSeconds: number | null;
  pausedSeconds: number | null;
  title: string;
  note: string;
  source: RecordSource;
  createdAt: string;
  updatedAt: string;
  /** v3.1 から移行した分類（講義・問題演習など）。新規入力では使わない。 */
  category?: string;

  /* ---- 以下は行動の事実（v6〜）。タイマー記録でのみ自動的に入る。推定値ではない。 ---- */
  /** 通常の一手 or 小さな一手で始めたか */
  mode?: 'standard' | 'small';
  /** 保存してあったしおり（次の一手）から始めたか */
  fromBookmark?: boolean;
  /** 本人の任意回答：きっかけ通りに始めたか（未回答は null） */
  cueFollowed?: 'yes' | 'no' | null;
  /** 記録時の支援表示（比較検証用） */
  supportMode?: SupportMode;
  /** アプリを開いてから開始までの秒数（30分超・不明は null） */
  openToStartSec?: number | null;
  /** 終了時に次のしおりを残したか */
  bookmarkLeft?: boolean;
  /** 予定の曜日に学習したか（記録時点のプランで判定） */
  plannedDay?: boolean;
}

export type SupportMode = 'plan' | 'simple';

export interface Settings {
  subject: string;
  /** しおり（次の一手） */
  nextAction: string;
  /** きっかけ（もし〜したら） */
  cue: string;
  targetMinutes: number;
  /** 小さな一手（できない日の代わり）。空なら従来の「2分だけ」 */
  smallAction: string;
  smallMinutes: number;
  /** 小さな一手を使う場面（もし〜なら） */
  smallWhen: string;
  /** 予定の曜日（0=日〜6=土） */
  planDays: number[];
  /** プラン表示（plan）／記録中心（simple） */
  supportMode: SupportMode;
  /** 週の見直しを提案する */
  weeklyReview: boolean;
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  subject: DEFAULT_SUBJECT,
  nextAction: '',
  cue: '',
  targetMinutes: DEFAULT_TARGET_MINUTES,
  smallAction: '',
  smallMinutes: DEFAULT_SMALL_MINUTES,
  smallWhen: DEFAULT_SMALL_WHEN,
  planDays: [0, 1, 2, 3, 4, 5, 6],
  supportMode: 'plan',
  weeklyReview: true,
}) as Settings;

export function cleanText(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  // 制御文字を除去し、改行をスペースに。前後の空白を除く。
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const target = Number(r.targetMinutes);
  const small = Number(r.smallMinutes);
  const okMin = (n: number) => Number.isInteger(n) && n >= LIMITS.targetMin && n <= LIMITS.targetMax;
  const days = Array.isArray(r.planDays)
    ? [...new Set(r.planDays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : DEFAULT_SETTINGS.planDays;
  return {
    subject: typeof r.subject === 'string' ? cleanText(r.subject, LIMITS.subject) : DEFAULT_SETTINGS.subject,
    nextAction: cleanText(r.nextAction, LIMITS.nextAction),
    cue: cleanText(r.cue, LIMITS.cue),
    targetMinutes: okMin(target) ? target : DEFAULT_TARGET_MINUTES,
    smallAction: cleanText(r.smallAction, LIMITS.smallAction),
    smallMinutes: okMin(small) ? small : DEFAULT_SMALL_MINUTES,
    smallWhen: typeof r.smallWhen === 'string' ? cleanText(r.smallWhen, LIMITS.smallWhen) : DEFAULT_SMALL_WHEN,
    planDays: days,
    supportMode: r.supportMode === 'simple' ? 'simple' : 'plan',
    weeklyReview: r.weeklyReview === false ? false : true,
  };
}

/** 学習日として入力できる最も早い日（基準日の翌日） */
export const FIRST_RECORDABLE_DATE = addDays(BASELINE.asOf, 1);

export type FieldErrors = Partial<Record<'studyDate' | 'minutes' | 'title' | 'note' | 'startTime' | 'id', string>>;

/** 記録の検証。エラーがなければ空オブジェクト。today はローカル日付。 */
export function validateRecord(r: Partial<StudyRecord>, today: string): FieldErrors {
  const e: FieldErrors = {};
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 100) e.id = 'IDが不正です。';
  if (!isValidDateString(r.studyDate)) e.studyDate = '学習日を正しく入力してください。';
  else if (r.studyDate > today) e.studyDate = '未来の日付は記録できません。';
  else if (r.studyDate <= BASELINE.asOf)
    e.studyDate = '2026年10月7日までの学習は「確認済みの累計」に含まれています。10月8日以降の日付を入力してください。';
  if (!Number.isInteger(r.minutes) || (r.minutes as number) < LIMITS.minutesMin || (r.minutes as number) > LIMITS.minutesMax)
    e.minutes = `学習時間は${LIMITS.minutesMin}〜${LIMITS.minutesMax}分の整数で入力してください。`;
  if (typeof r.title !== 'string' || r.title.trim().length === 0) e.title = '学習内容を入力してください。';
  else if (r.title.length > LIMITS.title) e.title = `学習内容は${LIMITS.title}文字以内で入力してください。`;
  if (typeof r.note === 'string' && r.note.length > LIMITS.note) e.note = `メモは${LIMITS.note}文字以内で入力してください。`;
  return e;
}

export function hasErrors(e: object): boolean {
  return Object.keys(e).length > 0;
}

/** 累計 = 基準値 + 新規に保存した記録の分数 */
export function totalMinutes(records: readonly StudyRecord[]): number {
  return BASELINE.minutes + appMinutes(records);
}

export function appMinutes(records: readonly StudyRecord[]): number {
  return records.reduce((sum, r) => sum + r.minutes, 0);
}

export function sortRecords(records: readonly StudyRecord[]): StudyRecord[] {
  return [...records].sort((a, b) => {
    if (a.studyDate !== b.studyDate) return a.studyDate < b.studyDate ? 1 : -1;
    const ta = a.startedAt ?? a.createdAt;
    const tb = b.startedAt ?? b.createdAt;
    return ta < tb ? 1 : ta > tb ? -1 : 0;
  });
}

export function lastStudyDate(records: readonly StudyRecord[]): string | null {
  let last: string | null = null;
  for (const r of records) if (last === null || r.studyDate > last) last = r.studyDate;
  return last;
}

export type HomeMode = 'default' | 'empty' | 'resume';

/**
 * ホームの状態。
 * - 実記録がない場合は再開扱いしない（基準値だけでは再開判定しない）。
 */
export function homeMode(records: readonly StudyRecord[], settings: Settings, today: string, gapDays = RESUME_GAP_DAYS): HomeMode {
  const last = lastStudyDate(records);
  if (last && dayDiff(last, today) >= gapDays) return 'resume';
  return settings.nextAction ? 'default' : 'empty';
}

export interface DaySummary {
  date: string;
  minutes: number;
}

export function summary14(records: readonly StudyRecord[], today: string) {
  const start = addDays(today, -13);
  const days: DaySummary[] = Array.from({ length: 14 }, (_, i) => ({ date: addDays(start, i), minutes: 0 }));
  const idx = new Map(days.map((d, i) => [d.date, i]));
  for (const r of records) {
    const i = idx.get(r.studyDate);
    if (i !== undefined) days[i].minutes += r.minutes;
  }
  const studyDays = days.filter((d) => d.minutes > 0).length;
  const minutes = days.reduce((s, d) => s + d.minutes, 0);
  return { days, studyDays, minutes, start };
}

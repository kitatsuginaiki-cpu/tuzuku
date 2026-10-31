import { BASELINE, LIMITS, RESUME_GAP_DAYS, DEFAULT_SUBJECT, DEFAULT_TARGET_MINUTES } from './config';
import { addDays, dayDiff, isValidDateString } from './dates';

export type RecordSource = 'timer' | 'manual' | 'import_v3';

export interface StudyRecord {
  id: string;
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
}

export interface Settings {
  subject: string;
  nextAction: string;
  cue: string;
  targetMinutes: number;
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  subject: DEFAULT_SUBJECT,
  nextAction: '',
  cue: '',
  targetMinutes: DEFAULT_TARGET_MINUTES,
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
  return {
    subject: typeof r.subject === 'string' ? cleanText(r.subject, LIMITS.subject) : DEFAULT_SETTINGS.subject,
    nextAction: cleanText(r.nextAction, LIMITS.nextAction),
    cue: cleanText(r.cue, LIMITS.cue),
    targetMinutes:
      Number.isInteger(target) && target >= LIMITS.targetMin && target <= LIMITS.targetMax ? target : DEFAULT_TARGET_MINUTES,
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

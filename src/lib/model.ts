/**
 * v7 のデータモデル：複数の習慣（時間型／日数型）、できない日の組、全体設定、v6 からの移行。
 * 基準値（確認済み 1,056分）は「簿記」の習慣1つだけが持つ。
 */
import { BASELINE, DEFAULT_TARGET_MINUTES, LIMITS } from './config';
import { addDays, isValidDateString, localDate } from './dates';
import { cleanText, sanitizeSettings, type Settings as V6Settings, type StudyRecord } from './records';
import { newId } from './session';

export type TrackingType = 'time' | 'days';

export interface CopingPlan {
  /** こんな日は */
  when: string;
  /** 代わりにやること */
  instead: string;
  /** 時間型での目安（分）。日数型や未指定は null */
  minutes: number | null;
}

export const HABIT_COLORS = ['navy', 'green', 'teal', 'amber', 'rose', 'slate'] as const;
export type HabitColor = (typeof HABIT_COLORS)[number];

export interface Habit {
  id: string;
  name: string;
  trackingType: TrackingType;
  /** きっかけ（もし〜したら） */
  cue: string;
  /** しおり（次の一手） */
  nextAction: string;
  /** できない日の組（最大3） */
  copingPlans: CopingPlan[];
  /** 予定の曜日（0=日〜6=土） */
  planDays: number[];
  /** 時間型の目標（分） */
  targetMinutes: number;
  /** 確認済み基準値を持つ習慣（簿記のみ） */
  baseline: boolean;
  /** 仲間に共有するか（既定オフ） */
  shared: boolean;
  color: HabitColor;
  archived: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export type Strictness = 'gentle' | 'normal' | 'strict';

export interface AppSettings {
  supportMode: 'plan' | 'simple';
  weeklyReview: boolean;
  characterEnabled: boolean;
  strictness: Strictness;
  /** この時刻（時）までは前日として扱う（0 = 0時で区切る） */
  dayStartHour: number;
  milestonesTime: number[]; // 時間
  milestonesDays: number[]; // 日
  /** 積み上げブロック1つの分数 */
  blockMinutes: number;
  updatedAt: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = Object.freeze({
  supportMode: 'plan',
  weeklyReview: true,
  characterEnabled: true,
  strictness: 'normal',
  dayStartHour: 0,
  milestonesTime: [10, 25, 50, 100],
  milestonesDays: [10, 30, 50, 100],
  blockMinutes: 30,
  updatedAt: '1970-01-01T00:00:00.000Z',
}) as AppSettings;

export const MAX_COPING = 3;
export const MAX_HABITS = 12;
export const REST_LABEL = '体調が悪い・休むと決めた';

/* ------------------------------ 正規化 ------------------------------ */

function okInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

export function sanitizeCoping(raw: unknown): CopingPlan[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      const r = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
      return {
        when: cleanText(r.when, LIMITS.smallWhen),
        instead: cleanText(r.instead, LIMITS.smallAction),
        minutes: okInt(r.minutes, LIMITS.targetMin, LIMITS.targetMax) ? r.minutes : null,
      };
    })
    .filter((c) => c.instead)
    .slice(0, MAX_COPING);
}

export function sanitizeHabit(raw: unknown): Habit | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || r.id.length > 100) return null;
  const name = cleanText(r.name, LIMITS.subject);
  if (!name) return null;
  const days = Array.isArray(r.planDays)
    ? [...new Set(r.planDays.filter((d): d is number => okInt(d, 0, 6)))].sort()
    : [0, 1, 2, 3, 4, 5, 6];
  const now = new Date().toISOString();
  return {
    id: r.id,
    name,
    trackingType: r.trackingType === 'days' ? 'days' : 'time',
    cue: cleanText(r.cue, LIMITS.cue),
    nextAction: cleanText(r.nextAction, LIMITS.nextAction),
    copingPlans: sanitizeCoping(r.copingPlans),
    planDays: days,
    targetMinutes: okInt(r.targetMinutes, LIMITS.targetMin, LIMITS.targetMax) ? r.targetMinutes : DEFAULT_TARGET_MINUTES,
    baseline: r.baseline === true,
    shared: r.shared === true,
    color: (HABIT_COLORS as readonly string[]).includes(r.color as string) ? (r.color as HabitColor) : 'navy',
    archived: r.archived === true,
    order: okInt(r.order, 0, 1000) ? r.order : 0,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : now,
  };
}

/** 習慣一覧の正規化：ID重複除去、基準値は最初の1件だけに限定 */
export function sanitizeHabits(raw: unknown): Habit[] {
  if (!Array.isArray(raw)) return [];
  const out: Habit[] = [];
  const ids = new Set<string>();
  let baselineTaken = false;
  for (const x of raw.slice(0, 100)) {
    const h = sanitizeHabit(x);
    if (!h || ids.has(h.id)) continue;
    if (h.baseline) {
      if (baselineTaken || h.trackingType !== 'time') h.baseline = false;
      else baselineTaken = true;
    }
    ids.add(h.id);
    out.push(h);
  }
  return out.sort((a, b) => a.order - b.order);
}

export function sanitizeAppSettings(raw: unknown): AppSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ms = (v: unknown, d: number[]) =>
    Array.isArray(v) ? [...new Set(v.filter((n): n is number => okInt(n, 1, 100000)))].sort((a, b) => a - b).slice(0, 10) : d;
  return {
    supportMode: r.supportMode === 'simple' ? 'simple' : 'plan',
    weeklyReview: r.weeklyReview !== false,
    characterEnabled: r.characterEnabled !== false,
    strictness: r.strictness === 'gentle' || r.strictness === 'strict' ? r.strictness : 'normal',
    dayStartHour: okInt(r.dayStartHour, 0, 4) ? r.dayStartHour : 0,
    milestonesTime: ms(r.milestonesTime, DEFAULT_APP_SETTINGS.milestonesTime),
    milestonesDays: ms(r.milestonesDays, DEFAULT_APP_SETTINGS.milestonesDays),
    blockMinutes: okInt(r.blockMinutes, 5, 120) ? r.blockMinutes : 30,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : DEFAULT_APP_SETTINGS.updatedAt,
  };
}

/* ------------------------------ 日付 ------------------------------ */

/** 区切り時刻を考慮した「その日」（例：dayStartHour=3 なら 2:59 は前日） */
export function logicalDate(ts: number | Date, dayStartHour: number): string {
  const t = typeof ts === 'number' ? ts : ts.getTime();
  return localDate(t - dayStartHour * 3600_000);
}

/* ------------------------------ 記録の検証（習慣ごと） ------------------------------ */

export type FieldErrors = Partial<Record<'studyDate' | 'minutes' | 'title' | 'note' | 'id' | 'habitId', string>>;

export const FIRST_BASELINE_RECORDABLE = addDays(BASELINE.asOf, 1);

export function validateRecordFor(r: Partial<StudyRecord>, habit: Habit | undefined, today: string): FieldErrors {
  const e: FieldErrors = {};
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 100) e.id = 'IDが不正です。';
  if (!habit) e.habitId = '習慣を選んでください。';
  if (!isValidDateString(r.studyDate)) e.studyDate = '日付を正しく入力してください。';
  else if (r.studyDate > today) e.studyDate = '未来の日付は記録できません。';
  else if (habit?.baseline && r.studyDate <= BASELINE.asOf)
    e.studyDate = '2026年10月7日までの学習は「確認済みの累計」に含まれています。10月8日以降の日付を入力してください。';
  const rest = r.kind === 'rest';
  const needMinutes = habit?.trackingType === 'time' && !rest;
  const m = r.minutes;
  if (needMinutes) {
    if (!Number.isInteger(m) || (m as number) < LIMITS.minutesMin || (m as number) > LIMITS.minutesMax)
      e.minutes = `時間は${LIMITS.minutesMin}〜${LIMITS.minutesMax}分の整数で入力してください。`;
  } else if (!Number.isInteger(m) || (m as number) < 0 || (m as number) > LIMITS.minutesMax) {
    e.minutes = `時間は0〜${LIMITS.minutesMax}分の整数で入力してください。`;
  }
  if (typeof r.title !== 'string' || r.title.trim().length === 0) e.title = '内容を入力してください。';
  else if (r.title.length > LIMITS.title) e.title = `内容は${LIMITS.title}文字以内で入力してください。`;
  if (typeof r.note === 'string' && r.note.length > LIMITS.note) e.note = `メモは${LIMITS.note}文字以内で入力してください。`;
  return e;
}

/** 日数型：同じ習慣・同じ日にすでに記録があるか（1日1回） */
export function hasDayRecord(records: readonly StudyRecord[], habitId: string, date: string, exceptId?: string): boolean {
  return records.some((r) => r.habitId === habitId && r.studyDate === date && r.id !== exceptId);
}

/* ------------------------------ テンプレート ------------------------------ */

export interface HabitTemplate {
  key: string;
  name: string;
  trackingType: TrackingType;
  cue: string;
  nextAction: string;
  planDays: number[];
  targetMinutes: number;
  copingPlans: CopingPlan[];
  baseline?: boolean;
  note?: string;
}

/** 本人と一緒に決めた5つの習慣の案。選んだものだけ作成する（自動で作らない） */
export const HABIT_TEMPLATES: HabitTemplate[] = [
  {
    key: 'morning',
    name: '朝8:00に起きて作業に入る',
    trackingType: 'days',
    cue: '顔を洗ったら、机に座ってPCを開く',
    nextAction: '前夜に書いた「明日の最初の作業」',
    planDays: [0, 1, 2, 3, 4, 5, 6],
    targetMinutes: 30,
    copingPlans: [
      { when: '寝坊した', instead: '起きた時刻のまま机に座り、作業ファイルを開く', minutes: null },
      { when: '眠くて頭が回らない', instead: '今日の作業リストを3行書く', minutes: null },
      { when: '朝から外出', instead: '移動前に作業ファイルを開いて1行書く', minutes: null },
    ],
    note: 'しおりは前の晩（歯磨きのあと）に「明日の最初の作業」を書いて残します。',
  },
  {
    key: 'boki',
    name: '簿記3級',
    trackingType: 'time',
    cue: '朝の作業に入った最初の20分',
    nextAction: '問題集 第12章 問1〜3を解く',
    planDays: [0, 1, 2, 3, 4, 5, 6],
    targetMinutes: 20,
    copingPlans: [
      { when: '時間がない・気が重い', instead: '前回間違えた仕訳を1問解き直す', minutes: 5 },
      { when: '集中が続かない', instead: '講義を5分見て1文メモ', minutes: 5 },
      { when: '教材がない', instead: 'スマホで仕訳を1問思い出して書く', minutes: 5 },
    ],
    baseline: true,
    note: '確認済みの累計（17時間36分）を土台として引き継ぎます。',
  },
  {
    key: 'reading',
    name: '読書',
    trackingType: 'days',
    cue: '布団に入ってスマホを充電器に置いたら',
    nextAction: '第4章を最後まで',
    planDays: [0, 1, 2, 3, 4, 5, 6],
    targetMinutes: 15,
    copingPlans: [
      { when: '眠い', instead: '1ページ読んでしおりを挟む', minutes: null },
      { when: '本がない', instead: '前回読んだところを1行で思い出して書く', minutes: null },
      { when: '内容が重い', instead: '目次を見て次に読む章を決める', minutes: null },
    ],
  },
  {
    key: 'room',
    name: '部屋をきれいに保つ',
    trackingType: 'days',
    cue: '帰宅してカバンを置いたら',
    nextAction: '机→床の順に5分リセット',
    planDays: [0, 1, 2, 3, 4, 5, 6],
    targetMinutes: 5,
    copingPlans: [
      { when: '疲れている', instead: '目についた物を3つ戻す', minutes: null },
      { when: '時間がない', instead: '机の上だけ空にする', minutes: null },
      { when: '散らかりすぎ', instead: '床の物を1か所にまとめる', minutes: null },
    ],
    note: '週末は「次にやる場所」をしおりに残します。',
  },
  {
    key: 'note',
    name: 'note更新',
    trackingType: 'days',
    cue: '日曜の朝の作業の最初',
    nextAction: '書きかけ記事の「次に書く見出し」',
    planDays: [0],
    targetMinutes: 30,
    copingPlans: [
      { when: '書く気が起きない', instead: 'ネタ帳に1行メモを足す', minutes: null },
      { when: '時間がない', instead: '次に書く見出しだけ書く', minutes: null },
      { when: '何を書くか決まらない', instead: '最近の出来事を3つ書き、1つに丸', minutes: null },
    ],
  },
];

export function habitFromTemplate(t: HabitTemplate, order: number, allowBaseline: boolean): Habit {
  const now = new Date().toISOString();
  return {
    id: newId(),
    name: t.name,
    trackingType: t.trackingType,
    cue: t.cue,
    nextAction: t.nextAction,
    copingPlans: t.copingPlans.map((c) => ({ ...c })),
    planDays: [...t.planDays],
    targetMinutes: t.targetMinutes,
    baseline: !!t.baseline && allowBaseline,
    shared: false,
    color: (['green', 'navy', 'teal', 'amber', 'rose', 'slate'] as const)[order % 6],
    archived: false,
    order,
    createdAt: now,
    updatedAt: now,
  };
}

export function blankHabit(order: number, trackingType: TrackingType = 'days'): Habit {
  const now = new Date().toISOString();
  return {
    id: newId(),
    name: '',
    trackingType,
    cue: '',
    nextAction: '',
    copingPlans: [],
    planDays: [0, 1, 2, 3, 4, 5, 6],
    targetMinutes: DEFAULT_TARGET_MINUTES,
    baseline: false,
    shared: false,
    color: 'slate',
    archived: false,
    order,
    createdAt: now,
    updatedAt: now,
  };
}

/* ------------------------------ v6 → v7 移行 ------------------------------ */

export interface MigrationResult {
  habits: Habit[];
  settings: AppSettings;
  records: StudyRecord[];
  migrated: boolean;
}

/**
 * v6 の単一プラン設定を「簿記」の習慣1件に移す。記録には habitId を付ける。
 * - v6 の設定が既定のままで記録も0件なら、習慣は作らない（初回はテンプレートから選んでもらう）。
 */
export function migrateFromV6(v6raw: unknown, records: readonly StudyRecord[]): MigrationResult {
  const v6: V6Settings = sanitizeSettings(v6raw);
  const touched = !!v6raw && (records.length > 0 || !!v6.nextAction || !!v6.cue || !!v6.smallAction);
  const settings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    supportMode: v6.supportMode,
    weeklyReview: v6.weeklyReview,
    updatedAt: new Date().toISOString(),
  };
  if (!touched) return { habits: [], settings, records: [...records], migrated: false };
  const now = new Date().toISOString();
  const boki: Habit = {
    id: newId(),
    name: v6.subject || '簿記3級',
    trackingType: 'time',
    cue: v6.cue,
    nextAction: v6.nextAction,
    copingPlans: v6.smallAction ? [{ when: v6.smallWhen, instead: v6.smallAction, minutes: v6.smallMinutes }] : [],
    planDays: [...v6.planDays],
    targetMinutes: v6.targetMinutes,
    baseline: true,
    shared: false,
    color: 'green',
    archived: false,
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
  return {
    habits: [boki],
    settings,
    records: records.map((r) => (r.habitId ? r : { ...r, habitId: boki.id, kind: r.kind ?? 'done' })),
    migrated: true,
  };
}

export function isDone(r: StudyRecord): boolean {
  return (r.kind ?? 'done') === 'done';
}

export function today(settings: AppSettings, now = Date.now()): string {
  return logicalDate(now, settings.dayStartHour);
}

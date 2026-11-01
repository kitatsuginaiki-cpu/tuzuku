/**
 * キャラクター「つづきぼし」：続ける力をあらわす小さな彗星。
 * 表情は実際の記録だけからルールで決める（推定・AI は使わない）。CHARACTER_RULES で調整できる。
 *  - 集中    ：計測中
 *  - 嬉しい  ：今日やった（休み以外の記録あり）／節目に到達
 *  - おやすみ：今日の予定の習慣を、すべて「休むと決めた」
 *  - 待っている：今日の予定がまだで、夕方（17時）以降
 *  - 心配    ：予定日に2日以上続けて記録がない（ふつう・きびしい）
 *  - 怒っている：予定日に3日以上続けて記録がない（きびしいのみ）
 *  - やるぞ  ：それ以外（ふつう）
 * 再開を罰しない：再開画面（context='resume'）では怒らない。一手でも動けばすぐ嬉しい顔になる。
 *
 * 成長（Lv.1〜5）は「つづけた日」（やった・小さな一手の記録がある日。習慣をまたいで重複なし）で決まる。
 * 積み上げと同じく、間があいても下がらない。
 */
import { addDays, parseLocalDate } from './dates';
import { isDone, type AppSettings, type Habit } from './model';
import type { StudyRecord } from './records';

export type Mood = 'happy' | 'focus' | 'normal' | 'waiting' | 'rest' | 'worried' | 'angry';
/** 仲間に共有する表情（サーバー側の許可リストと同じ5種類） */
export type SharedMood = 'happy' | 'normal' | 'waiting' | 'worried' | 'angry';
export function toSharedMood(m: Mood): SharedMood {
  return m === 'focus' ? 'happy' : m === 'rest' ? 'normal' : m;
}

export const CHARACTER_RULES = Object.freeze({
  waitingHour: 17,
  worriedMissed: 2,
  angryMissed: 3,
  /** 遡って数える最大日数 */
  lookback: 30,
});

export const MOOD_LABEL: Record<Mood, string> = {
  happy: '嬉しそう',
  focus: '集中している',
  normal: 'やる気十分',
  waiting: '待っている',
  rest: 'おやすみ中',
  worried: '心配そう',
  angry: '怒っている',
};

export const CHARACTER_NAME = 'つづきぼし';

/* ------------------------------ 成長 ------------------------------ */

export interface Level {
  level: number;
  name: string;
  /** この段階に必要な「つづけた日」 */
  days: number;
  desc: string;
}

/** 5段階。最後の66日は、習慣が自動化するまでの中央値（約59〜66日）にちなむ */
export const LEVELS: readonly Level[] = Object.freeze([
  { level: 1, name: 'はじまり', days: 0, desc: 'これから一緒につづけていく姿。' },
  { level: 2, name: 'ならし', days: 3, desc: '少しずつ習慣のリズムができてきた。' },
  { level: 3, name: 'かたち', days: 10, desc: '継続が習慣として定着してきた。' },
  { level: 4, name: 'ひろがり', days: 30, desc: '着実に積み重ね、自信がついてきた。' },
  { level: 5, name: 'みちしるべ', days: 66, desc: 'つづける力が育ち、これからも前へ進む存在に。' },
]);

/** つづけた日：やった・小さな一手の記録がある日（習慣をまたいで重複なし） */
export function streakFreeDays(records: readonly StudyRecord[]): number {
  return new Set(records.filter(isDone).map((r) => r.studyDate)).size;
}

export interface Growth {
  level: Level;
  next: Level | null;
  days: number;
  /** 次の段階までの残り日数 */
  left: number;
  /** 現在の段階の中での進み（0〜1） */
  ratio: number;
}

export function growthOf(records: readonly StudyRecord[]): Growth {
  const days = streakFreeDays(records);
  let level = LEVELS[0];
  for (const l of LEVELS) if (days >= l.days) level = l;
  const next = LEVELS.find((l) => l.level === level.level + 1) ?? null;
  return {
    level,
    next,
    days,
    left: next ? next.days - days : 0,
    ratio: next ? (days - level.days) / (next.days - level.days) : 1,
  };
}

/* ------------------------------ 見た目 ------------------------------ */

export type CharaColor = 'standard' | 'blue' | 'orange';
export type CharaAccessory = 'none' | 'scarf' | 'cap';
export const COLOR_LABEL: Record<CharaColor, string> = { standard: 'スタンダード', blue: 'ブルー', orange: 'オレンジ' };
export const ACCESSORY_LABEL: Record<CharaAccessory, string> = { none: 'なし', scarf: 'マフラー', cap: '学びの帽子' };

/** アクセサリーが使えるか（使えないときは理由） */
export function accessoryAvailable(a: CharaAccessory, opts: { today: string; level: number; milestones: number }): { ok: boolean; reason: string } {
  if (a === 'none') return { ok: true, reason: '' };
  if (a === 'scarf') {
    const m = Number(opts.today.slice(5, 7));
    return m === 12 || m <= 2 ? { ok: true, reason: '冬（12〜2月）の期間限定' } : { ok: false, reason: '12〜2月に使えます' };
  }
  return opts.level >= 3 || opts.milestones > 0
    ? { ok: true, reason: 'Lv.3 か、節目への到達で手に入れました' }
    : { ok: false, reason: 'Lv.3 になるか、節目に届くと手に入ります' };
}

/** 状態ごとのセリフ（短く・人格否定や罪悪感をあおる言葉は使わない） */
export const MOOD_LINES: Record<Mood, string[]> = {
  happy: ['いい流れです！この調子でつづけよう。', '今日の分、積み上がったね。', 'ひとつ進んだ。光がふえたよ。'],
  focus: ['集中タイム。そばにいるよ。', 'いい集中。', 'この一手に、まっすぐ。'],
  normal: ['よし、やるぞ！今日の一手はここ。', 'きっかけが来たら始めよう。', 'しおりから、いつでも。'],
  waiting: ['まだ間に合うよ。小さな一手でも。', 'ここで待ってる。', '1分だけでも、つながるよ。'],
  rest: ['今日はおやすみ。また明日。', 'ひと休みも、つづけるうち。', 'ゆっくり休もう。'],
  worried: ['少しおやすみしていましたね。今日、一歩だけ。', '大丈夫、しおりは残ってる。', '今日は小さな一手からどう？'],
  angry: ['むー。3日あいてるぞ。1問だけでもやろう！', 'こら、しおりが待ってるよ！', 'そろそろ戻ってこーい！'],
};

export interface MoodInput {
  habits: readonly Habit[];
  records: readonly StudyRecord[];
  settings: AppSettings;
  today: string;
  /** 区切りを考慮した現在の時（0〜23） */
  hour: number;
  firstUsedOn: string | null;
  sessionActive?: boolean;
  context?: 'home' | 'resume';
  justMilestone?: boolean;
}

export interface MoodResult {
  mood: Mood;
  /** 予定日に続けて記録がない日数（昨日から遡る） */
  missed: number;
  doneToday: boolean;
  plannedToday: boolean;
}

function plannedHabits(habits: readonly Habit[], date: string) {
  const dow = parseLocalDate(date).getDay();
  return habits.filter((h) => !h.archived && h.planDays.includes(dow));
}

export function moodFor(i: MoodInput): MoodResult {
  const active = i.habits.filter((h) => !h.archived);
  const byDate = new Map<string, StudyRecord[]>();
  for (const r of i.records) {
    const list = byDate.get(r.studyDate) ?? [];
    list.push(r);
    byDate.set(r.studyDate, list);
  }
  const doneToday = (byDate.get(i.today) ?? []).some((r) => isDone(r) && active.some((h) => h.id === r.habitId));
  const plannedToday = plannedHabits(active, i.today).length > 0;

  // 予定日に記録（やった・休み）がない日が、昨日から何日続いているか
  let missed = 0;
  for (let k = 1; k <= CHARACTER_RULES.lookback; k++) {
    const d = addDays(i.today, -k);
    if (i.firstUsedOn && d < i.firstUsedOn) break;
    const planned = plannedHabits(active, d);
    if (planned.length === 0) continue; // 予定のない日は数えない（途切れにもしない）
    const rs = byDate.get(d) ?? [];
    const covered = rs.some((r) => planned.some((h) => h.id === r.habitId));
    if (covered) break;
    missed++;
  }

  // 今日の予定の習慣を、すべて「休むと決めた」日
  const todayRecs = byDate.get(i.today) ?? [];
  const plannedNow = plannedHabits(active, i.today);
  const restToday =
    !doneToday && plannedNow.length > 0 && plannedNow.every((h) => todayRecs.some((r) => r.habitId === h.id && !isDone(r)));

  let mood: Mood;
  if (i.sessionActive) mood = 'focus';
  else if (doneToday || i.justMilestone) mood = 'happy';
  else if (restToday) mood = 'rest';
  else if (i.settings.strictness === 'strict' && missed >= CHARACTER_RULES.angryMissed) mood = 'angry';
  else if (i.settings.strictness !== 'gentle' && missed >= CHARACTER_RULES.worriedMissed) mood = 'worried';
  else if (plannedToday && i.hour >= CHARACTER_RULES.waitingHour) mood = 'waiting';
  else if (missed >= CHARACTER_RULES.worriedMissed) mood = 'waiting'; // やさしい：心配の代わりに待つ
  else mood = 'normal';

  // 再開画面では怒らない（戻ってきたことを罰しない）
  if (i.context === 'resume' && (mood === 'angry' || mood === 'worried')) mood = 'waiting';
  return { mood, missed, doneToday, plannedToday };
}

/** 同じ日・同じ表情なら同じセリフ（日ごとに変わる） */
export function lineFor(mood: Mood, date: string): string {
  const lines = MOOD_LINES[mood];
  let h = 0;
  for (const c of date + mood) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return lines[h % lines.length];
}

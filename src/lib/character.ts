/**
 * キャラクターの表情。実際の記録だけからルールで決める（推定・AI は使わない）。
 * 初期ルール（CHARACTER_RULES で変更可能）：
 *  - 嬉しい  ：今日やった（休み以外の記録あり）／学習中／節目に到達
 *  - 待っている：今日の予定がまだで、夕方（17時）以降
 *  - 心配    ：予定日に2日以上続けて記録がない（ふつう・きびしい）
 *  - 怒っている：予定日に3日以上続けて記録がない（きびしいのみ）
 *  - ふつう  ：それ以外
 * 再開を罰しない：再開画面（context='resume'）と、学習を始めた瞬間は怒らない。
 */
import { addDays, parseLocalDate } from './dates';
import { isDone, type AppSettings, type Habit } from './model';
import type { StudyRecord } from './records';

export type Mood = 'happy' | 'normal' | 'waiting' | 'worried' | 'angry';

export const CHARACTER_RULES = Object.freeze({
  waitingHour: 17,
  worriedMissed: 2,
  angryMissed: 3,
  /** 遡って数える最大日数 */
  lookback: 30,
});

export const MOOD_LABEL: Record<Mood, string> = {
  happy: '嬉しそう',
  normal: 'いつもどおり',
  waiting: '待っている',
  worried: '心配そう',
  angry: '怒っている',
};

export const CHARACTER_NAME = 'つづ';

/** 状態ごとのセリフ（短く・人格否定や罪悪感をあおる言葉は使わない） */
export const MOOD_LINES: Record<Mood, string[]> = {
  happy: ['今日の分、積み上がったね。', 'いい流れ。', 'ひとつ進んだ。'],
  normal: ['今日の一手、ここにあるよ。', 'きっかけが来たら始めよう。', 'しおりから、いつでも。'],
  waiting: ['まだ間に合うよ。小さな一手でも。', 'ここで待ってる。', '1分だけでも、つながるよ。'],
  worried: ['ちょっと間が空いてるね。小さく始めよう。', '大丈夫、しおりは残ってる。', '今日は小さな一手からどう？'],
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

  let mood: Mood;
  if (i.sessionActive || doneToday || i.justMilestone) mood = 'happy';
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

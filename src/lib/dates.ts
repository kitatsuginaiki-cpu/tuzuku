/** ローカル日付（端末のタイムゾーン）を YYYY-MM-DD で返す。ISO(UTC)日付とは異なる点に注意。 */
export function localDate(input: Date | number = new Date()): string {
  const d = new Date(input);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDateString(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d, 12);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

/** YYYY-MM-DD をローカル正午の Date に変換（DST の影響を避ける） */
export function parseLocalDate(s: string): Date {
  const m = DATE_RE.exec(s);
  if (!m) throw new Error(`invalid date: ${s}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
}

/** from から to までの暦日の差（to - from）。 */
export function dayDiff(from: string, to: string): number {
  return Math.round((parseLocalDate(to).getTime() - parseLocalDate(from).getTime()) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const d = parseLocalDate(date);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

const WEEK = '日月火水木金土';

/** 2026年10月7日 */
export function formatJpDate(date: string): string {
  const d = parseLocalDate(date);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 11月1日（日） */
export function formatShortDate(date: string): string {
  const d = parseLocalDate(date);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`;
}

/** ISO 文字列からローカル時刻 HH:MM */
export function formatClockTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** ローカル日付 + HH:MM から ISO 文字列を作る */
export function localDateTimeToIso(date: string, time: string): string | null {
  if (!isValidDateString(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [h, mi] = time.split(':').map(Number);
  if (h > 23 || mi > 59) return null;
  const d = parseLocalDate(date);
  d.setHours(h, mi, 0, 0);
  return d.toISOString();
}

/** 1056 → 「17時間36分」 */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}分`;
  return `${h}時間${m}分`;
}

/** ミリ秒 → MM:SS（60分以上は H:MM:SS） */
export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${String(m).padStart(2, '0')}:${ss}`;
}

/** 読み上げ用: 「残り14分32秒」など */
export function spokenDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h ? `${h}時間` : ''}${m}分${s}秒`;
}

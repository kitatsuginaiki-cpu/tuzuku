/**
 * 学習セッションの状態機械（純粋関数のみ）。
 * 時間の根拠は「開始時刻・一時停止の累計・現在時刻」。setInterval の回数は使わない。
 */
import { LIMITS } from './config';

export type SessionMode = 'standard' | 'two_minute';
export type SessionStatus = 'running' | 'paused' | 'completing';

export interface ActiveSession {
  id: string;
  mode: SessionMode;
  /** 開始時点の「次にやること」。未設定なら空文字。 */
  title: string;
  subject: string;
  targetSeconds: number;
  /** epoch ms */
  startedAt: number;
  status: SessionStatus;
  /** paused のときの一時停止開始時刻 */
  pausedAt: number | null;
  /** 確定済みの一時停止累計（ミリ秒） */
  pausedMs: number;
  /** completing に入った時刻 */
  completingAt: number | null;
  /** completing から戻るときに復帰する状態 */
  statusBeforeComplete: 'running' | 'paused' | null;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // 古い環境向けフォールバック
  const rnd = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 8)).join('');
  return `${Date.now().toString(36)}-${rnd}`;
}

export function createSession(opts: {
  mode: SessionMode;
  title: string;
  subject: string;
  targetMinutes: number;
  now: number;
  id?: string;
}): ActiveSession {
  return {
    id: opts.id ?? newId(),
    mode: opts.mode,
    title: opts.title,
    subject: opts.subject,
    targetSeconds: clampTarget(opts.targetMinutes) * 60,
    startedAt: opts.now,
    status: 'running',
    pausedAt: null,
    pausedMs: 0,
    completingAt: null,
    statusBeforeComplete: null,
  };
}

export function clampTarget(min: number): number {
  if (!Number.isFinite(min)) return 20;
  return Math.min(LIMITS.targetMax, Math.max(LIMITS.targetMin, Math.round(min)));
}

/** 計測上の学習時間（一時停止・終了確認中の時間は含まない） */
export function elapsedMs(s: ActiveSession, now: number): number {
  let end = now;
  if (s.status === 'paused' && s.pausedAt != null) end = s.pausedAt;
  if (s.status === 'completing' && s.completingAt != null) end = s.completingAt;
  return Math.max(0, end - s.startedAt - s.pausedMs);
}

/** 現時点までの一時停止時間の合計（ミリ秒） */
export function pausedTotalMs(s: ActiveSession, now: number): number {
  let extra = 0;
  if (s.status === 'paused' && s.pausedAt != null) extra = Math.max(0, now - s.pausedAt);
  return s.pausedMs + extra;
}

export function remainingMs(s: ActiveSession, now: number): number {
  return Math.max(0, s.targetSeconds * 1000 - elapsedMs(s, now));
}

export function isOverTarget(s: ActiveSession, now: number): boolean {
  return elapsedMs(s, now) >= s.targetSeconds * 1000;
}

/** 0..1。表示中の数値と必ず一致させるため、表示と同じ秒単位に丸めてから計算する */
export function progressRatio(s: ActiveSession, now: number): number {
  const target = s.targetSeconds;
  if (target <= 0) return 1;
  const elapsedSec = Math.floor(elapsedMs(s, now) / 1000);
  return Math.min(1, elapsedSec / target);
}

export function pause(s: ActiveSession, now: number): ActiveSession {
  if (s.status !== 'running') return s;
  return { ...s, status: 'paused', pausedAt: now };
}

export function resume(s: ActiveSession, now: number): ActiveSession {
  if (s.status !== 'paused' || s.pausedAt == null) return s;
  return { ...s, status: 'running', pausedMs: s.pausedMs + Math.max(0, now - s.pausedAt), pausedAt: null };
}

/** 学習を終える → 終了確認（completing）。計測はこの時点で止まる。 */
export function beginCompleting(s: ActiveSession, now: number): ActiveSession {
  if (s.status === 'completing') return s;
  let pausedMs = s.pausedMs;
  if (s.status === 'paused' && s.pausedAt != null) pausedMs += Math.max(0, now - s.pausedAt);
  return {
    ...s,
    status: 'completing',
    pausedMs,
    pausedAt: null,
    completingAt: now,
    statusBeforeComplete: s.status,
  };
}

/** 終了確認から戻る。終了画面にいた時間は一時停止として扱う。 */
export function cancelCompleting(s: ActiveSession, now: number): ActiveSession {
  if (s.status !== 'completing' || s.completingAt == null) return s;
  const pausedMs = s.pausedMs + Math.max(0, now - s.completingAt);
  const back = s.statusBeforeComplete ?? 'running';
  return {
    ...s,
    status: back,
    pausedMs,
    pausedAt: back === 'paused' ? now : null,
    completingAt: null,
    statusBeforeComplete: null,
  };
}

export function setTarget(s: ActiveSession, minutes: number): ActiveSession {
  return { ...s, targetSeconds: clampTarget(minutes) * 60 };
}

/**
 * 終了画面の初期分数。1分未満は 0 を返し、ユーザーに入力を求める
 * （実際にしていない学習時間を切り上げて記録しない）。
 */
export function suggestedMinutes(s: ActiveSession, now: number): number {
  return Math.round(elapsedMs(s, now) / 60_000);
}

/** 保存データの検証（再読み込み時の復旧用）。不正なら null。 */
export function sanitizeActive(raw: unknown, now: number): ActiveSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 100) return null;
  if (!num(r.startedAt) || (r.startedAt as number) > now + 5 * 60_000) return null;
  if (!num(r.targetSeconds) || (r.targetSeconds as number) < 60 || (r.targetSeconds as number) > LIMITS.targetMax * 60) return null;
  if (!num(r.pausedMs) || (r.pausedMs as number) < 0) return null;
  const status = r.status;
  if (status !== 'running' && status !== 'paused' && status !== 'completing') return null;
  const pausedAt = num(r.pausedAt) ? (r.pausedAt as number) : null;
  const completingAt = num(r.completingAt) ? (r.completingAt as number) : null;
  if (status === 'paused' && pausedAt == null) return null;
  if (status === 'completing' && completingAt == null) return null;
  const before = r.statusBeforeComplete === 'running' || r.statusBeforeComplete === 'paused' ? r.statusBeforeComplete : null;
  return {
    id: r.id,
    mode: r.mode === 'two_minute' ? 'two_minute' : 'standard',
    title: typeof r.title === 'string' ? r.title.slice(0, LIMITS.nextAction) : '',
    subject: typeof r.subject === 'string' ? r.subject.slice(0, LIMITS.subject) : '',
    targetSeconds: r.targetSeconds as number,
    startedAt: r.startedAt as number,
    status,
    pausedAt: status === 'paused' ? pausedAt : null,
    pausedMs: r.pausedMs as number,
    completingAt: status === 'completing' ? completingAt : null,
    statusBeforeComplete: status === 'completing' ? before : null,
  };
}

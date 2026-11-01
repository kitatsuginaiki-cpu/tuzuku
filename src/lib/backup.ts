/**
 * JSON バックアップの書き出し・読み込み、および v3.1 試作版からの移行。
 * どの経路でも「基準日以前の個別記録」や「架空の記録」を取り込まない。
 */
import { BASELINE, LIMITS } from './config';
import { isValidDateString } from './dates';
import { sanitizeReviews, type Review } from './plan';
import {
  cleanText,
  hasErrors,
  sanitizeSettings,
  validateRecord,
  type Settings,
  type StudyRecord,
} from './records';

export const BACKUP_FORMAT = 'tsuzuku-backup';
export const SCHEMA_VERSION = 2;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  baseline: { minutes: number; asOf: string };
  settings: Settings;
  records: StudyRecord[];
  /** v2〜：週の見直しの履歴 */
  reviews: Review[];
}

export function buildBackup(settings: Settings, records: readonly StudyRecord[], reviews: readonly Review[] = [], now = new Date()): BackupFile {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    baseline: { minutes: BASELINE.minutes, asOf: BASELINE.asOf },
    settings: { ...settings, planDays: [...settings.planDays] },
    records: records.map((r) => ({ ...r })),
    reviews: reviews.map((r) => ({ ...r })),
  };
}

export class ImportError extends Error {}

export type ParsedImport =
  | { kind: 'backup'; settings: Settings; records: StudyRecord[]; reviews: Review[]; exportedAt: string | null }
  | { kind: 'legacy_v3'; legacy: LegacyCandidates };

/** ファイル内容を解析する。不正なら日本語メッセージ付きの ImportError。 */
export function parseImportText(text: string, today: string): ParsedImport {
  if (text.length > LIMITS.backupBytes) throw new ImportError('ファイルが大きすぎます（10MBまで）。');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError('JSONファイルとして読み込めませんでした。');
  }
  if (!raw || typeof raw !== 'object') throw new ImportError('データの形式が正しくありません。');
  const obj = raw as Record<string, unknown>;
  if (obj.format === BACKUP_FORMAT) return { kind: 'backup', ...parseBackupObject(obj, today) };
  if (obj.format === 'tsuzuku-v3') return { kind: 'legacy_v3', legacy: parseLegacyV3(obj, today) };
  throw new ImportError('「つづく。」のバックアップファイルではありません。');
}

function parseBackupObject(obj: Record<string, unknown>, today: string) {
  if (typeof obj.schemaVersion !== 'number' || obj.schemaVersion < 1)
    throw new ImportError('バックアップのバージョンが不正です。');
  if (obj.schemaVersion > SCHEMA_VERSION)
    throw new ImportError('新しいバージョンのアプリで作られたバックアップです。アプリを更新してから読み込んでください。');
  const b = obj.baseline as Record<string, unknown> | undefined;
  if (!b || b.minutes !== BASELINE.minutes || b.asOf !== BASELINE.asOf)
    throw new ImportError('確認済みの累計（2026年10月7日・17時間36分）が一致しないため読み込めません。');
  if (!Array.isArray(obj.records)) throw new ImportError('学習記録の形式が正しくありません。');
  if (obj.records.length > LIMITS.records) throw new ImportError('記録の件数が多すぎます。');
  const records: StudyRecord[] = [];
  const ids = new Set<string>();
  obj.records.forEach((r, i) => {
    const rec = normalizeRecord(r);
    const errs = rec ? validateRecord(rec, today) : { id: '形式が不正です。' };
    if (!rec || hasErrors(errs)) {
      const first = Object.values(errs)[0];
      throw new ImportError(`${i + 1}件目の記録に問題があります：${first}`);
    }
    if (ids.has(rec.id)) throw new ImportError(`同じIDの記録が重複しています（${i + 1}件目）。`);
    ids.add(rec.id);
    records.push(rec);
  });
  return {
    settings: sanitizeSettings(obj.settings),
    records,
    reviews: sanitizeReviews(obj.reviews),
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : null,
  };
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function intOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 7 * 86400 ? v : null;
}

export function normalizeRecord(raw: unknown): StudyRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const now = new Date().toISOString();
  const source = r.source === 'timer' || r.source === 'manual' || r.source === 'import_v3' ? r.source : 'manual';
  const rec: StudyRecord = {
    id: typeof r.id === 'string' ? r.id : '',
    studyDate: typeof r.studyDate === 'string' ? r.studyDate : '',
    startedAt: isoOrNull(r.startedAt),
    endedAt: isoOrNull(r.endedAt),
    minutes: typeof r.minutes === 'number' ? r.minutes : NaN,
    measuredSeconds: intOrNull(r.measuredSeconds),
    pausedSeconds: intOrNull(r.pausedSeconds),
    title: cleanText(r.title, LIMITS.title + 1),
    note: cleanText(r.note, LIMITS.note + 1),
    source,
    createdAt: isoOrNull(r.createdAt) ?? now,
    updatedAt: isoOrNull(r.updatedAt) ?? now,
  };
  if (typeof r.category === 'string' && r.category) rec.category = cleanText(r.category, 20);
  // v6 の行動の事実（あるものだけ保持）
  if (r.mode === 'small' || r.mode === 'two_minute') rec.mode = 'small';
  else if (r.mode === 'standard') rec.mode = 'standard';
  if (typeof r.fromBookmark === 'boolean') rec.fromBookmark = r.fromBookmark;
  if (r.cueFollowed === 'yes' || r.cueFollowed === 'no') rec.cueFollowed = r.cueFollowed;
  if (r.supportMode === 'plan' || r.supportMode === 'simple') rec.supportMode = r.supportMode;
  if (typeof r.openToStartSec === 'number' && Number.isInteger(r.openToStartSec) && r.openToStartSec >= 0 && r.openToStartSec <= 86400)
    rec.openToStartSec = r.openToStartSec;
  if (typeof r.bookmarkLeft === 'boolean') rec.bookmarkLeft = r.bookmarkLeft;
  if (typeof r.plannedDay === 'boolean') rec.plannedDay = r.plannedDay;
  return rec;
}

/* ---------------- v3.1 からの移行 ---------------- */

export interface LegacyCandidate {
  record: StudyRecord;
  /** 既定で取り込むか */
  include: boolean;
  /** 取り込めない／既定で除外する理由 */
  reason: string | null;
  /** 取り込み自体が不可能（検証エラー） */
  blocked: boolean;
}

export interface LegacyCandidates {
  candidates: LegacyCandidate[];
  nextAction: string;
  cue: string;
  subject: string;
}

/** v3.1 の状態オブジェクト（format: 'tsuzuku-v3'）から移行候補を作る。自動では保存しない。 */
export function parseLegacyV3(obj: Record<string, unknown>, today: string): LegacyCandidates {
  if (!Array.isArray(obj.records)) throw new ImportError('v3.1のデータに学習記録の一覧がありません。');
  if (obj.records.length > LIMITS.records) throw new ImportError('記録の件数が多すぎます。');
  const settings = (obj.settings && typeof obj.settings === 'object' ? obj.settings : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const candidates: LegacyCandidate[] = obj.records.map((raw) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const created = isoOrNull(r.createdAt) ?? new Date().toISOString();
    const ended = isoOrNull(r.endedAt);
    const minutes = typeof r.minutes === 'number' ? r.minutes : NaN;
    const record: StudyRecord = {
      id: typeof r.id === 'string' ? `v3-${r.id}`.slice(0, 100) : '',
      studyDate: typeof r.day === 'string' ? r.day : '',
      startedAt: ended && Number.isFinite(minutes) ? new Date(Date.parse(ended) - minutes * 60_000).toISOString() : null,
      endedAt: ended,
      minutes,
      measuredSeconds: null,
      pausedSeconds: null,
      title: cleanText(r.title, LIMITS.title + 1),
      note: cleanText(r.note, LIMITS.note + 1),
      source: 'import_v3',
      createdAt: created,
      updatedAt: created,
    };
    if (typeof r.kind === 'string' && r.kind) record.category = cleanText(r.kind, 20);
    const errs = validateRecord(record, today);
    let reason: string | null = null;
    let blocked = false;
    if (isValidDateString(record.studyDate) && record.studyDate <= BASELINE.asOf) {
      reason = '2026年10月7日以前のため、確認済みの累計に含まれています（二重計上を防ぐため取り込みません）';
      blocked = true;
    } else if (seen.has(record.id)) {
      reason = '重複した記録です';
      blocked = true;
    } else if (hasErrors(errs)) {
      reason = Object.values(errs)[0] ?? '不正な値があります';
      blocked = true;
    }
    seen.add(record.id);
    return { record, include: !blocked, reason, blocked };
  });
  return {
    candidates,
    nextAction: cleanText(settings.nextStep, LIMITS.nextAction),
    cue: cleanText(settings.cue, LIMITS.cue),
    subject: cleanText(settings.goal, LIMITS.subject),
  };
}

/**
 * 永続化層（v7）。IndexedDB を優先し、使えなければ localStorage、それも不可ならメモリ（非永続・警告表示）。
 * - 複数の書き込みは1回の原子的な操作（write）で行う。
 * - v6 の設定（kv:settings）は移行後も残し、移行前の状態を書き出せるようにする。
 * - outbox：ログイン中だけ使う同期待ちの変更（サーバーへ送る前にローカルへ確定させる）。
 */
import { sanitizeActive, type ActiveSession } from './session';
import type { StudyRecord } from './records';
import { normalizeRecord } from './backup';
import { DEFAULT_META, sanitizeMeta, sanitizeReviews, type Meta, type Review } from './plan';
import { migrateFromV6, sanitizeAppSettings, sanitizeHabits, type AppSettings, type Habit } from './model';

export type StorageKind = 'indexeddb' | 'localStorage' | 'memory';
export type SyncKind = 'habit' | 'record' | 'review' | 'settings';

export interface OutboxItem {
  key: string;
  kind: SyncKind;
  id: string;
  /** null は削除（トゥームストーン） */
  payload: unknown | null;
  updatedAt: string;
}

export interface AccountState {
  userId: string;
  email: string;
  displayName: string;
  avatar: string;
  lastPulledAt: string | null;
}

export interface LoadedData {
  habits: Habit[];
  settings: AppSettings;
  active: ActiveSession | null;
  records: StudyRecord[];
  meta: Meta;
  reviews: Review[];
  account: AccountState | null;
  /** 今回の起動で v6 から移行したか */
  migratedFromV6: boolean;
  /** 移行前の v6 データ（書き出し用。移行していなければ null） */
  v6Backup: { settings: unknown; records: StudyRecord[] } | null;
}

export type Op =
  | { t: 'kv'; key: string; value: unknown }
  | { t: 'kvDel'; key: string }
  | { t: 'rec'; value: StudyRecord }
  | { t: 'recDel'; id: string }
  | { t: 'recClear' }
  | { t: 'out'; item: OutboxItem }
  | { t: 'outDel'; key: string }
  | { t: 'outClear' };

/** 低レベルの保存先（IndexedDB / JSON） */
interface Store {
  readonly kind: StorageKind;
  getKV(keys: string[]): Promise<Record<string, unknown>>;
  getRecords(): Promise<unknown[]>;
  getOutbox(): Promise<OutboxItem[]>;
  write(ops: Op[]): Promise<void>;
}

/* ------------------------------ IndexedDB ------------------------------ */

export const DB_NAME = 'tsuzuku-v5';
const DB_VERSION = 2;
const KV = 'kv';
const RECORDS = 'records';
const OUTBOX = 'outbox';

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('transaction error'));
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export function openDatabase(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(RECORDS)) {
        const store = db.createObjectStore(RECORDS, { keyPath: 'id' });
        store.createIndex('studyDate', 'studyDate');
      }
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('indexedDB blocked'));
  });
}

class IdbStore implements Store {
  readonly kind = 'indexeddb' as const;
  constructor(private db: IDBDatabase) {
    db.onversionchange = () => db.close();
  }
  async getKV(keys: string[]) {
    const tx = this.db.transaction(KV, 'readonly');
    const kv = tx.objectStore(KV);
    const vals = await Promise.all(keys.map((k) => reqToPromise(kv.get(k))));
    return Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
  }
  async getRecords() {
    return (await reqToPromise(this.db.transaction(RECORDS, 'readonly').objectStore(RECORDS).getAll())) as unknown[];
  }
  async getOutbox() {
    return (await reqToPromise(this.db.transaction(OUTBOX, 'readonly').objectStore(OUTBOX).getAll())) as OutboxItem[];
  }
  async write(ops: Op[]) {
    const tx = this.db.transaction([KV, RECORDS, OUTBOX], 'readwrite');
    const kv = tx.objectStore(KV);
    const rec = tx.objectStore(RECORDS);
    const out = tx.objectStore(OUTBOX);
    for (const op of ops) {
      if (op.t === 'kv') kv.put(op.value, op.key);
      else if (op.t === 'kvDel') kv.delete(op.key);
      else if (op.t === 'rec') rec.put(op.value);
      else if (op.t === 'recDel') rec.delete(op.id);
      else if (op.t === 'recClear') rec.clear();
      else if (op.t === 'out') out.put(op.item);
      else if (op.t === 'outDel') out.delete(op.key);
      else if (op.t === 'outClear') out.clear();
    }
    await txDone(tx);
  }
}

/* ------------------------------ JSON（localStorage / メモリ） ------------------------------ */

type JsonState = { kv: Record<string, unknown>; records: Record<string, StudyRecord>; outbox: Record<string, OutboxItem> };

class JsonStore implements Store {
  private mem: JsonState = { kv: {}, records: {}, outbox: {} };
  constructor(
    readonly kind: 'localStorage' | 'memory',
    private lsKey = 'tsuzuku-v7-state',
  ) {
    if (kind === 'localStorage') {
      const raw = localStorage.getItem(lsKey);
      if (raw) this.mem = JSON.parse(raw);
      else {
        // v6 の localStorage 形式から読み込む（移行は Repository が行う）
        const v6 = localStorage.getItem('tsuzuku-v5-state');
        if (v6) {
          const o = JSON.parse(v6);
          this.mem.kv = { settings: o.settings, active: o.active, meta: o.meta, reviews: o.reviews };
          for (const r of Array.isArray(o.records) ? o.records : []) if (r?.id) this.mem.records[r.id] = r;
        }
      }
    }
  }
  async getKV(keys: string[]) {
    return Object.fromEntries(keys.map((k) => [k, structuredClone(this.mem.kv[k])]));
  }
  async getRecords() {
    return Object.values(this.mem.records).map((r) => ({ ...r }));
  }
  async getOutbox() {
    return Object.values(this.mem.outbox).map((r) => ({ ...r }));
  }
  async write(ops: Op[]) {
    const next: JsonState = structuredClone(this.mem);
    for (const op of ops) {
      if (op.t === 'kv') next.kv[op.key] = structuredClone(op.value);
      else if (op.t === 'kvDel') delete next.kv[op.key];
      else if (op.t === 'rec') next.records[op.value.id] = { ...op.value };
      else if (op.t === 'recDel') delete next.records[op.id];
      else if (op.t === 'recClear') next.records = {};
      else if (op.t === 'out') next.outbox[op.item.key] = { ...op.item };
      else if (op.t === 'outDel') delete next.outbox[op.key];
      else if (op.t === 'outClear') next.outbox = {};
    }
    if (this.kind === 'localStorage') localStorage.setItem(this.lsKey, JSON.stringify(next));
    this.mem = next;
  }
}

/* ------------------------------ Repository ------------------------------ */

function cleanRecords(raw: unknown[]): StudyRecord[] {
  const out: StudyRecord[] = [];
  const ids = new Set<string>();
  for (const r of raw) {
    const rec = normalizeRecord(r);
    if (!rec || !rec.id || ids.has(rec.id) || !Number.isInteger(rec.minutes) || rec.minutes < 0) continue;
    if (rec.minutes === 0 && !rec.habitId) continue; // v6 以前の0分は不正
    ids.add(rec.id);
    out.push(rec);
  }
  return out;
}

const KV_KEYS = ['habits', 'appSettings', 'settings', 'active', 'meta', 'reviews', 'account', 'v6Backup'];

export class Repository {
  constructor(private store: Store) {}
  get kind() {
    return this.store.kind;
  }

  async load(): Promise<LoadedData> {
    const kv = await this.store.getKV(KV_KEYS);
    let records = cleanRecords(await this.store.getRecords());
    let habits = sanitizeHabits(kv.habits);
    let settings = sanitizeAppSettings(kv.appSettings);
    let migratedFromV6 = false;
    let v6Backup = (kv.v6Backup as LoadedData['v6Backup']) ?? null;

    // v7 の習慣データがまだない → v6 から移行（1回だけ）
    if (kv.habits === undefined) {
      const m = migrateFromV6(kv.settings, records);
      const ops: Op[] = [
        { t: 'kv', key: 'habits', value: m.habits },
        { t: 'kv', key: 'appSettings', value: m.settings },
      ];
      if (m.migrated) {
        v6Backup = { settings: kv.settings ?? null, records };
        ops.push({ t: 'kv', key: 'v6Backup', value: v6Backup });
        for (const r of m.records) ops.push({ t: 'rec', value: r });
        migratedFromV6 = true;
      }
      await this.store.write(ops);
      habits = m.habits;
      settings = m.settings;
      records = m.records;
    }

    return {
      habits,
      settings,
      active: sanitizeActive(kv.active, Date.now()),
      records,
      meta: kv.meta ? sanitizeMeta(kv.meta) : { ...DEFAULT_META },
      reviews: sanitizeReviews(kv.reviews),
      account: sanitizeAccount(kv.account),
      migratedFromV6,
      v6Backup,
    };
  }

  write(ops: Op[]) {
    return this.store.write(ops);
  }
  getOutbox() {
    return this.store.getOutbox();
  }
}

export function sanitizeAccount(raw: unknown): AccountState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.userId !== 'string' || !r.userId) return null;
  return {
    userId: r.userId,
    email: typeof r.email === 'string' ? r.email : '',
    displayName: typeof r.displayName === 'string' ? r.displayName.slice(0, 20) : '',
    avatar: typeof r.avatar === 'string' ? r.avatar.slice(0, 20) : 'green',
    lastPulledAt: typeof r.lastPulledAt === 'string' ? r.lastPulledAt : null,
  };
}

export async function openRepository(): Promise<Repository> {
  try {
    const repo = new Repository(new IdbStore(await openDatabase()));
    await repo.load(); // 読み込み（と必要なら移行）まで成功することを確認
    return repo;
  } catch (e) {
    console.warn('[つづく。] IndexedDB を利用できません。localStorage を使います。', e);
  }
  try {
    const k = '__tsuzuku_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return new Repository(new JsonStore('localStorage'));
  } catch (e) {
    console.warn('[つづく。] localStorage も利用できません。データは保存されません。', e);
  }
  return new Repository(new JsonStore('memory'));
}

/** テスト用：メモリだけのリポジトリ */
export function memoryRepository(): Repository {
  return new Repository(new JsonStore('memory'));
}

/** テスト用：任意の名前の IndexedDB */
export async function idbRepository(name: string): Promise<Repository> {
  return new Repository(new IdbStore(await openDatabase(name)));
}

/** 保存領域を「永続」として扱うよう要求（ブラウザの自動削除を避ける。許可は保証されない） */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* 未対応 */
  }
  return null;
}

/* ------------- v3.1 試作版データの検出（同じ公開URLで使っていた場合） ------------- */

const LEGACY_DB = 'tsuzuku-db-v3';
const LEGACY_LS = 'tsuzuku-state-v3';

export async function readLegacyV3(): Promise<Record<string, unknown> | null> {
  try {
    const ls = localStorage.getItem(LEGACY_LS);
    if (ls) {
      const obj = JSON.parse(ls);
      if (obj?.format === 'tsuzuku-v3') return obj;
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return null;
    const list = await indexedDB.databases();
    if (!list.some((d) => d.name === LEGACY_DB)) return null;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(LEGACY_DB);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      if (!db.objectStoreNames.contains('kv')) return null;
      const val = await reqToPromise(db.transaction('kv', 'readonly').objectStore('kv').get('state'));
      return val && (val as Record<string, unknown>).format === 'tsuzuku-v3' ? (val as Record<string, unknown>) : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

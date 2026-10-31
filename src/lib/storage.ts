/**
 * 永続化層。IndexedDB を優先し、使えなければ localStorage、それも不可ならメモリ（非永続・警告表示）。
 * 学習終了の保存は「記録追加・進行中セッション削除・次の一歩更新」を 1 トランザクションで行う。
 */
import { sanitizeActive, type ActiveSession } from './session';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings, type StudyRecord } from './records';
import { normalizeRecord } from './backup';

export type StorageKind = 'indexeddb' | 'localStorage' | 'memory';

export interface LoadedData {
  settings: Settings;
  active: ActiveSession | null;
  records: StudyRecord[];
}

export interface Repository {
  readonly kind: StorageKind;
  load(): Promise<LoadedData>;
  saveSettings(settings: Settings): Promise<void>;
  saveActive(active: ActiveSession | null): Promise<void>;
  /** 冪等：同じ ID の記録が既にあれば上書きせず 'duplicate' を返す */
  completeSession(record: StudyRecord, settings: Settings): Promise<'saved' | 'duplicate'>;
  putRecord(record: StudyRecord): Promise<void>;
  deleteRecord(id: string): Promise<void>;
  /** 記録を追加（既存IDはスキップ）。追加件数を返す */
  addRecords(records: StudyRecord[], settings: Settings): Promise<number>;
  replaceAll(settings: Settings, records: StudyRecord[]): Promise<void>;
}

export const DB_NAME = 'tsuzuku-v5';
const DB_VERSION = 1;
const KV = 'kv';
const RECORDS = 'records';

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('indexedDB blocked'));
  });
}

function cleanRecords(raw: unknown[]): StudyRecord[] {
  const out: StudyRecord[] = [];
  const ids = new Set<string>();
  for (const r of raw) {
    const rec = normalizeRecord(r);
    if (rec && rec.id && !ids.has(rec.id) && Number.isInteger(rec.minutes) && rec.minutes > 0) {
      ids.add(rec.id);
      out.push(rec);
    }
  }
  return out;
}

export class IdbRepository implements Repository {
  readonly kind = 'indexeddb' as const;
  constructor(private db: IDBDatabase) {
    // 他タブでのバージョン更新時に接続を閉じる
    db.onversionchange = () => db.close();
  }

  async load(): Promise<LoadedData> {
    const tx = this.db.transaction([KV, RECORDS], 'readonly');
    const kv = tx.objectStore(KV);
    const [settings, active, records] = await Promise.all([
      reqToPromise(kv.get('settings')),
      reqToPromise(kv.get('active')),
      reqToPromise(tx.objectStore(RECORDS).getAll()),
    ]);
    return {
      settings: settings ? sanitizeSettings(settings) : { ...DEFAULT_SETTINGS },
      active: sanitizeActive(active, Date.now()),
      records: cleanRecords(records as unknown[]),
    };
  }

  async saveSettings(settings: Settings) {
    const tx = this.db.transaction(KV, 'readwrite');
    tx.objectStore(KV).put(settings, 'settings');
    await txDone(tx);
  }

  async saveActive(active: ActiveSession | null) {
    const tx = this.db.transaction(KV, 'readwrite');
    if (active) tx.objectStore(KV).put(active, 'active');
    else tx.objectStore(KV).delete('active');
    await txDone(tx);
  }

  async completeSession(record: StudyRecord, settings: Settings) {
    const tx = this.db.transaction([KV, RECORDS], 'readwrite');
    const store = tx.objectStore(RECORDS);
    let result: 'saved' | 'duplicate' = 'saved';
    const get = store.get(record.id);
    get.onsuccess = () => {
      if (get.result) {
        result = 'duplicate';
      } else {
        store.add(record);
      }
      const kv = tx.objectStore(KV);
      kv.delete('active');
      kv.put(settings, 'settings');
    };
    await txDone(tx);
    return result;
  }

  async putRecord(record: StudyRecord) {
    const tx = this.db.transaction(RECORDS, 'readwrite');
    tx.objectStore(RECORDS).put(record);
    await txDone(tx);
  }

  async deleteRecord(id: string) {
    const tx = this.db.transaction(RECORDS, 'readwrite');
    tx.objectStore(RECORDS).delete(id);
    await txDone(tx);
  }

  async addRecords(records: StudyRecord[], settings: Settings) {
    const tx = this.db.transaction([KV, RECORDS], 'readwrite');
    const store = tx.objectStore(RECORDS);
    let added = 0;
    for (const r of records) {
      const g = store.get(r.id);
      g.onsuccess = () => {
        if (!g.result) {
          store.add(r);
          added++;
        }
      };
    }
    tx.objectStore(KV).put(settings, 'settings');
    await txDone(tx);
    return added;
  }

  async replaceAll(settings: Settings, records: StudyRecord[]) {
    const tx = this.db.transaction([KV, RECORDS], 'readwrite');
    const store = tx.objectStore(RECORDS);
    store.clear();
    for (const r of records) store.add(r);
    tx.objectStore(KV).put(settings, 'settings');
    await txDone(tx);
  }
}

/** localStorage 版（IndexedDB が使えない環境用）。1キーに全体を保存。 */
export class LocalStorageRepository implements Repository {
  readonly kind = 'localStorage' as const;
  static KEY = 'tsuzuku-v5-state';
  private read(): { settings: unknown; active: unknown; records: unknown[] } {
    const raw = localStorage.getItem(LocalStorageRepository.KEY);
    if (!raw) return { settings: null, active: null, records: [] };
    const obj = JSON.parse(raw);
    return { settings: obj.settings, active: obj.active, records: Array.isArray(obj.records) ? obj.records : [] };
  }
  private write(data: { settings: unknown; active: unknown; records: unknown[] }) {
    localStorage.setItem(LocalStorageRepository.KEY, JSON.stringify(data));
  }
  async load(): Promise<LoadedData> {
    const d = this.read();
    return {
      settings: d.settings ? sanitizeSettings(d.settings) : { ...DEFAULT_SETTINGS },
      active: sanitizeActive(d.active, Date.now()),
      records: cleanRecords(d.records),
    };
  }
  async saveSettings(settings: Settings) {
    const d = this.read();
    this.write({ ...d, settings });
  }
  async saveActive(active: ActiveSession | null) {
    const d = this.read();
    this.write({ ...d, active });
  }
  async completeSession(record: StudyRecord, settings: Settings) {
    const d = this.read();
    const dup = d.records.some((r) => (r as StudyRecord)?.id === record.id);
    this.write({ settings, active: null, records: dup ? d.records : [...d.records, record] });
    return dup ? ('duplicate' as const) : ('saved' as const);
  }
  async putRecord(record: StudyRecord) {
    const d = this.read();
    const others = d.records.filter((r) => (r as StudyRecord)?.id !== record.id);
    this.write({ ...d, records: [...others, record] });
  }
  async deleteRecord(id: string) {
    const d = this.read();
    this.write({ ...d, records: d.records.filter((r) => (r as StudyRecord)?.id !== id) });
  }
  async addRecords(records: StudyRecord[], settings: Settings) {
    const d = this.read();
    const ids = new Set(d.records.map((r) => (r as StudyRecord)?.id));
    const fresh = records.filter((r) => !ids.has(r.id));
    this.write({ settings, active: d.active, records: [...d.records, ...fresh] });
    return fresh.length;
  }
  async replaceAll(settings: Settings, records: StudyRecord[]) {
    const d = this.read();
    this.write({ settings, active: d.active, records });
  }
}

/** 非永続（最後の手段）。画面に警告を出す。 */
export class MemoryRepository implements Repository {
  readonly kind = 'memory' as const;
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private active: ActiveSession | null = null;
  private records = new Map<string, StudyRecord>();
  async load() {
    return { settings: { ...this.settings }, active: this.active, records: [...this.records.values()] };
  }
  async saveSettings(s: Settings) {
    this.settings = { ...s };
  }
  async saveActive(a: ActiveSession | null) {
    this.active = a;
  }
  async completeSession(r: StudyRecord, s: Settings) {
    const dup = this.records.has(r.id);
    if (!dup) this.records.set(r.id, r);
    this.active = null;
    this.settings = { ...s };
    return dup ? ('duplicate' as const) : ('saved' as const);
  }
  async putRecord(r: StudyRecord) {
    this.records.set(r.id, r);
  }
  async deleteRecord(id: string) {
    this.records.delete(id);
  }
  async addRecords(rs: StudyRecord[], s: Settings) {
    let n = 0;
    for (const r of rs)
      if (!this.records.has(r.id)) {
        this.records.set(r.id, r);
        n++;
      }
    this.settings = { ...s };
    return n;
  }
  async replaceAll(s: Settings, rs: StudyRecord[]) {
    this.settings = { ...s };
    this.records = new Map(rs.map((r) => [r.id, r]));
  }
}

export async function openRepository(): Promise<Repository> {
  try {
    const db = await openDatabase();
    const repo = new IdbRepository(db);
    await repo.load(); // 読み込みまで成功することを確認
    return repo;
  } catch (e) {
    console.warn('[つづく。] IndexedDB を利用できません。localStorage を使います。', e);
  }
  try {
    const k = '__tsuzuku_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return new LocalStorageRepository();
  } catch (e) {
    console.warn('[つづく。] localStorage も利用できません。データは保存されません。', e);
  }
  return new MemoryRepository();
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

/**
 * 同一オリジンに v3.1 のデータがあれば読み取って返す（書き換えない）。
 * indexedDB.databases() が使えない環境では、DB を新規作成しないよう localStorage のみ確認する。
 */
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

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DB_NAME, idbRepository, memoryRepository, openDatabase, type Repository } from '../../src/lib/storage';
import { DEFAULT_APP_SETTINGS } from '../../src/lib/model';
import type { StudyRecord } from '../../src/lib/records';
import { createSession } from '../../src/lib/session';

let n = 0;
const fresh = () => idbRepository(`test-db-${++n}`);

const rec = (id: string, minutes = 20, extra: Partial<StudyRecord> = {}): StudyRecord => ({
  id,
  studyDate: '2026-11-01',
  startedAt: null,
  endedAt: null,
  minutes,
  measuredSeconds: null,
  pausedSeconds: null,
  title: 't',
  note: '',
  source: 'timer',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...extra,
});

/** v6 時代の DB（version 1：kv と records のみ）を作る */
function makeV6Db(name: string, settings: unknown, records: StudyRecord[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('kv');
      db.createObjectStore('records', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['kv', 'records'], 'readwrite');
      if (settings !== undefined) tx.objectStore('kv').put(settings, 'settings');
      for (const r of records) tx.objectStore('records').put(r);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe.each([
  ['IndexedDB', fresh],
  ['memory (JSON)', async () => memoryRepository()],
] as [string, () => Promise<Repository>][])('Repository on %s', (_label, make) => {
  it('starts empty: no habits, default settings, no active, 0 records, no migration', async () => {
    const r = await make();
    const d = await r.load();
    expect(d.habits).toEqual([]);
    expect(d.records).toEqual([]);
    expect(d.active).toBeNull();
    expect(d.settings.strictness).toBe(DEFAULT_APP_SETTINGS.strictness);
    expect(d.migratedFromV6).toBe(false);
    expect(d.account).toBeNull();
  });

  it('persists the active session (reload recovery)', async () => {
    const r = await make();
    await r.load();
    const s = createSession({ mode: 'standard', habitId: 'h1', title: 'a', subject: 'b', targetMinutes: 20, now: Date.now() - 1000 });
    await r.write([{ t: 'kv', key: 'active', value: s }]);
    expect((await r.load()).active).toEqual(s);
  });

  it('writes several ops at once; put twice with the same id keeps one record', async () => {
    const r = await make();
    await r.load();
    await r.write([
      { t: 'rec', value: rec('a', 20, { habitId: 'h' }) },
      { t: 'rec', value: rec('a', 30, { habitId: 'h' }) },
      { t: 'rec', value: rec('b', 5, { habitId: 'h' }) },
    ]);
    expect((await r.load()).records.map((x) => x.minutes).sort()).toEqual([30, 5].sort());
    await r.write([{ t: 'recDel', id: 'a' }]);
    expect((await r.load()).records.map((x) => x.id)).toEqual(['b']);
    await r.write([{ t: 'recClear' }]);
    expect((await r.load()).records).toEqual([]);
  });

  it('keeps an outbox (offline queue) separate from data', async () => {
    const r = await make();
    await r.load();
    await r.write([
      { t: 'out', item: { key: 'record:a', kind: 'record', id: 'a', payload: { x: 1 }, updatedAt: '2026-11-01T00:00:00.000Z' } },
      { t: 'out', item: { key: 'record:a', kind: 'record', id: 'a', payload: null, updatedAt: '2026-11-01T00:01:00.000Z' } },
      { t: 'out', item: { key: 'habit:h', kind: 'habit', id: 'h', payload: {}, updatedAt: '2026-11-01T00:00:00.000Z' } },
    ]);
    const out = await r.getOutbox();
    expect(out).toHaveLength(2);
    expect(out.find((o) => o.key === 'record:a')?.payload).toBeNull();
    await r.write([{ t: 'outDel', key: 'habit:h' }]);
    expect(await r.getOutbox()).toHaveLength(1);
    await r.write([{ t: 'outClear' }]);
    expect(await r.getOutbox()).toEqual([]);
  });
});

describe('v6 → v7 migration (IndexedDB)', () => {
  it('upgrades the DB, moves the single plan into a 簿記 habit with the baseline, tags records, keeps a backup', async () => {
    const name = `v6-db-${++n}`;
    await makeV6Db(name, { subject: '簿記3級', nextAction: '第12章 問1', cue: '朝の作業の最初', smallAction: '1問だけ', smallMinutes: 5 }, [rec('r1', 20), rec('r2', 15)]);
    const r = await idbRepository(name);
    const d = await r.load();
    expect(d.migratedFromV6).toBe(true);
    expect(d.habits).toHaveLength(1);
    const h = d.habits[0];
    expect(h).toMatchObject({ name: '簿記3級', trackingType: 'time', baseline: true, nextAction: '第12章 問1', cue: '朝の作業の最初', shared: false });
    expect(h.copingPlans[0]).toMatchObject({ instead: '1問だけ', minutes: 5 });
    expect(d.records.every((x) => x.habitId === h.id && x.kind === 'done')).toBe(true);
    expect(d.v6Backup?.records).toHaveLength(2);
    // 2回目の読み込みでは移行しない（習慣が増えない）
    const again = await (await idbRepository(name)).load();
    expect(again.migratedFromV6).toBe(false);
    expect(again.habits.map((x) => x.id)).toEqual([h.id]);
    expect(again.records).toHaveLength(2);
    // outbox ストアが追加されている
    const db = await openDatabase(name);
    expect([...db.objectStoreNames]).toContain('outbox');
    db.close();
  });

  it('does not create a habit for an untouched v6 install (no records, default plan)', async () => {
    const name = `v6-empty-${++n}`;
    await makeV6Db(name, { subject: '簿記3級' }, []);
    const d = await (await idbRepository(name)).load();
    expect(d.habits).toEqual([]);
    expect(d.migratedFromV6).toBe(false);
  });

  it('uses the same DB name as v5/v6 so existing data is found', () => {
    expect(DB_NAME).toBe('tsuzuku-v5');
  });
});

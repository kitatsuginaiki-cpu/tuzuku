import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IdbRepository, openDatabase } from '../../src/lib/storage';
import { DEFAULT_SETTINGS, type StudyRecord } from '../../src/lib/records';
import { createSession } from '../../src/lib/session';

let n = 0;
async function repo() {
  return new IdbRepository(await openDatabase(`test-db-${++n}`));
}

const rec = (id: string, minutes = 20): StudyRecord => ({
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
});

describe('IdbRepository', () => {
  let r: IdbRepository;
  beforeEach(async () => {
    r = await repo();
  });

  it('starts empty: default settings, no active, 0 records', async () => {
    const d = await r.load();
    expect(d.records).toEqual([]);
    expect(d.active).toBeNull();
    expect(d.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('persists active session (reload recovery)', async () => {
    const s = createSession({ mode: 'standard', title: 'a', subject: 'b', targetMinutes: 20, now: Date.now() - 1000 });
    await r.saveActive(s);
    expect((await r.load()).active).toEqual(s);
  });

  it('completeSession is atomic and idempotent (double submit → 1 record)', async () => {
    const s = createSession({ mode: 'standard', title: 'a', subject: 'b', targetMinutes: 20, now: Date.now() - 1000 });
    await r.saveActive(s);
    const settings = { ...DEFAULT_SETTINGS, nextAction: '次の一歩' };
    const [x, y] = await Promise.all([r.completeSession(rec(s.id), settings), r.completeSession(rec(s.id), settings)]);
    expect([x, y].sort()).toEqual(['duplicate', 'saved']);
    const d = await r.load();
    expect(d.records).toHaveLength(1);
    expect(d.active).toBeNull();
    expect(d.settings.nextAction).toBe('次の一歩');
  });

  it('put / delete / replaceAll / addRecords', async () => {
    await r.putRecord(rec('a'));
    await r.putRecord({ ...rec('a'), minutes: 30 });
    expect((await r.load()).records.map((x) => x.minutes)).toEqual([30]);
    await r.deleteRecord('a');
    expect((await r.load()).records).toHaveLength(0);
    await r.replaceAll(DEFAULT_SETTINGS, [rec('b'), rec('c')]);
    expect((await r.load()).records).toHaveLength(2);
    const added = await r.addRecords([rec('c'), rec('d')], DEFAULT_SETTINGS);
    expect(added).toBe(1);
    expect((await r.load()).records).toHaveLength(3);
  });

  it('replaceAll with duplicate ids aborts and keeps old data', async () => {
    await r.replaceAll(DEFAULT_SETTINGS, [rec('keep')]);
    await expect(r.replaceAll(DEFAULT_SETTINGS, [rec('x'), rec('x')])).rejects.toBeTruthy();
    expect((await r.load()).records.map((x) => x.id)).toEqual(['keep']);
  });
});

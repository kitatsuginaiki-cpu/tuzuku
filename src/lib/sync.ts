/**
 * 端末間同期（ログイン中のみ）。
 * - ローカルが正：書き込みは先に端末へ確定し、outbox に積んでから送る（オフラインでも失われない）。
 * - 競合は updatedAt の新しい方を採用（Last-Write-Wins）。送信待ちの変更があるキーは受信で上書きしない。
 * - 仲間への共有は「共有オン」の習慣の要約だけ（記録の中身・メモは送らない）。
 */
import { addDays } from './dates';
import { dayStatus, habitTotal, totalValue } from './accumulate';
import { moodFor, toSharedMood } from './character';
import { logicalDate, sanitizeAppSettings, sanitizeHabit, type AppSettings, type Habit } from './model';
import { normalizeRecord } from './backup';
import { sanitizeReviews, type Meta, type Review } from './plan';
import type { StudyRecord } from './records';
import { getRemote, type RemoteItem, type SharedStatus } from './remote';
import type { AccountState, Op, OutboxItem, Repository } from './storage';

export interface SyncStatus {
  status: 'off' | 'idle' | 'syncing' | 'offline' | 'error';
  lastSyncedAt: string | null;
  error: string | null;
}

export interface SyncState {
  habits: Habit[];
  settings: AppSettings;
  records: StudyRecord[];
  reviews: Review[];
  meta: Meta;
  account: AccountState | null;
  active: unknown | null;
}

interface Deps {
  repo: Repository;
  getState: () => SyncState;
  onStatus: (s: SyncStatus) => void;
  onApplied: () => void;
  now?: () => number;
}

const INTERVAL_MS = 60_000;
const DEBOUNCE_MS = 1500;

/** 仲間に見せる要約を作る（純粋関数・テスト対象） */
export function sharedStatuses(state: Pick<SyncState, 'habits' | 'records' | 'settings' | 'meta'>, now: number): SharedStatus[] {
  const today = logicalDate(now, state.settings.dayStartHour);
  const hour = new Date(now - state.settings.dayStartHour * 3600_000).getHours();
  const iso = new Date(now).toISOString();
  return state.habits
    .filter((h) => h.shared && !h.archived)
    .map((h) => {
      const st = dayStatus(h.id, state.records, today);
      let weekDays = 0;
      for (let k = 0; k < 7; k++) {
        const s = dayStatus(h.id, state.records, addDays(today, -k));
        if (s === 'done' || s === 'small') weekDays++;
      }
      const { mood } = moodFor({
        habits: [h],
        records: state.records,
        settings: state.settings,
        today,
        hour,
        firstUsedOn: state.meta.firstUsedOn,
      });
      return {
        habitId: h.id,
        habitName: h.name,
        trackingType: h.trackingType,
        today: st ?? 'none',
        todayDate: today,
        weekDays,
        total: totalValue(habitTotal(h, state.records)),
        mood: state.settings.characterEnabled ? toSharedMood(mood) : null,
        updatedAt: iso,
      };
    });
}

/**
 * 受信したデータをローカルへ適用する操作を作る（純粋関数・テスト対象）。
 * pending：送信待ちのキー（これらは受信で上書きしない）。
 */
export function applyRemote(
  local: Pick<SyncState, 'habits' | 'records' | 'reviews' | 'settings'>,
  items: RemoteItem[],
  pending: Set<string>,
): { ops: Op[]; changed: number } {
  const ops: Op[] = [];
  let changed = 0;
  let habits = local.habits;
  let habitsTouched = false;
  let reviews = local.reviews;
  let reviewsTouched = false;
  const newer = (a: string | undefined, b: string) => !a || b > a;

  for (const it of items) {
    if (pending.has(`${it.kind}:${it.id}`)) continue;
    if (it.kind === 'record') {
      const cur = local.records.find((r) => r.id === it.id);
      if (it.payload == null) {
        if (cur && newer(cur.updatedAt, it.updatedAt)) {
          ops.push({ t: 'recDel', id: it.id });
          changed++;
        }
        continue;
      }
      const rec = normalizeRecord(it.payload);
      if (!rec || rec.id !== it.id) continue;
      if (!cur || newer(cur.updatedAt, rec.updatedAt)) {
        ops.push({ t: 'rec', value: rec });
        changed++;
      }
    } else if (it.kind === 'habit') {
      if (it.payload == null) continue; // 習慣は削除せずアーカイブで扱う
      const h = sanitizeHabit(it.payload);
      if (!h || h.id !== it.id) continue;
      const cur = habits.find((x) => x.id === h.id);
      if (!cur || newer(cur.updatedAt, h.updatedAt)) {
        habits = cur ? habits.map((x) => (x.id === h.id ? h : x)) : [...habits, h];
        habitsTouched = true;
        changed++;
      }
    } else if (it.kind === 'review') {
      if (it.payload == null || reviews.some((r) => r.id === it.id)) continue;
      const [rv] = sanitizeReviews([it.payload]);
      if (!rv) continue;
      reviews = [...reviews, rv];
      reviewsTouched = true;
      changed++;
    } else if (it.kind === 'settings') {
      if (it.payload == null) continue;
      const s = sanitizeAppSettings(it.payload);
      if (newer(local.settings.updatedAt, s.updatedAt)) {
        ops.push({ t: 'kv', key: 'appSettings', value: s });
        changed++;
      }
    }
  }
  if (habitsTouched) {
    // 基準値を持てるのは最初の1つだけ（sanitize と同じ規則）
    let seen = false;
    habits = habits.map((h) => {
      if (!h.baseline) return h;
      if (seen) return { ...h, baseline: false };
      seen = true;
      return h;
    });
    ops.push({ t: 'kv', key: 'habits', value: habits });
  }
  if (reviewsTouched) ops.push({ t: 'kv', key: 'reviews', value: reviews });
  return { ops, changed };
}

/** 端末の全データを送信待ちに積む操作（ログイン直後に1回） */
export function fullOutbox(state: Pick<SyncState, 'habits' | 'records' | 'reviews' | 'settings'>): Op[] {
  const item = (kind: OutboxItem['kind'], id: string, payload: unknown, updatedAt: string): Op => ({
    t: 'out',
    item: { key: `${kind}:${id}`, kind, id, payload, updatedAt },
  });
  return [
    ...state.habits.map((h) => item('habit', h.id, h, h.updatedAt)),
    ...state.records.map((r) => item('record', r.id, r, r.updatedAt)),
    ...state.reviews.map((r) => item('review', r.id, r, r.createdAt)),
    item('settings', 'app', state.settings, state.settings.updatedAt || new Date(0).toISOString()),
  ];
}

export class SyncEngine {
  private timer: number | null = null;
  private interval: number | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private status: SyncStatus = { status: 'off', lastSyncedAt: null, error: null };
  private onOnline = () => this.schedule(0);
  private onVisible = () => {
    if (!document.hidden) this.schedule(0);
  };

  constructor(private d: Deps) {}

  start() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisible);
    this.interval = window.setInterval(() => {
      if (!document.hidden) this.schedule(0);
    }, INTERVAL_MS);
    this.schedule(0);
  }

  stop() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.interval) window.clearInterval(this.interval);
    if (this.timer) window.clearTimeout(this.timer);
  }

  private set(s: Partial<SyncStatus>) {
    this.status = { ...this.status, ...s };
    this.d.onStatus(this.status);
  }

  schedule(delay = DEBOUNCE_MS) {
    if (typeof window === 'undefined') return;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.run(), delay);
  }

  /** ログイン直後：端末のデータをすべて送信待ちにして同期 */
  async fullPush() {
    await this.d.repo.write(fullOutbox(this.d.getState()));
    await this.run();
  }

  async run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.once().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        this.schedule(0);
      }
    });
    return this.running;
  }

  private async once() {
    const state = this.d.getState();
    if (!state.account) {
      this.set({ status: 'off', error: null });
      return;
    }
    const remote = await getRemote();
    if (!remote.available) {
      this.set({ status: 'off', error: null });
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.set({ status: 'offline' });
      return;
    }
    this.set({ status: 'syncing', error: null });
    try {
      // 1) 送る
      const out = await this.d.repo.getOutbox();
      if (out.length) {
        await remote.push(out);
        // 送信中に同じキーが更新されていたら残す
        const after = await this.d.repo.getOutbox();
        const sent = new Map(out.map((o) => [o.key, o.updatedAt]));
        await this.d.repo.write(after.filter((o) => sent.get(o.key) === o.updatedAt).map((o) => ({ t: 'outDel' as const, key: o.key })));
      }
      // 2) 受け取る
      const { items, serverTime } = await remote.pull(state.account.lastPulledAt);
      const pending = new Set((await this.d.repo.getOutbox()).map((o) => o.key));
      const cur = this.d.getState();
      const { ops, changed } = applyRemote(cur, items, pending);
      if (cur.account) ops.push({ t: 'kv', key: 'account', value: { ...cur.account, lastPulledAt: serverTime } });
      await this.d.repo.write(ops);
      // 3) 仲間に見せる要約
      const latest = this.d.getState();
      await remote.publishShared(sharedStatuses(latest, this.d.now?.() ?? Date.now()));
      this.set({ status: 'idle', lastSyncedAt: new Date().toISOString(), error: null });
      // account.lastPulledAt を含め、常に再読込（changed=0 でも account が変わる）
      void changed;
      this.d.onApplied();
    } catch (e) {
      console.warn('[つづく。] 同期できませんでした', e);
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      this.set({ status: offline ? 'offline' : 'error', error: offline ? null : '同期できませんでした。あとで自動でやり直します。' });
    }
  }
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LIMITS, OPEN_TO_START_MAX_MS, REVIEW_INTERVAL_DAYS, TWO_MINUTE_TARGET_MINUTES } from './lib/config';
import { addDays } from './lib/dates';
import { cleanText, hasErrors, type StudyRecord } from './lib/records';
import {
  beginCompleting,
  cancelCompleting,
  createSession,
  elapsedMs,
  newId,
  pause,
  pausedTotalMs,
  resume,
  setTarget,
  type ActiveSession,
} from './lib/session';
import { DEFAULT_META, isPlannedDay, type Meta, type Review, type ReviewChange } from './lib/plan';
import {
  DEFAULT_APP_SETTINGS,
  hasDayRecord,
  logicalDate,
  validateRecordFor,
  type AppSettings,
  type CopingPlan,
  type Habit,
} from './lib/model';
import { crossedMilestone, habitTotal } from './lib/accumulate';
import { accessoryAvailable, growthOf, type CharaAccessory } from './lib/character';
import { openRepository, requestPersistence, type AccountState, type Op, type Repository, type Snapshot, type StorageKind, type SyncKind } from './lib/storage';
import { SyncEngine, type SyncStatus } from './lib/sync';
import { syncEnabled } from './lib/remote';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
  action?: { label: string; run: () => void };
}

export interface State {
  phase: 'loading' | 'ready';
  habits: Habit[];
  settings: AppSettings;
  active: ActiveSession | null;
  records: StudyRecord[];
  meta: Meta;
  reviews: Review[];
  account: AccountState | null;
  storageKind: StorageKind | null;
  recovered: boolean;
  /** 直前にしおりを保存した習慣 */
  justBookmarked: string | null;
  /** 直前に到達した節目 */
  justMilestone: { habitId: string; value: number } | null;
  /** つづきぼしが進化した（お祝いを出す段階） */
  levelUp: number | null;
  migratedFromV6: boolean;
  v6Backup: { settings: unknown; records: StudyRecord[] } | null;
  lastSnapshot: Snapshot | null;
  sync: SyncStatus;
}

export interface FinishInput {
  minutes: number;
  title: string;
  nextAction: string;
  cueFollowed: 'yes' | 'no' | null;
}

export interface ReviewInput {
  habitId: string | null;
  change: ReviewChange;
  ease: number | null;
  note: string;
}

export type StartMode = { kind: 'standard' } | { kind: 'small'; coping: CopingPlan | null };

interface Actions {
  startSession(habitId: string, mode: StartMode): Promise<void>;
  pauseSession(): void;
  resumeSession(): void;
  changeTarget(minutes: number): void;
  beginFinish(): void;
  cancelFinish(): void;
  discardSession(): Promise<void>;
  saveFinish(input: FinishInput): Promise<'saved' | 'duplicate'>;
  /** 日数型：今日（または指定日）を「やった」にする */
  markDone(habitId: string, opts?: { small?: CopingPlan | null; date?: string }): Promise<void>;
  /** 休むと決めた日（失敗ではない・積み上げに数えない） */
  markRest(habitId: string, date?: string): Promise<void>;
  saveHabit(habit: Habit): Promise<void>;
  addHabits(habits: Habit[]): Promise<void>;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
  saveRecord(record: StudyRecord): Promise<void>;
  deleteRecord(id: string, opts?: { quiet?: boolean }): Promise<void>;
  /** 消去・復元（この端末だけ）。直前の状態を1つ自動で保存し、元に戻せるようにする */
  replaceAll(data: { habits: Habit[]; settings: AppSettings; records: StudyRecord[]; reviews: Review[] }, reason: 'reset' | 'restore'): Promise<void>;
  addRecords(records: StudyRecord[], habitPatch?: { habitId: string; nextAction?: string; cue?: string }): Promise<number>;
  saveReview(input: ReviewInput): Promise<void>;
  snoozeReview(): Promise<void>;
  setAccount(account: AccountState | null): Promise<void>;
  /** バックアップを書き出した・コピーしたことを記録する */
  markBackup(): Promise<void>;
  syncNow(): Promise<void>;
  toast(message: string, opts?: { tone?: Toast['tone']; action?: Toast['action'] }): void;
  dismissToast(id: number): void;
  clearRecovered(): void;
  clearFlash(): void;
  clearLevelUp(): void;
}

const Ctx = createContext<{ state: State; actions: Actions; toasts: Toast[] } | null>(null);
const CHANNEL = 'tsuzuku-sync';

let visibleSince = Date.now();
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) visibleSince = Date.now();
  });
}

export class ValidationError extends Error {
  constructor(public errors: Record<string, string>) {
    super(Object.values(errors)[0] ?? '入力を確認してください。');
  }
}

/** 今日（区切り時刻を考慮） */
export function todayOf(s: AppSettings) {
  return logicalDate(Date.now(), s.dayStartHour);
}

export function StoreProvider({ children, navigate }: { children: ReactNode; navigate: (route: string) => void }) {
  const [state, setState] = useState<State>({
    phase: 'loading',
    habits: [],
    settings: { ...DEFAULT_APP_SETTINGS },
    active: null,
    records: [],
    meta: { ...DEFAULT_META },
    reviews: [],
    account: null,
    storageKind: null,
    recovered: false,
    justBookmarked: null,
    justMilestone: null,
    levelUp: null,
    migratedFromV6: false,
    v6Backup: null,
    lastSnapshot: null,
    sync: { status: 'off', lastSyncedAt: null, error: null },
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const repo = useRef<Repository | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const channel = useRef<BroadcastChannel | null>(null);
  const toastSeq = useRef(0);
  const sync = useRef<SyncEngine | null>(null);

  const toast = useCallback<Actions['toast']>((message, opts) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-2), { id, message, tone: opts?.tone ?? 'info', action: opts?.action }]);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const reload = useCallback(async () => {
    if (!repo.current) return;
    const d = await repo.current.load();
    setState((s) => ({ ...s, ...d, migratedFromV6: s.migratedFromV6 || d.migratedFromV6 }));
  }, []);

  /** ローカルに書き込み（ログイン中は同期待ちにも積む）→ 他タブへ通知 → 同期を予約 */
  const commit = useCallback(async (ops: Op[], changes: { kind: SyncKind; id: string; payload: unknown | null; updatedAt?: string }[] = []) => {
    const all = [...ops];
    // 送信待ちに積むのは、同期が有効でログインしているときだけ
    if (stateRef.current.account && syncEnabled()) {
      for (const c of changes) {
        const updatedAt = c.updatedAt ?? new Date().toISOString();
        all.push({ t: 'out', item: { key: `${c.kind}:${c.id}`, kind: c.kind, id: c.id, payload: c.payload, updatedAt } });
      }
    }
    await repo.current!.write(all);
    try {
      channel.current?.postMessage('changed');
    } catch {
      /* ignore */
    }
    sync.current?.schedule();
  }, []);

  // 初期化
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await openRepository();
      repo.current = r;
      let data;
      try {
        data = await r.load();
      } catch (e) {
        console.error(e);
        toast('保存データを読み込めませんでした。', { tone: 'error' });
        return;
      }
      const today = logicalDate(Date.now(), data.settings.dayStartHour);
      const meta = { ...data.meta };
      let metaChanged = false;
      if (!meta.firstUsedOn) {
        meta.firstUsedOn = today;
        metaChanged = true;
      }
      if (!meta.openedDays.includes(today)) {
        meta.openedDays = [...meta.openedDays, today].slice(-180);
        metaChanged = true;
      }
      if (metaChanged) r.write([{ t: 'kv', key: 'meta', value: meta }]).catch(() => undefined);
      if (cancelled) return;
      setState((s) => ({ ...s, phase: 'ready', ...data, meta, storageKind: r.kind, recovered: !!data.active }));
      if (data.active) navigate('/session');
      if (data.migratedFromV6) toast('複数の習慣に対応しました。これまでの記録は「簿記3級」に引き継いでいます。');
      if (r.kind !== 'memory') void requestPersistence();
      // 同期エンジン（ログイン中のみ動く）
      if (!syncEnabled()) return; // 同期が止まっている間は、エンジンを動かさない（通信しない）
      sync.current = new SyncEngine({
        repo: r,
        getState: () => stateRef.current,
        onStatus: (st) => setState((x) => ({ ...x, sync: st })),
        onApplied: () => void reload(),
      });
      sync.current.start();
    })();
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel(CHANNEL);
      channel.current.onmessage = () => void reload();
    }
    return () => {
      cancelled = true;
      channel.current?.close();
      sync.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commitActive = useCallback(
    async (next: ActiveSession | null) => {
      setState((s) => ({ ...s, active: next }));
      try {
        await repo.current!.write([next ? { t: 'kv', key: 'active', value: next } : { t: 'kvDel', key: 'active' }]);
        try {
          channel.current?.postMessage('changed');
        } catch {
          /* ignore */
        }
      } catch (e) {
        console.error(e);
        toast('計測の状態を保存できませんでした。この画面を閉じずに続けてください。', { tone: 'error' });
      }
    },
    [toast],
  );

  /** 記録の追加・変更の後に節目を確認し、未通知なら一度だけ知らせる */
  const checkMilestone = useCallback(
    async (habitId: string, before: StudyRecord[], after: StudyRecord[]) => {
      const s = stateRef.current;
      const h = s.habits.find((x) => x.id === habitId);
      if (!h) return;
      const v = crossedMilestone(h, habitTotal(h, before), habitTotal(h, after), s.settings);
      if (v == null) return;
      const shown = s.meta.milestonesShown[habitId] ?? [];
      if (shown.includes(v)) return;
      const meta = { ...s.meta, milestonesShown: { ...s.meta.milestonesShown, [habitId]: [...shown, v] } };
      setState((x) => ({ ...x, meta, justMilestone: { habitId, value: v } }));
      toast(`節目：${h.name} が ${h.trackingType === 'time' ? `${v}時間` : `${v}日`} に到達しました。`);
      await repo.current!.write([{ t: 'kv', key: 'meta', value: meta }]).catch(() => undefined);
    },
    [toast],
  );

  const actions = useMemo<Actions>(() => {
    const habitOf = (id: string) => stateRef.current.habits.find((h) => h.id === id);

    async function putRecord(record: StudyRecord, extra: Op[] = [], extraChanges: Parameters<typeof commit>[1] = []) {
      const before = stateRef.current.records;
      await commit([{ t: 'rec', value: record }, ...extra], [{ kind: 'record', id: record.id, payload: record, updatedAt: record.updatedAt }, ...extraChanges]);
      const after = [...before.filter((r) => r.id !== record.id), record];
      setState((s) => ({ ...s, records: [...s.records.filter((r) => r.id !== record.id), record] }));
      if (record.habitId) await checkMilestone(record.habitId, before, after);
    }

    function dayRecord(h: Habit, date: string, kind: 'done' | 'rest', small: CopingPlan | null): StudyRecord {
      const now = new Date().toISOString();
      return {
        id: newId(),
        habitId: h.id,
        kind,
        studyDate: date,
        startedAt: null,
        endedAt: null,
        minutes: 0,
        measuredSeconds: null,
        pausedSeconds: null,
        title: kind === 'rest' ? '休むと決めた日' : small ? small.instead : h.nextAction || h.name,
        note: small ? `こんな日は：${small.when}` : '',
        source: 'manual',
        createdAt: now,
        updatedAt: now,
        mode: small ? 'small' : 'standard',
        fromBookmark: !small && !!h.nextAction,
        cueFollowed: null,
        supportMode: stateRef.current.settings.supportMode,
        openToStartSec: null,
        bookmarkLeft: false,
        plannedDay: isPlannedDay(h, date),
      };
    }

    return {
      async startSession(habitId, mode) {
        const s = stateRef.current;
        if (s.active) {
          navigate('/session');
          return;
        }
        const h = habitOf(habitId);
        if (!h) return;
        const now = Date.now();
        const small = mode.kind === 'small';
        const coping = small ? mode.coping : null;
        const title = small && coping ? coping.instead : h.nextAction;
        const sinceOpen = now - visibleSince;
        const session = createSession({
          mode: small ? 'small' : 'standard',
          habitId,
          copingWhen: coping?.when ?? null,
          title,
          subject: h.name,
          targetMinutes: small ? coping?.minutes ?? TWO_MINUTE_TARGET_MINUTES : h.targetMinutes,
          now,
          fromBookmark: !!h.nextAction && title === h.nextAction,
          openToStartMs: sinceOpen >= 0 && sinceOpen <= OPEN_TO_START_MAX_MS ? sinceOpen : null,
        });
        await commitActive(session);
        setState((x) => ({ ...x, recovered: false, justBookmarked: null, justMilestone: null }));
        navigate('/session');
      },
      pauseSession() {
        const a = stateRef.current.active;
        if (a) void commitActive(pause(a, Date.now()));
      },
      resumeSession() {
        const a = stateRef.current.active;
        if (a) void commitActive(resume(a, Date.now()));
      },
      changeTarget(minutes) {
        const a = stateRef.current.active;
        if (a) void commitActive(setTarget(a, minutes));
      },
      beginFinish() {
        const a = stateRef.current.active;
        if (a) void commitActive(beginCompleting(a, Date.now()));
      },
      cancelFinish() {
        const a = stateRef.current.active;
        if (a) void commitActive(cancelCompleting(a, Date.now()));
      },
      async discardSession() {
        const prev = stateRef.current.active;
        if (!prev) return;
        await commitActive(null);
        navigate('/');
        toast('計測を記録せずに終了しました。', {
          action: {
            label: '元に戻す',
            run: () => {
              if (stateRef.current.active) return;
              void commitActive(prev).then(() => navigate('/session'));
            },
          },
        });
      },
      async saveFinish(input) {
        const s = stateRef.current;
        const a = s.active;
        if (!a) throw new Error('no-active');
        const h = habitOf(a.habitId) ?? s.habits[0];
        if (!h) throw new Error('no-habit');
        const now = Date.now();
        const end = a.completingAt ?? now;
        const nowIso = new Date(now).toISOString();
        const studyDate = logicalDate(a.startedAt, s.settings.dayStartHour);
        const nextAction = cleanText(input.nextAction, LIMITS.nextAction);
        if (s.records.some((r) => r.id === a.id)) {
          await commitActive(null);
          return 'duplicate';
        }
        const record: StudyRecord = {
          id: a.id,
          habitId: h.id,
          kind: 'done',
          studyDate,
          startedAt: new Date(a.startedAt).toISOString(),
          endedAt: new Date(end).toISOString(),
          minutes: input.minutes,
          measuredSeconds: Math.floor(elapsedMs(a, end) / 1000),
          pausedSeconds: Math.floor(pausedTotalMs(a, end) / 1000),
          title: cleanText(input.title, LIMITS.title) || `${h.name}`,
          note: a.copingWhen ? `こんな日は：${a.copingWhen}` : '',
          source: 'timer',
          createdAt: nowIso,
          updatedAt: nowIso,
          mode: a.mode,
          fromBookmark: a.fromBookmark,
          cueFollowed: input.cueFollowed,
          supportMode: s.settings.supportMode,
          openToStartSec: a.openToStartMs == null ? null : Math.round(a.openToStartMs / 1000),
          bookmarkLeft: !!nextAction,
          plannedDay: isPlannedDay(h, studyDate),
        };
        const errs = validateRecordFor(record, h, logicalDate(now, s.settings.dayStartHour));
        if (hasErrors(errs)) throw new ValidationError(errs as Record<string, string>);
        const habit: Habit = { ...h, nextAction, updatedAt: nowIso };
        const habits = s.habits.map((x) => (x.id === h.id ? habit : x));
        const before = s.records;
        await commit(
          [
            { t: 'rec', value: record },
            { t: 'kvDel', key: 'active' },
            { t: 'kv', key: 'habits', value: habits },
          ],
          [
            { kind: 'record', id: record.id, payload: record, updatedAt: nowIso },
            { kind: 'habit', id: habit.id, payload: habit, updatedAt: nowIso },
          ],
        );
        setState((x) => ({
          ...x,
          active: null,
          habits,
          records: [...x.records, record],
          recovered: false,
          justBookmarked: nextAction ? h.id : null,
        }));
        await checkMilestone(h.id, before, [...before, record]);
        return 'saved';
      },
      async markDone(habitId, opts) {
        const s = stateRef.current;
        const h = habitOf(habitId);
        if (!h) return;
        const date = opts?.date ?? todayOf(s.settings);
        const existing = s.records.find((r) => r.habitId === habitId && r.studyDate === date);
        if (existing && (existing.kind ?? 'done') === 'done' && h.trackingType === 'days') {
          toast('この日はすでに記録しています。');
          return;
        }
        const rec = dayRecord(h, date, 'done', opts?.small ?? null);
        // 日数型：同じ日の「休み」は「やった」に置き換える（1日1件）
        const extra: Op[] = existing && h.trackingType === 'days' ? [{ t: 'recDel', id: existing.id }] : [];
        const extraChanges = existing && h.trackingType === 'days' ? [{ kind: 'record' as const, id: existing.id, payload: null }] : [];
        if (existing && h.trackingType === 'days') setState((x) => ({ ...x, records: x.records.filter((r) => r.id !== existing.id) }));
        await putRecord(rec, extra, extraChanges);
        toast(`${h.name}：${opts?.small ? '小さな一手で' : ''}やった日に記録しました。`, {
          action: { label: '取り消す', run: () => void actionsRef.current?.deleteRecord(rec.id, { quiet: true }) },
        });
      },
      async markRest(habitId, date) {
        const s = stateRef.current;
        const h = habitOf(habitId);
        if (!h) return;
        const d = date ?? todayOf(s.settings);
        if (s.records.some((r) => r.habitId === habitId && r.studyDate === d)) {
          toast('この日はすでに記録があります。');
          return;
        }
        const rec = dayRecord(h, d, 'rest', null);
        await putRecord(rec);
        toast(`${h.name}：今日は休むと決めました。積み上げはそのままです。`, {
          action: { label: '取り消す', run: () => void actionsRef.current?.deleteRecord(rec.id, { quiet: true }) },
        });
      },
      async saveHabit(habit) {
        const s = stateRef.current;
        const now = new Date().toISOString();
        const h: Habit = { ...habit, updatedAt: now };
        // 基準値を持てるのは1つだけ
        const habits = s.habits.some((x) => x.id === h.id) ? s.habits.map((x) => (x.id === h.id ? h : x)) : [...s.habits, h];
        await commit([{ t: 'kv', key: 'habits', value: habits }], [{ kind: 'habit', id: h.id, payload: h, updatedAt: now }]);
        setState((x) => ({ ...x, habits }));
      },
      async addHabits(list) {
        const s = stateRef.current;
        const habits = [...s.habits, ...list];
        await commit(
          [{ t: 'kv', key: 'habits', value: habits }],
          list.map((h) => ({ kind: 'habit' as const, id: h.id, payload: h, updatedAt: h.updatedAt })),
        );
        setState((x) => ({ ...x, habits }));
      },
      async updateSettings(patch) {
        const settings = { ...stateRef.current.settings, ...patch, updatedAt: new Date().toISOString() };
        await commit([{ t: 'kv', key: 'appSettings', value: settings }], [{ kind: 'settings', id: 'app', payload: settings, updatedAt: settings.updatedAt }]);
        setState((s) => ({ ...s, settings }));
      },
      async saveRecord(record) {
        const s = stateRef.current;
        const h = record.habitId ? habitOf(record.habitId) : undefined;
        const errs = validateRecordFor(record, h, todayOf(s.settings)) as Record<string, string>;
        if (h?.trackingType === 'days' && hasDayRecord(s.records, h.id, record.studyDate, record.id))
          errs.studyDate = 'この日はすでに記録があります（日数型は1日1件）。';
        if (hasErrors(errs)) throw new ValidationError(errs);
        await putRecord({ ...record, updatedAt: new Date().toISOString() });
      },
      async deleteRecord(id, opts) {
        const prev = stateRef.current.records.find((r) => r.id === id);
        if (!prev) return;
        await commit([{ t: 'recDel', id }], [{ kind: 'record', id, payload: null }]);
        setState((s) => ({ ...s, records: s.records.filter((r) => r.id !== id) }));
        if (opts?.quiet) {
          toast('取り消しました。');
          return;
        }
        toast('記録を削除しました。', {
          action: {
            label: '元に戻す',
            run: () => {
              putRecord({ ...prev, updatedAt: new Date().toISOString() })
                .then(() => toast('削除を取り消しました。'))
                .catch(() => toast('元に戻せませんでした。', { tone: 'error' }));
            },
          },
        });
      },
      async replaceAll(data, reason) {
        const cur = stateRef.current;
        const snapshot: Snapshot = {
          at: new Date().toISOString(),
          reason,
          habits: cur.habits,
          settings: cur.settings,
          records: cur.records,
          reviews: cur.reviews,
        };
        const ops: Op[] = [
          { t: 'kv', key: 'lastSnapshot', value: snapshot },
          { t: 'recClear' },
          ...data.records.map((r) => ({ t: 'rec' as const, value: r })),
          { t: 'kv', key: 'habits', value: data.habits },
          { t: 'kv', key: 'appSettings', value: data.settings },
          { t: 'kv', key: 'reviews', value: data.reviews },
        ];
        // 消去・復元はこの端末だけの操作。サーバーへは削除を送らない（他の端末のデータを消さない）
        await commit(ops);
        setState((x) => ({ ...x, habits: data.habits, settings: data.settings, records: data.records, reviews: data.reviews, lastSnapshot: snapshot }));
      },
      async addRecords(list, habitPatch) {
        const s = stateRef.current;
        const fresh = list.filter((r) => !s.records.some((x) => x.id === r.id));
        let habits = s.habits;
        const ops: Op[] = fresh.map((r) => ({ t: 'rec' as const, value: r }));
        const changes: Parameters<typeof commit>[1] = fresh.map((r) => ({ kind: 'record' as const, id: r.id, payload: r }));
        if (habitPatch) {
          habits = s.habits.map((h) =>
            h.id === habitPatch.habitId
              ? { ...h, nextAction: h.nextAction || habitPatch.nextAction || '', cue: h.cue || habitPatch.cue || '', updatedAt: new Date().toISOString() }
              : h,
          );
          ops.push({ t: 'kv', key: 'habits', value: habits });
          const h = habits.find((x) => x.id === habitPatch.habitId);
          if (h) changes.push({ kind: 'habit', id: h.id, payload: h });
        }
        await commit(ops, changes);
        setState((x) => ({ ...x, habits, records: [...x.records, ...fresh] }));
        return fresh.length;
      },
      async saveReview(input) {
        const s = stateRef.current;
        const today = todayOf(s.settings);
        const review: Review = {
          id: newId(),
          habitId: input.habitId,
          date: today,
          periodStart: addDays(today, -(REVIEW_INTERVAL_DAYS - 1)),
          change: input.change,
          ease: input.ease,
          note: cleanText(input.note, LIMITS.reviewNote),
          createdAt: new Date().toISOString(),
        };
        const meta: Meta = { ...s.meta, lastReviewOn: today, reviewSnoozedOn: null };
        const reviews = [...s.reviews, review];
        await commit(
          [
            { t: 'kv', key: 'reviews', value: reviews },
            { t: 'kv', key: 'meta', value: meta },
          ],
          [{ kind: 'review', id: review.id, payload: review }],
        );
        setState((x) => ({ ...x, meta, reviews }));
      },
      async snoozeReview() {
        const meta: Meta = { ...stateRef.current.meta, reviewSnoozedOn: todayOf(stateRef.current.settings) };
        await commit([{ t: 'kv', key: 'meta', value: meta }]);
        setState((x) => ({ ...x, meta }));
      },
      async markBackup() {
        const meta: Meta = { ...stateRef.current.meta, lastBackupAt: new Date().toISOString() };
        setState((x) => ({ ...x, meta }));
        await repo.current!.write([{ t: 'kv', key: 'meta', value: meta }]).catch(() => undefined);
      },
      async setAccount(account) {
        const ops: Op[] = [account ? { t: 'kv', key: 'account', value: account } : { t: 'kvDel', key: 'account' }];
        if (!account) ops.push({ t: 'outClear' });
        await repo.current!.write(ops);
        setState((x) => ({ ...x, account }));
        if (account) await sync.current?.fullPush();
      },
      async syncNow() {
        await sync.current?.run();
      },
      toast,
      dismissToast,
      clearRecovered() {
        setState((s) => ({ ...s, recovered: false }));
      },
      clearLevelUp() {
        setState((s) => (s.levelUp ? { ...s, levelUp: null } : s));
      },
      clearFlash() {
        setState((s) => (s.justBookmarked || s.justMilestone ? { ...s, justBookmarked: null, justMilestone: null } : s));
      },
    };
  }, [checkMilestone, commit, commitActive, dismissToast, navigate, toast]);

  // つづきぼしの進化：記録が増えて段階が上がったら一度だけお祝いする（下がっても記録はそのまま）
  useEffect(() => {
    if (state.phase !== 'ready' || !repo.current) return;
    const lv = growthOf(state.records).level.level;
    if (lv <= state.meta.levelShown) return;
    const meta = { ...state.meta, levelShown: lv };
    setState((x) => ({ ...x, meta, levelUp: x.settings.characterEnabled ? lv : null }));
    repo.current.write([{ t: 'kv', key: 'meta', value: meta }]).catch(() => undefined);
  }, [state.phase, state.records, state.meta]);

  const actionsRef = useRef<Actions | null>(null);
  actionsRef.current = actions;

  return <Ctx.Provider value={{ state, actions, toasts }}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error('StoreProvider missing');
  return v;
}

/** 1秒ごとに現在時刻を返す（表示更新用。時間計算の根拠ではない）。復帰時は即時更新。 */
export function useNow(enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, 1000);
    const vis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('focus', tick);
    window.addEventListener('pageshow', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('focus', tick);
      window.removeEventListener('pageshow', tick);
    };
  }, [enabled]);
  return now;
}

/** つづきぼしの今の見た目（成長段階・色・使えるアクセサリー） */
export function useChara() {
  const { state } = useStore();
  const g = growthOf(state.records);
  const milestones = Object.values(state.meta.milestonesShown).reduce((n, v) => n + v.length, 0);
  const today = todayOf(state.settings);
  const acc: CharaAccessory = accessoryAvailable(state.settings.charaAccessory, { today, level: g.level.level, milestones }).ok
    ? state.settings.charaAccessory
    : 'none';
  return { growth: g, level: g.level.level, color: state.settings.charaColor, accessory: acc, milestones, today, enabled: state.settings.characterEnabled };
}

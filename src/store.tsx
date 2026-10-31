import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LIMITS, TWO_MINUTE_TARGET_MINUTES } from './lib/config';
import { localDate } from './lib/dates';
import {
  DEFAULT_SETTINGS,
  cleanText,
  hasErrors,
  validateRecord,
  type Settings,
  type StudyRecord,
} from './lib/records';
import {
  beginCompleting,
  cancelCompleting,
  createSession,
  elapsedMs,
  pause,
  pausedTotalMs,
  resume,
  setTarget,
  type ActiveSession,
  type SessionMode,
} from './lib/session';
import { openRepository, requestPersistence, type Repository, type StorageKind } from './lib/storage';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
  action?: { label: string; run: () => void };
}

interface State {
  phase: 'loading' | 'ready';
  settings: Settings;
  active: ActiveSession | null;
  records: StudyRecord[];
  storageKind: StorageKind | null;
  /** 再読み込み後に進行中セッションを復旧したか */
  recovered: boolean;
}

export interface FinishInput {
  minutes: number;
  title: string;
  nextAction: string;
}

interface Actions {
  startSession(mode: SessionMode): Promise<void>;
  pauseSession(): void;
  resumeSession(): void;
  changeTarget(minutes: number): void;
  beginFinish(): void;
  cancelFinish(): void;
  discardSession(): Promise<void>;
  saveFinish(input: FinishInput): Promise<'saved' | 'duplicate'>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  saveRecord(record: StudyRecord): Promise<void>;
  deleteRecord(id: string): Promise<void>;
  replaceAll(settings: Settings, records: StudyRecord[]): Promise<void>;
  addRecords(records: StudyRecord[], settings: Settings): Promise<number>;
  toast(message: string, opts?: { tone?: Toast['tone']; action?: Toast['action'] }): void;
  dismissToast(id: number): void;
  clearRecovered(): void;
}

const Ctx = createContext<{ state: State; actions: Actions; toasts: Toast[] } | null>(null);

const CHANNEL = 'tsuzuku-sync';

export function StoreProvider({ children, navigate }: { children: ReactNode; navigate: (route: string) => void }) {
  const [state, setState] = useState<State>({
    phase: 'loading',
    settings: { ...DEFAULT_SETTINGS },
    active: null,
    records: [],
    storageKind: null,
    recovered: false,
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const repo = useRef<Repository | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const channel = useRef<BroadcastChannel | null>(null);
  const toastSeq = useRef(0);

  const toast = useCallback<Actions['toast']>((message, opts) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-2), { id, message, tone: opts?.tone ?? 'info', action: opts?.action }]);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const broadcast = useCallback(() => {
    try {
      channel.current?.postMessage('changed');
    } catch {
      /* ignore */
    }
  }, []);

  const reload = useCallback(async () => {
    if (!repo.current) return;
    const d = await repo.current.load();
    setState((s) => ({ ...s, ...d }));
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
        data = { settings: { ...DEFAULT_SETTINGS }, active: null, records: [] };
        toast('保存データを読み込めませんでした。', { tone: 'error' });
      }
      if (cancelled) return;
      setState({ phase: 'ready', ...data, storageKind: r.kind, recovered: !!data.active });
      if (data.active) navigate('/session');
      if (r.kind !== 'memory') void requestPersistence();
    })();
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel(CHANNEL);
      channel.current.onmessage = () => void reload();
    }
    return () => {
      cancelled = true;
      channel.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 進行中セッションを更新して保存。保存に失敗しても画面上の計測は続ける。 */
  const commitActive = useCallback(
    async (next: ActiveSession | null) => {
      setState((s) => ({ ...s, active: next }));
      try {
        await repo.current!.saveActive(next);
        broadcast();
      } catch (e) {
        console.error(e);
        toast('計測の状態を保存できませんでした。この画面を閉じずに続けてください。', { tone: 'error' });
      }
    },
    [broadcast, toast],
  );

  const actions = useMemo<Actions>(
    () => ({
      async startSession(mode) {
        const s = stateRef.current;
        if (s.active) {
          navigate('/session');
          return;
        }
        const target = mode === 'two_minute' ? TWO_MINUTE_TARGET_MINUTES : s.settings.targetMinutes;
        const session = createSession({
          mode,
          title: s.settings.nextAction,
          subject: s.settings.subject,
          targetMinutes: target,
          now: Date.now(),
        });
        await commitActive(session);
        setState((x) => ({ ...x, recovered: false }));
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
        const now = Date.now();
        const end = a.completingAt ?? now;
        const subjectFallback = s.settings.subject ? `${s.settings.subject}の学習` : '学習';
        const nowIso = new Date(now).toISOString();
        const record: StudyRecord = {
          id: a.id,
          studyDate: localDate(a.startedAt),
          startedAt: new Date(a.startedAt).toISOString(),
          endedAt: new Date(end).toISOString(),
          minutes: input.minutes,
          measuredSeconds: Math.floor(elapsedMs(a, end) / 1000),
          pausedSeconds: Math.floor(pausedTotalMs(a, end) / 1000),
          title: cleanText(input.title, LIMITS.title) || subjectFallback,
          note: '',
          source: 'timer',
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        const errs = validateRecord(record, localDate(now));
        if (hasErrors(errs)) throw new ValidationError(errs);
        const settings: Settings = { ...s.settings, nextAction: cleanText(input.nextAction, LIMITS.nextAction) };
        const result = await repo.current!.completeSession(record, settings);
        setState((x) => ({
          ...x,
          active: null,
          settings,
          records: result === 'saved' ? [...x.records.filter((r) => r.id !== record.id), record] : x.records,
          recovered: false,
        }));
        broadcast();
        return result;
      },
      async updateSettings(patch) {
        const settings = { ...stateRef.current.settings, ...patch };
        await repo.current!.saveSettings(settings);
        setState((s) => ({ ...s, settings }));
        broadcast();
      },
      async saveRecord(record) {
        const errs = validateRecord(record, localDate());
        if (hasErrors(errs)) throw new ValidationError(errs);
        await repo.current!.putRecord(record);
        setState((s) => ({ ...s, records: [...s.records.filter((r) => r.id !== record.id), record] }));
        broadcast();
      },
      async deleteRecord(id) {
        const prev = stateRef.current.records.find((r) => r.id === id);
        if (!prev) return;
        await repo.current!.deleteRecord(id);
        setState((s) => ({ ...s, records: s.records.filter((r) => r.id !== id) }));
        broadcast();
        toast('記録を削除しました。', {
          action: {
            label: '元に戻す',
            run: () => {
              repo
                .current!.putRecord(prev)
                .then(() => {
                  setState((s) => ({ ...s, records: [...s.records.filter((r) => r.id !== prev.id), prev] }));
                  broadcast();
                  toast('削除を取り消しました。');
                })
                .catch(() => toast('元に戻せませんでした。', { tone: 'error' }));
            },
          },
        });
      },
      async replaceAll(settings, records) {
        await repo.current!.replaceAll(settings, records);
        setState((s) => ({ ...s, settings, records }));
        broadcast();
      },
      async addRecords(records, settings) {
        const n = await repo.current!.addRecords(records, settings);
        await reload();
        broadcast();
        return n;
      },
      toast,
      dismissToast,
      clearRecovered() {
        setState((s) => ({ ...s, recovered: false }));
      },
    }),
    [broadcast, commitActive, dismissToast, navigate, reload, toast],
  );

  return <Ctx.Provider value={{ state, actions, toasts }}>{children}</Ctx.Provider>;
}

export class ValidationError extends Error {
  constructor(public errors: Record<string, string>) {
    super(Object.values(errors)[0] ?? '入力を確認してください。');
  }
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

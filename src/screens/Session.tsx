import { useEffect, useRef, useState } from 'react';
import { AWAY_NOTICE_MS, LIMITS } from '../lib/config';
import { formatClock, formatClockTime, spokenDuration } from '../lib/dates';
import { elapsedMs, isOverTarget, progressRatio, remainingMs, type ActiveSession } from '../lib/session';
import { useNow, useStore } from '../store';
import { Dialog } from '../components/Dialog';
import { FieldError, TopBar, useFocusHeading } from '../components/common';
import { IconCheck, IconPause, IconPlay, IconStop } from '../components/Icons';

export function SessionScreen({ active, navigate }: { active: ActiveSession; navigate: (r: string) => void }) {
  const { state, actions } = useStore();
  const habit = state.habits.find((h) => h.id === active.habitId);
  const habitTarget = habit?.targetMinutes ?? 20;
  const now = useNow(active.status === 'running');
  const [interrupt, setInterrupt] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const [away, setAway] = useState<number | null>(null);
  const hiddenAt = useRef<number | null>(null);
  const h1 = useFocusHeading<HTMLHeadingElement>();

  // 画面を離れていた時間を検知（計測は継続。終了時に修正できることを伝える）
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) hiddenAt.current = Date.now();
      else if (hiddenAt.current) {
        const gone = Date.now() - hiddenAt.current;
        hiddenAt.current = null;
        if (gone >= AWAY_NOTICE_MS && active.status === 'running') setAway(gone);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [active.status]);

  const paused = active.status === 'paused';
  const over = isOverTarget(active, now);
  const elapsed = elapsedMs(active, now);
  const targetMin = active.targetSeconds / 60;
  const targetLabel = formatClock(active.targetSeconds * 1000);
  // 残り時間は切り上げ表示（開始直後に 20:00 と表示し、0 になった時点で目標到達）
  const remainingDisplay = formatClock(Math.ceil(remainingMs(active, now) / 1000) * 1000);
  const ratio = progressRatio(active, now);

  return (
    <div className="screen session">
      <TopBar title={paused ? '一時停止中' : `${habit?.name ?? ''} 計測中`.trim()} onBack={() => navigate('/')} backLabel="ホームに戻る（計測は続きます）" />

      <div className="session-body">
        {state.recovered && (
          <p className="notice" role="status">
            前回の計測を復元しました（{formatClockTime(new Date(active.startedAt).toISOString())} 開始）。
            <button type="button" className="link-btn" onClick={actions.clearRecovered}>
              閉じる
            </button>
          </p>
        )}
        {away != null && (
          <p className="notice" role="status">
            画面を離れていた約{Math.round(away / 60000)}分も計測に含まれています。終了時に実際の時間を修正できます。
            <button type="button" className="link-btn" onClick={() => setAway(null)}>
              閉じる
            </button>
          </p>
        )}

        <div className="session-head">
          <p className="eyebrow">
            {active.mode === 'small' ? '小さな一手' : active.fromBookmark ? 'しおりから' : ''}
            {active.subject && (active.mode === 'small' || active.fromBookmark ? ` · ${active.subject}` : active.subject)}
          </p>
          <h1 className="session-title" ref={h1} tabIndex={-1}>
            {active.title || '内容は終了時に入力できます'}
          </h1>
        </div>

        <div className={`timer${paused ? ' is-paused' : ''}`}>
          <p
            className="timer-clock num"
            role="timer"
            aria-live="off"
            aria-label={over ? `経過時間 ${spokenDuration(elapsed)}` : `残り時間 ${spokenDuration(remainingMs(active, now))}`}
          >
            {over ? formatClock(elapsed) : remainingDisplay}
          </p>
          <p className="timer-label">
            {paused ? '一時停止中 · ' : ''}
            {over ? '経過時間' : '残り時間'} / {over ? `目標 ${targetLabel}` : targetLabel}
            <button type="button" className="link-btn timer-target-btn" onClick={() => setTargetOpen(true)}>
              目標を変更
            </button>
          </p>
          <div
            className="progress"
            role="progressbar"
            aria-label="目標時間に対する進み具合"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(ratio * 100)}
            aria-valuetext={`目標${targetMin}分のうち${Math.floor(elapsed / 60000)}分経過`}
          >
            <span className="progress-fill" style={{ transform: `scaleX(${ratio})` }} />
          </div>
          {over && (
            <p className="timer-over" role="status">
              {active.mode === 'small'
                ? `小さな一手の${targetMin}分になりました。このまま続けても、ここで終えても構いません。`
                : `目標の${targetMin}分を過ぎました。このまま続けることも、終えることもできます。`}
              {active.mode === 'small' && habitTarget > targetMin && (
                <button type="button" className="link-btn" onClick={() => actions.changeTarget(habitTarget)}>
                  目標を{habitTarget}分にする
                </button>
              )}
            </p>
          )}
        </div>

        <div className="session-controls">
          <div className="round-ctl">
            <button
              type="button"
              className={`round-btn${paused ? ' is-on' : ''}`}
              onClick={paused ? actions.resumeSession : actions.pauseSession}
              aria-label={paused ? '再開' : '一時停止'}
            >
              {paused ? <IconPlay size={22} /> : <IconPause size={22} />}
            </button>
            <span className="round-label" aria-hidden="true">
              {paused ? '再開' : '一時停止'}
            </span>
          </div>
          <div className="round-ctl">
            <button type="button" className="round-btn" onClick={() => setInterrupt(true)} aria-label="中断">
              <IconStop size={20} />
            </button>
            <span className="round-label" aria-hidden="true">
              中断
            </span>
          </div>
        </div>
      </div>

      <div className="session-foot">
        <button type="button" className="btn btn-primary btn-xl" onClick={actions.beginFinish}>
          <IconCheck size={20} />
          終える
        </button>
        <p className="foot-caption">実際にやった時間を確認して積み上げます。</p>
      </div>

      <Dialog
        open={interrupt}
        onClose={() => setInterrupt(false)}
        title="計測を中断しますか？"
        role="alertdialog"
        description="「記録せず終了」を選ぶと、今回の計測は破棄されます。"
      >
        <div className="dialog-actions stacked">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-autofocus
            onClick={() => {
              setInterrupt(false);
              actions.beginFinish();
            }}
          >
            記録して終了
          </button>
          <button
            type="button"
            className="btn btn-danger-ghost"
            onClick={() => {
              setInterrupt(false);
              void actions.discardSession();
            }}
          >
            記録せず終了
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setInterrupt(false)}>
            戻る
          </button>
        </div>
      </Dialog>

      <TargetDialog
        open={targetOpen}
        current={targetMin}
        onClose={() => setTargetOpen(false)}
        onSave={(m) => {
          actions.changeTarget(m);
          setTargetOpen(false);
        }}
      />
    </div>
  );
}

function TargetDialog(p: { open: boolean; current: number; onClose: () => void; onSave: (m: number) => void }) {
  const [v, setV] = useState(String(p.current));
  const [err, setErr] = useState('');
  useEffect(() => {
    if (p.open) {
      setV(String(p.current));
      setErr('');
    }
  }, [p.open, p.current]);
  return (
    <Dialog open={p.open} onClose={p.onClose} title="目標時間を変更" description="目標時間は目安です。到達しても自動では終了しません。">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(v);
          if (!Number.isInteger(n) || n < LIMITS.targetMin || n > LIMITS.targetMax) {
            setErr(`${LIMITS.targetMin}〜${LIMITS.targetMax}分の整数で入力してください。`);
            return;
          }
          p.onSave(n);
        }}
        noValidate
      >
        <div className="chips" role="group" aria-label="よく使う目標時間">
          {[10, 15, 20, 30, 45, 60].map((m) => (
            <button type="button" key={m} className={`chip${String(m) === v ? ' is-on' : ''}`} aria-pressed={String(m) === v} onClick={() => setV(String(m))}>
              {m}分
            </button>
          ))}
        </div>
        <label className="field-label" htmlFor="target-min">
          目標時間（分）
        </label>
        <input
          id="target-min"
          className="input input-num"
          type="number"
          inputMode="numeric"
          min={LIMITS.targetMin}
          max={LIMITS.targetMax}
          value={v}
          onChange={(e) => setV(e.target.value)}
          aria-invalid={!!err}
          aria-describedby="target-err"
        />
        <FieldError id="target-err">{err}</FieldError>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={p.onClose}>
            キャンセル
          </button>
          <button type="submit" className="btn btn-primary btn-sm">
            変更する
          </button>
        </div>
      </form>
    </Dialog>
  );
}

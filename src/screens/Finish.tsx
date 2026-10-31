import { useRef, useState } from 'react';
import { LIMITS, LONG_SESSION_WARN_MINUTES } from '../lib/config';
import { formatClockTime, formatMinutes } from '../lib/dates';
import { elapsedMs, pausedTotalMs, suggestedMinutes, type ActiveSession } from '../lib/session';
import { useStore } from '../store';
import { FieldError, TopBar, useFocusHeading } from '../components/common';
import { IconAlert, IconCheck, IconPencil } from '../components/Icons';

type SaveState = 'idle' | 'saving' | 'error' | 'saved';

export function FinishScreen({ active, navigate }: { active: ActiveSession; navigate: (r: string) => void }) {
  const { state, actions } = useStore();
  const end = active.completingAt ?? Date.now();
  const measured = suggestedMinutes(active, end);
  const tooShort = measured < 1;
  const tooLong = measured > LONG_SESSION_WARN_MINUTES;

  const [minutes, setMinutes] = useState(tooShort ? '' : String(Math.min(measured, LIMITS.minutesMax)));
  const [editingTime, setEditingTime] = useState(tooShort || tooLong);
  const [title, setTitle] = useState(active.title);
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<{ minutes?: string; title?: string; next?: string }>({});
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const inFlight = useRef(false);
  const h1 = useFocusHeading<HTMLHeadingElement>();
  const minutesRef = useRef<HTMLInputElement>(null);

  const fallbackTitle = state.settings.subject ? `${state.settings.subject}の学習` : '学習';
  const minutesNum = Number(minutes);
  const pausedMin = Math.floor(pausedTotalMs(active, end) / 60000);

  function validate() {
    const e: typeof errors = {};
    if (!minutes.trim() || !Number.isInteger(minutesNum) || minutesNum < LIMITS.minutesMin || minutesNum > LIMITS.minutesMax)
      e.minutes = `実際に学習した時間を${LIMITS.minutesMin}〜${LIMITS.minutesMax}分の整数で入力してください。`;
    if (title.trim().length > LIMITS.title) e.title = `今日やったことは${LIMITS.title}文字以内で入力してください。`;
    if (next.trim().length > LIMITS.nextAction) e.next = `次の一歩は${LIMITS.nextAction}文字以内で入力してください。`;
    return e;
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    if (inFlight.current) return; // 二重送信防止
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      if (e.minutes) {
        setEditingTime(true);
        requestAnimationFrame(() => minutesRef.current?.focus());
      }
      return;
    }
    inFlight.current = true;
    setSaveState('saving');
    try {
      const result = await actions.saveFinish({ minutes: minutesNum, title, nextAction: next });
      setSaveState('saved');
      navigate('/');
      actions.toast(result === 'duplicate' ? 'この学習はすでに保存済みです。' : `${formatMinutes(minutesNum)}の学習を保存しました。`);
    } catch (err) {
      console.error(err);
      setSaveState('error');
    } finally {
      inFlight.current = false;
    }
  }

  const saving = saveState === 'saving';

  return (
    <div className="screen finish">
      <TopBar title="学習終了" onBack={saving ? undefined : actions.cancelFinish} backLabel="学習中の画面に戻る" />
      <form className="finish-form" onSubmit={save} noValidate>
        <div className="finish-body">
          <span className="check-badge" aria-hidden="true">
            <IconCheck size={24} />
          </span>
          <h1 className="h1 finish-h1" ref={h1} tabIndex={-1}>
            学習を終えました。
          </h1>

          <section className="finish-time" aria-labelledby="time-label">
            <h2 id="time-label" className="eyebrow">
              今回の学習時間
            </h2>
            {!editingTime ? (
              <div className="time-row">
                <p className="big-num">
                  <span className="num">{minutesNum}</span>
                  <span className="unit">分</span>
                </p>
                <button type="button" className="link-btn" onClick={() => {
                  setEditingTime(true);
                  requestAnimationFrame(() => minutesRef.current?.focus());
                }}>
                  <IconPencil size={15} />
                  時間を修正
                </button>
              </div>
            ) : (
              <div className="time-edit">
                <label htmlFor="minutes" className="sr-only">
                  実際に学習した時間（分）
                </label>
                <div className="minutes-input">
                  <input
                    ref={minutesRef}
                    id="minutes"
                    className="input input-num big"
                    type="number"
                    inputMode="numeric"
                    min={LIMITS.minutesMin}
                    max={LIMITS.minutesMax}
                    step={1}
                    value={minutes}
                    placeholder=""
                    onChange={(e) => {
                      setMinutes(e.target.value);
                      if (errors.minutes) setErrors({ ...errors, minutes: undefined });
                    }}
                    aria-invalid={!!errors.minutes}
                    aria-describedby="minutes-help minutes-err"
                    disabled={saving}
                  />
                  <span className="unit" aria-hidden="true">
                    分
                  </span>
                </div>
              </div>
            )}
            <p id="minutes-help" className="help">
              {tooShort
                ? '計測は1分未満でした。記録する場合は、実際に学習した分数を入力してください。'
                : tooLong
                  ? `計測は${formatMinutes(measured)}です。画面を離れていた時間が含まれていれば、実際に学習した時間に直してください。`
                  : `計測 ${formatClockTime(new Date(active.startedAt).toISOString())}〜${formatClockTime(new Date(end).toISOString())}`}
              {!tooShort && !tooLong && pausedMin > 0 ? `（一時停止 ${pausedMin}分を除く）` : ''}
              {!tooShort && !tooLong && elapsedMs(active, end) > 0 ? '。別のことをしていた時間があれば修正できます。' : ''}
            </p>
            <FieldError id="minutes-err">{errors.minutes}</FieldError>
          </section>

          <div className="field">
            <label htmlFor="did" className="field-label">
              今日やったこと
            </label>
            <div className="input-wrap">
              <input
                id="did"
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`例：${fallbackTitle}`}
                aria-invalid={!!errors.title}
                aria-describedby="did-help did-err"
                autoComplete="off"
                disabled={saving}
              />
              <IconPencil size={17} className="input-icon" />
            </div>
            <p id="did-help" className="help">
              {title.trim() ? '必要なら編集できます' : `空欄の場合は「${fallbackTitle}」として記録します`}
            </p>
            <FieldError id="did-err">{errors.title}</FieldError>
          </div>

          <div className="field">
            <label htmlFor="next" className="field-label">
              次の一歩 <span className="optional">任意</span>
            </label>
            <input
              id="next"
              className="input input-accent"
              value={next}
              onChange={(e) => {
                setNext(e.target.value);
                if (errors.next) setErrors({ ...errors, next: undefined });
              }}
              placeholder="例：続きの問題を3問解く"
              aria-invalid={!!errors.next || next.length > LIMITS.nextAction}
              aria-describedby="next-help next-err"
              autoComplete="off"
              enterKeyHint="done"
              disabled={saving}
            />
            <div className="field-meta">
              <p id="next-help" className="help">
                {next.trim() ? '次回はこの内容から始められます' : '次回はこの内容から始められます（空欄なら未設定）'}
              </p>
              <p className={`count${next.length > LIMITS.nextAction ? ' is-over' : ''}`} aria-hidden="true">
                {next.length}/{LIMITS.nextAction}
              </p>
            </div>
            <FieldError id="next-err">
              {errors.next || (next.length > LIMITS.nextAction ? `次の一歩は${LIMITS.nextAction}文字以内で入力してください。` : '')}
            </FieldError>
          </div>
        </div>

        <div className="finish-foot">
          {saveState === 'error' && (
            <p className="save-error" role="alert">
              <IconAlert size={18} />
              保存できませんでした。入力は保持しています。もう一度お試しください。
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-xl" disabled={saving} aria-busy={saving}>
            <IconCheck size={20} />
            {saving ? '保存中…' : saveState === 'error' ? 'もう一度保存する' : '保存して終了'}
          </button>
        </div>
      </form>
    </div>
  );
}

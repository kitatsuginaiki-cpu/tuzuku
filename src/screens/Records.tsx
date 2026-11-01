import { useEffect, useState } from 'react';
import { BASELINE, LIMITS } from '../lib/config';
import { formatClockTime, formatJpDate, formatMinutes, formatShortDate, localDateTimeToIso, parseLocalDate } from '../lib/dates';
import { cleanText, sortRecords, summary14, type StudyRecord } from '../lib/records';
import { formatTotal, habitTotal } from '../lib/accumulate';
import { FIRST_BASELINE_RECORDABLE, isDone, type Habit } from '../lib/model';
import { newId } from '../lib/session';
import { todayOf, useStore, ValidationError } from '../store';
import { Dialog } from '../components/Dialog';
import { FieldError, Logo, useFocusHeading } from '../components/common';
import { IconBook, IconChevronRight, IconGear, IconPlus } from '../components/Icons';

export function Records({ navigate }: { navigate: (r: string) => void }) {
  const { state } = useStore();
  const habits = [...state.habits].sort((a, b) => Number(a.archived) - Number(b.archived) || a.order - b.order);
  const [habitId, setHabitId] = useState<string | null>(habits[0]?.id ?? null);
  const habit = habits.find((h) => h.id === habitId) ?? habits[0];
  const records = habit ? state.records.filter((r) => r.habitId === habit.id) : [];
  const sorted = sortRecords(records);
  const today = todayOf(state.settings);
  const time = habit?.trackingType === 'time';
  const sum = summary14(records.filter(isDone), today);
  const [editing, setEditing] = useState<StudyRecord | 'new' | null>(null);
  const h1 = useFocusHeading<HTMLHeadingElement>();
  const total = habit ? habitTotal(habit, state.records) : null;

  return (
    <div className="screen records">
      <header className="home-header mobile-only">
        <Logo />
        <button type="button" className="icon-btn" aria-label="設定を開く" onClick={() => navigate('/settings')}>
          <IconGear size={22} />
        </button>
      </header>

      <section className="hero records-hero">
        <h1 className="h1 h1-sm" ref={h1} tabIndex={-1}>
          記録
        </h1>
      </section>

      {habits.length === 0 ? (
        <p className="empty">習慣を追加すると、ここに記録が並びます。</p>
      ) : (
        <>
          {habits.length > 1 && (
            <div className="chips habit-pick" role="radiogroup" aria-label="表示する習慣">
              {habits.map((h) => (
                <button type="button" role="radio" key={h.id} aria-checked={habit?.id === h.id} className={`chip${habit?.id === h.id ? ' is-on' : ''}`} onClick={() => setHabitId(h.id)}>
                  {h.name}
                  {h.archived ? '（しまった）' : ''}
                </button>
              ))}
            </div>
          )}

          {habit && total && (
            <section className="total" aria-labelledby="total-label">
              <h2 id="total-label" className="label">
                {habit.name}の積み上げ
              </h2>
              <p className="big-total num">{formatTotal(total)}</p>
              {total.type === 'time' ? (
                habit.baseline ? (
                  <p className="help">
                    {formatJpDate(BASELINE.asOf)}までの確認済み {formatMinutes(BASELINE.minutes)} ＋ このアプリでの記録 {formatMinutes(total.appMinutes)}
                  </p>
                ) : (
                  <p className="help">このアプリでの記録の合計</p>
                )
              ) : (
                <p className="help">やった日の数（休むと決めた日は数えず、減りもしません）</p>
              )}
            </section>
          )}

          {time && sum.minutes > 0 && (
            <section className="summary" aria-labelledby="sum-label">
              <h2 id="sum-label" className="section-title">
                直近14日間
              </h2>
              <dl className="sum-stats">
                <div>
                  <dt>やった日</dt>
                  <dd>
                    <span className="num">{sum.studyDays}</span>日
                  </dd>
                </div>
                <div>
                  <dt>時間</dt>
                  <dd className="num">{formatMinutes(sum.minutes)}</dd>
                </div>
              </dl>
              <SummaryBars days={sum.days} />
            </section>
          )}

          <section className="list" aria-labelledby="list-label">
            <div className="section-head">
              <h2 id="list-label" className="section-title">
                このアプリでの記録
              </h2>
              <span className="count-label">{records.length}件</span>
            </div>

            {sorted.length === 0 ? (
              <div className="empty">
                <IconBook size={30} className="empty-icon" />
                <p className="empty-title">
                  日別の記録は
                  <br />
                  まだありません。
                </p>
                <p className="empty-text">記録すると、ここで振り返れます。</p>
              </div>
            ) : (
              <ul className="record-list">
                {sorted.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="record-item" onClick={() => setEditing(r)}>
                      <span className="record-main">
                        <span className="record-date">
                          {formatShortDate(r.studyDate)}
                          {r.startedAt ? ` ${formatClockTime(r.startedAt)}` : ''}
                          {r.source === 'manual' && time ? ' · 手動' : ''}
                        </span>
                        {(r.mode === 'small' || r.fromBookmark || !isDone(r)) && (
                          <span className="tags">
                            {!isDone(r) && <span className="tag">休み</span>}
                            {r.fromBookmark && isDone(r) && <span className="tag">しおりから</span>}
                            {r.mode === 'small' && <span className="tag">小さな一手</span>}
                          </span>
                        )}
                        <span className="record-title">{r.title}</span>
                        {r.note && <span className="record-note">{r.note}</span>}
                      </span>
                      {time && isDone(r) && <span className="record-min num">{formatMinutes(r.minutes)}</span>}
                      <span className="sr-only">（編集）</span>
                      <IconChevronRight size={18} className="record-chev" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {habit && (
              <button type="button" className="btn btn-quiet" onClick={() => setEditing('new')}>
                <IconPlus size={18} />
                {time ? '計測しなかった時間を記録する' : '過去の日を記録する'}
              </button>
            )}
          </section>
          {habit && <RecordDialog habit={habit} record={editing} onClose={() => setEditing(null)} />}
        </>
      )}
    </div>
  );
}

function SummaryBars({ days }: { days: { date: string; minutes: number }[] }) {
  const max = Math.max(...days.map((d) => d.minutes), 1);
  return (
    <ol className="bars" aria-label="直近14日間の日別学習時間">
      {days.map((d) => {
        const dt = parseLocalDate(d.date);
        return (
          <li key={d.date} className="bar-col">
            <span className="bar-track" aria-hidden="true">
              <span className={`bar${d.minutes ? '' : ' is-zero'}`} style={{ height: d.minutes ? `${Math.max(8, (d.minutes / max) * 100)}%` : undefined }} />
            </span>
            <span className="bar-day" aria-hidden="true">
              {dt.getDate()}
            </span>
            <span className="sr-only">
              {formatShortDate(d.date)} {d.minutes ? formatMinutes(d.minutes) : '記録なし'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RecordDialog({ habit, record, onClose }: { habit: Habit; record: StudyRecord | 'new' | null; onClose: () => void }) {
  const { state, actions } = useStore();
  const time = habit.trackingType === 'time';
  const isNew = record === 'new';
  const open = record !== null;
  const r = record && record !== 'new' ? record : null;
  const today = todayOf(state.settings);
  const [form, setForm] = useState({ date: today, time: '', minutes: '', title: '', note: '', kind: 'done' as 'done' | 'small' | 'rest' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSaveErr('');
    setConfirmDelete(false);
    if (r)
      setForm({ date: r.studyDate, time: formatClockTime(r.startedAt), minutes: String(r.minutes), title: r.title, note: r.note, kind: !isDone(r) ? 'rest' : r.mode === 'small' ? 'small' : 'done' });
    else setForm({ date: today, time: '', minutes: '', title: '', note: '', kind: 'done' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [k]: e.target.value });
    if (errors[k]) setErrors({ ...errors, [k]: '' });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const errs: Record<string, string> = {};
    const minutes = time && form.kind !== 'rest' ? Number(form.minutes) : 0;
    let startedAt: string | null = null;
    if (time && form.time) {
      startedAt = localDateTimeToIso(form.date, form.time);
      if (!startedAt) errs.time = '開始時刻を正しく入力してください。';
    }
    if (form.title.trim().length > LIMITS.title) errs.title = `内容は${LIMITS.title}文字以内で入力してください。`;
    if (form.note.trim().length > LIMITS.note) errs.note = `メモは${LIMITS.note}文字以内で入力してください。`;
    const now = new Date().toISOString();
    const next: StudyRecord = {
      ...(r ?? {
        measuredSeconds: null,
        pausedSeconds: null,
        source: 'manual' as const,
        createdAt: now,
        endedAt: null,
        fromBookmark: false,
        cueFollowed: null,
        supportMode: state.settings.supportMode,
        openToStartSec: null,
        bookmarkLeft: false,
        plannedDay: habit.planDays.includes(parseLocalDate(form.date).getDay()),
      }),
      id: r?.id ?? newId(),
      habitId: habit.id,
      kind: form.kind === 'rest' ? 'rest' : 'done',
      mode: form.kind === 'small' ? 'small' : 'standard',
      studyDate: form.date,
      startedAt,
      endedAt: r && r.startedAt === startedAt && r.minutes === minutes ? r.endedAt : startedAt ? new Date(Date.parse(startedAt) + minutes * 60000).toISOString() : null,
      minutes,
      title: cleanText(form.title, LIMITS.title + 1) || (form.kind === 'rest' ? '休むと決めた日' : time ? '' : habit.name),
      note: cleanText(form.note, LIMITS.note + 1),
      updatedAt: now,
    } as StudyRecord;
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setBusy(true);
    setSaveErr('');
    try {
      await actions.saveRecord(next);
      onClose();
      actions.toast(isNew ? '記録しました。' : '記録を更新しました。');
    } catch (err) {
      if (err instanceof ValidationError) {
        const m: Record<string, string> = {};
        if (err.errors.studyDate) m.date = err.errors.studyDate;
        if (err.errors.minutes) m.minutes = err.errors.minutes;
        if (err.errors.title) m.title = err.errors.title;
        if (err.errors.note) m.note = err.errors.note;
        setErrors(m);
      } else setSaveErr('保存できませんでした。入力は保持しています。もう一度お試しください。');
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!r || busy) return;
    setBusy(true);
    try {
      await actions.deleteRecord(r.id);
      onClose();
    } catch {
      setSaveErr('削除できませんでした。もう一度お試しください。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={isNew ? `${habit.name}を記録する` : '記録を編集'} busy={busy}
      description={isNew ? (time ? 'タイマーを使わなかった時間を、あとから残せます。' : 'つけ忘れた日を、あとから残せます。') : undefined}>
      {confirmDelete && r ? (
        <div>
          <p className="dialog-text">
            「{r.title}」{time && isDone(r) ? `（${formatMinutes(r.minutes)}）` : ''}を削除しますか？ 積み上げから差し引かれます。
          </p>
          <FieldError id="del-err">{saveErr}</FieldError>
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)} disabled={busy} data-autofocus>
              やめる
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={doDelete} disabled={busy}>
              {busy ? '削除中…' : '削除する'}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="record-form">
          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="rec-date">日付</label>
              <input id="rec-date" className="input" type="date" min={habit.baseline ? FIRST_BASELINE_RECORDABLE : undefined} max={today} value={form.date} onChange={set('date')}
                aria-invalid={!!errors.date} aria-describedby="rec-date-err" required />
              <FieldError id="rec-date-err">{errors.date}</FieldError>
            </div>
            {time && (
              <div className="field">
                <label className="field-label" htmlFor="rec-time">開始時刻 <span className="optional">任意</span></label>
                <input id="rec-time" className="input" type="time" value={form.time} onChange={set('time')} aria-invalid={!!errors.time} aria-describedby="rec-time-err" />
                <FieldError id="rec-time-err">{errors.time}</FieldError>
              </div>
            )}
          </div>
          <fieldset className="field">
            <legend className="field-label">この日は</legend>
            <div className="chips" role="radiogroup" aria-label="この日の記録の種類">
              {(time ? ([['done', 'やった'], ['small', '小さな一手']] as const) : ([['done', 'やった'], ['small', '小さな一手'], ['rest', '休むと決めた']] as const)).map(([v, l]) => (
                <button type="button" role="radio" key={v} aria-checked={form.kind === v} className={`chip${form.kind === v ? ' is-on' : ''}`} onClick={() => setForm({ ...form, kind: v })}>
                  {l}
                </button>
              ))}
            </div>
          </fieldset>
          {time && (
            <div className="field">
              <label className="field-label" htmlFor="rec-min">時間（分）</label>
              <input id="rec-min" className="input input-num" type="number" inputMode="numeric" min={1} max={LIMITS.minutesMax} step={1}
                value={form.minutes} onChange={set('minutes')} placeholder="例：20" aria-invalid={!!errors.minutes} aria-describedby="rec-min-err" required />
              <FieldError id="rec-min-err">{errors.minutes}</FieldError>
            </div>
          )}
          <div className="field">
            <label className="field-label" htmlFor="rec-title">内容 {!time && <span className="optional">任意</span>}</label>
            <input id="rec-title" className="input" value={form.title} onChange={set('title')} placeholder={time ? '例：講義#14を見る' : `例：${habit.name}`}
              aria-invalid={!!errors.title} aria-describedby="rec-title-err" autoComplete="off" required={time} />
            <FieldError id="rec-title-err">{errors.title}</FieldError>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="rec-note">メモ <span className="optional">任意</span></label>
            <textarea id="rec-note" className="input textarea" rows={2} value={form.note} onChange={set('note')}
              aria-invalid={!!errors.note} aria-describedby="rec-note-err" />
            <FieldError id="rec-note-err">{errors.note}</FieldError>
          </div>
          {saveErr && <p className="save-error" role="alert">{saveErr}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>キャンセル</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy} aria-busy={busy}>
              {busy ? '保存中…' : isNew ? '記録する' : '変更を保存'}
            </button>
          </div>
          {!isNew && (
            <button type="button" className="btn btn-danger-ghost delete-link" onClick={() => setConfirmDelete(true)} disabled={busy}>
              この記録を削除
            </button>
          )}
          {habit.baseline && (
            <p className="help dialog-foot">2026年10月7日までの学習は確認済みの累計（17時間36分）に含まれているため、10月8日以降の日付で記録します。</p>
          )}
        </form>
      )}
    </Dialog>
  );
}

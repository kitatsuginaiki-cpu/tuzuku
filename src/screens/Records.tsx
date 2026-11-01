import { useEffect, useState } from 'react';
import { BASELINE, LIMITS } from '../lib/config';
import { formatClockTime, formatJpDate, formatMinutes, formatShortDate, localDate, localDateTimeToIso, parseLocalDate } from '../lib/dates';
import {
  FIRST_RECORDABLE_DATE,
  appMinutes,
  cleanText,
  sortRecords,
  summary14,
  totalMinutes,
  type StudyRecord,
} from '../lib/records';
import { newId } from '../lib/session';
import { useStore, ValidationError } from '../store';
import { Dialog } from '../components/Dialog';
import { FieldError, TopBar, useFocusHeading } from '../components/common';
import { IconBook, IconChevronRight, IconPlus } from '../components/Icons';

export function Records({ navigate }: { navigate: (r: string) => void }) {
  const { state } = useStore();
  const { records } = state;
  const sorted = sortRecords(records);
  const total = totalMinutes(records);
  const app = appMinutes(records);
  const today = localDate();
  const sum = summary14(records, today);
  const [editing, setEditing] = useState<StudyRecord | 'new' | null>(null);
  const h1 = useFocusHeading<HTMLHeadingElement>();
  const h = Math.floor(total / 60);
  const m = total % 60;

  return (
    <div className="screen records">
      <div className="mobile-only">
        <TopBar title="記録" onBack={() => navigate('/')} backLabel="今日に戻る" />
      </div>

      <section className="hero records-hero">
        <h1 className="h1" ref={h1} tabIndex={-1}>
          これまでの記録。
        </h1>
        <p className="lead">積み重ねを、確かめる。</p>
      </section>

      <section className="total" aria-labelledby="total-label">
        <h2 id="total-label" className="label">
          確認済みの累計学習時間
        </h2>
        <p className="big-total" aria-label={`${h}時間${m}分`}>
          <span className="num">{h}</span>
          <span className="unit">時間</span>
          <span className="num">{m}</span>
          <span className="unit">分</span>
        </p>
        {app === 0 ? (
          <p className="help">{formatJpDate(BASELINE.asOf)}時点までの記録</p>
        ) : (
          <p className="help">
            {formatJpDate(BASELINE.asOf)}までの {formatMinutes(BASELINE.minutes)} ＋ このアプリでの記録 {formatMinutes(app)}
          </p>
        )}
      </section>

      {sum.minutes > 0 && (
        <section className="summary" aria-labelledby="sum-label">
          <h2 id="sum-label" className="section-title">
            直近14日間
          </h2>
          <dl className="sum-stats">
            <div>
              <dt>学習した日</dt>
              <dd>
                <span className="num">{sum.studyDays}</span>日
              </dd>
            </div>
            <div>
              <dt>学習時間</dt>
              <dd className="num">{formatMinutes(sum.minutes)}</dd>
            </div>
          </dl>
          <SummaryBars days={sum.days} />
        </section>
      )}

      <section className="list" aria-labelledby="list-label">
        <div className="section-head">
          <h2 id="list-label" className="section-title">
            このアプリでの学習記録
          </h2>
          <span className="count-label">{records.length}件</span>
        </div>

        {sorted.length === 0 ? (
          <div className="empty">
            <IconBook size={30} className="empty-icon" />
            <p className="empty-title">
              日別の学習記録は
              <br />
              まだありません。
            </p>
            <p className="empty-text">学習を記録すると、ここで振り返れます。</p>
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
                      {r.category ? ` · ${r.category}` : ''}
                      {r.source === 'manual' ? ' · 手動' : ''}
                    </span>
                    {(r.mode === 'small' || r.fromBookmark) && (
                      <span className="tags">
                        {r.fromBookmark && <span className="tag">しおりから</span>}
                        {r.mode === 'small' && <span className="tag">小さな一手</span>}
                      </span>
                    )}
                    <span className="record-title">{r.title}</span>
                    {r.note && <span className="record-note">{r.note}</span>}
                  </span>
                  <span className="record-min num">{formatMinutes(r.minutes)}</span>
                  <span className="sr-only">（編集）</span>
                  <IconChevronRight size={18} className="record-chev" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <button type="button" className="btn btn-quiet" onClick={() => setEditing('new')}>
          <IconPlus size={18} />
          計測しなかった学習を記録する
        </button>
      </section>

      <RecordDialog record={editing} onClose={() => setEditing(null)} />
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

function RecordDialog({ record, onClose }: { record: StudyRecord | 'new' | null; onClose: () => void }) {
  const { actions } = useStore();
  const isNew = record === 'new';
  const open = record !== null;
  const r = record && record !== 'new' ? record : null;
  const today = localDate();
  const [form, setForm] = useState({ date: today, time: '', minutes: '', title: '', note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSaveErr('');
    setConfirmDelete(false);
    if (r) setForm({ date: r.studyDate, time: formatClockTime(r.startedAt), minutes: String(r.minutes), title: r.title, note: r.note });
    else setForm({ date: today, time: '', minutes: '', title: '', note: '' });
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
    const minutes = Number(form.minutes);
    let startedAt: string | null = null;
    if (form.time) {
      startedAt = localDateTimeToIso(form.date, form.time);
      if (!startedAt) errs.time = '開始時刻を正しく入力してください。';
    }
    if (form.title.trim().length > LIMITS.title) errs.title = `学習内容は${LIMITS.title}文字以内で入力してください。`;
    if (form.note.trim().length > LIMITS.note) errs.note = `メモは${LIMITS.note}文字以内で入力してください。`;
    const now = new Date().toISOString();
    const next: StudyRecord = {
      ...(r ?? { measuredSeconds: null, pausedSeconds: null, source: 'manual' as const, createdAt: now, endedAt: null }),
      id: r?.id ?? newId(),
      studyDate: form.date,
      startedAt,
      endedAt: r && r.startedAt === startedAt && r.minutes === minutes ? r.endedAt : startedAt ? new Date(Date.parse(startedAt) + minutes * 60000).toISOString() : null,
      minutes,
      title: cleanText(form.title, LIMITS.title + 1),
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
      actions.toast(isNew ? '学習を記録しました。' : '記録を更新しました。');
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
    <Dialog open={open} onClose={onClose} title={isNew ? '学習を記録する' : '記録を編集'} busy={busy}
      description={isNew ? 'タイマーを使わなかった学習を、あとから残せます。' : undefined}>
      {confirmDelete && r ? (
        <div>
          <p className="dialog-text">
            「{r.title}」（{formatMinutes(r.minutes)}）を削除しますか？ 累計から差し引かれます。
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
              <label className="field-label" htmlFor="rec-date">学習日</label>
              <input id="rec-date" className="input" type="date" min={FIRST_RECORDABLE_DATE} max={today} value={form.date} onChange={set('date')}
                aria-invalid={!!errors.date} aria-describedby="rec-date-err" required />
              <FieldError id="rec-date-err">{errors.date}</FieldError>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="rec-time">開始時刻 <span className="optional">任意</span></label>
              <input id="rec-time" className="input" type="time" value={form.time} onChange={set('time')} aria-invalid={!!errors.time} aria-describedby="rec-time-err" />
              <FieldError id="rec-time-err">{errors.time}</FieldError>
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="rec-min">学習時間（分）</label>
            <input id="rec-min" className="input input-num" type="number" inputMode="numeric" min={1} max={LIMITS.minutesMax} step={1}
              value={form.minutes} onChange={set('minutes')} placeholder="例：20" aria-invalid={!!errors.minutes} aria-describedby="rec-min-err" required />
            <FieldError id="rec-min-err">{errors.minutes}</FieldError>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="rec-title">学習内容</label>
            <input id="rec-title" className="input" value={form.title} onChange={set('title')} placeholder="例：講義#14を見る"
              aria-invalid={!!errors.title} aria-describedby="rec-title-err" autoComplete="off" required />
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
          <p className="help dialog-foot">2026年10月7日までの学習は確認済みの累計（17時間36分）に含まれているため、10月8日以降の日付で記録します。</p>
        </form>
      )}
    </Dialog>
  );
}

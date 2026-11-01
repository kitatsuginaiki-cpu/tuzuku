import { useState } from 'react';
import { LIMITS } from '../lib/config';
import { formatMinutes, formatShortDate } from '../lib/dates';
import { REVIEW_CHANGE_LABEL, weekFacts, type ReviewChange } from '../lib/plan';
import { todayOf, useStore } from '../store';
import { TopBar, useFocusHeading } from '../components/common';
import { editHabit } from './HabitEditor';
import { habitsDueForReview } from '../lib/today';

/** 見直す習慣（Home から渡す。null なら見直し時期の最初の習慣） */
let target: string | null = null;
export function reviewHabit(id: string | null) {
  target = id;
}

const CHANGES: ReviewChange[] = ['cue', 'action', 'small', 'days', 'none'];

/** 週の見直し：この7日間の「事実」だけを示し、来週ひとつだけ変えることを選ぶ */
export function Review({ navigate }: { navigate: (r: string) => void }) {
  const { state, actions } = useStore();
  const habits = state.habits.filter((h) => !h.archived).sort((a, b) => a.order - b.order);
  const due = habitsDueForReview(habits, state.settings, state.meta, state.records, todayOf(state.settings));
  const [habitId, setHabitId] = useState<string | null>(() => {
    const t = target;
    target = null;
    return (t && habits.some((h) => h.id === t) ? t : null) ?? due[0]?.id ?? habits[0]?.id ?? null;
  });
  const habit = habits.find((h) => h.id === habitId) ?? habits[0];
  const f = weekFacts(
    state.records.filter((r) => r.habitId === habit?.id),
    habit ?? { planDays: [] },
    todayOf(state.settings),
    state.meta.firstUsedOn,
  );
  const time = habit?.trackingType !== 'days';
  const [change, setChange] = useState<ReviewChange | null>(null);
  const [ease, setEase] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const h1 = useFocusHeading<HTMLHeadingElement>();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!change) {
      setErr('来週ひとつだけ変えることを選んでください（「今のままで続ける」も選べます）。');
      document.getElementById('change-cue')?.focus();
      return;
    }
    setBusy(true);
    try {
      await actions.saveReview({ habitId: habit?.id ?? null, change, ease, note });
      if (change === 'none' || !habit) {
        actions.toast('見直しを保存しました。');
        navigate('/');
      } else {
        editHabit(habit.id, change);
        actions.toast(`見直しを保存しました。「${REVIEW_CHANGE_LABEL[change]}」をここで変更できます。`);
        navigate('/habit');
      }
    } catch {
      setErr('保存できませんでした。入力は保持しています。もう一度お試しください。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen review">
      <div className="mobile-only">
        <TopBar title="週の見直し" onBack={() => navigate('/')} backLabel="今日に戻る" />
      </div>
      <section className="hero plan-hero">
        <h1 className="h1 h1-sm" ref={h1} tabIndex={-1}>
          来週、ひとつだけ変えるなら？
        </h1>
        <p className="lead">
          {formatShortDate(f.start)}〜{formatShortDate(f.end)} の事実です。良し悪しの判定はしません。
        </p>
      </section>

      {habits.length > 1 && (
        <div className="chips habit-pick" role="radiogroup" aria-label="見直す習慣">
          {habits.map((h) => (
            <button type="button" role="radio" key={h.id} aria-checked={habit?.id === h.id} className={`chip${habit?.id === h.id ? ' is-on' : ''}`} onClick={() => setHabitId(h.id)}>
              {h.name}
              {due.some((d) => d.id === h.id) && <span className="due-dot">見直し時期</span>}
            </button>
          ))}
        </div>
      )}
      <dl className="facts">
        <div>
          <dt>やった日</dt>
          <dd>
            <span className="num">{f.studyDays}</span>日
            {f.plannedDays > 0 && (
              <span className="facts-sub">
                予定の{f.plannedDays}日のうち {f.plannedDone}日
              </span>
            )}
          </dd>
        </div>
        {time && (
          <div>
            <dt>時間</dt>
            <dd className="num">{formatMinutes(f.minutes)}</dd>
          </div>
        )}
        <div>
          <dt>しおりから始めた</dt>
          <dd>
            <span className="num">{f.fromBookmark}</span>回<span className="facts-sub">全{f.sessions}回中</span>
          </dd>
        </div>
        <div>
          <dt>小さな一手で始めた</dt>
          <dd>
            <span className="num">{f.small}</span>回
          </dd>
        </div>
        <div>
          <dt>きっかけ通りに始めた</dt>
          <dd>
            {f.cueAnswered > 0 ? (
              <>
                <span className="num">{f.cueYes}</span>回<span className="facts-sub">回答した{f.cueAnswered}回のうち</span>
              </>
            ) : (
              <span className="facts-sub">回答なし</span>
            )}
          </dd>
        </div>
      </dl>
      <p className="help">回数が少ないうちは、傾向を判断する材料にはなりません。合わないと感じたところを1つ試しに変える、くらいで十分です。</p>

      <form onSubmit={save} noValidate>
        <fieldset className="plan-block">
          <legend className="section-title">来週ひとつだけ変えること</legend>
          <div className="radio-list">
            {CHANGES.map((c) => (
              <label key={c} className={`radio${change === c ? ' is-on' : ''}`}>
                <input type="radio" id={`change-${c}`} name="change" value={c} checked={change === c} onChange={() => { setChange(c); setErr(''); }} />
                <span>{REVIEW_CHANGE_LABEL[c]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="plan-block">
          <legend className="section-title">
            今週の始めやすさ <span className="optional">任意</span>
          </legend>
          <div className="chips" role="radiogroup" aria-label="始めやすさ（1=始めにくい、5=始めやすい）">
            {[1, 2, 3, 4, 5].map((n) => (
              <button type="button" role="radio" key={n} aria-checked={ease === n} className={`chip num${ease === n ? ' is-on' : ''}`} onClick={() => setEase(ease === n ? null : n)}>
                {n}
              </button>
            ))}
          </div>
          <p className="help">1＝始めにくかった、5＝始めやすかった</p>
          <label className="field-label spaced" htmlFor="review-note">
            メモ <span className="optional">任意</span>
          </label>
          <input id="review-note" className="input" value={note} maxLength={LIMITS.reviewNote} onChange={(e) => setNote(e.target.value)}
            placeholder="例：夜は疲れて始めにくかった" autoComplete="off" />
        </fieldset>

        {err && (
          <p className="save-error" role="alert">
            {err}
          </p>
        )}
        <div className="plan-save">
          <button type="submit" className="btn btn-primary btn-xl" disabled={busy}>
            {busy ? '保存中…' : '見直しを保存'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => actions.snoozeReview(habit ? [habit.id] : []).then(() => navigate('/')).catch(() => setErr('保存できませんでした。'))}>
            今週はしない
          </button>
        </div>
      </form>
    </div>
  );
}

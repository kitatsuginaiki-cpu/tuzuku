import { useEffect, useRef, useState } from 'react';
import { BASELINE, LIMITS } from '../lib/config';
import { formatJpDate } from '../lib/dates';
import { looksVague, planDaysLabel, WEEKDAY_LABELS } from '../lib/plan';
import { blankHabit, HABIT_COLORS, MAX_COPING, type CopingPlan, type Habit, type HabitColor, type TrackingType } from '../lib/model';
import { useStore } from '../store';
import { Dialog } from '../components/Dialog';
import { FieldError, TopBar, useFocusHeading } from '../components/common';

/** 編集対象（null＝新規）。画面遷移の前に設定する */
let target: string | null = null;
/** 週の見直しから「どこを変えるか」 */
let focusField: 'cue' | 'action' | 'small' | 'days' | null = null;
export function editHabit(id: string | null, focus: typeof focusField = null) {
  target = id;
  focusField = focus;
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const COLOR_LABEL: Record<HabitColor, string> = { navy: '紺', green: '緑', teal: '青緑', amber: '山吹', rose: '紅', slate: '灰' };

type CopingForm = { when: string; instead: string; minutes: string };
type Form = {
  name: string;
  trackingType: TrackingType;
  cue: string;
  nextAction: string;
  planDays: number[];
  targetMinutes: string;
  coping: CopingForm[];
  shared: boolean;
  color: HabitColor;
};

function toForm(h: Habit): Form {
  return {
    name: h.name,
    trackingType: h.trackingType,
    cue: h.cue,
    nextAction: h.nextAction,
    planDays: [...h.planDays],
    targetMinutes: String(h.targetMinutes),
    coping: h.copingPlans.map((c) => ({ when: c.when, instead: c.instead, minutes: c.minutes ? String(c.minutes) : '' })),
    shared: h.shared,
    color: h.color,
  };
}

export function HabitEditor({ navigate }: { navigate: (r: string) => void }) {
  const { state, actions } = useStore();
  const [base] = useState<Habit>(() => {
    const found = target ? state.habits.find((h) => h.id === target) : undefined;
    return found ?? blankHabit(state.habits.length);
  });
  const isNew = !state.habits.some((h) => h.id === base.id);
  const hasRecords = state.records.some((r) => r.habitId === base.id);
  const [form, setForm] = useState<Form>(() => toForm(base));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const h1 = useFocusHeading<HTMLHeadingElement>();
  const refs = {
    cue: useRef<HTMLInputElement>(null),
    action: useRef<HTMLInputElement>(null),
    small: useRef<HTMLInputElement>(null),
    days: useRef<HTMLDivElement>(null),
  };

  useEffect(() => {
    const f = focusField;
    focusField = null;
    if (f) {
      const el = refs[f].current;
      el?.scrollIntoView({ block: 'center' });
      (el as HTMLElement | null)?.focus({ preventScroll: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    if (errors[k]) setErrors({ ...errors, [k]: '' });
  };
  const setCoping = (i: number, k: keyof CopingForm, v: string) => setForm({ ...form, coping: form.coping.map((c, j) => (j === i ? { ...c, [k]: v } : c)) });
  const toggleDay = (d: number) =>
    setForm({ ...form, planDays: form.planDays.includes(d) ? form.planDays.filter((x) => x !== d) : [...form.planDays, d].sort() });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const t = (s: string) => s.replace(/\s+/g, ' ').trim();
    const errs: Record<string, string> = {};
    const target = Number(form.targetMinutes);
    const okMin = (n: number) => Number.isInteger(n) && n >= LIMITS.targetMin && n <= LIMITS.targetMax;
    if (!t(form.name)) errs.name = '名前を入力してください。';
    else if (t(form.name).length > LIMITS.subject) errs.name = `名前は${LIMITS.subject}文字以内で入力してください。`;
    if (t(form.cue).length > LIMITS.cue) errs.cue = `きっかけは${LIMITS.cue}文字以内で入力してください。`;
    if (t(form.nextAction).length > LIMITS.nextAction) errs.nextAction = `しおりは${LIMITS.nextAction}文字以内で入力してください。`;
    if (form.trackingType === 'time' && !okMin(target)) errs.targetMinutes = `${LIMITS.targetMin}〜${LIMITS.targetMax}分の整数で入力してください。`;
    form.coping.forEach((c, i) => {
      if (t(c.when).length > LIMITS.smallWhen) errs[`when${i}`] = `${LIMITS.smallWhen}文字以内で入力してください。`;
      if (t(c.instead).length > LIMITS.smallAction) errs[`instead${i}`] = `${LIMITS.smallAction}文字以内で入力してください。`;
      if (!t(c.instead) && t(c.when)) errs[`instead${i}`] = '代わりにやることを入力してください（不要なら組を削除）。';
      if (form.trackingType === 'time' && c.minutes && !okMin(Number(c.minutes))) errs[`minutes${i}`] = `${LIMITS.targetMin}〜${LIMITS.targetMax}分の整数で入力してください。`;
    });
    setErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) {
      document.getElementById(`habit-${first}`)?.focus();
      return;
    }
    const copingPlans: CopingPlan[] = form.coping
      .filter((c) => t(c.instead))
      .map((c) => ({ when: t(c.when), instead: t(c.instead), minutes: form.trackingType === 'time' && c.minutes ? Number(c.minutes) : null }));
    const habit: Habit = {
      ...base,
      name: t(form.name),
      trackingType: hasRecords ? base.trackingType : form.trackingType,
      cue: t(form.cue),
      nextAction: t(form.nextAction),
      planDays: [...form.planDays].sort(),
      targetMinutes: okMin(target) ? target : base.targetMinutes,
      copingPlans,
      shared: form.shared,
      color: form.color,
      baseline: base.baseline && form.trackingType === 'time',
    };
    setBusy(true);
    try {
      await actions.saveHabit(habit);
      actions.toast(isNew ? `「${habit.name}」を追加しました。` : '保存しました。');
      navigate('/');
    } catch {
      actions.toast('保存できませんでした。入力は保持しています。もう一度お試しください。', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    setBusy(true);
    try {
      await actions.saveHabit({ ...base, archived: true, shared: false });
      setArchiveOpen(false);
      actions.toast(`「${base.name}」をしまいました。記録と積み上げは残っています。`, {
        action: { label: '元に戻す', run: () => void actions.saveHabit({ ...base, archived: false }) },
      });
      navigate('/');
    } finally {
      setBusy(false);
    }
  }

  const time = form.trackingType === 'time';
  return (
    <div className="screen plan habit-editor">
      <TopBar title={isNew ? '習慣を追加' : '習慣を編集'} onBack={() => navigate('/')} backLabel="今日に戻る" />
      <section className="hero plan-hero">
        <h1 className="h1 h1-sm" ref={h1} tabIndex={-1}>
          {isNew ? '何を、いつ始める？' : form.name || '習慣'}
        </h1>
        <p className="lead">一度決めれば、毎日入力する必要はありません。合わなければいつでも変えられます。</p>
      </section>

      <form onSubmit={save} noValidate className="plan-form">
        <fieldset className="plan-block">
          <legend className="section-title">名前と記録のしかた</legend>
          <label className="field-label" htmlFor="habit-name">
            名前
          </label>
          <input id="habit-name" className="input" value={form.name} onChange={set('name')} placeholder="例：読書" aria-invalid={!!errors.name}
            aria-describedby="habit-name-err" autoComplete="off" />
          <FieldError id="habit-name-err">{errors.name}</FieldError>
          <div className="seg spaced" role="radiogroup" aria-label="記録のしかた">
            {(
              [
                ['time', '時間で記録', 'タイマーで測って分を積み上げる'],
                ['days', '日数で記録', '「やった」をタップして日を積み上げる'],
              ] as const
            ).map(([v, l, d]) => (
              <label key={v} className={`seg-item${form.trackingType === v ? ' is-on' : ''}${hasRecords ? ' is-locked' : ''}`}>
                <input type="radio" name="tracking" value={v} checked={form.trackingType === v} disabled={hasRecords}
                  onChange={() => setForm({ ...form, trackingType: v })} />
                <span className="seg-name">{l}</span>
                <span className="seg-desc">{d}</span>
              </label>
            ))}
          </div>
          {hasRecords && <p className="help">記録があるため、記録のしかたは変えられません（積み上げの数字が変わらないように）。</p>}
          {base.baseline && time && (
            <p className="help">確認済みの累計（17時間36分・{formatJpDate(BASELINE.asOf)}時点）を土台として含めています。</p>
          )}
        </fieldset>

        <fieldset className="plan-block">
          <legend className="section-title">きっかけ（もし〜したら）</legend>
          <label className="sr-only" htmlFor="habit-cue">
            きっかけ
          </label>
          <input ref={refs.cue} id="habit-cue" className="input" value={form.cue} onChange={set('cue')} placeholder="〇〇したら"
            aria-invalid={!!errors.cue} aria-describedby="habit-cue-help habit-cue-err" autoComplete="off" />
          <p id="habit-cue-help" className="help">毎日ほぼ必ずある出来事の「あと」にすると、思い出しやすくなります。</p>
          <FieldError id="habit-cue-err">{errors.cue}</FieldError>
        </fieldset>

        <fieldset className="plan-block">
          <legend className="section-title">しおり（次の一手）</legend>
          <label className="sr-only" htmlFor="habit-nextAction">
            しおり
          </label>
          <input ref={refs.action} id="habit-nextAction" className="input" value={form.nextAction} onChange={set('nextAction')}
            placeholder="例：第4章を最後まで" aria-invalid={!!errors.nextAction} aria-describedby="habit-next-help habit-nextAction-err" autoComplete="off" />
          <p id="habit-next-help" className="help">
            {looksVague(form.nextAction) ? '「何を・どこまで」を足すと始めやすくなります。' : time ? 'ふだんは終わったときに更新します。' : '次にやることを1つ。終わったら書き換えます。'}
          </p>
          <FieldError id="habit-nextAction-err">{errors.nextAction}</FieldError>
          {time && (
            <div className="field spaced">
              <label className="field-label" htmlFor="habit-targetMinutes">
                ふだんの目標時間（分）
              </label>
              <input id="habit-targetMinutes" className="input input-num" type="number" inputMode="numeric" min={1} max={LIMITS.targetMax}
                value={form.targetMinutes} onChange={set('targetMinutes')} aria-invalid={!!errors.targetMinutes} aria-describedby="habit-targetMinutes-err" />
              <FieldError id="habit-targetMinutes-err">{errors.targetMinutes}</FieldError>
            </div>
          )}
        </fieldset>

        <fieldset className="plan-block">
          <legend className="section-title">予定の曜日</legend>
          <div ref={refs.days} tabIndex={-1} className="chips days" role="group" aria-label="予定の曜日（押すと切り替わります）">
            {DAY_ORDER.map((d) => (
              <button type="button" key={d} className={`chip day${form.planDays.includes(d) ? ' is-on' : ''}`} aria-pressed={form.planDays.includes(d)} onClick={() => toggleDay(d)}>
                {WEEKDAY_LABELS[d]}
              </button>
            ))}
          </div>
          <p className="help">予定：{planDaysLabel(form.planDays)}。予定のない日はキャラクターも気にしません。</p>
        </fieldset>

        <fieldset className="plan-block">
          <legend className="section-title">できない日の組（最大{MAX_COPING}つ）</legend>
          <p className="help">「こんな日は」→「代わりにやること」をセットで。その場で迷わないよう、ごく小さな行動にします。</p>
          {form.coping.map((c, i) => (
            <div key={i} className="coping-edit">
              <div className="field">
                <label className="field-label" htmlFor={`habit-when${i}`}>
                  こんな日は
                </label>
                <input ref={i === 0 ? refs.small : undefined} id={`habit-when${i}`} className="input" value={c.when} onChange={(e) => setCoping(i, 'when', e.target.value)}
                  placeholder="例：疲れている" aria-invalid={!!errors[`when${i}`]} aria-describedby={`habit-when${i}-err`} autoComplete="off" />
                <FieldError id={`habit-when${i}-err`}>{errors[`when${i}`]}</FieldError>
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`habit-instead${i}`}>
                  代わりにやること
                </label>
                <input id={`habit-instead${i}`} className="input" value={c.instead} onChange={(e) => setCoping(i, 'instead', e.target.value)}
                  placeholder="例：1ページだけ読む" aria-invalid={!!errors[`instead${i}`]} aria-describedby={`habit-instead${i}-err`} autoComplete="off" />
                <FieldError id={`habit-instead${i}-err`}>{errors[`instead${i}`]}</FieldError>
              </div>
              {time && (
                <div className="field coping-min">
                  <label className="field-label" htmlFor={`habit-minutes${i}`}>
                    目安（分）
                  </label>
                  <input id={`habit-minutes${i}`} className="input input-num" type="number" inputMode="numeric" min={1} max={LIMITS.targetMax}
                    value={c.minutes} onChange={(e) => setCoping(i, 'minutes', e.target.value)} placeholder="5" aria-invalid={!!errors[`minutes${i}`]}
                    aria-describedby={`habit-minutes${i}-err`} />
                  <FieldError id={`habit-minutes${i}-err`}>{errors[`minutes${i}`]}</FieldError>
                </div>
              )}
              <button type="button" className="link-btn coping-del" onClick={() => setForm({ ...form, coping: form.coping.filter((_, j) => j !== i) })}>
                この組を削除
              </button>
            </div>
          ))}
          {form.coping.length < MAX_COPING && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setForm({ ...form, coping: [...form.coping, { when: '', instead: '', minutes: '' }] })}>
              ＋ 組を追加
            </button>
          )}
        </fieldset>

        <fieldset className="plan-block">
          <legend className="section-title">仲間への共有</legend>
          <label className="switch-row">
            <input type="checkbox" role="switch" checked={form.shared} onChange={(e) => setForm({ ...form, shared: e.target.checked })} aria-describedby="habit-share-help" />
            <span>この習慣を仲間に見せる</span>
          </label>
          <p id="habit-share-help" className="help">
            見せるのは「{['名前', '今日やったか', 'この7日の日数', '積み上げ', ...(state.settings.characterEnabled ? ['キャラクターの表情'] : [])].join('・')}」だけ。メモや時刻、しおりは見せません。既定はオフです。
          </p>
        </fieldset>

        <fieldset className="plan-block">
          <legend className="section-title">色</legend>
          <div className="chips" role="radiogroup" aria-label="色">
            {HABIT_COLORS.map((c) => (
              <button type="button" role="radio" key={c} aria-checked={form.color === c} className={`chip swatch c-${c}${form.color === c ? ' is-on' : ''}`}
                onClick={() => setForm({ ...form, color: c })}>
                <span className="swatch-dot" aria-hidden="true" />
                {COLOR_LABEL[c]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="plan-save">
          <button type="submit" className="btn btn-primary btn-xl" disabled={busy}>
            {busy ? '保存中…' : isNew ? '追加する' : '保存する'}
          </button>
          {!isNew && (
            <button type="button" className="btn btn-danger-ghost" onClick={() => setArchiveOpen(true)} disabled={busy}>
              この習慣をしまう
            </button>
          )}
        </div>
      </form>

      <Dialog open={archiveOpen} onClose={() => setArchiveOpen(false)} title="この習慣をしまいますか？" role="alertdialog" busy={busy}
        description="今日の画面から外れます。記録と積み上げは消えません。仲間への共有はオフになります。">
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setArchiveOpen(false)} disabled={busy}>
            やめる
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={archive} disabled={busy} data-autofocus>
            しまう
          </button>
        </div>
      </Dialog>
    </div>
  );
}

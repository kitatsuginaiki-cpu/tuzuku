import { useEffect, useRef, useState } from 'react';
import { LIMITS } from '../lib/config';
import { looksVague, planDaysLabel, WEEKDAY_LABELS } from '../lib/plan';
import type { Settings } from '../lib/records';
import { useStore } from '../store';
import { FieldError, TopBar, useFocusHeading } from '../components/common';

/** 週の見直しから「どこを変えるか」を受け取る（次に開いたときにその欄へフォーカス） */
export let planFocusTarget: 'cue' | 'action' | 'small' | 'days' | null = null;
export function setPlanFocus(t: typeof planFocusTarget) {
  planFocusTarget = t;
}

const CUE_EXAMPLES = ['昼食後にコーヒーを淹れたら', '帰宅して机に座ったら', '夕食の片づけが終わったら'];
const WHEN_EXAMPLES = ['時間がない・気が重い', '疲れている', '予定が崩れた'];
const SMALL_EXAMPLES = ['1問だけ解く', '前回の問題を1問解き直す', 'テキストを開いて1ページ読む'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

type Form = {
  cue: string;
  nextAction: string;
  smallWhen: string;
  smallAction: string;
  smallMinutes: string;
  targetMinutes: string;
  subject: string;
  planDays: number[];
};

function toForm(s: Settings): Form {
  return {
    cue: s.cue,
    nextAction: s.nextAction,
    smallWhen: s.smallWhen,
    smallAction: s.smallAction,
    smallMinutes: String(s.smallMinutes),
    targetMinutes: String(s.targetMinutes),
    subject: s.subject,
    planDays: [...s.planDays],
  };
}

export function Plan({ navigate }: { navigate: (r: string) => void }) {
  const { state, actions } = useStore();
  const [form, setForm] = useState<Form>(() => toForm(state.settings));
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [busy, setBusy] = useState(false);
  const h1 = useFocusHeading<HTMLHeadingElement>();
  const refs = {
    cue: useRef<HTMLInputElement>(null),
    action: useRef<HTMLInputElement>(null),
    small: useRef<HTMLInputElement>(null),
    days: useRef<HTMLDivElement>(null),
  };

  useEffect(() => {
    const t = planFocusTarget;
    planFocusTarget = null;
    if (t) {
      const el = refs[t].current;
      el?.scrollIntoView({ block: 'center' });
      (el as HTMLElement | null)?.focus({ preventScroll: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    if (errors[k]) setErrors({ ...errors, [k]: undefined });
  };
  const toggleDay = (d: number) =>
    setForm({ ...form, planDays: form.planDays.includes(d) ? form.planDays.filter((x) => x !== d) : [...form.planDays, d].sort() });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const errs: typeof errors = {};
    const t = (s: string) => s.replace(/\s+/g, ' ').trim();
    const target = Number(form.targetMinutes);
    const smallMin = Number(form.smallMinutes);
    const okMin = (n: number) => Number.isInteger(n) && n >= LIMITS.targetMin && n <= LIMITS.targetMax;
    if (t(form.cue).length > LIMITS.cue) errs.cue = `きっかけは${LIMITS.cue}文字以内で入力してください。`;
    if (t(form.nextAction).length > LIMITS.nextAction) errs.nextAction = `次の一手は${LIMITS.nextAction}文字以内で入力してください。`;
    if (t(form.smallWhen).length > LIMITS.smallWhen) errs.smallWhen = `${LIMITS.smallWhen}文字以内で入力してください。`;
    if (t(form.smallAction).length > LIMITS.smallAction) errs.smallAction = `小さな一手は${LIMITS.smallAction}文字以内で入力してください。`;
    if (!okMin(smallMin)) errs.smallMinutes = `${LIMITS.targetMin}〜${LIMITS.targetMax}分の整数で入力してください。`;
    if (!okMin(target)) errs.targetMinutes = `${LIMITS.targetMin}〜${LIMITS.targetMax}分の整数で入力してください。`;
    if (t(form.subject).length > LIMITS.subject) errs.subject = `${LIMITS.subject}文字以内で入力してください。`;
    setErrors(errs);
    if (Object.keys(errs).length) {
      document.getElementById(`plan-${Object.keys(errs)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      await actions.updateSettings({
        cue: t(form.cue),
        nextAction: t(form.nextAction),
        smallWhen: t(form.smallWhen),
        smallAction: t(form.smallAction),
        smallMinutes: smallMin,
        targetMinutes: target,
        subject: t(form.subject),
        planDays: [...form.planDays].sort(),
      });
      actions.toast('プランを保存しました。');
      navigate('/');
    } catch {
      actions.toast('保存できませんでした。入力は保持しています。もう一度お試しください。', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const preview = {
    cue: form.cue.trim() || '〔きっかけ〕',
    act: form.nextAction.trim() || 'しおりの一手',
    when: form.smallWhen.trim() || '時間がない・気が重い',
    small: form.smallAction.trim() || `${form.smallMinutes || '2'}分だけ`,
  };

  return (
    <div className="screen plan">
      <div className="mobile-only">
        <TopBar title="プラン" onBack={() => navigate('/')} backLabel="今日に戻る" />
      </div>
      <section className="hero plan-hero">
        <h1 className="h1 h1-sm" ref={h1} tabIndex={-1}>
          いつ、何から始める？
        </h1>
        <p className="lead">一度決めれば、毎日入力する必要はありません。合わなければいつでも変えられます。</p>
      </section>

      <figure className="plan-preview" aria-label="プランの文（プレビュー）">
        <p>
          もし <mark>{preview.cue}</mark>、<mark>{preview.act}</mark> を始める。
        </p>
        <p>
          {preview.when}日は、<mark>{preview.small}</mark> を <mark>{form.smallMinutes || '–'}分</mark>。
        </p>
        <figcaption className="help">予定：{planDaysLabel(form.planDays)}</figcaption>
      </figure>

      <form onSubmit={save} noValidate className="plan-form">
        <fieldset className="plan-block">
          <legend className="section-title">きっかけ（もし〜したら）</legend>
          <label className="sr-only" htmlFor="plan-cue">
            きっかけ
          </label>
          <input ref={refs.cue} id="plan-cue" className="input" value={form.cue} onChange={set('cue')} placeholder="〇〇したら"
            aria-invalid={!!errors.cue} aria-describedby="plan-cue-help plan-cue-err" autoComplete="off" />
          <p id="plan-cue-help" className="help">毎日ほぼ必ずある出来事の「あと」にすると、思い出しやすくなります。</p>
          <FieldError id="plan-cue-err">{errors.cue}</FieldError>
          <div className="chips" role="group" aria-label="きっかけの例">
            {CUE_EXAMPLES.map((c) => (
              <button type="button" key={c} className={`chip${form.cue === c ? ' is-on' : ''}`} aria-pressed={form.cue === c} onClick={() => setForm({ ...form, cue: c })}>
                {c}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="plan-block">
          <legend className="section-title">この一手（しおり）</legend>
          <label className="sr-only" htmlFor="plan-nextAction">
            次の一手
          </label>
          <input ref={refs.action} id="plan-nextAction" className="input" value={form.nextAction} onChange={set('nextAction')}
            placeholder="例：第11章の仕訳問題を3問解く" aria-invalid={!!errors.nextAction} aria-describedby="plan-next-help plan-nextAction-err" autoComplete="off" />
          <p id="plan-next-help" className="help">
            {looksVague(form.nextAction) ? '「何を・どこまで」を足すと始めやすくなります（例：第11章の問題を3問）。' : 'ふだんは学習の終わりに更新します。'}
          </p>
          <FieldError id="plan-nextAction-err">{errors.nextAction}</FieldError>
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
          <p className="help">予定の日に学習できたかは、週の見直しで事実として確認できます。予定外の日に学習しても問題ありません。</p>
        </fieldset>

        <fieldset className="plan-block">
          <legend className="section-title">できない日の小さな一手</legend>
          <label className="field-label" htmlFor="plan-smallWhen">
            こんな日は
          </label>
          <input id="plan-smallWhen" className="input" value={form.smallWhen} onChange={set('smallWhen')} aria-invalid={!!errors.smallWhen}
            aria-describedby="plan-smallWhen-err" autoComplete="off" />
          <FieldError id="plan-smallWhen-err">{errors.smallWhen}</FieldError>
          <div className="chips" role="group" aria-label="こんな日の例">
            {WHEN_EXAMPLES.map((c) => (
              <button type="button" key={c} className={`chip${form.smallWhen === c ? ' is-on' : ''}`} aria-pressed={form.smallWhen === c} onClick={() => setForm({ ...form, smallWhen: c })}>
                {c}
              </button>
            ))}
          </div>
          <label className="field-label spaced" htmlFor="plan-smallAction">
            代わりにやること
          </label>
          <input ref={refs.small} id="plan-smallAction" className="input" value={form.smallAction} onChange={set('smallAction')}
            placeholder="例：1問だけ解く" aria-invalid={!!errors.smallAction} aria-describedby="plan-small-help plan-smallAction-err" autoComplete="off" />
          <p id="plan-small-help" className="help">空欄のままなら「2分だけ」になります。その場で迷わずに済むよう、ごく小さな行動にします。</p>
          <FieldError id="plan-smallAction-err">{errors.smallAction}</FieldError>
          <div className="chips" role="group" aria-label="代わりにやることの例">
            {SMALL_EXAMPLES.map((c) => (
              <button type="button" key={c} className={`chip${form.smallAction === c ? ' is-on' : ''}`} aria-pressed={form.smallAction === c} onClick={() => setForm({ ...form, smallAction: c })}>
                {c}
              </button>
            ))}
          </div>
          <div className="field-row spaced">
            <div className="field">
              <label className="field-label" htmlFor="plan-smallMinutes">
                小さな一手の時間（分）
              </label>
              <input id="plan-smallMinutes" className="input input-num" type="number" inputMode="numeric" min={1} max={LIMITS.targetMax}
                value={form.smallMinutes} onChange={set('smallMinutes')} aria-invalid={!!errors.smallMinutes} aria-describedby="plan-smallMinutes-err" />
              <FieldError id="plan-smallMinutes-err">{errors.smallMinutes}</FieldError>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="plan-targetMinutes">
                ふだんの目標時間（分）
              </label>
              <input id="plan-targetMinutes" className="input input-num" type="number" inputMode="numeric" min={1} max={LIMITS.targetMax}
                value={form.targetMinutes} onChange={set('targetMinutes')} aria-invalid={!!errors.targetMinutes} aria-describedby="plan-targetMinutes-err" />
              <FieldError id="plan-targetMinutes-err">{errors.targetMinutes}</FieldError>
            </div>
          </div>
          <p className="help">どちらも目安です。時間になっても自動では終了・記録しません。</p>
        </fieldset>

        <fieldset className="plan-block">
          <legend className="section-title">学習対象</legend>
          <label className="sr-only" htmlFor="plan-subject">
            学習対象
          </label>
          <input id="plan-subject" className="input" value={form.subject} onChange={set('subject')} aria-invalid={!!errors.subject}
            aria-describedby="plan-subject-err" autoComplete="off" />
          <FieldError id="plan-subject-err">{errors.subject}</FieldError>
        </fieldset>

        <div className="plan-save">
          <button type="submit" className="btn btn-primary btn-xl" disabled={busy}>
            {busy ? '保存中…' : 'プランを保存'}
          </button>
        </div>
      </form>
    </div>
  );
}

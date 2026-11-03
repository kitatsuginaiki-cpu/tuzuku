import { useEffect, useState } from 'react';
import { BASELINE } from '../lib/config';
import { formatClock, formatJpDate, formatShortDate } from '../lib/dates';
import { defaultSmall } from '../lib/plan';
import { habitsDueForReview, shouldPromptRest, todayView, type HabitToday } from '../lib/today';
import { elapsedMs } from '../lib/session';
import { formatTotal, habitTotal, type DayStatus } from '../lib/accumulate';
import { lineFor, moodFor, MOOD_LABEL } from '../lib/character';
import { HABIT_TEMPLATES, habitFromTemplate, MAX_HABITS, type CopingPlan, type Habit } from '../lib/model';
import { todayOf, useChara, useNow, useStore } from '../store';
import { Logo, useFocusHeading } from '../components/common';
import { Dialog } from '../components/Dialog';
import { CharacterFace } from '../components/Character';
import { IconCheck, IconChevronRight, IconClock, IconGear, IconPencil, IconPlay } from '../components/Icons';
import { editHabit } from './HabitEditor';
import { reviewHabit } from './Review';
import { StorageNotice } from '../components/StorageNotice';

const STATUS_LABEL: Record<Exclude<DayStatus, null>, string> = { done: 'やった', small: '小さな一手', rest: '休みの日' };

export function Home({ navigate }: { navigate: (r: string) => void }) {
  const { state, actions } = useStore();
  const { settings, records, active, meta, habits } = state;
  const today = todayOf(settings);
  const now = useNow(true);
  const h1 = useFocusHeading<HTMLHeadingElement>();
  const list = habits.filter((h) => !h.archived).sort((a, b) => a.order - b.order);
  const [coping, setCoping] = useState<Habit | null>(null);
  const chara = useChara();

  useEffect(() => {
    if (!state.justBookmarked && !state.justMilestone) return;
    const t = window.setTimeout(actions.clearFlash, 4000);
    return () => window.clearTimeout(t);
  }, [state.justBookmarked, state.justMilestone, actions]);

  const hour = new Date(now - settings.dayStartHour * 3600_000).getHours();
  const mood = moodFor({
    habits: list,
    records,
    settings,
    today,
    hour,
    firstUsedOn: meta.firstUsedOn,
    sessionActive: !!active,
    justMilestone: !!state.justMilestone,
  });
  const view = todayView(habits, records, today, active?.habitId ?? null);
  const due = list.length > 0 ? habitsDueForReview(list, settings, meta, records, today) : [];

  return (
    <div className="screen home v7">
      <header className="home-header mobile-only">
        <Logo />
        <button type="button" className="icon-btn" aria-label="設定を開く" onClick={() => navigate('/settings')}>
          <IconGear size={22} />
        </button>
      </header>
      <h1 id="home-h1" className="sr-only" ref={h1} tabIndex={-1}>
        今日
      </h1>
      <p className="today-line">{formatShortDate(today)}</p>
      <StorageNotice navigate={navigate} />

      {settings.characterEnabled && list.length > 0 && (
        <section className={`buddy is-${mood.mood}`} aria-label={`${chara.name}のようす`}>
          <CharacterFace mood={mood.mood} level={chara.level} kind={chara.kind} size={124} />
          <div className="buddy-talk">
            <p className="buddy-name">
              {chara.name}
              <span className="lv-badge">
                Lv.{chara.level} {chara.growth.level.name}
              </span>
            </p>
            <p className="buddy-line">{lineFor(mood.mood, today)}</p>
            <p className="buddy-fact">
              <span className="sr-only">{MOOD_LABEL[mood.mood]}。</span>
              {mood.doneToday
                ? '今日の記録があります'
                : mood.missed >= 2
                  ? `予定の日に${mood.missed}日、記録がありません`
                  : mood.plannedToday
                    ? '今日は予定の日です'
                    : '今日は予定のない日です'}
            </p>
            {chara.growth.next ? (
              <div className="buddy-grow">
                <span className="buddy-grow-text">
                  次の進化 Lv.{chara.growth.next.level} まで あと<span className="num">{chara.growth.left}</span>日
                </span>
                <span className="grow-bar" aria-hidden="true">
                  <span style={{ transform: `scaleX(${Math.max(0.04, chara.growth.ratio)})` }} />
                </span>
              </div>
            ) : (
              <p className="buddy-grow-text">いちばん輝く姿になりました（つづけた日 {chara.growth.days}日）</p>
            )}
          </div>
        </section>
      )}

      {active && (
        <section className="active-row" aria-label="計測中">
          <p className="active-note" role="status">
            <span className={`dot${active.status === 'running' ? ' is-live' : ''}`} aria-hidden="true" />
            {habits.find((h) => h.id === active.habitId)?.name ?? ''}
            {active.status === 'running' ? ' 計測中' : active.status === 'paused' ? ' 一時停止中' : ' 終了の確認中'}
            <span className="num">（{formatClock(elapsedMs(active, now))}）</span>
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/session')}>
            <IconPlay size={18} />
            計測の画面へ
          </button>
        </section>
      )}

      {list.length === 0 ? (
        <Onboarding navigate={navigate} />
      ) : (
        <>
          {(
            [
              ['todo', '今日やること', view.todo],
              ['unplanned', '予定のない習慣', view.unplanned],
              ['done', '今日の記録済み', view.done],
            ] as const
          ).map(([key, title, items]) =>
            items.length === 0 ? (
              key === 'todo' && view.done.length > 0 ? (
                <p key={key} className="all-done">
                  <IconCheck size={18} />
                  今日の予定はすべて記録しました。
                </p>
              ) : null
            ) : (
              <section key={key} className={`habit-group is-${key}`} aria-labelledby={`g-${key}`}>
                <h2 id={`g-${key}`} className="group-title">
                  {title}
                  <span className="group-count">{items.length}</span>
                </h2>
                <ul className="habit-list">
                  {items.map((it) => (
                    <HabitCard key={it.habit.id} item={it} today={today} navigate={navigate} onCoping={() => setCoping(it.habit)} />
                  ))}
                </ul>
              </section>
            ),
          )}
          {list.length < MAX_HABITS && (
            <button type="button" className="btn btn-ghost add-habit" onClick={() => { editHabit(null); navigate('/habit'); }}>
              ＋ 習慣を追加
            </button>
          )}
        </>
      )}

      {due.length > 0 && <ReviewRow habits={due} navigate={navigate} />}
      <CopingDialog habit={coping} today={today} onClose={() => setCoping(null)} navigate={navigate} />
    </div>
  );
}

function HabitCard({ item, today, navigate, onCoping }: { item: HabitToday; today: string; navigate: (r: string) => void; onCoping: () => void }) {
  const { state, actions } = useStore();
  const [busy, setBusy] = useState(false);
  const h = item.habit;
  const st = item.status;
  const planned = item.planned;
  const total = habitTotal(h, state.records);
  const resume = item.resume;
  const restPrompt = shouldPromptRest(item.rest, state.meta.restPromptDismissed[h.id]);
  const compact = item.group === 'done' && h.trackingType === 'days';
  const time = h.trackingType === 'time';
  const firstCoping: CopingPlan = h.copingPlans[0] ?? { when: '時間がない・気が重い', instead: defaultSmall(h).label, minutes: time ? defaultSmall(h).minutes : null };
  const flash = state.justBookmarked === h.id || state.justMilestone?.habitId === h.id;
  const isActive = state.active?.habitId === h.id;
  const todayRec = state.records.find((r) => r.habitId === h.id && r.studyDate === today);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      actions.toast('保存できませんでした。もう一度お試しください。', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const statusText = st ? STATUS_LABEL[st] : planned ? '予定の日' : '予定外の日';
  const showCue = state.settings.supportMode === 'plan' && !!h.cue;
  const headingId = `hc-${h.id}`;
  return (
    <li className={`habit-card c-${h.color}${st ? ` is-${st}` : ''}${flash ? ' is-new' : ''}${compact ? ' is-compact' : ''}`} aria-labelledby={headingId}>
      <div className="hc-head">
        <h3 id={headingId} className="hc-name">
          {h.name}
        </h3>
        <span className={`hc-status${st ? ' is-on' : ''}`}>
          {st && st !== 'rest' && <IconCheck size={14} />}
          {statusText}
        </span>
      </div>
      <p className="hc-total">
        <span className="hc-total-label">積み上げ</span>
        <span className="num">{formatTotal(total)}</span>
        {h.trackingType === 'time' && h.baseline && <span className="hc-sub">（{formatJpDate(BASELINE.asOf)}までの確認済みを含む）</span>}
      </p>
      {restPrompt && item.rest && (
        <div className="hc-rest" role="group" aria-labelledby={`${headingId}-rest`}>
          <p id={`${headingId}-rest`} className="hc-panel-title">
            休むと決めた日が{item.rest.count}日続いています
          </p>
          <p className="hc-panel-text">休むのは悪いことではありません。今の予定が合っているか、見直してみませんか？</p>
          <div className="row-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { editHabit(h.id, 'days'); navigate('/habit'); }}>
              予定の曜日を見直す
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { editHabit(h.id, 'small'); navigate('/habit'); }}>
              一手を小さくする
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => item.rest && run(() => actions.dismissRestPrompt(h.id, item.rest!))}>
              このままでいい
            </button>
          </div>
        </div>
      )}
      {!compact && (showCue || h.nextAction) && (
        <dl className="hc-plan">
          {showCue && (
            <div>
              <dt>もし</dt>
              <dd>{h.cue}</dd>
            </div>
          )}
          {h.nextAction && (
            <div>
              <dt>しおり</dt>
              <dd className={flash && state.justBookmarked === h.id ? 'is-new' : ''}>{h.nextAction}</dd>
            </div>
          )}
        </dl>
      )}
      {resume && !isActive ? (
        <div className="hc-resume" role="group" aria-labelledby={`${headingId}-resume`}>
          <p id={`${headingId}-resume`} className="hc-panel-title">
            また、ここから。
          </p>
          <p className="hc-panel-text">
            最後の記録：{formatShortDate(resume.lastDate)}
            {h.nextAction ? '。しおりは残っています。' : '。'}
          </p>
          <ul className="choices">
            <li>
              <button type="button" className="choice is-main" disabled={busy || (time && !!state.active)}
                onClick={() => run(() => (time ? actions.startSession(h.id, { kind: 'standard' }) : actions.markDone(h.id)))}>
                <span className="choice-main">
                  <span className="choice-name">{time ? (h.nextAction ? 'しおりから始める' : '始める') : 'やった'}</span>
                  <span className="choice-desc">{h.nextAction || (time ? '内容は終わったときに残せます' : h.name)}</span>
                </span>
                {time ? <IconPlay size={18} /> : <IconCheck size={18} />}
              </button>
            </li>
            <li>
              <button type="button" className="choice" disabled={busy || (time && !!state.active)}
                onClick={() => run(() => (time ? actions.startSession(h.id, { kind: 'small', coping: firstCoping }) : actions.markDone(h.id, { small: firstCoping })))}>
                <span className="choice-main">
                  <span className="choice-name">{time ? '小さな一手で始める' : '小さな一手でやった'}</span>
                  <span className="choice-desc">
                    {firstCoping.instead}
                    {time && firstCoping.minutes ? `（${firstCoping.minutes}分）` : ''}
                  </span>
                </span>
                <IconClock size={18} />
              </button>
            </li>
            <li>
              <button type="button" className="choice" onClick={() => { editHabit(h.id); navigate('/habit'); }}>
                <span className="choice-main">
                  <span className="choice-name">プランを見直す</span>
                  <span className="choice-desc">きっかけ・一手の大きさ・曜日</span>
                </span>
                <IconChevronRight size={18} />
              </button>
            </li>
          </ul>
          <div className="hc-actions">
            <button type="button" className="link-btn" onClick={onCoping}>
              ほかの小さな一手・今日は休む
            </button>
            <button type="button" className="icon-btn hc-edit" aria-label={`${h.name}を編集`} onClick={() => { editHabit(h.id); navigate('/habit'); }}>
              <IconPencil size={18} />
            </button>
          </div>
        </div>
      ) : (
      <div className="hc-actions">
        {h.trackingType === 'time' ? (
          isActive ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/session')}>
              <IconPlay size={18} />
              計測中の画面へ
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy || !!state.active}
              onClick={() => run(() => actions.startSession(h.id, { kind: 'standard' }))}
            >
              <IconPlay size={18} />
              {h.nextAction ? 'しおりから始める' : '始める'}
            </button>
          )
        ) : st === 'done' || st === 'small' ? (
          <p className="hc-done">
            <IconCheck size={18} />
            今日はやった
            {todayRec && (
              <button type="button" className="link-btn" onClick={() => run(() => actions.deleteRecord(todayRec.id, { quiet: true }))}>
                取り消す
              </button>
            )}
          </p>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => actions.markDone(h.id))}>
            <IconCheck size={18} />
            やった
          </button>
        )}
        {!(h.trackingType === 'days' && (st === 'done' || st === 'small')) && !isActive && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCoping} disabled={busy || (h.trackingType === 'time' && !!state.active)}>
            <IconClock size={17} />
            できない日は
          </button>
        )}
        <button
          type="button"
          className="icon-btn hc-edit"
          aria-label={`${h.name}を編集`}
          onClick={() => {
            editHabit(h.id);
            navigate('/habit');
          }}
        >
          <IconPencil size={18} />
        </button>
      </div>
      )}
    </li>
  );
}

/** できない日の組：こんな日は → 代わりにやること。休むと決める日も選べる */
function CopingDialog({ habit, today, onClose, navigate }: { habit: Habit | null; today: string; onClose: () => void; navigate: (r: string) => void }) {
  const { state, actions } = useStore();
  const [busy, setBusy] = useState(false);
  const h = habit;
  const plans: CopingPlan[] = h
    ? h.copingPlans.length
      ? h.copingPlans
      : [{ when: '時間がない・気が重い', instead: defaultSmall(h).label, minutes: h.trackingType === 'time' ? defaultSmall(h).minutes : null }]
    : [];
  const hasToday = !!h && state.records.some((r) => r.habitId === h.id && r.studyDate === today);

  async function pick(c: CopingPlan) {
    if (!h || busy) return;
    setBusy(true);
    try {
      if (h.trackingType === 'time') await actions.startSession(h.id, { kind: 'small', coping: c });
      else await actions.markDone(h.id, { small: c });
      onClose();
    } catch (e) {
      console.error(e);
      actions.toast('保存できませんでした。もう一度お試しください。', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function rest() {
    if (!h || busy) return;
    setBusy(true);
    try {
      await actions.markRest(h.id);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!h} onClose={onClose} title={h ? `${h.name}：できない日は` : ''} busy={busy} description="今日の状態に近いものを選んでください。">
      <ul className="coping-list">
        {plans.map((c, i) => (
          <li key={i}>
            <button type="button" className="choice" onClick={() => pick(c)} disabled={busy}>
              <span className="choice-main">
                <span className="choice-name">{c.when || 'こんな日'}なら</span>
                <span className="choice-desc">
                  {c.instead}
                  {h?.trackingType === 'time' && c.minutes ? `（${c.minutes}分）` : ''}
                </span>
              </span>
              {h?.trackingType === 'time' ? <IconPlay size={18} /> : <IconCheck size={18} />}
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="choice is-rest" onClick={rest} disabled={busy || hasToday}>
            <span className="choice-main">
              <span className="choice-name">今日は休むと決める</span>
              <span className="choice-desc">{hasToday ? '今日はすでに記録があります' : '積み上げは減りません。途切れとして数えません。'}</span>
            </span>
            <IconChevronRight size={18} />
          </button>
        </li>
      </ul>
      <div className="dialog-actions">
        {h && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              editHabit(h.id);
              onClose();
              navigate('/habit');
            }}
          >
            組を編集する
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          閉じる
        </button>
      </div>
    </Dialog>
  );
}

/** はじめて：一緒に考えた5つの案から選ぶ（自動では作らない） */
function Onboarding({ navigate }: { navigate: (r: string) => void }) {
  const { actions } = useStore();
  const [picked, setPicked] = useState<string[]>([]);
  const [useBaseline, setUseBaseline] = useState(true);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!picked.length || busy) return;
    setBusy(true);
    try {
      const list = HABIT_TEMPLATES.filter((t) => picked.includes(t.key)).map((t, i) => habitFromTemplate(t, i, useBaseline));
      await actions.addHabits(list);
      actions.toast(`${list.length}つの習慣を用意しました。きっかけやしおりは✎から変えられます。`);
    } catch {
      actions.toast('保存できませんでした。もう一度お試しください。', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="onboarding" aria-labelledby="ob-title">
      <h2 id="ob-title" className="h2">
        何をつづけますか？
      </h2>
      <p className="lead">選んだものだけ作ります。あとで名前・きっかけ・できない日の組を変えられます。</p>
      <fieldset className="ob-list">
        <legend className="sr-only">習慣の案</legend>
        {HABIT_TEMPLATES.map((t) => {
          const on = picked.includes(t.key);
          return (
            <label key={t.key} className={`ob-item${on ? ' is-on' : ''}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => setPicked(on ? picked.filter((k) => k !== t.key) : [...picked, t.key])}
              />
              <span className="ob-main">
                <span className="ob-name">
                  {t.name}
                  <span className="badge">{t.trackingType === 'time' ? '時間で記録' : '日数で記録'}</span>
                </span>
                <span className="ob-desc">もし：{t.cue}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {picked.includes('boki') && (
        <label className="check-row">
          <input type="checkbox" checked={useBaseline} onChange={(e) => setUseBaseline(e.target.checked)} />
          <span>
            簿記に、確認済みの累計 17時間36分（{formatJpDate(BASELINE.asOf)}時点）を土台として含める
          </span>
        </label>
      )}
      <div className="ob-actions">
        <button type="button" className="btn btn-primary" onClick={create} disabled={!picked.length || busy} aria-busy={busy}>
          {picked.length ? `${picked.length}つの習慣ではじめる` : '習慣を選んでください'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => { editHabit(null); navigate('/habit'); }}>
          自分で作る
        </button>
      </div>
    </section>
  );
}

function ReviewRow({ habits, navigate }: { habits: Habit[]; navigate: (r: string) => void }) {
  const { actions } = useStore();
  return (
    <section className="review-row" aria-labelledby="review-row-title">
      <div>
        <h2 id="review-row-title" className="review-row-title">
          週の見直し（1分）
        </h2>
        <p className="help">
          {habits.map((h) => h.name).join('・')}：この7日間の事実を見て、来週ひとつだけ変えます。
        </p>
      </div>
      <div className="review-row-actions">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => { reviewHabit(habits[0].id); navigate('/review'); }}>
          見直す
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => actions.snoozeReview(habits.map((h) => h.id)).catch(() => actions.toast('保存できませんでした。', { tone: 'error' }))}
        >
          今週はしない
        </button>
      </div>
    </section>
  );
}

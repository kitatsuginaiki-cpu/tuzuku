import { useEffect, useState } from 'react';
import { LIMITS } from '../lib/config';
import { formatClock, formatShortDate, localDate } from '../lib/dates';
import { homeMode, lastStudyDate } from '../lib/records';
import { isPlannedDay, isReviewDue, looksVague, smallPlan } from '../lib/plan';
import { elapsedMs } from '../lib/session';
import { useNow, useStore } from '../store';
import { EditTextDialog, Logo, useFocusHeading } from '../components/common';
import { IconChevronRight, IconClock, IconGear, IconPencil, IconPlay } from '../components/Icons';

export function Home({ navigate }: { navigate: (r: string) => void }) {
  const { state, actions } = useStore();
  const { settings, records, active, meta } = state;
  const today = localDate();
  const mode = homeMode(records, settings, today);
  const planMode = settings.supportMode === 'plan';
  const resume = mode === 'resume';
  const [editing, setEditing] = useState(false);
  const [starting, setStarting] = useState(false);
  const h1 = useFocusHeading<HTMLHeadingElement>();
  const now = useNow(!!active);
  const next = settings.nextAction;
  const small = smallPlan(settings);
  const reviewDue = isReviewDue(settings, meta, records, today);

  // 「しおりを挟みました」の強調は一度だけ
  useEffect(() => {
    if (!state.justBookmarked) return;
    const t = window.setTimeout(actions.clearBookmarked, 2400);
    return () => window.clearTimeout(t);
  }, [state.justBookmarked, actions]);

  async function start(m: 'standard' | 'small') {
    if (starting) return;
    setStarting(true);
    try {
      await actions.startSession(m);
    } finally {
      setStarting(false);
    }
  }

  const header = (
    <header className="home-header mobile-only">
      <Logo />
      <button type="button" className="icon-btn" aria-label="設定を開く" onClick={() => navigate('/settings')}>
        <IconGear size={22} />
      </button>
    </header>
  );

  const bookmark = (
    <button type="button" className={`next-body${state.justBookmarked ? ' is-new' : ''}`} onClick={() => setEditing(true)}>
      {settings.subject && <span className="subject">{settings.subject}</span>}
      <span className={`next-title${next ? '' : ' is-empty'}`}>{next || '次の一手は未設定'}</span>
      <span className="next-caption">
        <span>{next ? (state.justBookmarked ? 'しおりを挟みました' : resume ? '前回残したしおり' : 'しおり（前回残した一手）') : '学習を始めてからでも決められます'}</span>
        <span className="next-edit">
          <IconPencil size={14} />
          {next ? '変更' : '次の一手を決める'}
        </span>
      </span>
    </button>
  );

  const editDialog = (
    <EditTextDialog
      open={editing}
      onClose={() => setEditing(false)}
      title="次の一手を決める"
      label="しおり（次の一手）"
      initial={settings.nextAction}
      maxLength={LIMITS.nextAction}
      placeholder="例：第11章の仕訳問題を3問解く"
      help="すぐ手をつけられる行動を1つ。数や範囲を入れると始めやすくなります。"
      tooLongMessage={`次の一手は${LIMITS.nextAction}文字以内で入力してください。`}
      hint={(v) => (looksVague(v) ? '「何を・どこまで」を足すと始めやすくなります（例：第11章の問題を3問）。' : '')}
      onSave={(v) => actions.updateSettings({ nextAction: v })}
    />
  );

  /* ---------------- 学習中 ---------------- */
  if (active) {
    return (
      <div className="screen home">
        {header}
        <section className="hero" aria-labelledby="home-h1">
          <p className="eyebrow">学習中</p>
          <h1 id="home-h1" className="h1" ref={h1} tabIndex={-1}>
            {active.title || '学習中'}
          </h1>
        </section>
        <section className="cta">
          <p className="active-note" role="status">
            <span className={`dot${active.status === 'running' ? ' is-live' : ''}`} aria-hidden="true" />
            {active.status === 'running' ? '計測中' : active.status === 'paused' ? '一時停止中' : '終了の確認中'}
            <span className="num">（{formatClock(elapsedMs(active, now))} 経過）</span>
          </p>
          <button type="button" className="btn btn-primary btn-xl" onClick={() => navigate('/session')}>
            <IconPlay size={20} />
            学習中の画面に戻る
          </button>
        </section>
      </div>
    );
  }

  /* ---------------- 記録中心（シンプル表示） ---------------- */
  if (!planMode) {
    return (
      <div className="screen home is-simple">
        {header}
        <section className="hero" aria-labelledby="home-h1">
          <p className="eyebrow">{resume ? '前回の続きから' : '今日の学習'}</p>
          <h1 id="home-h1" className="h1" ref={h1} tabIndex={-1}>
            {resume ? 'また、ここから。' : '次の一歩から。'}
          </h1>
        </section>
        <section className="next simple-next" aria-label="次にやること">
          {bookmark}
        </section>
        <section className="cta" aria-label="学習の開始">
          <button type="button" className="btn btn-primary btn-xl" onClick={() => start('standard')} disabled={starting}>
            <IconPlay size={20} />
            学習を始める
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => start('small')} disabled={starting}>
            <IconClock size={19} />
            2分だけ始める
          </button>
        </section>
        {editDialog}
      </div>
    );
  }

  /* ---------------- 数日ぶり（プラン表示） ---------------- */
  if (resume) {
    const last = lastStudyDate(records);
    return (
      <div className="screen home is-resume">
        {header}
        <section className="hero" aria-labelledby="home-h1">
          <p className="eyebrow">前回の続きから</p>
          <h1 id="home-h1" className="h1" ref={h1} tabIndex={-1}>
            また、ここから。
          </h1>
          <p className="lead">{next ? 'しおりは残っています。どれから始めますか？' : 'どれから始めますか？'}</p>
          {last && <p className="fact">最後の学習：{formatShortDate(last)}</p>}
        </section>
        <ul className="choices" aria-label="再開のしかた">
          <li>
            <button type="button" className="choice is-main" onClick={() => start('standard')} disabled={starting}>
              <span className="choice-main">
                <span className="choice-name">{next ? 'しおりから始める' : '学習を始める'}</span>
                <span className="choice-desc">{next || '内容は終わったときに残せます'}</span>
              </span>
              <IconPlay size={18} />
            </button>
          </li>
          <li>
            <button type="button" className="choice" onClick={() => start('small')} disabled={starting}>
              <span className="choice-main">
                <span className="choice-name">小さな一手で始める</span>
                <span className="choice-desc">
                  {small.label}（{small.minutes}分）
                </span>
              </span>
              <IconClock size={18} />
            </button>
          </li>
          <li>
            <button type="button" className="choice" onClick={() => navigate('/plan')}>
              <span className="choice-main">
                <span className="choice-name">プランを1つ変える</span>
                <span className="choice-desc">きっかけ・一手の大きさ・曜日</span>
              </span>
              <IconChevronRight size={18} />
            </button>
          </li>
        </ul>
        {reviewDue && <ReviewRow navigate={navigate} />}
        {editDialog}
      </div>
    );
  }

  /* ---------------- 通常・初回（プラン表示） ---------------- */
  const planned = isPlannedDay(settings, today);
  return (
    <div className="screen home is-plan">
      {header}
      <h1 id="home-h1" className="sr-only" ref={h1} tabIndex={-1}>
        今日の一手
      </h1>
      <p className="today-line">
        {formatShortDate(today)}
        <span aria-hidden="true"> ・ </span>
        {planned ? '予定の日' : '予定外の日'}
      </p>

      <ol className="thread" aria-label="今日のプラン">
        <li className="thread-item is-cue">
          <span className="thread-key">もし</span>
          {settings.cue ? (
            <button type="button" className="thread-cue" onClick={() => navigate('/plan')}>
              {settings.cue}
            </button>
          ) : (
            <button type="button" className="thread-cue is-empty" onClick={() => navigate('/plan')}>
              きっかけを決める
              <span className="thread-hint">（例：昼食後にコーヒーを淹れたら）</span>
            </button>
          )}
        </li>
        <li className="thread-item is-act">
          <span className="thread-key">この一手</span>
          {bookmark}
        </li>
      </ol>

      <section className="cta" aria-label="学習の開始">
        <button type="button" className="btn btn-primary btn-xl" onClick={() => start('standard')} disabled={starting}>
          <IconPlay size={20} />
          {next ? 'この一手を始める' : '学習を始める'}
        </button>
        <p className="sr-only">
          目標時間は{settings.targetMinutes}分です。時間になっても自動では終了しません。
        </p>
      </section>

      <section className="small-row" aria-label="できない日の小さな一手">
        <div className="small-text">
          <span className="small-when">{settings.smallWhen || '時間がない・気が重い'}なら</span>
          <span className="small-what">
            {small.label}
            {small.custom && <span className="small-min">（{small.minutes}分）</span>}
          </span>
          {!small.custom && (
            <button type="button" className="link-btn small-set" onClick={() => navigate('/plan')}>
              自分の小さな一手を決める
            </button>
          )}
        </div>
        <button type="button" className="btn btn-secondary btn-small" onClick={() => start('small')} disabled={starting}>
          {small.custom ? '小さく始める' : `${small.minutes}分だけ始める`}
        </button>
      </section>

      {reviewDue && <ReviewRow navigate={navigate} />}
      {editDialog}
    </div>
  );
}

function ReviewRow({ navigate }: { navigate: (r: string) => void }) {
  const { actions } = useStore();
  return (
    <section className="review-row" aria-labelledby="review-row-title">
      <div>
        <h2 id="review-row-title" className="review-row-title">
          週の見直し（1分）
        </h2>
        <p className="help">この7日間の事実を見て、来週ひとつだけ変えます。</p>
      </div>
      <div className="review-row-actions">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate('/review')}>
          見直す
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => actions.snoozeReview().catch(() => actions.toast('保存できませんでした。', { tone: 'error' }))}
        >
          今週はしない
        </button>
      </div>
    </section>
  );
}

import { useState } from 'react';
import { LIMITS } from '../lib/config';
import { formatClock, localDate } from '../lib/dates';
import { homeMode } from '../lib/records';
import { elapsedMs } from '../lib/session';
import { useNow, useStore } from '../store';
import { EditTextDialog, Logo, useFocusHeading } from '../components/common';
import { IconChevronRight, IconClock, IconGear, IconPencil, IconPlay } from '../components/Icons';

export function Home({ navigate }: { navigate: (r: string) => void }) {
  const { state, actions } = useStore();
  const { settings, records, active } = state;
  const today = localDate();
  const mode = homeMode(records, settings, today);
  const resume = mode === 'resume';
  const [editing, setEditing] = useState<null | 'next' | 'cue'>(null);
  const [starting, setStarting] = useState(false);
  const h1 = useFocusHeading<HTMLHeadingElement>();
  const now = useNow(!!active);

  async function start(m: 'standard' | 'two_minute') {
    if (starting) return;
    setStarting(true);
    try {
      await actions.startSession(m);
    } finally {
      setStarting(false);
    }
  }

  const next = settings.nextAction;
  const primaryLabel = resume && next ? '前回の続きから始める' : '学習を始める';

  return (
    <div className="screen home">
      <header className="home-header mobile-only">
        <Logo />
        <button type="button" className="icon-btn" aria-label="設定を開く" onClick={() => navigate('/settings')}>
          <IconGear size={22} />
        </button>
      </header>

      <section className="hero" aria-labelledby="home-h1">
        <p className="eyebrow">{resume ? '前回の続きから' : '今日の学習'}</p>
        <h1 id="home-h1" className="h1" ref={h1} tabIndex={-1}>
          {resume ? 'また、ここから。' : '次の一歩から。'}
        </h1>
        <p className="lead">{resume ? '今日できるところから始めましょう。' : '迷わず始められるように。'}</p>
      </section>

      <section className="next" aria-labelledby="next-label">
        <div className="next-head">
          <h2 id="next-label" className="label">
            {resume ? '次の一歩' : '次にやること'}
          </h2>
        </div>
        <button
          type="button"
          className="next-body"
          onClick={() => setEditing('next')}
        >
          {settings.subject && <span className="subject">{settings.subject}</span>}
          <span className={`next-title${next ? '' : ' is-empty'}`}>{next || '次にやることは未設定'}</span>
          <span className="next-caption">
            {next ? (resume ? '前回保存した学習内容' : '次に取り組むこと') : '学習を始めてからでも決められます'}
            <span className="next-edit">
              <IconPencil size={14} />
              {next ? '編集' : '次の一歩を決める'}
            </span>
          </span>
        </button>
      </section>

      <section className="cta" aria-label="学習の開始">
        {active ? (
          <>
            <p className="active-note" role="status">
              <span className={`dot${active.status === 'running' ? ' is-live' : ''}`} aria-hidden="true" />
              {active.status === 'running' ? '学習中' : active.status === 'paused' ? '一時停止中' : '終了の確認中'}
              <span className="num">（{formatClock(elapsedMs(active, now))} 経過）</span>
            </p>
            <button type="button" className="btn btn-primary btn-xl" onClick={() => navigate('/session')}>
              <IconPlay size={20} />
              学習中の画面に戻る
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary btn-xl"
              onClick={() => start('standard')}
              disabled={starting}
              aria-describedby="target-note"
            >
              <IconPlay size={20} />
              {primaryLabel}
            </button>
            <p id="target-note" className="sr-only">
              目標時間は{settings.targetMinutes}分です。時間になっても自動では終了しません。
            </p>
            <button type="button" className="btn btn-secondary" onClick={() => start('two_minute')} disabled={starting}>
              <IconClock size={19} />
              2分だけ始める
            </button>
          </>
        )}
      </section>

      <div className="home-foot mobile-only">
        {resume ? (
          <button type="button" className="row-link" onClick={() => setEditing('next')}>
            <IconPencil size={19} />
            <span className="row-link-text">次にやることを変更</span>
          </button>
        ) : (
          <button
            type="button"
            className="row-link"
            onClick={() => setEditing('cue')}
            aria-label={`きっかけ：${settings.cue || '未設定'}。タップして編集`}
          >
            <IconClock size={19} />
            <span className="row-link-text">きっかけ：{settings.cue || '未設定'}</span>
            <IconChevronRight size={18} className="row-link-chev" />
          </button>
        )}
      </div>

      <EditTextDialog
        open={editing === 'next'}
        onClose={() => setEditing(null)}
        title="次の一歩を決める"
        label="次にやること"
        initial={settings.nextAction}
        maxLength={LIMITS.nextAction}
        placeholder="例：仕訳の基本を3問解く"
        help="すぐに手をつけられる行動を1つ書きます。"
        tooLongMessage={`次の一歩は${LIMITS.nextAction}文字以内で入力してください。`}
        onSave={(v) => actions.updateSettings({ nextAction: v })}
      />
      <CueDialog open={editing === 'cue'} onClose={() => setEditing(null)} />
    </div>
  );
}

export function CueDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, actions } = useStore();
  return (
    <EditTextDialog
      open={open}
      onClose={onClose}
      title="学習のきっかけ"
      label="〇〇したら、学習を始める"
      initial={state.settings.cue}
      maxLength={LIMITS.cue}
      placeholder="例：昼食後にコーヒーを淹れたら"
      help="ふだんの行動と結びつけておくと、始める場面を思い出しやすくなります（任意）。"
      tooLongMessage={`きっかけは${LIMITS.cue}文字以内で入力してください。`}
      onSave={(v) => actions.updateSettings({ cue: v })}
    />
  );
}

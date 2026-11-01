import { BASELINE } from '../lib/config';
import { formatJpDate, formatShortDate, localDate, parseLocalDate } from '../lib/dates';
import { calendar, formatHM, formatTotal, habitTotal, toBlocks, totalValue, type Total } from '../lib/accumulate';
import type { AppSettings, Habit } from '../lib/model';
import { todayOf, useStore } from '../store';
import { Logo, useFocusHeading } from '../components/common';
import { IconGear } from '../components/Icons';

/** 次の節目（時間型＝分、日数型＝日）。すべて越えていたら null */
function nextMilestone(h: Habit, t: Total, s: AppSettings): { label: string; left: string; ratio: number } | null {
  const v = totalValue(t);
  const list = h.trackingType === 'time' ? s.milestonesTime.map((x) => x * 60) : s.milestonesDays;
  const sorted = [...list].sort((a, b) => a - b);
  const next = sorted.find((m) => m > v);
  if (next == null) return null;
  const prev = [...sorted].reverse().find((m) => m <= v) ?? 0;
  const ratio = (v - prev) / (next - prev);
  return h.trackingType === 'time'
    ? { label: `${next / 60}時間`, left: formatHM(next - v), ratio }
    : { label: `${next}日`, left: `${next - v}日`, ratio };
}

const BLOCK_CAP = 400;

export function Stack({ navigate }: { navigate: (r: string) => void }) {
  const { state } = useStore();
  const h1 = useFocusHeading<HTMLHeadingElement>();
  const today = todayOf(state.settings);
  const list = state.habits.filter((h) => !h.archived).sort((a, b) => a.order - b.order);
  const archived = state.habits.filter((h) => h.archived);

  return (
    <div className="screen stack">
      <header className="home-header mobile-only">
        <Logo />
        <button type="button" className="icon-btn" aria-label="設定を開く" onClick={() => navigate('/settings')}>
          <IconGear size={22} />
        </button>
      </header>
      <section className="hero">
        <h1 className="h1 h1-sm" ref={h1} tabIndex={-1}>
          積み上げ
        </h1>
        <p className="lead">途切れても、積み上げは減りません。</p>
      </section>
      {list.length === 0 && <p className="empty">習慣を追加すると、ここに積み上がっていきます。</p>}
      {list.map((h) => (
        <StackCard key={h.id} habit={h} today={today} />
      ))}
      {archived.length > 0 && (
        <details className="stack-archived">
          <summary>しまった習慣（{archived.length}）</summary>
          <ul>
            {archived.map((h) => (
              <li key={h.id}>
                {h.name}：<span className="num">{formatTotal(habitTotal(h, state.records))}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function StackCard({ habit: h, today }: { habit: Habit; today: string }) {
  const { state } = useStore();
  const t = habitTotal(h, state.records);
  const ms = nextMilestone(h, t, state.settings);
  const reached = state.meta.milestonesShown[h.id] ?? [];
  const id = `st-${h.id}`;
  return (
    <section className={`stack-card c-${h.color}`} aria-labelledby={id}>
      <div className="stack-head">
        <h2 id={id} className="h2">
          {h.name}
        </h2>
        <p className="stack-total num">{formatTotal(t)}</p>
      </div>
      {t.type === 'time' ? <TimeBlocks t={t} blockMinutes={state.settings.blockMinutes} /> : <DayTiles habit={h} today={today} />}
      {t.type === 'days' && (
        <p className="help">
          やった日 {t.days}日（うち小さな一手 {t.smallDays}日）・休むと決めた日 {t.restDays}日
        </p>
      )}
      {ms ? (
        <div className="milestone">
          <p className="milestone-text">
            次の節目 <strong>{ms.label}</strong> まで あと<span className="num">{ms.left}</span>
          </p>
          <div className="progress" role="progressbar" aria-label={`次の節目${ms.label}までの進み`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ms.ratio * 100)}>
            <span className="progress-fill" style={{ transform: `scaleX(${ms.ratio})` }} />
          </div>
        </div>
      ) : (
        <p className="milestone-text">設定したすべての節目に到達しています。</p>
      )}
      {reached.length > 0 && (
        <p className="help">到達した節目：{[...reached].sort((a, b) => a - b).map((v) => (h.trackingType === 'time' ? `${v}時間` : `${v}日`)).join('・')}</p>
      )}
    </section>
  );
}

function TimeBlocks({ t, blockMinutes }: { t: Extract<Total, { type: 'time' }>; blockMinutes: number }) {
  const b = toBlocks(t, blockMinutes);
  const all = b.baselineBlocks + b.appBlocks;
  // ブロックが多いときは1つを大きくして描画量を抑える（数字は常に正確な合計を表示）
  const scale = all > BLOCK_CAP ? Math.ceil(all / BLOCK_CAP) : 1;
  const base = Math.floor(b.baselineBlocks / scale);
  const app = Math.floor(all / scale) - base;
  const unit = blockMinutes * scale;
  const label = `${unit}分のブロックが${base + app}個。${t.baselineMinutes ? `うち${base}個は確認済みの累計（土台）。` : ''}端数${b.remainder}分。`;
  return (
    <figure className="blocks-fig">
      <div className="blocks" role="img" aria-label={label}>
        {Array.from({ length: base }, (_, i) => (
          <span key={`b${i}`} className="block is-base" />
        ))}
        {Array.from({ length: app }, (_, i) => (
          <span key={`a${i}`} className="block" />
        ))}
        {b.remainder > 0 && <span className="block is-part" style={{ opacity: 0.35 + (0.65 * b.remainder) / unit }} />}
      </div>
      <figcaption className="legend">
        <span>
          <span className="block is-base" aria-hidden="true" /> 土台：{formatHM(t.baselineMinutes)}
          {t.baselineMinutes ? `（${formatJpDate(BASELINE.asOf)}までの確認済み）` : ''}
        </span>
        <span>
          <span className="block" aria-hidden="true" /> このアプリで：{formatHM(t.appMinutes)}
        </span>
        <span className="help">1ブロック＝{unit}分</span>
      </figcaption>
    </figure>
  );
}

const DOW_HEAD = ['月', '火', '水', '木', '金', '土', '日'];
const TILE_LABEL = { done: 'やった', small: '小さな一手', rest: '休み' } as const;

function DayTiles({ habit, today }: { habit: Habit; today: string }) {
  const { state } = useStore();
  // 習慣を作る前の日は「予定の日」として表示しない（できなかった日に見えないように）
  const created = localDate(new Date(habit.createdAt));
  const first = state.records.filter((r) => r.habitId === habit.id).reduce((m, r) => (r.studyDate < m ? r.studyDate : m), created);
  const rows = calendar(habit, state.records, today, 6, first);
  return (
    <figure className="tiles-fig">
      <table className="tiles" aria-label={`${habit.name}の直近6週間`}>
        <thead>
          <tr>
            {DOW_HEAD.map((d) => (
              <th key={d} scope="col">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((c) => {
                const label = `${formatShortDate(c.date)}：${c.future ? 'これから' : c.status ? TILE_LABEL[c.status] : c.before ? '始める前' : c.planned ? '予定の日・記録なし' : '予定なし'}`;
                return (
                  <td key={c.date}>
                    <span
                      className={`tile${c.status ? ` is-${c.status}` : ''}${c.planned ? ' is-planned' : ''}${c.future ? ' is-future' : ''}${c.before ? ' is-before' : ''}${c.date === today ? ' is-today' : ''}`}
                      title={label}
                    >
                      <span className="sr-only">{label}</span>
                      <span aria-hidden="true">{parseLocalDate(c.date).getDate()}</span>
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <figcaption className="legend">
        <span>
          <span className="tile is-done" aria-hidden="true" /> やった
        </span>
        <span>
          <span className="tile is-small" aria-hidden="true" /> 小さな一手
        </span>
        <span>
          <span className="tile is-rest" aria-hidden="true" /> 休み
        </span>
        <span>
          <span className="tile is-planned" aria-hidden="true" /> 予定の日
        </span>
      </figcaption>
    </figure>
  );
}

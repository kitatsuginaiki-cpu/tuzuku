import { useCallback, useEffect, useRef, useState } from 'react';
import { weekFacts } from './lib/plan';
import { formatTotal, habitTotal } from './lib/accumulate';
import { StoreProvider, todayOf, useStore, type Toast } from './store';
import { Logo } from './components/common';
import { IconBars, IconGear, IconHome, IconPeople, IconStack } from './components/Icons';
import { Home } from './screens/Home';
import { HabitEditor } from './screens/HabitEditor';
import { Review } from './screens/Review';
import { SessionScreen } from './screens/Session';
import { FinishScreen } from './screens/Finish';
import { Records } from './screens/Records';
import { Settings } from './screens/Settings';
import { Stack } from './screens/Stack';
import { Friends } from './screens/Friends';
import { Privacy } from './screens/Privacy';
import { LevelUpDialog } from './components/LevelUp';

type Route = '/' | '/stack' | '/friends' | '/records' | '/settings' | '/session' | '/habit' | '/review' | '/privacy';

/**
 * URL のハッシュは「#records」のような単純な名前にする（「#/path」形式は使わない）。
 * 埋め込み先（Claude の Artifact など）で「#/…」や「settings」が使えないため。
 * 旧形式（#/records など）も読み取りは受け付ける。v6 の #plan は今日へ。
 */
const HASH: Record<Route, string> = {
  '/': '',
  '/stack': 'stack',
  '/friends': 'friends',
  '/records': 'records',
  '/settings': 'options',
  '/session': 'session',
  '/habit': 'habit',
  '/review': 'review',
  '/privacy': 'privacy',
};

function readRoute(): Route {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (h === 'settings') return '/settings';
  const hit = (Object.keys(HASH) as Route[]).find((r) => HASH[r] === h);
  return hit ?? '/';
}

function toHref(r: Route): string {
  return HASH[r] ? `#${HASH[r]}` : '#';
}

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  useEffect(() => {
    const on = () => {
      document.body.dataset.navigated = '1';
      setRoute(readRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const navigate = useCallback((r: string) => {
    if (readRoute() === r) return;
    document.body.dataset.navigated = '1';
    location.hash = HASH[r as Route] ?? '';
    window.scrollTo(0, 0);
  }, []);
  return (
    <StoreProvider navigate={navigate}>
      <Shell route={route} navigate={navigate} />
    </StoreProvider>
  );
}

const TABS: [Route, string, (s: number) => React.ReactNode][] = [
  ['/', '今日', (s) => <IconHome size={s} />],
  ['/stack', '積み上げ', (s) => <IconStack size={s} />],
  ['/friends', '仲間', (s) => <IconPeople size={s} />],
  ['/records', '記録', (s) => <IconBars size={s} />],
];

function Shell({ route, navigate }: { route: Route; navigate: (r: string) => void }) {
  const { state } = useStore();
  const { active } = state;

  // 進行中セッションがないのに /session を開いた場合は今日へ
  useEffect(() => {
    if (state.phase === 'ready' && route === '/session' && !active) navigate('/');
  }, [state.phase, route, active, navigate]);

  if (state.phase === 'loading') {
    return (
      <div className="loading" role="status" aria-live="polite">
        <Logo />
        <span className="sr-only">読み込み中</span>
      </div>
    );
  }

  const flow = route === '/session' && !!active;
  let screen;
  if (flow && active) {
    screen = active.status === 'completing' ? <FinishScreen key={`f-${active.id}`} active={active} navigate={navigate} /> : <SessionScreen active={active} navigate={navigate} />;
  } else if (route === '/records') screen = <Records navigate={navigate} />;
  else if (route === '/stack') screen = <Stack navigate={navigate} />;
  else if (route === '/friends') screen = <Friends navigate={navigate} />;
  else if (route === '/habit') screen = <HabitEditor navigate={navigate} />;
  else if (route === '/review') screen = <Review navigate={navigate} />;
  else if (route === '/settings') screen = <Settings navigate={navigate} />;
  else if (route === '/privacy') screen = <Privacy navigate={navigate} />;
  else screen = <Home navigate={navigate} />;

  const page = flow ? 'flow' : route === '/' || route === '/session' ? 'home' : route.slice(1);

  return (
    <div className={`app page-${page}`}>
      <a className="skip-link" href="#main">本文へ移動</a>
      {!flow && <SideNav route={route} navigate={navigate} />}
      <main id="main" className="main" tabIndex={-1}>
        <div className="main-inner">{screen}</div>
      </main>
      {page === 'home' && <InfoAside navigate={navigate} />}
      {!flow && <BottomNav route={route} navigate={navigate} />}
      <Toasts />
      {!(flow && active?.status === 'running') && <LevelUpDialog />}
    </div>
  );
}

function SideNav({ route, navigate }: { route: Route; navigate: (r: string) => void }) {
  const item = (r: Route, label: string, icon: React.ReactNode) => (
    <a key={r} href={toHref(r)} className={`side-link${route === r || (r === '/' && route === '/session') ? ' is-current' : ''}`} aria-current={route === r ? 'page' : undefined}
      onClick={(e) => { e.preventDefault(); navigate(r); }}>
      {icon}
      <span>{label}</span>
    </a>
  );
  return (
    <nav className="sidenav" aria-label="メイン">
      <Logo />
      <div className="side-main">{TABS.map(([r, l, i]) => item(r, l, i(20)))}</div>
      <div className="side-sub">{item('/settings', '設定', <IconGear size={19} />)}</div>
    </nav>
  );
}

function BottomNav({ route, navigate }: { route: Route; navigate: (r: string) => void }) {
  if (route === '/settings' || route === '/review' || route === '/habit' || route === '/privacy') return null;
  return (
    <nav className="bottomnav" aria-label="メイン">
      {TABS.map(([r, label, icon]) => (
        <a key={r} href={toHref(r)} className={`tab${route === r ? ' is-current' : ''}`} aria-current={route === r ? 'page' : undefined}
          onClick={(e) => { e.preventDefault(); navigate(r); }}>
          {icon(24)}
          <span className="tab-label">{label}</span>
        </a>
      ))}
    </nav>
  );
}

/** PC：右側の補助情報。積み上げと、この7日間の事実だけ。 */
function InfoAside({ navigate }: { navigate: (r: string) => void }) {
  const { state } = useStore();
  const today = todayOf(state.settings);
  const list = state.habits.filter((h) => !h.archived).sort((a, b) => a.order - b.order);
  if (!list.length) return <aside className="info" aria-label="補助情報" />;
  return (
    <aside className="info" aria-label="補助情報">
      <section className="info-block">
        <h2 className="info-label">積み上げ</h2>
        <ul className="info-list">
          {list.map((h) => (
            <li key={h.id}>
              <span>{h.name}</span>
              <span className="num">{formatTotal(habitTotal(h, state.records))}</span>
            </li>
          ))}
        </ul>
        <button type="button" className="link-btn info-link" onClick={() => navigate('/stack')}>
          積み上げを見る
        </button>
      </section>
      <section className="info-block">
        <h2 className="info-label">この7日間でやった日</h2>
        <ul className="info-list">
          {list.map((h) => {
            const f = weekFacts(state.records.filter((r) => r.habitId === h.id), h, today, state.meta.firstUsedOn);
            return (
              <li key={h.id}>
                <span>{h.name}</span>
                <span className="num">
                  {f.studyDays}日{f.plannedDays > 0 ? `／予定${f.plannedDays}日` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}

function Toasts() {
  const { toasts, actions } = useStore();
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} onDone={() => actions.dismissToast(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ t, onDone }: { t: Toast; onDone: () => void }) {
  const [hold, setHold] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (hold) return;
    timer.current = window.setTimeout(onDone, t.action || t.tone === 'error' ? 8000 : 4000);
    return () => window.clearTimeout(timer.current);
  }, [hold, onDone, t]);
  return (
    <div className={`toast${t.tone === 'error' ? ' is-error' : ''}`} role={t.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}>
      <span className="toast-msg">{t.message}</span>
      {t.action && (
        <button type="button" className="toast-action" onClick={() => { t.action!.run(); onDone(); }}>
          {t.action.label}
        </button>
      )}
      <button type="button" className="toast-close" aria-label="通知を閉じる" onClick={onDone}>×</button>
    </div>
  );
}

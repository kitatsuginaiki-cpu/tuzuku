import { useCallback, useEffect, useRef, useState } from 'react';
import { BASELINE } from './lib/config';
import { formatJpDate, formatMinutes, localDate } from './lib/dates';
import { weekFacts } from './lib/plan';
import { totalMinutes } from './lib/records';
import { StoreProvider, useStore, type Toast } from './store';
import { Logo } from './components/common';
import { IconBars, IconChevronRight, IconGear, IconHome, IconPlan } from './components/Icons';
import { Home } from './screens/Home';
import { Plan } from './screens/Plan';
import { Review } from './screens/Review';
import { SessionScreen } from './screens/Session';
import { FinishScreen } from './screens/Finish';
import { Records } from './screens/Records';
import { Settings } from './screens/Settings';

type Route = '/' | '/records' | '/settings' | '/session' | '/plan' | '/review';

/**
 * URL のハッシュは「#records」のような単純な名前にする（「#/path」形式は使わない）。
 * 埋め込み先（Claude の Artifact など）で「#/…」や「settings」が使えないため。
 * 旧形式（#/records など）も読み取りは受け付ける。
 */
const HASH: Record<Route, string> = { '/': '', '/records': 'records', '/settings': 'options', '/session': 'session', '/plan': 'plan', '/review': 'review' };

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
  else if (route === '/plan') screen = <Plan navigate={navigate} />;
  else if (route === '/review') screen = <Review navigate={navigate} />;
  else if (route === '/settings') screen = <Settings navigate={navigate} />;
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
    </div>
  );
}

function SideNav({ route, navigate }: { route: Route; navigate: (r: string) => void }) {
  const item = (r: Route, label: string, icon: React.ReactNode) => (
    <a href={toHref(r)} className={`side-link${route === r || (r === '/' && route === '/session') ? ' is-current' : ''}`} aria-current={route === r ? 'page' : undefined}
      onClick={(e) => { e.preventDefault(); navigate(r); }}>
      {icon}
      <span>{label}</span>
    </a>
  );
  return (
    <nav className="sidenav" aria-label="メイン">
      <Logo />
      <div className="side-main">
        {item('/', '今日', <IconHome size={20} />)}
        {item('/plan', 'プラン', <IconPlan size={20} />)}
        {item('/records', '記録', <IconBars size={20} />)}
      </div>
      <div className="side-sub">{item('/settings', '設定', <IconGear size={19} />)}</div>
    </nav>
  );
}

function BottomNav({ route, navigate }: { route: Route; navigate: (r: string) => void }) {
  if (route === '/settings' || route === '/review') return null;
  const item = (r: Route, label: string, icon: React.ReactNode) => (
    <a href={toHref(r)} className={`tab${route === r ? ' is-current' : ''}`} aria-current={route === r ? 'page' : undefined}
      onClick={(e) => { e.preventDefault(); navigate(r); }}>
      {icon}
      <span className="tab-label">{label}</span>
    </a>
  );
  return (
    <nav className="bottomnav" aria-label="メイン">
      {item('/', '今日', <IconHome size={24} />)}
      {item('/plan', 'プラン', <IconPlan size={24} />)}
      {item('/records', '記録', <IconBars size={24} />)}
    </nav>
  );
}

/** PC：右側の補助情報。確認済みの累計と、この7日間の事実だけ。 */
function InfoAside({ navigate }: { navigate: (r: string) => void }) {
  const { state } = useStore();
  const total = totalMinutes(state.records);
  const f = weekFacts(state.records, state.settings, localDate(), state.meta.firstUsedOn);
  return (
    <aside className="info" aria-label="補助情報">
      <section className="info-block">
        <h2 className="info-label">この7日間</h2>
        <p className="info-value num">{f.studyDays}日</p>
        <p className="help">
          {state.settings.supportMode === 'plan' && f.plannedDays > 0 ? `予定の${f.plannedDays}日のうち${f.plannedDone}日・` : ''}
          {formatMinutes(f.minutes)}
        </p>
        <button type="button" className="link-btn info-link" onClick={() => navigate('/records')}>
          記録を見る
          <IconChevronRight size={16} />
        </button>
      </section>
      <section className="info-block">
        <h2 className="info-label">確認済みの累計時間</h2>
        <p className="info-value num">{formatMinutes(total)}</p>
        <p className="help">
          {state.records.length === 0 ? `${formatJpDate(BASELINE.asOf)}時点の記録` : `${formatJpDate(BASELINE.asOf)}までの記録＋このアプリでの記録`}
        </p>
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

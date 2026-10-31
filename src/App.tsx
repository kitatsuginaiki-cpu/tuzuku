import { useCallback, useEffect, useRef, useState } from 'react';
import { BASELINE } from './lib/config';
import { formatJpDate, formatMinutes } from './lib/dates';
import { totalMinutes } from './lib/records';
import { StoreProvider, useStore, type Toast } from './store';
import { Logo } from './components/common';
import { IconBars, IconChevronRight, IconGear, IconHome } from './components/Icons';
import { CueDialog, Home } from './screens/Home';
import { SessionScreen } from './screens/Session';
import { FinishScreen } from './screens/Finish';
import { Records } from './screens/Records';
import { Settings } from './screens/Settings';

type Route = '/' | '/records' | '/settings' | '/session';

/**
 * URL のハッシュは「#records」のような単純な名前にする（「#/path」形式は使わない）。
 * 埋め込み先（Claude の Artifact など）で「#/…」や「settings」が使えないため。
 * 旧形式（#/records など）も読み取りは受け付ける。
 */
const HASH: Record<Route, string> = { '/': '', '/records': 'records', '/settings': 'options', '/session': 'session' };

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
      {page === 'home' && <InfoAside />}
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
        {item('/records', '記録', <IconBars size={20} />)}
      </div>
      <div className="side-sub">{item('/settings', '設定', <IconGear size={19} />)}</div>
    </nav>
  );
}

function BottomNav({ route, navigate }: { route: Route; navigate: (r: string) => void }) {
  if (route === '/settings') return null;
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
      {item('/records', '記録', <IconBars size={24} />)}
    </nav>
  );
}

/** PC：右側の補助情報。「きっかけ」と「確認済みの累計」のみ。 */
function InfoAside() {
  const { state } = useStore();
  const [cue, setCue] = useState(false);
  const total = totalMinutes(state.records);
  return (
    <aside className="info" aria-label="補助情報">
      <section className="info-block">
        <h2 className="info-label">学習のきっかけ</h2>
        <p className={`info-value${state.settings.cue ? ' is-text' : ''}`}>{state.settings.cue || '未設定'}</p>
        {!state.settings.cue && <p className="help">勉強する場面を決める</p>}
        <button type="button" className="link-btn info-link" onClick={() => setCue(true)}>
          {state.settings.cue ? '変更する' : '設定する'}
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
      {state.records.length === 0 && <p className="info-foot help">学習履歴が増えると、「記録」で振り返れます。</p>}
      <CueDialog open={cue} onClose={() => setCue(false)} />
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

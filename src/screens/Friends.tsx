import { useCallback, useEffect, useState } from 'react';
import { formatHM } from '../lib/accumulate';
import { MOOD_LABEL } from '../lib/character';
import { getRemote, GROUP_MAX, RemoteError, STAMP_DAILY_LIMIT, STAMPS, type Group, type Member, type Remote, type SharedStatus, type Stamp, type StampKind } from '../lib/remote';
import { useStore } from '../store';
import { Dialog } from '../components/Dialog';
import { FieldError, Logo, useFocusHeading } from '../components/common';
import { CharacterFace } from '../components/Character';
import { IconGear } from '../components/Icons';

const AVATARS = ['green', 'blue', 'orange', 'pink', 'purple', 'gray'] as const;
const AVATAR_LABEL: Record<string, string> = { green: '緑', blue: '青', orange: '橙', pink: '桃', purple: '紫', gray: '灰' };
const TODAY_LABEL: Record<SharedStatus['today'], string> = { done: 'やった', small: '小さな一手', rest: '休みの日', none: 'まだ' };

function errMsg(e: unknown) {
  // RemoteError（code 付き）の文言だけを表示する。それ以外の内部エラーは一般的な文言に
  if (e instanceof RemoteError || (e && typeof e === 'object' && 'code' in e && typeof (e as { message?: unknown }).message === 'string'))
    return (e as unknown as Error).message;
  return 'うまくいきませんでした。時間をおいてもう一度お試しください。';
}

export function Friends({ navigate }: { navigate: (r: string) => void }) {
  const { state } = useStore();
  const h1 = useFocusHeading<HTMLHeadingElement>();
  const [remote, setRemote] = useState<Remote | null>(null);
  useEffect(() => {
    void getRemote().then(setRemote);
  }, []);

  return (
    <div className="screen friends">
      <header className="home-header mobile-only">
        <Logo />
        <button type="button" className="icon-btn" aria-label="設定を開く" onClick={() => navigate('/settings')}>
          <IconGear size={22} />
        </button>
      </header>
      <section className="hero">
        <h1 className="h1 h1-sm" ref={h1} tabIndex={-1}>
          仲間
        </h1>
        <p className="lead">招待した人どうしで、共有をオンにした習慣の「今日やったか」と積み上げを見せ合えます。ランキングやコメントはありません。</p>
      </section>
      {!remote ? (
        <p role="status">読み込み中…</p>
      ) : !remote.available ? (
        <NotConfigured navigate={navigate} />
      ) : !state.account ? (
        <SignIn remote={remote} />
      ) : (
        <Signed remote={remote} navigate={navigate} />
      )}
      <p className="help friends-privacy">
        <button type="button" className="link-btn" onClick={() => navigate('/privacy')}>
          共有されるもの・されないもの（プライバシー）
        </button>
      </p>
    </div>
  );
}

function NotConfigured({ navigate }: { navigate: (r: string) => void }) {
  const { state } = useStore();
  return (
    <section className="panel" aria-labelledby="nc-title">
      <h2 id="nc-title" className="h2">
        仲間と同期は、安全確認のため一時停止中です
      </h2>
      <p>
        記録はこの端末に保存され、今まで通り使えます。サーバーへの送信・受信は行いません。PCとスマホのデータを合わせる仕組みを安全に作り直してから、再開します。
      </p>
      {state.account && <p className="help">以前ログインしていても、同期は止まっています。この端末のデータはそのまま残ります。</p>}
      <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate('/privacy')}>
        しくみを見る
      </button>
    </section>
  );
}

function SignIn({ remote }: { remote: Remote }) {
  const { actions } = useStore();
  const [step, setStep] = useState<'email' | 'code' | 'profile'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string>('green');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState<{ userId: string; email: string } | null>(null);

  async function wrap(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      await fn();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="si-title">
      <h2 id="si-title" className="h2">
        {step === 'profile' ? '仲間に見せる名前' : 'メールでログイン'}
      </h2>
      {step === 'email' && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const v = email.trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
              setErr('メールアドレスの形式を確かめてください。');
              return;
            }
            void wrap(async () => {
              await remote.sendCode(v);
              setStep('code');
            });
          }}
        >
          <p className="help">パスワードは使いません。メールに届く6桁のコードでログインします。</p>
          <label className="field-label" htmlFor="si-email">
            メールアドレス
          </label>
          <input id="si-email" className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!err} aria-describedby="si-err" />
          <FieldError id="si-err">{err}</FieldError>
          <button type="submit" className="btn btn-primary spaced" disabled={busy} aria-busy={busy}>
            {busy ? '送信中…' : 'コードを送る'}
          </button>
        </form>
      )}
      {step === 'code' && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void wrap(async () => {
              const u = await remote.verifyCode(email.trim(), code);
              setUser(u);
              setStep('profile');
            });
          }}
        >
          <p className="help">{email} に届いたコードを入力してください。</p>
          <label className="field-label" htmlFor="si-code">
            6桁のコード
          </label>
          <input id="si-code" className="input input-num" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-invalid={!!err} aria-describedby="si-err2" />
          <FieldError id="si-err2">{err}</FieldError>
          <div className="row-actions spaced">
            <button type="submit" className="btn btn-primary" disabled={busy || code.length < 6} aria-busy={busy}>
              {busy ? '確認中…' : 'ログイン'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { setStep('email'); setCode(''); setErr(''); }}>
              メールアドレスを直す
            </button>
          </div>
        </form>
      )}
      {step === 'profile' && user && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.replace(/\s+/g, ' ').trim();
            if (!n || n.length > 20) {
              setErr('名前は1〜20文字で入力してください。本名でなくて構いません。');
              return;
            }
            void wrap(async () => {
              await remote.saveProfile(n, avatar);
              await actions.setAccount({ userId: user.userId, email: user.email, displayName: n, avatar, lastPulledAt: null });
              actions.toast('ログインしました。この端末の記録を同期します。');
            });
          }}
        >
          <label className="field-label" htmlFor="si-name">
            表示名（本名でなくて構いません）
          </label>
          <input id="si-name" className="input" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} autoComplete="nickname"
            aria-invalid={!!err} aria-describedby="si-err3" />
          <FieldError id="si-err3">{err}</FieldError>
          <fieldset className="spaced">
            <legend className="field-label">アイコンの色</legend>
            <div className="chips" role="radiogroup" aria-label="アイコンの色">
              {AVATARS.map((a) => (
                <button type="button" role="radio" key={a} aria-checked={avatar === a} className={`chip swatch av-${a}${avatar === a ? ' is-on' : ''}`} onClick={() => setAvatar(a)}>
                  <span className="swatch-dot" aria-hidden="true" />
                  {AVATAR_LABEL[a]}
                </button>
              ))}
            </div>
          </fieldset>
          <button type="submit" className="btn btn-primary spaced" disabled={busy} aria-busy={busy}>
            はじめる
          </button>
        </form>
      )}
    </section>
  );
}

function Signed({ remote, navigate }: { remote: Remote; navigate: (r: string) => void }) {
  const { state, actions } = useStore();
  const account = state.account!;
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [sent, setSent] = useState<Record<string, number>>({});
  const [received, setReceived] = useState<Stamp[]>([]);
  const [err, setErr] = useState('');
  const [leaving, setLeaving] = useState<Group | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [g, s, r] = await Promise.all([remote.myGroups(), remote.stampsSentToday(), remote.stampsReceived(new Date(Date.now() - 7 * 86400_000).toISOString())]);
      setGroups(g);
      setSent(s);
      setReceived(r);
      setErr('');
    } catch (e) {
      setErr(errMsg(e));
      setGroups((g) => g ?? []);
    }
  }, [remote]);

  useEffect(() => {
    void refresh();
  }, [refresh, state.sync.lastSyncedAt]);

  const shared = state.habits.filter((h) => !h.archived);
  const names = new Map<string, string>();
  for (const g of groups ?? []) for (const m of g.members) names.set(m.userId, m.displayName || 'なかま');

  async function toggleShare(id: string, on: boolean) {
    const h = state.habits.find((x) => x.id === id);
    if (!h) return;
    await actions.saveHabit({ ...h, shared: on });
    await actions.syncNow();
    void refresh();
  }

  return (
    <>
      <p className="sync-line" role="status">
        {account.displayName}（{account.email}）・
        {state.sync.status === 'syncing'
          ? '同期中…'
          : state.sync.status === 'offline'
            ? 'オフライン（つながったら自動で同期します）'
            : state.sync.status === 'error'
              ? state.sync.error
              : state.sync.lastSyncedAt
                ? `同期済み ${new Date(state.sync.lastSyncedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`
                : '同期の準備中'}
        <button type="button" className="link-btn" onClick={() => void actions.syncNow().then(refresh)}>
          今すぐ同期
        </button>
      </p>
      {err && (
        <p className="save-error" role="alert">
          {err}
        </p>
      )}

      {received.length > 0 && (
        <section className="panel" aria-labelledby="rc-title">
          <h2 id="rc-title" className="h2">
            届いたスタンプ（7日間）
          </h2>
          <ul className="stamp-feed">
            {received.slice(0, 12).map((s) => (
              <li key={s.id}>
                <span className="stamp-chip">{s.kind}</span>
                <span>{names.get(s.fromUser) ?? 'なかま'}さんから</span>
                <span className="help">{new Date(s.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups === null ? (
        <p role="status">グループを読み込み中…</p>
      ) : (
        groups.map((g) => (
          <GroupCard key={g.id} group={g} me={account.userId} sent={sent} remote={remote} onChanged={refresh} onLeave={() => setLeaving(g)} />
        ))
      )}

      <section className="panel" aria-labelledby="sh-title">
        <h2 id="sh-title" className="h2">
          仲間に見せる習慣
        </h2>
        <p className="help">オンにした習慣だけ、参加中のすべてのグループに表示されます。メモ・時刻・しおりは表示されません。</p>
        {shared.length === 0 ? (
          <p className="empty">習慣がありません。</p>
        ) : (
          <ul className="share-list">
            {shared.map((h) => (
              <li key={h.id}>
                <ShareSwitch name={h.name} on={h.shared} onChange={(v) => toggleShare(h.id, v)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <GroupForms remote={remote} onDone={refresh} count={groups?.length ?? 0} />

      <section className="panel" aria-labelledby="ac-title">
        <h2 id="ac-title" className="h2">
          アカウント
        </h2>
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={async () => {
              await remote.signOut();
              await actions.setAccount(null);
              actions.toast('ログアウトしました。この端末の記録はそのまま残っています。');
            }}
          >
            ログアウト
          </button>
          <button type="button" className="btn btn-danger-ghost" onClick={() => setDeleting(true)}>
            アカウントを削除
          </button>
        </div>
        <button type="button" className="link-btn spaced" onClick={() => navigate('/privacy')}>
          プライバシー
        </button>
      </section>

      <LeaveDialog group={leaving} remote={remote} onClose={() => setLeaving(null)} onDone={refresh} />
      <DeleteDialog open={deleting} remote={remote} onClose={() => setDeleting(false)} />
    </>
  );
}

/** 切り替えはすぐ画面に反映し、保存に失敗したら戻す */
function ShareSwitch({ name, on, onChange }: { name: string; on: boolean; onChange: (v: boolean) => Promise<void> }) {
  const { actions } = useStore();
  const [v, setV] = useState(on);
  useEffect(() => setV(on), [on]);
  return (
    <label className="switch-row">
      <input
        type="checkbox"
        role="switch"
        checked={v}
        onChange={(e) => {
          const next = e.target.checked;
          setV(next);
          onChange(next).catch(() => {
            setV(!next);
            actions.toast('保存できませんでした。', { tone: 'error' });
          });
        }}
      />
      <span>{name}</span>
    </label>
  );
}

function formatStatusTotal(s: SharedStatus) {
  return s.trackingType === 'time' ? formatHM(s.total) : `${s.total}日`;
}

function GroupCard(p: { group: Group; me: string; sent: Record<string, number>; remote: Remote; onChanged: () => void; onLeave: () => void }) {
  const { actions } = useStore();
  const { group: g } = p;
  const [busy, setBusy] = useState<string | null>(null);
  const id = `gr-${g.id}`;

  async function stamp(m: Member, kind: StampKind) {
    if (busy) return;
    setBusy(m.userId);
    try {
      await p.remote.sendStamp(g.id, m.userId, kind);
      actions.toast(`${m.displayName || 'なかま'}さんに「${kind}」を送りました。`);
      p.onChanged();
    } catch (e) {
      actions.toast(errMsg(e), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(g.inviteCode);
      actions.toast('招待コードをコピーしました。');
    } catch {
      actions.toast(`招待コード：${g.inviteCode}`);
    }
  }

  return (
    <section className="panel group" aria-labelledby={id}>
      <div className="group-head">
        <h2 id={id} className="h2">
          {g.name}
        </h2>
        <span className="help">
          {g.members.length}/{GROUP_MAX}人
        </span>
      </div>
      <ul className="members">
        {g.members.map((m) => {
          const mine = m.userId === p.me;
          const left = STAMP_DAILY_LIMIT - (p.sent[m.userId] ?? 0);
          return (
            <li key={m.userId} className="member">
              <div className="member-head">
                <span className={`avatar av-${m.avatar}`} aria-hidden="true">
                  {(m.displayName || '？').slice(0, 1)}
                </span>
                <span className="member-name">
                  {m.displayName || 'なかま'}
                  {mine && <span className="badge">あなた</span>}
                </span>
              </div>
              {m.statuses.length === 0 ? (
                <p className="help">共有中の習慣はありません。</p>
              ) : (
                <ul className="statuses">
                  {m.statuses.map((s) => (
                    <li key={s.habitId} className={`status is-${s.today}`}>
                      {s.mood && <CharacterFace mood={s.mood} size={32} decorative />}
                      <span className="status-name">{s.habitName}</span>
                      <span className="status-today">{TODAY_LABEL[s.today]}</span>
                      <span className="status-meta">
                        7日中{s.weekDays}日・積み上げ <span className="num">{formatStatusTotal(s)}</span>
                        {s.mood && <span className="sr-only">・{MOOD_LABEL[s.mood]}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {!mine && (
                <div className="stamps" role="group" aria-label={`${m.displayName || 'なかま'}さんにスタンプを送る（今日あと${Math.max(0, left)}回）`}>
                  {STAMPS.map((k) => (
                    <button type="button" key={k} className="chip stamp" disabled={left <= 0 || busy === m.userId} onClick={() => stamp(m, k)}>
                      {k}
                    </button>
                  ))}
                  <span className="help">{left > 0 ? `今日あと${left}回` : '今日はもう送れません'}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="invite">
        <p>
          招待コード <code className="code num">{g.inviteCode}</code>
        </p>
        <div className="row-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={copy}>
            コードをコピー
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={p.onLeave}>
            グループを抜ける
          </button>
        </div>
      </div>
    </section>
  );
}

function GroupForms({ remote, onDone, count }: { remote: Remote; onDone: () => void; count: number }) {
  const { actions } = useStore();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<{ create?: string; join?: string }>({});
  const [busy, setBusy] = useState(false);

  async function run(kind: 'create' | 'join', fn: () => Promise<Group>) {
    if (busy) return;
    setBusy(true);
    setErr({});
    try {
      const g = await fn();
      actions.toast(kind === 'create' ? `「${g.name}」を作りました。招待コードを仲間に送ってください。` : `「${g.name}」に参加しました。`);
      setName('');
      setCode('');
      await actions.syncNow();
      onDone();
    } catch (e) {
      setErr({ [kind]: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="gf-title">
      <h2 id="gf-title" className="h2">
        {count ? 'グループを追加' : 'グループをはじめる'}
      </h2>
      <form noValidate onSubmit={(e) => { e.preventDefault(); void run('join', () => remote.joinGroup(code)); }}>
        <label className="field-label" htmlFor="gf-code">
          招待コードで参加
        </label>
        <div className="input-row">
          <input id="gf-code" className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters"
            placeholder="例：ABCD2345EF" aria-invalid={!!err.join} aria-describedby="gf-code-err" />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || code.replace(/\W/g, '').length < 6}>
            参加
          </button>
        </div>
        <FieldError id="gf-code-err">{err.join}</FieldError>
      </form>
      <form noValidate className="spaced" onSubmit={(e) => {
        e.preventDefault();
        const n = name.trim();
        if (n.length > 30) {
          setErr({ create: 'グループ名は30文字以内で入力してください。' });
          return;
        }
        void run('create', () => remote.createGroup(n || 'なかま'));
      }}>
        <label className="field-label" htmlFor="gf-name">
          新しく作る（2〜{GROUP_MAX}人）
        </label>
        <div className="input-row">
          <input id="gf-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：朝活なかま" autoComplete="off"
            aria-invalid={!!err.create} aria-describedby="gf-name-err" />
          <button type="submit" className="btn btn-outline btn-sm" disabled={busy}>
            作る
          </button>
        </div>
        <FieldError id="gf-name-err">{err.create}</FieldError>
      </form>
    </section>
  );
}

function LeaveDialog({ group, remote, onClose, onDone }: { group: Group | null; remote: Remote; onClose: () => void; onDone: () => void }) {
  const { actions } = useStore();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={!!group} onClose={onClose} title="グループを抜けますか？" role="alertdialog" busy={busy}
      description="抜けると、このグループの仲間からあなたの共有は見えなくなります。自分の記録は消えません。">
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          やめる
        </button>
        <button type="button" className="btn btn-primary btn-sm" data-autofocus disabled={busy}
          onClick={async () => {
            if (!group) return;
            setBusy(true);
            try {
              await remote.leaveGroup(group.id);
              actions.toast(`「${group.name}」を抜けました。`);
              onClose();
              onDone();
            } catch (e) {
              actions.toast(errMsg(e), { tone: 'error' });
            } finally {
              setBusy(false);
            }
          }}>
          抜ける
        </button>
      </div>
    </Dialog>
  );
}

function DeleteDialog({ open, remote, onClose }: { open: boolean; remote: Remote; onClose: () => void }) {
  const { actions } = useStore();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    if (open) setConfirm('');
  }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title="アカウントを削除しますか？" role="alertdialog" busy={busy}
      description="サーバー上のあなたのデータ（同期した記録・共有・スタンプ・グループの参加）をすべて削除します。取り消せません。この端末の記録は残ります。">
      <label className="field-label" htmlFor="del-confirm">
        確認のため「削除」と入力してください
      </label>
      <input id="del-confirm" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          やめる
        </button>
        <button type="button" className="btn btn-danger" disabled={busy || confirm.trim() !== '削除'}
          onClick={async () => {
            setBusy(true);
            try {
              await remote.deleteAccount();
              await actions.setAccount(null);
              actions.toast('アカウントを削除しました。この端末の記録は残っています。');
              onClose();
            } catch (e) {
              actions.toast(errMsg(e), { tone: 'error' });
            } finally {
              setBusy(false);
            }
          }}>
          {busy ? '削除中…' : '完全に削除する'}
        </button>
      </div>
    </Dialog>
  );
}

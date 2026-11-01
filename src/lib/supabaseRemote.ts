/**
 * Supabase 実装。公開してよい anon キーだけを使う（service_role キーは絶対に使わない）。
 * 権限はすべてサーバー側の RLS と RPC が決める（supabase/migrations）。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { RemoteError, type Group, type Remote, type RemoteItem, type SharedStatus, type Stamp, type StampKind } from './remote';
import type { OutboxItem, SyncKind } from './storage';

function toError(e: unknown): RemoteError {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/stamp_limit/.test(msg)) return new RemoteError('今日この人に送れるスタンプは3回までです。', 'limit');
  if (/group_full/.test(msg)) return new RemoteError('このグループは定員（8人）に達しています。', 'full');
  if (/too_many_groups/.test(msg)) return new RemoteError('参加できるグループは5つまでです。', 'limit');
  if (/not_found/.test(msg)) return new RemoteError('招待コードが見つかりません。もう一度確かめてください。', 'not_found');
  if (/JWT|jwt expired|refresh_token|invalid claim/i.test(msg)) return new RemoteError('ログインの有効期限が切れました。もう一度ログインしてください。', 'auth');
  if (/fetch|network|Failed to fetch/i.test(msg)) return new RemoteError('通信できませんでした。電波のよいところでもう一度お試しください。', 'network');
  return new RemoteError('うまくいきませんでした。時間をおいてもう一度お試しください。', 'unknown');
}

/**
 * コード送信の失敗を、設定の直し方が分かる文言にする。
 * どれにも当てはまらないときは、原因を調べられるようサーバーの文言も添える。
 */
export function sendCodeError(e: unknown): RemoteError {
  const err = (e ?? {}) as { message?: string; code?: string; status?: number };
  const msg = err.message ?? String(e);
  const code = err.code ?? '';
  const t = `${code} ${msg}`;
  if (/not_authorized|not authorized/i.test(t))
    return new RemoteError(
      'このメールアドレスには送れません。Supabase 標準のメール送信は、プロジェクトのチームメンバー宛てにしか送れません（別の送信サービス〈SMTP〉の設定が必要です）。',
      'auth',
    );
  if (/rate_limit|rate limit|too many|seconds/i.test(t) || err.status === 429)
    return new RemoteError('送信の上限に達しました。少し時間をおいてから、もう一度コードを送ってください（標準のメール送信は1時間に2通まで）。', 'limit');
  if (/signup_disabled|signups? not allowed|signup.*disabled/i.test(t))
    return new RemoteError('新しいユーザーの登録がオフになっています（Supabase：Authentication → Sign In / Providers → Allow new users to sign up）。', 'auth');
  if (/provider_disabled|otp_disabled|logins are disabled|provider is not enabled/i.test(t))
    return new RemoteError('メールでのログインが無効になっています（Supabase：Authentication → Sign In / Providers → Email）。', 'auth');
  if (/sending|smtp|unexpected_failure/i.test(t))
    return new RemoteError(`メールを送れませんでした。Supabase のメール送信（SMTP）の設定を確認してください。（詳細：${msg}）`, 'unknown');
  if (/invalid.*email|validate email|email_address_invalid/i.test(t)) return new RemoteError('メールアドレスを確かめてください。', 'auth');
  if (/fetch|network/i.test(t)) return new RemoteError('通信できませんでした。電波のよいところでもう一度お試しください。', 'network');
  return new RemoteError(`コードを送れませんでした。（詳細：${code ? `${code} / ` : ''}${msg.slice(0, 160)}）`, 'unknown');
}

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw toError(error);
  return data;
}

export function createSupabaseRemote(url: string, anonKey: string): Remote {
  const sb: SupabaseClient = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'tsuzuku-auth' },
  });

  async function uid(): Promise<string> {
    const { data } = await sb.auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new RemoteError('ログインしてください。', 'auth');
    return id;
  }

  return {
    available: true,
    async getUser() {
      const { data } = await sb.auth.getSession();
      const u = data.session?.user;
      return u ? { userId: u.id, email: u.email ?? '' } : null;
    },
    async sendCode(email) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw sendCodeError(error);
    },
    async verifyCode(email, code) {
      const { data, error } = await sb.auth.verifyOtp({ email, token: code.trim(), type: 'email' });
      if (error || !data.user) throw new RemoteError('コードが違うか、有効期限が切れています。', 'auth');
      return { userId: data.user.id, email: data.user.email ?? email };
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async push(items: OutboxItem[]) {
      for (let i = 0; i < items.length; i += 400) {
        const chunk = items.slice(i, i + 400).map((o) => ({ kind: o.kind, id: o.id, payload: o.payload, updatedAt: o.updatedAt }));
        await must(sb.rpc('push_items', { items: chunk }));
      }
    },
    async pull(since) {
      const out: RemoteItem[] = [];
      let from = 0;
      const page = 1000;
      // サーバー時刻を先に取ると取りこぼしが出るので、受信した最新の server_updated_at を次回の起点にする
      let latest = since;
      for (;;) {
        let q = sb
          .from('user_data')
          .select('kind,id,payload,deleted,updated_at,server_updated_at')
          .order('server_updated_at', { ascending: true })
          .range(from, from + page - 1);
        // 同時刻に確定した変更を取りこぼさないよう5秒重ねて取る（適用は冪等）
        if (since) q = q.gt('server_updated_at', new Date(Date.parse(since) - 5000).toISOString());
        const rows = await must(q);
        for (const r of (rows ?? []) as {
          kind: SyncKind;
          id: string;
          payload: unknown;
          deleted: boolean;
          updated_at: string;
          server_updated_at: string;
        }[]) {
          out.push({ kind: r.kind, id: r.id, payload: r.deleted ? null : r.payload, updatedAt: new Date(r.updated_at).toISOString() });
          if (!latest || r.server_updated_at > latest) latest = r.server_updated_at;
        }
        if (!rows || rows.length < page) break;
        from += page;
      }
      return { items: out, serverTime: latest ?? new Date(0).toISOString() };
    },
    async saveProfile(displayName, avatar) {
      const id = await uid();
      await must(sb.from('profiles').upsert({ user_id: id, display_name: displayName, avatar, updated_at: new Date().toISOString() }));
    },
    async publishShared(statuses: SharedStatus[]) {
      await must(sb.rpc('publish_shared', { statuses }));
    },
    async myGroups() {
      const data = await must(sb.rpc('my_groups'));
      return (Array.isArray(data) ? data : []) as Group[];
    },
    async createGroup(name) {
      const g = (await must(sb.rpc('create_group', { group_name: name }))) as Omit<Group, 'members'>;
      return { ...g, members: [] };
    },
    async joinGroup(code) {
      const g = (await must(sb.rpc('join_group', { code }))) as Omit<Group, 'members'>;
      return { ...g, members: [] };
    },
    async leaveGroup(groupId) {
      await must(sb.rpc('leave_group', { gid: groupId }));
    },
    async sendStamp(groupId, toUser, kind: StampKind) {
      const id = await uid();
      await must(sb.from('stamps').insert({ group_id: groupId, from_user: id, to_user: toUser, kind }));
    },
    async stampsSentToday() {
      const id = await uid();
      const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
      const rows = (await must(sb.from('stamps').select('to_user').eq('from_user', id).eq('sent_on', today))) as { to_user: string }[];
      const out: Record<string, number> = {};
      for (const r of rows) out[r.to_user] = (out[r.to_user] ?? 0) + 1;
      return out;
    },
    async stampsReceived(since) {
      const id = await uid();
      let q = sb.from('stamps').select('id,group_id,from_user,to_user,kind,created_at').eq('to_user', id).order('created_at', { ascending: false }).limit(50);
      if (since) q = q.gt('created_at', since);
      const rows = (await must(q)) as { id: string; group_id: string; from_user: string; to_user: string; kind: StampKind; created_at: string }[];
      return rows.map<Stamp>((r) => ({ id: r.id, groupId: r.group_id, fromUser: r.from_user, toUser: r.to_user, kind: r.kind, createdAt: r.created_at }));
    },
    async deleteAccount() {
      await must(sb.rpc('delete_my_account'));
      await sb.auth.signOut();
    },
  };
}

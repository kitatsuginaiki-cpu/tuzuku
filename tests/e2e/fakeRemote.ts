/**
 * E2E 用の偽サーバー（Node 側で動く）。Supabase の RLS / RPC と同じ規則をメモリ上で再現する。
 * ブラウザには window.__tsuzukuRemote として差し込み、呼び出しは exposeBinding 経由でここへ届く。
 * ※ 規則そのものの検証は supabase/tests/rls_test.sql（実際の PostgreSQL）で行う。
 */
import type { BrowserContext } from '@playwright/test';

type Kind = 'habit' | 'record' | 'review' | 'settings';
interface Row {
  kind: Kind;
  id: string;
  payload: unknown | null;
  updatedAt: string;
  serverAt: string;
}
interface Shared {
  habitId: string;
  habitName: string;
  trackingType: 'time' | 'days';
  today: string;
  todayDate: string;
  weekDays: number;
  total: number;
  mood: string | null;
  updatedAt: string;
}
class Fail extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

const tokyoDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

export class FakeBackend {
  users = new Map<string, string>(); // email → userId
  sessions = new Map<string, string>(); // clientId → userId
  profiles = new Map<string, { displayName: string; avatar: string }>();
  data = new Map<string, Map<string, Row>>();
  groups = new Map<string, { id: string; name: string; inviteCode: string; members: { userId: string; joinedAt: number }[] }>();
  shared = new Map<string, Shared[]>();
  stamps: { id: string; groupId: string; fromUser: string; toUser: string; kind: string; createdAt: string; sentOn: string }[] = [];
  calls: { client: string; method: string }[] = [];
  private seq = 0;
  private tick = 0;

  private now() {
    // サーバー時刻は単調増加（同時刻の取りこぼし検証を簡単にする）
    return new Date(Date.UTC(2026, 0, 1) + ++this.tick * 1000).toISOString();
  }
  private me(client: string) {
    const u = this.sessions.get(client);
    if (!u) throw new Fail('ログインしてください。', 'auth');
    return u;
  }
  private peers(u: string) {
    const out = new Set<string>();
    for (const g of this.groups.values()) if (g.members.some((m) => m.userId === u)) for (const m of g.members) out.add(m.userId);
    return out;
  }
  private groupView(g: { id: string; name: string; inviteCode: string; members: { userId: string; joinedAt: number }[] }) {
    return {
      id: g.id,
      name: g.name,
      inviteCode: g.inviteCode,
      members: g.members.map((m) => ({
        userId: m.userId,
        displayName: this.profiles.get(m.userId)?.displayName ?? '',
        avatar: this.profiles.get(m.userId)?.avatar ?? 'green',
        statuses: this.shared.get(m.userId) ?? [],
      })),
    };
  }
  /** テスト用：グループに架空の参加者を足す（定員の確認用。記録は作らない） */
  fillGroup(code: string, n: number) {
    const g = [...this.groups.values()].find((x) => x.inviteCode === code)!;
    for (let i = 0; i < n; i++) {
      const id = `filler-${++this.seq}`;
      g.members.push({ userId: id, joinedAt: Date.now() + i });
    }
  }
  userIdOf(email: string) {
    return this.users.get(email);
  }

  call(client: string, method: string, args: unknown[]): unknown {
    this.calls.push({ client, method });
    switch (method) {
      case 'getUser': {
        const u = this.sessions.get(client);
        if (!u) return null;
        const email = [...this.users.entries()].find(([, id]) => id === u)?.[0] ?? '';
        return { userId: u, email };
      }
      case 'sendCode':
        return null;
      case 'verifyCode': {
        const [email, code] = args as [string, string];
        if (code !== '123456') throw new Fail('コードが違うか、有効期限が切れています。', 'auth');
        let id = this.users.get(email);
        if (!id) {
          id = `user-${++this.seq}`;
          this.users.set(email, id);
        }
        this.sessions.set(client, id);
        return { userId: id, email };
      }
      case 'signOut':
        this.sessions.delete(client);
        return null;
      case 'push': {
        const u = this.me(client);
        const [items] = args as [{ kind: Kind; id: string; payload: unknown; updatedAt: string }[]];
        const m = this.data.get(u) ?? new Map<string, Row>();
        for (const it of items) {
          const k = `${it.kind}:${it.id}`;
          const cur = m.get(k);
          if (cur && cur.updatedAt >= it.updatedAt) continue; // LWW
          m.set(k, { kind: it.kind, id: it.id, payload: it.payload ?? null, updatedAt: it.updatedAt, serverAt: this.now() });
        }
        this.data.set(u, m);
        return null;
      }
      case 'pull': {
        const u = this.me(client);
        const [since] = args as [string | null];
        const rows = [...(this.data.get(u)?.values() ?? [])].filter((r) => !since || r.serverAt > since);
        const latest = rows.reduce((m, r) => (r.serverAt > m ? r.serverAt : m), since ?? new Date(0).toISOString());
        return { items: rows.map((r) => ({ kind: r.kind, id: r.id, payload: r.payload, updatedAt: r.updatedAt })), serverTime: latest };
      }
      case 'saveProfile': {
        const u = this.me(client);
        const [displayName, avatar] = args as [string, string];
        this.profiles.set(u, { displayName, avatar });
        return null;
      }
      case 'publishShared': {
        const u = this.me(client);
        this.shared.set(u, (args[0] as Shared[]).slice(0, 12));
        return null;
      }
      case 'myGroups': {
        const u = this.me(client);
        return [...this.groups.values()].filter((g) => g.members.some((m) => m.userId === u)).map((g) => this.groupView(g));
      }
      case 'createGroup': {
        const u = this.me(client);
        const id = `g-${++this.seq}`;
        const inviteCode = `CODE${String(this.seq).padStart(6, '0')}`;
        const g = { id, name: String(args[0] || 'なかま').slice(0, 30), inviteCode, members: [{ userId: u, joinedAt: Date.now() }] };
        this.groups.set(id, g);
        return { ...this.groupView(g), members: [] };
      }
      case 'joinGroup': {
        const u = this.me(client);
        const code = String(args[0]).toUpperCase().replace(/[^A-Z0-9]/g, '');
        const g = [...this.groups.values()].find((x) => x.inviteCode === code);
        if (!g) throw new Fail('招待コードが見つかりません。もう一度確かめてください。', 'not_found');
        if (!g.members.some((m) => m.userId === u)) {
          if (g.members.length >= 8) throw new Fail('このグループは定員（8人）に達しています。', 'full');
          g.members.push({ userId: u, joinedAt: Date.now() });
        }
        return { ...this.groupView(g), members: [] };
      }
      case 'leaveGroup': {
        const u = this.me(client);
        const g = this.groups.get(String(args[0]));
        if (g) {
          g.members = g.members.filter((m) => m.userId !== u);
          if (!g.members.length) this.groups.delete(g.id);
        }
        return null;
      }
      case 'sendStamp': {
        const u = this.me(client);
        const [groupId, toUser, kind] = args as [string, string, string];
        const g = this.groups.get(groupId);
        if (!g || !g.members.some((m) => m.userId === u) || !g.members.some((m) => m.userId === toUser) || u === toUser) throw new Fail('送れませんでした。', 'unknown');
        if (!['やろう', 'おつかれ', '見てるよ'].includes(kind)) throw new Fail('送れませんでした。', 'unknown');
        const day = tokyoDate();
        if (this.stamps.filter((s) => s.fromUser === u && s.toUser === toUser && s.sentOn === day).length >= 3)
          throw new Fail('今日この人に送れるスタンプは3回までです。', 'limit');
        this.stamps.push({ id: `s-${++this.seq}`, groupId, fromUser: u, toUser, kind, createdAt: new Date().toISOString(), sentOn: day });
        return null;
      }
      case 'stampsSentToday': {
        const u = this.me(client);
        const day = tokyoDate();
        const out: Record<string, number> = {};
        for (const s of this.stamps) if (s.fromUser === u && s.sentOn === day) out[s.toUser] = (out[s.toUser] ?? 0) + 1;
        return out;
      }
      case 'stampsReceived': {
        const u = this.me(client);
        return this.stamps.filter((s) => s.toUser === u).map(({ sentOn: _s, ...x }) => x).reverse();
      }
      case 'deleteAccount': {
        const u = this.me(client);
        this.data.delete(u);
        this.shared.delete(u);
        this.profiles.delete(u);
        this.stamps = this.stamps.filter((s) => s.fromUser !== u && s.toUser !== u);
        for (const g of [...this.groups.values()]) {
          g.members = g.members.filter((m) => m.userId !== u);
          if (!g.members.length) this.groups.delete(g.id);
        }
        for (const [e, id] of [...this.users.entries()]) if (id === u) this.users.delete(e);
        for (const [c, id] of [...this.sessions.entries()]) if (id === u) this.sessions.delete(c);
        return null;
      }
    }
    throw new Fail(`unknown method ${method}`, 'unknown');
  }

  /** ブラウザのコンテキスト（1台の端末）をこの偽サーバーにつなぐ */
  async attach(context: BrowserContext, client: string) {
    await context.exposeBinding('__fakeRemote', (_src, method: string, args: unknown[]) => {
      try {
        return { ok: this.call(client, method, args) };
      } catch (e) {
        const f = e as Fail;
        return { error: { message: f.message, code: f.code ?? 'unknown' } };
      }
    });
    await context.addInitScript(() => {
      const methods = [
        'getUser', 'sendCode', 'verifyCode', 'signOut', 'push', 'pull', 'saveProfile', 'publishShared', 'myGroups',
        'createGroup', 'joinGroup', 'leaveGroup', 'sendStamp', 'stampsSentToday', 'stampsReceived', 'deleteAccount',
      ];
      const w = window as unknown as Record<string, unknown> & { __fakeRemote: (m: string, a: unknown[]) => Promise<{ ok?: unknown; error?: { message: string; code: string } }> };
      const remote: Record<string, unknown> = { available: true };
      for (const m of methods)
        remote[m] = async (...args: unknown[]) => {
          const r = await w.__fakeRemote(m, JSON.parse(JSON.stringify(args)));
          if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
          return r.ok;
        };
      w.__tsuzukuRemote = remote;
    });
  }
}

/**
 * サーバーとの境界（共有グループ・端末間同期）。
 * 実装：Supabase（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が設定されたとき）。
 * 未設定なら unavailable（アプリはローカルだけで動く）。
 * テストでは window.__tsuzukuRemote に同じインターフェースの実装を差し込む。
 */
import type { SharedMood } from './character';
import type { OutboxItem, SyncKind } from './storage';

export interface RemoteUser {
  userId: string;
  email: string;
}

export interface RemoteItem {
  kind: SyncKind;
  id: string;
  payload: unknown | null;
  updatedAt: string;
}

/** 仲間に見せる要約（本人が共有をオンにした習慣だけ） */
export interface SharedStatus {
  habitId: string;
  habitName: string;
  trackingType: 'time' | 'days';
  /** 今日の状態 */
  today: 'done' | 'small' | 'rest' | 'none';
  todayDate: string;
  /** 直近7日でやった日数 */
  weekDays: number;
  /** 積み上げ（時間型＝分、日数型＝日） */
  total: number;
  mood: SharedMood | null;
  updatedAt: string;
}

export interface Member {
  userId: string;
  displayName: string;
  avatar: string;
  statuses: SharedStatus[];
}

export interface Group {
  id: string;
  name: string;
  inviteCode: string;
  members: Member[];
}

export const STAMPS = ['やろう', 'おつかれ', '見てるよ'] as const;
export type StampKind = (typeof STAMPS)[number];
export const STAMP_DAILY_LIMIT = 3;
export const GROUP_MAX = 8;

export interface Stamp {
  id: string;
  groupId: string;
  fromUser: string;
  toUser: string;
  kind: StampKind;
  createdAt: string;
}

export interface Remote {
  readonly available: boolean;
  /** 現在ログイン中のユーザー */
  getUser(): Promise<RemoteUser | null>;
  /** メールに6桁のコードを送る */
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<RemoteUser>;
  signOut(): Promise<void>;
  /** 自分のデータ（習慣・記録・見直し・設定）を送る。新しい updatedAt だけが反映される */
  push(items: OutboxItem[]): Promise<void>;
  /** since 以降に更新された自分のデータ */
  pull(since: string | null): Promise<{ items: RemoteItem[]; serverTime: string }>;
  saveProfile(displayName: string, avatar: string): Promise<void>;
  /** 共有をオンにした習慣の要約を置き換える（オフの習慣は消える） */
  publishShared(statuses: SharedStatus[]): Promise<void>;
  myGroups(): Promise<Group[]>;
  createGroup(name: string): Promise<Group>;
  joinGroup(inviteCode: string): Promise<Group>;
  leaveGroup(groupId: string): Promise<void>;
  sendStamp(groupId: string, toUser: string, kind: StampKind): Promise<void>;
  /** 今日、自分が相手に送ったスタンプ数（相手ごと） */
  stampsSentToday(): Promise<Record<string, number>>;
  /** 自分に届いたスタンプ（直近） */
  stampsReceived(since: string | null): Promise<Stamp[]>;
  /** アカウントと全データの削除 */
  deleteAccount(): Promise<void>;
}

export class RemoteError extends Error {
  constructor(
    message: string,
    public code: 'unavailable' | 'auth' | 'limit' | 'not_found' | 'full' | 'network' | 'unknown' = 'unknown',
  ) {
    super(message);
  }
}

const unavailable: Remote = {
  available: false,
  async getUser() {
    return null;
  },
  async sendCode() {
    throw new RemoteError('共有機能はまだ設定されていません。', 'unavailable');
  },
  async verifyCode() {
    throw new RemoteError('共有機能はまだ設定されていません。', 'unavailable');
  },
  async signOut() {},
  async push() {},
  async pull() {
    return { items: [], serverTime: new Date().toISOString() };
  },
  async saveProfile() {},
  async publishShared() {},
  async myGroups() {
    return [];
  },
  async createGroup() {
    throw new RemoteError('共有機能はまだ設定されていません。', 'unavailable');
  },
  async joinGroup() {
    throw new RemoteError('共有機能はまだ設定されていません。', 'unavailable');
  },
  async leaveGroup() {},
  async sendStamp() {
    throw new RemoteError('共有機能はまだ設定されていません。', 'unavailable');
  },
  async stampsSentToday() {
    return {};
  },
  async stampsReceived() {
    return [];
  },
  async deleteAccount() {},
};

declare global {
  interface Window {
    __tsuzukuRemote?: Remote;
  }
}

let cached: Remote | null = null;

/**
 * 同期・仲間の機能スイッチ。
 * 本物の Supabase と実機での検証が終わるまで、本番では止めておく（端末1台で安全に使うため）。
 * - 有効にするには VITE_SYNC_ENABLED=true でビルドする。
 * - E2E テストでは、偽サーバー（window.__tsuzukuRemote）を差し込んだときだけ有効になる。
 * 無効のときはサーバーへの通信を一切しない（送信待ちも作らない）。
 */
export function syncEnabled(): boolean {
  if (typeof window !== 'undefined' && window.__tsuzukuRemote) return true;
  return import.meta.env.VITE_SYNC_ENABLED === 'true';
}

export async function getRemote(): Promise<Remote> {
  if (cached) return cached;
  if (!syncEnabled()) return (cached = unavailable);
  if (typeof window !== 'undefined' && window.__tsuzukuRemote) return (cached = window.__tsuzukuRemote);
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && key) {
    const { createSupabaseRemote } = await import('./supabaseRemote');
    return (cached = createSupabaseRemote(url, key));
  }
  return (cached = unavailable);
}

-- つづく。v7：端末間同期と「仲間」機能
-- 方針
--  * 自分のデータ（user_data）は本人しか読めない・書けない。
--  * 仲間に見えるのは、本人が共有をオンにした習慣の要約（shared_status）と、表示名・アバター（profiles）だけ。
--  * グループの作成・参加・退出はRPC経由（招待コードの総当たり・上限超過を防ぐ）。
--  * スタンプは 1日・相手ごとに3回まで（トリガーで強制）。ランキングやコメントはない。
--  * アカウント削除で全データが消える（auth.users の ON DELETE CASCADE）。

-- ---------------------------------------------------------------- tables

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 20),
  avatar text not null default 'green' check (avatar in ('green','blue','orange','pink','purple','gray')),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_data (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('habit','record','review','settings')),
  id text not null check (char_length(id) between 1 and 80),
  payload jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null,            -- 端末で変更した時刻（競合の判定に使う）
  server_updated_at timestamptz not null default now(), -- 受信の差分取得に使う
  primary key (user_id, kind, id),
  check (pg_column_size(payload) <= 32768)
);
create index if not exists user_data_pull on public.user_data (user_id, server_updated_at);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 30),
  invite_code text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user on public.group_members (user_id);

create table if not exists public.shared_status (
  user_id uuid not null references auth.users (id) on delete cascade,
  habit_id text not null check (char_length(habit_id) between 1 and 80),
  habit_name text not null check (char_length(habit_name) <= 30),
  tracking_type text not null check (tracking_type in ('time','days')),
  today text not null check (today in ('done','small','rest','none')),
  today_date date not null,
  week_days int not null check (week_days between 0 and 7),
  total int not null check (total >= 0),
  mood text check (mood in ('happy','normal','waiting','worried','angry')),
  updated_at timestamptz not null default now(),
  primary key (user_id, habit_id)
);

create table if not exists public.stamps (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('やろう','おつかれ','見てるよ')),
  sent_on date not null default (now() at time zone 'Asia/Tokyo')::date,
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);
create index if not exists stamps_to on public.stamps (to_user, created_at);
create index if not exists stamps_pair_day on public.stamps (from_user, to_user, sent_on);

-- ---------------------------------------------------------------- helpers
-- RLS の中で group_members を参照すると再帰するため、SECURITY DEFINER の関数で判定する。

create or replace function public.my_group_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select group_id from public.group_members where user_id = auth.uid()
$$;

create or replace function public.is_group_member(g uuid, u uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = g and user_id = u)
$$;

create or replace function public.is_group_peer(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members a
    join public.group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = other
  )
$$;

revoke all on function public.my_group_ids() from public;
revoke all on function public.is_group_member(uuid, uuid) from public;
revoke all on function public.is_group_peer(uuid) from public;
grant execute on function public.my_group_ids() to authenticated;
grant execute on function public.is_group_member(uuid, uuid) to authenticated;
grant execute on function public.is_group_peer(uuid) to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.profiles enable row level security;
alter table public.user_data enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.shared_status enable row level security;
alter table public.stamps enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.is_group_peer(user_id));
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_data_own on public.user_data;
create policy user_data_own on public.user_data for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated
  using (id in (select public.my_group_ids()));

drop policy if exists members_select on public.group_members;
create policy members_select on public.group_members for select to authenticated
  using (group_id in (select public.my_group_ids()));

drop policy if exists shared_select on public.shared_status;
create policy shared_select on public.shared_status for select to authenticated
  using (user_id = auth.uid() or public.is_group_peer(user_id));
drop policy if exists shared_write on public.shared_status;
create policy shared_write on public.shared_status for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists shared_update on public.shared_status;
create policy shared_update on public.shared_status for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists shared_delete on public.shared_status;
create policy shared_delete on public.shared_status for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists stamps_select on public.stamps;
create policy stamps_select on public.stamps for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());
drop policy if exists stamps_insert on public.stamps;
create policy stamps_insert on public.stamps for insert to authenticated
  with check (
    from_user = auth.uid()
    and public.is_group_member(group_id, auth.uid())
    and public.is_group_member(group_id, to_user)
  );

-- 権限（テーブル単位）。RLS と合わせて、許可した操作だけが通る。
revoke all on public.profiles, public.user_data, public.groups, public.group_members, public.shared_status, public.stamps from anon, public;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_data to authenticated;
grant select on public.groups, public.group_members to authenticated;
grant select, insert, update, delete on public.shared_status to authenticated;
grant select, insert on public.stamps to authenticated;

-- ---------------------------------------------------------------- triggers

-- スタンプ：1日・相手ごとに3回まで。日付はサーバーが決める（端末の時計は信用しない）。
create or replace function public.stamps_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.sent_on := (now() at time zone 'Asia/Tokyo')::date;
  new.created_at := now();
  perform pg_advisory_xact_lock(hashtext(new.from_user::text || new.to_user::text));
  if (select count(*) from public.stamps
      where from_user = new.from_user and to_user = new.to_user and sent_on = new.sent_on) >= 3 then
    raise exception 'stamp_limit' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists stamps_limit on public.stamps;
create trigger stamps_limit before insert on public.stamps for each row execute function public.stamps_limit();

-- ---------------------------------------------------------------- RPC

-- 同期：送信（新しい updated_at だけ反映＝Last-Write-Wins）
create or replace function public.push_items(items jsonb)
returns int language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'auth' using errcode = '28000'; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 500 then
    raise exception 'bad_items' using errcode = '22023';
  end if;
  insert into public.user_data as u (user_id, kind, id, payload, deleted, updated_at, server_updated_at)
  select auth.uid(), i->>'kind', i->>'id',
         case when i->'payload' = 'null'::jsonb then null else i->'payload' end,
         (i->'payload' is null or i->'payload' = 'null'::jsonb),
         (i->>'updatedAt')::timestamptz, now()
  from jsonb_array_elements(items) i
  on conflict (user_id, kind, id) do update
    set payload = excluded.payload, deleted = excluded.deleted,
        updated_at = excluded.updated_at, server_updated_at = now()
    where u.updated_at < excluded.updated_at;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.push_items(jsonb) to authenticated;

-- 招待コード：紛らわしい文字（I, O, 0, 1）を除いた32文字 × 10桁（約50ビット）
create or replace function public.new_invite_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := uuid_send(gen_random_uuid());
  c text := '';
begin
  for i in 0..9 loop
    c := c || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return c;
end $$;
revoke all on function public.new_invite_code() from public;

create or replace function public.create_group(group_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.groups; code text;
begin
  if auth.uid() is null then raise exception 'auth' using errcode = '28000'; end if;
  if (select count(*) from public.group_members where user_id = auth.uid()) >= 5 then
    raise exception 'too_many_groups' using errcode = 'P0001';
  end if;
  loop
    code := public.new_invite_code();
    exit when not exists (select 1 from public.groups where invite_code = code);
  end loop;
  insert into public.groups (name, invite_code, created_by)
    values (left(coalesce(nullif(trim(group_name), ''), 'なかま'), 30), code, auth.uid())
    returning * into g;
  insert into public.group_members (group_id, user_id) values (g.id, auth.uid());
  return jsonb_build_object('id', g.id, 'name', g.name, 'inviteCode', g.invite_code);
end $$;
grant execute on function public.create_group(text) to authenticated;

create or replace function public.join_group(code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  if auth.uid() is null then raise exception 'auth' using errcode = '28000'; end if;
  select * into g from public.groups where invite_code = upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g'));
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtext(g.id::text));
  if exists (select 1 from public.group_members where group_id = g.id and user_id = auth.uid()) then
    return jsonb_build_object('id', g.id, 'name', g.name, 'inviteCode', g.invite_code);
  end if;
  if (select count(*) from public.group_members where group_id = g.id) >= 8 then
    raise exception 'group_full' using errcode = 'P0001';
  end if;
  if (select count(*) from public.group_members where user_id = auth.uid()) >= 5 then
    raise exception 'too_many_groups' using errcode = 'P0001';
  end if;
  insert into public.group_members (group_id, user_id) values (g.id, auth.uid());
  return jsonb_build_object('id', g.id, 'name', g.name, 'inviteCode', g.invite_code);
end $$;
grant execute on function public.join_group(text) to authenticated;

create or replace function public.leave_group(gid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'auth' using errcode = '28000'; end if;
  delete from public.group_members where group_id = gid and user_id = auth.uid();
  delete from public.groups g where g.id = gid
    and not exists (select 1 from public.group_members m where m.group_id = gid);
end $$;
grant execute on function public.leave_group(uuid) to authenticated;

-- 自分が入っているグループと、仲間の表示名・共有中の要約
create or replace function public.my_groups()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'name', g.name, 'inviteCode', g.invite_code,
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'userId', m.user_id,
        'displayName', coalesce(p.display_name, ''),
        'avatar', coalesce(p.avatar, 'green'),
        'statuses', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'habitId', s.habit_id, 'habitName', s.habit_name, 'trackingType', s.tracking_type,
            'today', s.today, 'todayDate', s.today_date, 'weekDays', s.week_days,
            'total', s.total, 'mood', s.mood, 'updatedAt', s.updated_at
          ) order by s.habit_name), '[]'::jsonb)
          from public.shared_status s where s.user_id = m.user_id
        )
      ) order by m.joined_at), '[]'::jsonb)
      from public.group_members m left join public.profiles p on p.user_id = m.user_id
      where m.group_id = g.id
    )
  ) order by g.created_at), '[]'::jsonb)
  from public.groups g
  where g.id in (select group_id from public.group_members where user_id = auth.uid())
$$;
grant execute on function public.my_groups() to authenticated;

-- 共有中の要約をまとめて置き換える（共有をオフにした習慣は消える）
create or replace function public.publish_shared(statuses jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'auth' using errcode = '28000'; end if;
  if jsonb_typeof(statuses) <> 'array' or jsonb_array_length(statuses) > 12 then
    raise exception 'bad_items' using errcode = '22023';
  end if;
  delete from public.shared_status where user_id = auth.uid()
    and habit_id not in (select s->>'habitId' from jsonb_array_elements(statuses) s);
  insert into public.shared_status as t (user_id, habit_id, habit_name, tracking_type, today, today_date, week_days, total, mood, updated_at)
  select auth.uid(), s->>'habitId', left(s->>'habitName', 30), s->>'trackingType', s->>'today',
         (s->>'todayDate')::date, (s->>'weekDays')::int, (s->>'total')::int, nullif(s->>'mood', ''), now()
  from jsonb_array_elements(statuses) s
  on conflict (user_id, habit_id) do update set
    habit_name = excluded.habit_name, tracking_type = excluded.tracking_type, today = excluded.today,
    today_date = excluded.today_date, week_days = excluded.week_days, total = excluded.total,
    mood = excluded.mood, updated_at = now();
end $$;
grant execute on function public.publish_shared(jsonb) to authenticated;

-- アカウントと全データを削除
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'auth' using errcode = '28000'; end if;
  -- 自分しかいないグループは消す（他の人がいるグループは残る）
  delete from public.groups g where g.id in (select group_id from public.group_members where user_id = me)
    and (select count(*) from public.group_members m where m.group_id = g.id) = 1;
  delete from auth.users where id = me;
end $$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- 未ログイン（anon）からは RPC を呼べないようにする（Supabase は既定で anon にも実行権限を付けるため明示的に外す）
revoke execute on function public.push_items(jsonb), public.create_group(text), public.join_group(text),
  public.leave_group(uuid), public.my_groups(), public.publish_shared(jsonb), public.delete_my_account(),
  public.my_group_ids(), public.is_group_member(uuid, uuid), public.is_group_peer(uuid), public.new_invite_code()
  from public, anon;

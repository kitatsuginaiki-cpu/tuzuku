-- RLS・RPC の検証。失敗すると例外で止まる（psql -v ON_ERROR_STOP=1）。
\set ON_ERROR_STOP 1
insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'c@example.com');

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.expect_error(sql text, pattern text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlerrm ~ pattern then return; end if;
    raise exception 'expected error % but got: %', pattern, sqlerrm;
  end;
  raise exception 'expected error % but statement succeeded: %', pattern, sql;
end $$;
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ASSERT FAILED: %', msg; end if; end $$;

-- 1) 自分のデータは本人だけ
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.push_items('[{"kind":"record","id":"r1","payload":{"id":"r1","minutes":20,"note":"秘密のメモ"},"updatedAt":"2026-10-20T10:00:00Z"}]');
select pg_temp.assert((select count(*) from public.user_data) = 1, 'A sees own data');
-- 古い updatedAt は反映されない（LWW）
select public.push_items('[{"kind":"record","id":"r1","payload":{"id":"r1","minutes":5},"updatedAt":"2026-10-19T10:00:00Z"}]');
select pg_temp.assert((select (payload->>'minutes')::int from public.user_data where id = 'r1') = 20, 'LWW keeps newer');
-- 新しい削除は反映される
select public.push_items('[{"kind":"record","id":"r1","payload":null,"updatedAt":"2026-10-21T10:00:00Z"}]');
select pg_temp.assert((select deleted from public.user_data where id = 'r1'), 'tombstone applied');
select public.push_items('[{"kind":"record","id":"r2","payload":{"id":"r2","minutes":30},"updatedAt":"2026-10-21T10:00:00Z"}]');
-- 他人の user_id では書けない
select pg_temp.expect_error($$insert into public.user_data (user_id, kind, id, payload, updated_at) values ('00000000-0000-0000-0000-00000000000b','record','x','{}',now())$$, 'row-level security');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.assert((select count(*) from public.user_data) = 0, 'B cannot see A data');
update public.user_data set payload = '{}' where user_id = '00000000-0000-0000-0000-00000000000a';
delete from public.user_data where user_id = '00000000-0000-0000-0000-00000000000a';
reset role;
select pg_temp.assert((select count(*) from public.user_data where user_id = '00000000-0000-0000-0000-00000000000a') = 2, 'B cannot modify A data');

-- 2) グループに入る前は、他人の共有・プロフィールは見えない
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.profiles (user_id, display_name, avatar) values ('00000000-0000-0000-0000-00000000000a', 'あ', 'blue');
select public.publish_shared('[{"habitId":"h1","habitName":"簿記3級","trackingType":"time","today":"done","todayDate":"2026-10-21","weekDays":3,"total":1200,"mood":"happy"}]');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.profiles (user_id, display_name) values ('00000000-0000-0000-0000-00000000000b', 'び');
select pg_temp.assert((select count(*) from public.shared_status) = 0, 'B cannot see A shared before group');
select pg_temp.assert((select count(*) from public.profiles) = 1, 'B sees only own profile');
-- 他人の共有は書けない
select pg_temp.expect_error($$insert into public.shared_status (user_id, habit_id, habit_name, tracking_type, today, today_date, week_days, total) values ('00000000-0000-0000-0000-00000000000a','hx','x','days','none','2026-10-21',0,0)$$, 'row-level security');
-- グループは直接作れない（RPC のみ）
select pg_temp.expect_error($$insert into public.groups (name, invite_code) values ('x', 'AAAA')$$, 'permission denied');
select pg_temp.expect_error($$insert into public.group_members (group_id, user_id) values (gen_random_uuid(), auth.uid())$$, 'permission denied');
reset role;

-- 3) 招待コードで参加 → 共有中の要約だけ見える
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
create temp table g as select public.create_group('朝活') as j;
reset role;
grant select on g to authenticated;
select pg_temp.assert((select length(j->>'inviteCode') from g) = 10, 'invite code length');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select public.join_group('NOPE000000')$$, 'not_found');
select public.join_group(lower((select j->>'inviteCode' from g)));
select pg_temp.assert((select count(*) from public.shared_status) = 1, 'B sees A shared after join');
select pg_temp.assert((select count(*) from public.user_data) = 0, 'B still cannot see A raw data');
select pg_temp.assert((select count(*) from public.profiles) = 2, 'B sees A profile after join');
select pg_temp.assert(jsonb_array_length((public.my_groups()->0)->'members') = 2, 'my_groups lists 2 members');
select pg_temp.assert(((public.my_groups()->0)->'members'->0->'statuses'->0->>'total')::int = 1200, 'my_groups shows status');
reset role;

-- C は無関係：何も見えない
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.assert((select count(*) from public.groups) = 0, 'C sees no groups');
select pg_temp.assert((select count(*) from public.shared_status) = 0, 'C sees no shared');
select pg_temp.assert(jsonb_array_length(public.my_groups()) = 0, 'C my_groups empty');
-- C はグループ外の相手にスタンプを送れない
select pg_temp.expect_error(format($$insert into public.stamps (group_id, from_user, to_user, kind) values (%L, auth.uid(), '00000000-0000-0000-0000-00000000000a', 'やろう')$$, (select (j->>'id') from g)), 'row-level security');
reset role;

-- 4) スタンプ：1日・相手ごとに3回まで、なりすまし不可
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($$insert into public.stamps (group_id, from_user, to_user, kind) values (%L, auth.uid(), '00000000-0000-0000-0000-00000000000a', 'ばか')$$, (select j->>'id' from g)), 'check constraint');
insert into public.stamps (group_id, from_user, to_user, kind) select (j->>'id')::uuid, auth.uid(), '00000000-0000-0000-0000-00000000000a', 'やろう' from g;
insert into public.stamps (group_id, from_user, to_user, kind) select (j->>'id')::uuid, auth.uid(), '00000000-0000-0000-0000-00000000000a', 'おつかれ' from g;
insert into public.stamps (group_id, from_user, to_user, kind) select (j->>'id')::uuid, auth.uid(), '00000000-0000-0000-0000-00000000000a', '見てるよ' from g;
select pg_temp.expect_error(format($$insert into public.stamps (group_id, from_user, to_user, kind) values (%L, auth.uid(), '00000000-0000-0000-0000-00000000000a', 'やろう')$$, (select j->>'id' from g)), 'stamp_limit');
select pg_temp.expect_error(format($$insert into public.stamps (group_id, from_user, to_user, kind) values (%L, '00000000-0000-0000-0000-00000000000a', auth.uid(), 'やろう')$$, (select j->>'id' from g)), 'row-level security');
select pg_temp.expect_error($$update public.stamps set kind = 'やろう'$$, 'permission denied');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.assert((select count(*) from public.stamps where to_user = auth.uid()) = 3, 'A receives 3 stamps');
reset role;

-- 5) 定員8人
do $$ declare i int; begin
  for i in 1..7 loop
    insert into auth.users values (('00000000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'))::uuid, null);
  end loop;
end $$;
do $$ declare i int; code text; ok int := 0; begin
  select j->>'inviteCode' into code from g;
  for i in 1..7 loop
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'), false);
    set role authenticated;
    begin
      perform public.join_group(code);
      ok := ok + 1;
    exception when others then
      if sqlerrm <> 'group_full' then raise; end if;
    end;
    reset role;
  end loop;
  if ok <> 6 then raise exception 'ASSERT FAILED: expected 6 joins (total 8), got %', ok; end if;
end $$;
select pg_temp.assert((select count(*) from public.group_members) = 8, 'group capped at 8');

-- 6) 共有をオフ → 仲間から消える
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.publish_shared('[]');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.assert((select count(*) from public.shared_status) = 0, 'unshared disappears');
-- 退出 → もう見えない
select public.leave_group((select (j->>'id')::uuid from g));
select pg_temp.assert((select count(*) from public.groups) = 0, 'B left group');
select pg_temp.assert((select count(*) from public.profiles) = 1, 'B no longer sees A profile');
reset role;

-- 7) アカウント削除で全データが消える
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.delete_my_account();
reset role;
select pg_temp.assert((select count(*) from auth.users where id = '00000000-0000-0000-0000-00000000000a') = 0, 'user deleted');
select pg_temp.assert((select count(*) from public.user_data where user_id = '00000000-0000-0000-0000-00000000000a') = 0, 'data deleted');
select pg_temp.assert((select count(*) from public.stamps where to_user = '00000000-0000-0000-0000-00000000000a') = 0, 'stamps deleted');
select pg_temp.assert((select count(*) from public.groups) = 1, 'group with other members remains');

-- 8) 未ログイン（anon）は何もできない
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select pg_temp.expect_error($$select * from public.user_data$$, 'permission denied');
select pg_temp.expect_error($$select public.create_group('x')$$, 'permission denied');
select pg_temp.expect_error($$select public.my_groups()$$, 'permission denied');
select pg_temp.expect_error($$select public.join_group('AAAA')$$, 'permission denied');
reset role;

select 'ALL RLS TESTS PASSED' as result;

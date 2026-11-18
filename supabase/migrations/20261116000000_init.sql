-- 就活しめきりボード: データベース定義
--
-- ・entries            エントリー（企業 × 締切）。利用者本人だけが読み書きできる（RLS）
-- ・user_settings      利用者ごとの設定
-- ・push_subscriptions プッシュ通知の宛先（端末ごと）
-- ・reminder_log       送信済みリマインダーの記録（二重送信の防止）
--
-- 締切の5分おきの確認は pg_cron → pg_net → Edge Function「push」で行う。

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- entries
-- ---------------------------------------------------------------------------
create table public.entries (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company       text not null check (char_length(company) between 1 and 100),
  kind          text not null default '' check (char_length(kind) <= 40),
  platform      text not null default '' check (char_length(platform) <= 40),
  deadline_date date,
  deadline_time time,
  event_date    date,
  event_time    time,
  status        text not null default 'undecided' check (status in ('undecided', 'submitted', 'skipped')),
  step          text not null default '' check (char_length(step) <= 40),
  checklist     jsonb not null default '[]'::jsonb
                check (jsonb_typeof(checklist) = 'array' and pg_column_size(checklist) <= 20000),
  url           text not null default '' check (char_length(url) <= 2000),
  memo          text not null default '' check (char_length(memo) <= 2000),
  is_sample     boolean not null default false,
  -- 端末側で最後に編集した時刻。新しい編集だけを受け付ける（下のトリガー）
  edited_at     timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- 削除は「削除済みの印」を付ける方式。ほかの端末に削除を伝えるため
  deleted_at    timestamptz,
  -- 締切の瞬間（日本時間）。時刻未定の締切はその日の 23:59:59 として扱う
  deadline_at   timestamptz generated always as (
    (deadline_date + coalesce(deadline_time, time '23:59:59')) at time zone 'Asia/Tokyo'
  ) stored,
  check (deadline_time is null or deadline_date is not null),
  check (event_time is null or event_date is not null)
);

create index entries_user_idx on public.entries (user_id) where deleted_at is null;
create index entries_due_idx on public.entries (deadline_at) where deleted_at is null and status = 'undecided';
create index entries_deleted_idx on public.entries (deleted_at) where deleted_at is not null;

create function public.entries_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 端末の時計が大きく進んでいても、未来の時刻は受け付けない
  if new.edited_at > now() + interval '10 minutes' then
    new.edited_at := now();
  end if;

  if tg_op = 'UPDATE' then
    -- 古い編集（別の端末がオフラインの間にためていた変更など）で新しい内容を上書きしない
    if new.edited_at < old.edited_at then
      return null;
    end if;
    new.user_id := old.user_id;
  else
    if (select count(*) from public.entries e where e.user_id = new.user_id and e.deleted_at is null) >= 1000 then
      raise exception 'エントリーは1000件まで登録できます' using errcode = 'check_violation';
    end if;
  end if;

  new.updated_at := now();
  return new;
end
$$;

create trigger entries_before_write
before insert or update on public.entries
for each row execute function public.entries_before_write();

alter table public.entries enable row level security;

create policy "entries: 本人だけ読める" on public.entries
  for select to authenticated using (user_id = (select auth.uid()));
create policy "entries: 本人だけ追加できる" on public.entries
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "entries: 本人だけ更新できる" on public.entries
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.entries from anon, authenticated;
grant select, insert, update on public.entries to authenticated;
grant all on public.entries to service_role;

-- ---------------------------------------------------------------------------
-- user_settings
-- ---------------------------------------------------------------------------
create table public.user_settings (
  user_id       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  ics_reminders integer[] not null default '{1440,180}' check (cardinality(ics_reminders) <= 6),
  push_offsets  integer[] not null default '{1440,180}' check (cardinality(push_offsets) <= 6),
  edited_at     timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create function public.user_settings_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.edited_at > now() + interval '10 minutes' then
    new.edited_at := now();
  end if;
  if tg_op = 'UPDATE' then
    if new.edited_at < old.edited_at then
      return null;
    end if;
    new.user_id := old.user_id;
  end if;
  new.updated_at := now();
  return new;
end
$$;

create trigger user_settings_before_write
before insert or update on public.user_settings
for each row execute function public.user_settings_before_write();

alter table public.user_settings enable row level security;

create policy "user_settings: 本人だけ読める" on public.user_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy "user_settings: 本人だけ追加できる" on public.user_settings
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "user_settings: 本人だけ更新できる" on public.user_settings
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.user_settings from anon, authenticated;
grant select, insert, update on public.user_settings to authenticated;
grant all on public.user_settings to service_role;

-- ---------------------------------------------------------------------------
-- push_subscriptions
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  endpoint     text not null unique check (endpoint ~ '^https?://' and char_length(endpoint) <= 2000),
  p256dh       text not null check (char_length(p256dh) between 80 and 100),
  auth         text not null check (char_length(auth) between 20 and 30),
  user_agent   text not null default '' check (char_length(user_agent) <= 300),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions: 本人だけ読める" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "push_subscriptions: 本人だけ削除できる" on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

-- 端末の通知先を登録する。同じ端末で別の人がログインし直した場合は、その人の宛先に付け替える。
create function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'ログインが必要です' using errcode = 'insufficient_privilege';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_user, p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        last_seen_at = now();

  -- 1人あたり20端末まで。古いものから消す
  delete from public.push_subscriptions p
  where p.user_id = v_user
    and p.id not in (
      select q.id from public.push_subscriptions q
      where q.user_id = v_user
      order by q.last_seen_at desc
      limit 20
    );
end
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- reminder_log と、送るべきリマインダーの取り出し
-- ---------------------------------------------------------------------------
create table public.reminder_log (
  entry_id    uuid not null references public.entries (id) on delete cascade,
  offset_min  integer not null,
  deadline_at timestamptz not null,
  sent_at     timestamptz not null default now(),
  primary key (entry_id, offset_min, deadline_at)
);

alter table public.reminder_log enable row level security;
revoke all on public.reminder_log from anon, authenticated;
grant all on public.reminder_log to service_role;

-- いま送るべきリマインダーを取り出し、同時に「送信済み」として記録する。
--
-- ・対象は「未定」のまま締切がまだ来ていないエントリーで、通知先の端末がある利用者のもの
-- ・時刻未定の締切は 23:59:59 締切とみなす。その「前日」の通知は前日の朝9:00（日本時間）に送る
-- ・1つのエントリーで複数のタイミングを同時に過ぎていた場合は、いちばん締切に近い1通だけ送る
--   （例: 締切2時間前に登録したら「前日」「3時間前」をまとめて1通にする）
create function public.claim_due_reminders(p_now timestamptz default now())
returns table (
  entry_id uuid,
  user_id uuid,
  company text,
  kind text,
  deadline_date date,
  deadline_time time,
  deadline_at timestamptz,
  offset_min integer
)
language sql
security definer
set search_path = ''
as $$
  with cand as (
    select
      e.id, e.user_id, e.company, e.kind, e.deadline_date, e.deadline_time, e.deadline_at, o.offset_min,
      case
        when e.deadline_time is null and o.offset_min >= 1440
          then ((e.deadline_date - (o.offset_min / 1440)) + time '09:00') at time zone 'Asia/Tokyo'
        else e.deadline_at - make_interval(mins => o.offset_min)
      end as fire_at
    from public.entries e
    left join public.user_settings s on s.user_id = e.user_id
    cross join lateral unnest(coalesce(s.push_offsets, array[1440, 180])) as o (offset_min)
    where e.deleted_at is null
      and e.status = 'undecided'
      and e.deadline_at > p_now
      and e.deadline_at <= p_now + interval '8 days'
      and o.offset_min between 1 and 10080
      and exists (select 1 from public.push_subscriptions p where p.user_id = e.user_id)
  ),
  due as (
    select * from cand where fire_at <= p_now
  ),
  tightest as (
    select distinct on (d.id) d.* from due d order by d.id, d.fire_at desc, d.offset_min asc
  ),
  claimed as (
    insert into public.reminder_log (entry_id, offset_min, deadline_at)
    select d.id, d.offset_min, d.deadline_at from due d
    on conflict do nothing
    returning entry_id, offset_min
  )
  select t.id, t.user_id, t.company, t.kind, t.deadline_date, t.deadline_time, t.deadline_at, t.offset_min
  from tightest t
  join claimed c on c.entry_id = t.id and c.offset_min = t.offset_min
$$;

revoke all on function public.claim_due_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 定期実行（pg_cron）
-- ---------------------------------------------------------------------------

-- Edge Function のURLと合言葉を Vault に保存する。セットアップ時に1回だけ実行する:
--   select public.configure_reminders('https://<プロジェクトID>.supabase.co/functions/v1/push');
create function public.configure_reminders(p_function_url text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_secret text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if p_function_url !~ '^https?://' then
    raise exception 'URLは https:// から始めてください';
  end if;

  select id into v_id from vault.secrets where name = 'shimekiri_push_url';
  if v_id is null then
    perform vault.create_secret(p_function_url, 'shimekiri_push_url', '就活しめきりボード: push 関数のURL');
  else
    perform vault.update_secret(v_id, p_function_url);
  end if;

  select id into v_id from vault.secrets where name = 'shimekiri_cron_secret';
  if v_id is null then
    perform vault.create_secret(v_secret, 'shimekiri_cron_secret', '就活しめきりボード: 定期実行の合言葉');
  end if;

  return '設定しました。5分おきに締切を確認して通知を送ります。';
end
$$;

revoke all on function public.configure_reminders(text) from public, anon, authenticated;

-- Edge Function 側から、呼び出しが本当にこのデータベースの定期実行から来たかを確かめる
create function public.verify_cron_secret(p_secret text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    (select char_length(p_secret) >= 32 and d.decrypted_secret = p_secret
       from vault.decrypted_secrets d
      where d.name = 'shimekiri_cron_secret'),
    false
  )
$$;

revoke all on function public.verify_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_cron_secret(text) to service_role;

create function public.invoke_push_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  -- 通知先が1件もなければ何もしない
  if not exists (select 1 from public.push_subscriptions) then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'shimekiri_push_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'shimekiri_cron_secret';
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('action', 'reminders'),
    timeout_milliseconds := 20000
  );
end
$$;

revoke all on function public.invoke_push_reminders() from public, anon, authenticated;

-- 古い記録の掃除（削除済みエントリー・送信記録・長く使われていない通知先）
create function public.purge_old_rows()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.entries where deleted_at < now() - interval '30 days';
  delete from public.reminder_log where sent_at < now() - interval '60 days';
  delete from public.push_subscriptions where last_seen_at < now() - interval '180 days';
$$;

revoke all on function public.purge_old_rows() from public, anon, authenticated;

select cron.schedule('shimekiri-push-reminders', '*/5 * * * *', 'select public.invoke_push_reminders()');
select cron.schedule('shimekiri-purge', '17 18 * * *', 'select public.purge_old_rows()');

-- ---------------------------------------------------------------------------
-- アカウントの削除（本人の操作で、すべてのデータと一緒に消す）
-- ---------------------------------------------------------------------------
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'ログインが必要です' using errcode = 'insufficient_privilege';
  end if;
  delete from auth.users where id = v_user;
end
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

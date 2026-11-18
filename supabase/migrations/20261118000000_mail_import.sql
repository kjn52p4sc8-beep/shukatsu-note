-- Tokens and OAuth state are server-only; candidates are visible only to their owner.
create table public.mail_connections (
 user_id uuid primary key references auth.users on delete cascade,
 email text not null, refresh_cipher text not null, label text not null default '',
 scan_after bigint not null default 0, page_token text not null default '', scan_started bigint not null default 0,
 last_sync timestamptz, last_attempt timestamptz, last_error text not null default '', lease_until timestamptz, lease_id uuid
);
create table public.mail_oauth_states (
 state_hash text primary key, user_id uuid not null references auth.users on delete cascade,
 verifier_cipher text not null, label text not null default '', expires_at timestamptz not null
);
create table public.mail_forward_addresses (
 user_id uuid primary key references auth.users on delete cascade,
 address text not null unique
);
create table public.mail_candidates (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
 source text not null check(source in ('gmail','forward')),
 message_key text not null, slot integer not null, subject text not null, sender text not null,
 received_at timestamptz not null, candidate jsonb not null,
 state text not null default 'pending' check(state in ('pending','accepted','ignored')),
 entry_id uuid, created_at timestamptz not null default now(),
 unique(user_id,source,message_key,slot)
);
create index mail_candidates_owner_pending on public.mail_candidates(user_id,state,received_at desc);
alter table public.mail_connections enable row level security;
alter table public.mail_oauth_states enable row level security;
alter table public.mail_forward_addresses enable row level security;
alter table public.mail_candidates enable row level security;
revoke all on public.mail_connections,public.mail_oauth_states,public.mail_forward_addresses,public.mail_candidates from anon,authenticated;
grant all on public.mail_connections,public.mail_oauth_states,public.mail_forward_addresses,public.mail_candidates to service_role;
grant select on public.mail_candidates to authenticated;
create policy "read own mail candidates" on public.mail_candidates for select to authenticated using (user_id=auth.uid());

create function public.claim_mail_sync(p_user uuid, p_lease uuid)
returns setof public.mail_connections language sql security definer set search_path='' as $$
 update public.mail_connections set lease_until=now()+interval '10 minutes',lease_id=p_lease,last_attempt=now()
 where user_id=p_user and (lease_until is null or lease_until<now()) returning *;
$$;
revoke all on function public.claim_mail_sync(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_mail_sync(uuid,uuid) to service_role;

-- One transaction registers the deadline and marks the candidate as consumed.
-- Client edit timestamps use JavaScript millisecond precision.
-- Updating an existing entry requires the edit timestamp the user actually reviewed.
create function public.review_mail_candidate(
 p_id uuid, p_company text, p_kind text, p_date date, p_time time,
 p_target uuid default null, p_expected timestamptz default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.mail_candidates; e public.entries; target uuid;
begin
 select * into c from public.mail_candidates where id=p_id and user_id=auth.uid() for update;
 if not found then raise exception '候補が見つかりません'; end if;
 if c.state='accepted' then return c.entry_id; end if;
 if c.state<>'pending' then raise exception 'この候補は処理済みです'; end if;
 if p_company is null or length(trim(p_company)) not between 1 and 100 or length(p_kind)>40 then raise exception '企業名と内容を確認してください'; end if;
 if p_date is null then raise exception '締切の日付を確認してください'; end if;
 if p_time>=time '24:00' then raise exception '締切時刻は23:59までです'; end if;
 if p_target is not null then
  select * into e from public.entries where id=p_target and user_id=auth.uid() and deleted_at is null for update;
  if not found then raise exception '更新先が見つかりません'; end if;
  if p_expected is null or date_trunc('milliseconds',e.edited_at)<>p_expected then raise exception '別の編集があります。同期してから確認し直してください'; end if;
  update public.entries set deadline_date=p_date,deadline_time=p_time,edited_at=greatest(date_trunc('milliseconds',now()),date_trunc('milliseconds',e.edited_at)+interval '1 millisecond') where id=p_target;
  target:=p_target;
 else
  target:=gen_random_uuid();
  insert into public.entries(id,user_id,company,kind,deadline_date,deadline_time,edited_at,memo)
  values(target,auth.uid(),trim(p_company),p_kind,p_date,p_time,date_trunc('milliseconds',now()),
   left('出典：応募メール（公式サイト未確認）' || E'\n件名：' || c.subject || E'\n差出人：' || c.sender || E'\n' || (c.candidate->>'evidence'),2000));
 end if;
 update public.mail_candidates set state='accepted',entry_id=target where id=c.id;
 return target;
end $$;
revoke all on function public.review_mail_candidate(uuid,text,text,date,time,uuid,timestamptz) from public,anon;
grant execute on function public.review_mail_candidate(uuid,text,text,date,time,uuid,timestamptz) to authenticated;

create function public.ignore_mail_candidate(p_id uuid) returns void language sql security definer set search_path='' as $$
 update public.mail_candidates set state='ignored' where id=p_id and user_id=auth.uid() and state='pending';
$$;
revoke all on function public.ignore_mail_candidate(uuid) from public,anon;
grant execute on function public.ignore_mail_candidate(uuid) to authenticated;

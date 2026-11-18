-- ESと面接記録も既存entriesの本人限定RLS・バックアップ・同期の対象にする。
alter table public.entries
  add column es_drafts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(es_drafts) = 'array' and jsonb_array_length(es_drafts) <= 50 and octet_length(es_drafts::text) <= 5000000),
  add column interviews jsonb not null default '[]'::jsonb
    check (jsonb_typeof(interviews) = 'array' and jsonb_array_length(interviews) <= 50 and octet_length(interviews::text) <= 7000000);

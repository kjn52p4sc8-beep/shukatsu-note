import { beforeAll,afterAll,it,expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
let db:PGlite;
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const c='00000000-0000-4000-8000-000000000003',d='00000000-0000-4000-8000-000000000004';
beforeAll(async()=>{
 db=new PGlite();
 // Supabase supplies auth/users/roles; this fixture emulates only their contract.
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,service_role;grant execute on function auth.uid() to authenticated;
 create table public.entries(id uuid primary key,user_id uuid references auth.users,company text,kind text,deadline_date date,deadline_time time,memo text,edited_at timestamptz default now(),deleted_at timestamptz);
 insert into auth.users values('${a}'),('${b}');`);
 await db.exec(await readFile('supabase/migrations/20261118000000_mail_import.sql','utf8'));
 await db.query(`insert into public.mail_candidates(id,user_id,source,message_key,slot,subject,sender,received_at,candidate) values($1,$2,'gmail','message1',0,'ES締切','sender@example.com',now(),$3),($4,$2,'gmail','message2',0,'期限変更','sender@example.com',now(),$3)`,[c,a,JSON.stringify({evidence:'ES締切：2027年1月20日'}),d]);
},30000);
afterAll(async()=>{await db?.close();});
async function asUser(user:string){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');}
it('RLSで他人の候補と認証トークンを読めず、他人の候補を登録できない',async()=>{
 await asUser(b);
 expect((await db.query('select * from public.mail_candidates')).rows).toHaveLength(0);
 await expect(db.query('select * from public.mail_connections')).rejects.toThrow();
 await expect(db.query("select public.review_mail_candidate($1,'企業','ES','2027-01-20','17:00')",[c])).rejects.toThrow('候補が見つかりません');
});
it('確認と締切登録は一度だけ実行され、同じ確認の再送で二重登録しない',async()=>{
 await asUser(a);
 const first=await db.query<{id:string}>("select public.review_mail_candidate($1,'企業','ES','2027-01-20','17:00') as id",[c]);
 const second=await db.query<{id:string}>("select public.review_mail_candidate($1,'企業','ES','2027-01-20','17:00') as id",[c]);
 expect(second.rows).toEqual(first.rows);
 await db.exec('reset role');expect((await db.query('select * from public.entries')).rows).toHaveLength(1);
});
it('期限変更は既存メモを維持し、確認時点より新しい編集があると拒否する',async()=>{
 await db.exec('reset role');
 await db.exec("update public.entries set edited_at='2026-11-18T00:00:00.123456Z'");
 const {rows:[entry]}=await db.query<{id:string;edited_at:string}>('select id,edited_at::text from public.entries');
 await asUser(a);
 await expect(db.query("select public.review_mail_candidate($1,'企業','ES','2027-01-22','18:00',$2,'2000-01-01')",[d,entry.id])).rejects.toThrow('別の編集');
 await db.query("select public.review_mail_candidate($1,'企業','ES','2027-01-22','18:00',$2,$3)",[d,entry.id,new Date(entry.edited_at).toISOString()]);
 await db.exec('reset role');
 const {rows:[updated]}=await db.query<{date:string;memo:string}>('select deadline_date::text as date,memo from public.entries');
 expect(updated.date).toBe('2027-01-22');expect(updated.memo).toContain('出典：応募メール');
});
it('同期のロックは並行処理を防ぎ、認証ユーザーはサーバー専用RPCを呼べない',async()=>{
 await db.exec('reset role');
 await db.query("insert into mail_connections(user_id,email,refresh_cipher)values($1,'test@example.com','encrypted')",[a]);
 const first=await db.query('select * from public.claim_mail_sync($1,$2)',[a,c]);
 const second=await db.query('select * from public.claim_mail_sync($1,$2)',[a,d]);
 expect(first.rows).toHaveLength(1);expect(second.rows).toHaveLength(0);
 await asUser(a);await expect(db.query('select * from public.claim_mail_sync($1,$2)',[a,d])).rejects.toThrow();
});

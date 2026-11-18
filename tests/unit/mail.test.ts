import { describe,it,expect } from 'vitest';
import { parseMail,gmailText,htmlToText } from '../../supabase/functions/_shared/mail-parser';
import { b64,digest,seal,unseal,verifyWebhook } from '../../supabase/functions/_shared/mail-security';
import { createMailHandler } from '../../supabase/functions/_shared/mail-service';
import { captureMailCallback } from '../../src/data/mail-callback';
const input=(text:string)=>({subject:'応募のご案内',from:'みらい株式会社 <jobs@example.com>',receivedAt:'2026-11-18T00:00:00Z',text});
describe('応募メールの抽出',()=>{
 it('複数の締切を区別し、開催日や署名の日付を締切にしない',()=>{
  const rows=parseMail(input('企業名：みらい商事\n面接日：2027年1月10日\nES提出期限：2027年1月20日 17:00\n適性検査 締切：2027年1月22日 23:59'));
  expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({company:'みらい商事',kind:'ES提出',date:'2027-01-20',time:'17:00'});
  expect(rows[1]).toMatchObject({kind:'適性検査',date:'2027-01-22',time:'23:59'});
 });
 it.each(['締切：1月20日','締切：明日17時','締切：2027年2月30日','締切：2027年1月20日→2027年1月25日','締切：2027年1月20日 17:00 PST'])('曖昧な日付を自動確定しない：%s',text=>expect(parseMail(input(text))[0].date).toBe(''));
 it('日付のない件名から空の候補を重複生成しない',()=>{
  const rows=parseMail({...input('ES締切：2027年1月20日 17:00'),subject:'ES締切のご案内'});
  expect(rows).toHaveLength(1);expect(rows[0].date).toBe('2027-01-20');
 });
 it('全角文字と日本語時刻、改行直後の日付を読める',()=>{
  expect(parseMail(input('ES締切：\n２０２７年１月２０日 午後５時３０分'))[0]).toMatchObject({date:'2027-01-20',time:'17:30'});
 });
 it('締切のないメールは確認用として残し、安全なリンクだけを返す',()=>{
  const row=parseMail(input('マイページをご確認ください https://example.com/jobs\njavascript:alert(1)'))[0];
  expect(row.date).toBe('');expect(row.links).toEqual(['https://example.com/jobs']);
 });
 it('MIMEの代替本文を重複させず、添付ファイルを読まない',()=>{
  const data=b64(new TextEncoder().encode('締切です'));
  expect(gmailText({mimeType:'multipart/alternative',parts:[{mimeType:'text/plain',body:{data}},{mimeType:'text/html',body:{data}}]})).toBe('締切です');
  expect(gmailText({mimeType:'text/plain',filename:'private.txt',body:{data}})).toBe('');
  expect(htmlToText('<script>secret()</script><p>締切</p>')).not.toContain('secret');
 });
});
describe('メール連携の認証',()=>{
 it('更新トークンを暗号化し、別鍵・改ざんを拒否する',async()=>{
  const key=b64(crypto.getRandomValues(new Uint8Array(32))),other=b64(crypto.getRandomValues(new Uint8Array(32)));
  const encrypted=await seal('sensitive-refresh-token',key);
  expect(encrypted).not.toContain('sensitive');expect(await unseal(encrypted,key)).toBe('sensitive-refresh-token');
  await expect(unseal(encrypted,other)).rejects.toThrow();
  expect(await digest('state')).not.toBe('state');
 });
 it('Webhookの本文・署名・時刻を検証する',async()=>{
  const keyBytes=crypto.getRandomValues(new Uint8Array(32));const secret='whsec_'+b64(keyBytes),raw='{"type":"email.received"}';const now=Date.now(),ts=String(Math.floor(now/1000)),id='msg_abc';
  const key=await crypto.subtle.importKey('raw',keyBytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=b64(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${id}.${ts}.${raw}`))));
  const headers=new Headers({'svix-id':id,'svix-timestamp':ts,'svix-signature':'v1,'+sig});
  expect(await verifyWebhook(raw,headers,secret,now)).toBe(true);
  expect(await verifyWebhook(raw+'x',headers,secret,now)).toBe(false);
  expect(await verifyWebhook(raw,headers,secret,now+301000)).toBe(false);
 });
 it('Gmailの認証codeをSupabaseのログインと分け、state不一致を拒否する',()=>{
  const u=new URL('https://app.example/?mail_callback=1&code=abc&state=xyz');
  expect(captureMailCallback(u,'xyz')).toMatchObject({code:'abc',error:''});
  expect(captureMailCallback(u,'other')!.error).not.toBe('');
  expect(captureMailCallback(new URL('https://app.example/?code=supabase'),'xyz')).toBeNull();
 });
 it('匿名の接続・同期、偽Webhook、偽cronを拒否する',async()=>{
  let calls=0;const handler=createMailHandler({RESEND_API_KEY:'x',RESEND_WEBHOOK_SECRET:'whsec_eA==',MAIL_INBOUND_DOMAIN:'mail.example'},async()=>{calls++;throw Error('Unexpected fetch');});
  expect((await handler(new Request('https://api.example/',{method:'POST',body:'{"action":"start"}'}))).status).toBe(401);
  expect((await handler(new Request('https://api.example/?hook=resend',{method:'POST',body:'{}'}))).status).toBe(401);
  expect((await handler(new Request('https://api.example/?cron=1',{method:'POST',body:'{}'}))).status).toBe(401);
  expect(calls).toBe(0);
 });
});

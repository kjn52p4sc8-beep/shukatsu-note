import { parseMail, gmailText, htmlToText, type MailInput, type GmailPart } from './mail-parser.ts';
import { randomSecret, digest, seal, unseal, verifyWebhook } from './mail-security.ts';
type Env = Record<string, string | undefined>;
type Connection = { user_id: string; email: string; refresh_cipher: string; label: string; scan_after: number; page_token: string; scan_started: number; last_sync: string | null; last_error: string };
const enc = encodeURIComponent;
export function createMailHandler(env: Env, fetcher: typeof fetch = fetch) {
  const base = env.SUPABASE_URL ?? ''; const service = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const cipherKey = env.MAIL_TOKEN_KEY ?? ''; const redirect = env.GOOGLE_MAIL_REDIRECT_URI ?? '';
  const origin = (() => { try { return new URL(env.MAIL_APP_URL || redirect).origin; } catch { return ''; } })();
  const configured = !!(env.GOOGLE_MAIL_CLIENT_ID && env.GOOGLE_MAIL_CLIENT_SECRET && cipherKey && redirect);
  const forwarding = !!(env.MAIL_INBOUND_DOMAIN && env.RESEND_API_KEY && env.RESEND_WEBHOOK_SECRET);
  const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  async function db<T>(path: string, method='GET', body?: unknown, extra?: Record<string,string>): Promise<T> {
    const res = await fetcher(`${base}/rest/v1/${path}`, { method, headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('データ保存に失敗しました。接続設定とマイグレーションを確認してください。');
    const text = await res.text(); return (text ? JSON.parse(text) : null) as T;
  }
  async function googleToken(values: Record<string,string>) {
    const res = await fetcher('https://oauth2.googleapis.com/token', { method:'POST', body:new URLSearchParams({ ...values, client_id:env.GOOGLE_MAIL_CLIENT_ID!, client_secret:env.GOOGLE_MAIL_CLIENT_SECRET! }), signal:AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('Googleとの連携が切れているか、認証に失敗しました。再接続してください。');
    return await res.json() as { access_token:string; refresh_token?:string; scope?:string };
  }
  async function google<T>(path:string, token:string):Promise<T> {
    const res=await fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
    if(!res.ok) throw new Error('Gmailを読み込めませんでした。連携の権限と通信を確認してください。');
    return res.json();
  }
  async function ingest(user:string, source:'gmail'|'forward', key:string, mail:MailInput) {
    const candidates=parseMail(mail);
    await db('mail_candidates?on_conflict=user_id,source,message_key,slot','POST', candidates.map((candidate,slot)=>({user_id:user,source,message_key:key,slot,subject:mail.subject.slice(0,300),sender:mail.from.slice(0,300),received_at:mail.receivedAt,candidate})),{Prefer:'resolution=ignore-duplicates'});
  }
  async function sync(user:string) {
    const lease=crypto.randomUUID();
    const rows=await db<Connection[]>('rpc/claim_mail_sync','POST',{p_user:user,p_lease:lease});
    const connection=rows[0]; if(!connection) return {scanned:0,busy:true};
    const filter=`mail_connections?user_id=eq.${user}&lease_id=eq.${lease}`;
    try {
      const token=await googleToken({grant_type:'refresh_token',refresh_token:await unseal(connection.refresh_cipher,cipherKey)});
      const started=connection.page_token?connection.scan_started:Math.floor(Date.now()/1000);
      const after=connection.scan_after||started-30*86400;
      const term=connection.label?`label:"${connection.label.replace(/["\\]/g,' ')}"`:'{エントリー 応募 ES 適性検査 面接 インターン}';
      const query=new URLSearchParams({q:`after:${Math.max(0,after-300)} before:${started+1} ${term} -in:trash -in:spam`,maxResults:'10'});
      if(connection.page_token) query.set('pageToken',connection.page_token);
      const page=await google<{messages?:{id:string}[];nextPageToken?:string}>(`messages?${query}`,token.access_token);
      for(const message of page.messages??[]) {
        const existing=await db<{id:string}[]>(`mail_candidates?user_id=eq.${user}&source=eq.gmail&message_key=eq.${enc(message.id)}&select=id&limit=1`);
        if(existing.length) continue;
        const mail=await google<{payload:GmailPart & {headers?:{name:string;value:string}[]}; internalDate:string}>(`messages/${enc(message.id)}?format=full`,token.access_token);
        const header=(n:string)=>mail.payload.headers?.find(h=>h.name.toLowerCase()===n)?.value??'';
        // A disconnect removes this lease; do not enqueue more mail afterwards.
        if(!(await db<{user_id:string}[]>(`${filter}&select=user_id`)).length) return {scanned:0,busy:false};
        await ingest(user,'gmail',message.id,{subject:header('subject'),from:header('from'),text:gmailText(mail.payload),receivedAt:new Date(Number(mail.internalDate)).toISOString()});
      }
      await db(filter,'PATCH',{page_token:page.nextPageToken??'',scan_after:page.nextPageToken?after:started,scan_started:started,last_sync:new Date().toISOString(),last_error:''});
      return {scanned:page.messages?.length??0,more:!!page.nextPageToken};
    } catch(e) {
      await db(filter,'PATCH',{page_token:'',last_error:'取込に失敗しました。再接続または通信状態を確認してください。'});
      throw e;
    } finally {await db(filter,'PATCH',{lease_until:null,lease_id:null});}
  }
  return async (req:Request):Promise<Response> => {
    if(req.method==='OPTIONS') return new Response(null,{headers:cors});
    if(req.method!=='POST') return reply({error:'POST required'},405);
    try {
      const url=new URL(req.url);
      if(url.searchParams.get('hook')==='resend') {
        if(!forwarding) return reply({error:'受信設定がありません'},503);
        const raw=await req.text();
        if(raw.length>500000 || !await verifyWebhook(raw,req.headers,env.RESEND_WEBHOOK_SECRET!)) return reply({error:'Invalid signature'},401);
        const event=JSON.parse(raw) as {type:string;data?:{email_id?:string}};
        if(event.type!=='email.received') return reply({ok:true});
        const id=event.data?.email_id;
        if(!id || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) return reply({error:'Invalid email id'},400);
        const result=await fetcher(`https://api.resend.com/emails/receiving/${id}`,{headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`},signal:AbortSignal.timeout(15000)});
        if(!result.ok) return reply({error:'Receiving lookup failed'},502);
        const m=await result.json() as {to:string[];from:string;subject:string;text?:string;html?:string;created_at:string};
        for(const address of (m.to??[]).slice(0,10)) {
          const owners=await db<{user_id:string}[]>(`mail_forward_addresses?address=eq.${enc(address.toLowerCase())}&select=user_id`);
          if(owners[0]) await ingest(owners[0].user_id,'forward',id,{subject:m.subject??'',from:m.from??'',text:(m.text||htmlToText(m.html??'')).slice(0,100000),receivedAt:m.created_at});
        }
        return reply({ok:true});
      }
      if(url.searchParams.get('cron')==='1') {
        if(!env.MAIL_CRON_SECRET || req.headers.get('x-mail-cron-secret')!==env.MAIL_CRON_SECRET) return reply({error:'Unauthorized'},401);
        // Least recently synced first: bounded work; remaining accounts run on the next tick.
        const users=await db<{user_id:string}[]>('mail_connections?select=user_id&order=last_attempt.asc.nullsfirst&limit=5');
        const results=await Promise.allSettled(users.map(u=>sync(u.user_id)));
        return reply({processed:results.filter(r=>r.status==='fulfilled').length});
      }
      const authorization=req.headers.get('Authorization')??'';
      if(!authorization.startsWith('Bearer ')) return reply({error:'ログインが必要です'},401);
      const auth=await fetcher(`${base}/auth/v1/user`,{headers:{Authorization:authorization,apikey:service},signal:AbortSignal.timeout(10000)});
      if(!auth.ok) return reply({error:'ログインし直してください'},401);
      const {id:user}=await auth.json() as {id:string};
      const raw=await req.text();if(raw.length>10000) return reply({error:'Request too large'},413);
      const body=JSON.parse(raw) as {action:string;state?:string;code?:string;label?:string};
      if(body.action==='status') {
        const connections=await db<Pick<Connection,'email'|'label'|'last_sync'|'last_error'>[]>(`mail_connections?user_id=eq.${user}&select=email,label,last_sync,last_error`);
        const addresses=await db<{address:string}[]>(`mail_forward_addresses?user_id=eq.${user}&select=address`);
        return reply({gmailReady:configured,forwardReady:forwarding,connection:connections[0]??null,address:addresses[0]?.address??null});
      }
      if(body.action==='start') {
        if(!configured) return reply({error:'Gmail連携の公開設定がまだありません'},503);
        const state=randomSecret(),verifier=randomSecret();
        const label=(body.label??'').trim().slice(0,100);
        await db(`mail_oauth_states?expires_at=lt.${enc(new Date().toISOString())}`,'DELETE');
        await db('mail_oauth_states','POST',{state_hash:await digest(state),user_id:user,verifier_cipher:await seal(verifier,cipherKey),label,expires_at:new Date(Date.now()+10*60000).toISOString()});
        const params=new URLSearchParams({client_id:env.GOOGLE_MAIL_CLIENT_ID!,redirect_uri:redirect,response_type:'code',scope:'https://www.googleapis.com/auth/gmail.readonly',access_type:'offline',prompt:'consent',state,code_challenge:await digest(verifier),code_challenge_method:'S256'});
        return reply({url:`https://accounts.google.com/o/oauth2/v2/auth?${params}`,state});
      }
      if(body.action==='finish') {
        if(!configured || !body.state || !body.code) return reply({error:'認証情報が不足しています'},400);
        const states=await db<{verifier_cipher:string;label:string}[]>(`mail_oauth_states?state_hash=eq.${enc(await digest(body.state))}&user_id=eq.${user}&expires_at=gt.${enc(new Date().toISOString())}`,'DELETE',undefined,{Prefer:'return=representation'});
        if(!states[0]) return reply({error:'認証が期限切れです。接続し直してください'},400);
        const token=await googleToken({code:body.code,grant_type:'authorization_code',redirect_uri:redirect,code_verifier:await unseal(states[0].verifier_cipher,cipherKey)});
        if(!token.refresh_token || !token.scope?.split(' ').includes('https://www.googleapis.com/auth/gmail.readonly')) return reply({error:'メール読み取りの許可を確認して接続し直してください'},400);
        const profile=await google<{emailAddress:string}>('profile',token.access_token);
        await db('mail_connections?on_conflict=user_id','POST',{user_id:user,email:profile.emailAddress,refresh_cipher:await seal(token.refresh_token,cipherKey),label:states[0].label,scan_after:0,page_token:'',scan_started:0,last_error:'',lease_until:null,lease_id:null},{Prefer:'resolution=merge-duplicates'});
        return reply({ok:true});
      }
      if(body.action==='sync') {if(!configured) return reply({error:'Gmail設定がありません'},503);return reply(await sync(user));}
      if(body.action==='disconnect') {
        const rows=await db<Connection[]>(`mail_connections?user_id=eq.${user}`,'DELETE',undefined,{Prefer:'return=representation'});
        if(rows[0]) {try {const token=await unseal(rows[0].refresh_cipher,cipherKey);await fetcher('https://oauth2.googleapis.com/revoke',{method:'POST',body:new URLSearchParams({token}),signal:AbortSignal.timeout(10000)});}catch{/* local disconnection is complete */}}
        return reply({ok:true});
      }
      if(body.action==='forward-enable') {
        if(!forwarding) return reply({error:'メール転送の受信設定がまだありません'},503);
        const domain=env.MAIL_INBOUND_DOMAIN!.toLowerCase();
        if(!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new Error('受信ドメインの設定を確認してください');
        const address=`jobs-${crypto.randomUUID().replace(/-/g,'')}@${domain}`;
        await db('mail_forward_addresses?on_conflict=user_id','POST',{user_id:user,address},{Prefer:'resolution=merge-duplicates'});
        return reply({address});
      }
      if(body.action==='forward-disable') {await db(`mail_forward_addresses?user_id=eq.${user}`,'DELETE');return reply({ok:true});}
      return reply({error:'Unknown action'},400);
    } catch(e) {return reply({error:e instanceof Error ? e.message : '連携に失敗しました'},400);}
  };
}

import { expect,it } from 'vitest';
import { createMailHandler } from '../../supabase/functions/_shared/mail-service';
import { b64,digest,seal,unseal } from '../../supabase/functions/_shared/mail-security';

const user='00000000-0000-4000-8000-000000000001';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
const env={SUPABASE_URL:'https://project.example',SUPABASE_SERVICE_ROLE_KEY:'server-only',MAIL_APP_URL:'https://app.example',GOOGLE_MAIL_REDIRECT_URI:'https://app.example/?mail_callback=1',GOOGLE_MAIL_CLIENT_ID:'client',GOOGLE_MAIL_CLIENT_SECRET:'secret',MAIL_TOKEN_KEY:b64(crypto.getRandomValues(new Uint8Array(32)))};
const request=(action:string,other:Record<string,string>={})=>new Request('https://project.example/functions/v1/mail-bridge',{method:'POST',headers:{Authorization:'Bearer user-session'},body:JSON.stringify({action,...other})});

it('OAuthはPKCEと利用者に紐付く一度限りのstateを使い、更新トークンは暗号化して保存する',async()=>{
 let state:Record<string,string>|null=null,connection:Record<string,string>|null=null;
 const handler=createMailHandler(env,async(input,init)=>{
  const url=new URL(String(input));
  if(url.pathname==='/auth/v1/user')return json({id:user});
  if(url.pathname==='/rest/v1/mail_oauth_states'){
   if(init?.method==='POST'){state=JSON.parse(String(init.body));return new Response(null,{status:201});}
   if(url.searchParams.has('expires_at')&&!url.searchParams.has('state_hash'))return new Response(null,{status:204});
   expect(url.searchParams.get('user_id')).toBe('eq.'+user);
   if(state) expect(url.searchParams.get('state_hash')).toBe('eq.'+state.state_hash);
   expect(url.searchParams.get('expires_at')).toMatch(/^gt\./);
   const consumed=state;state=null;return json(consumed?[consumed]:[]);
  }
  if(url.hostname==='oauth2.googleapis.com'){
   const body=init!.body as URLSearchParams;
   expect(body.get('code')).toBe('one-time-code');
   expect(body.get('code_verifier')).toHaveLength(43);
   expect(body.get('redirect_uri')).toBe(env.GOOGLE_MAIL_REDIRECT_URI);
   return json({access_token:'access',refresh_token:'refresh-secret',scope:'https://www.googleapis.com/auth/gmail.readonly'});
  }
  if(url.pathname.endsWith('/profile'))return json({emailAddress:'student@example.com'});
  if(url.pathname==='/rest/v1/mail_connections'){connection=JSON.parse(String(init?.body));return new Response(null,{status:201});}
  throw Error('Unexpected request '+url.pathname);
 });
 const start=await handler(request('start',{label:'就活'}));
 const response=await start.json() as {url:string;state:string};
 const consent=new URL(response.url);
 expect(consent.searchParams.get('state')).toBe(response.state);
 expect(consent.searchParams.get('code_challenge_method')).toBe('S256');
 expect(consent.searchParams.get('code_challenge')).toBe(await digest(await unseal(state!.verifier_cipher,env.MAIL_TOKEN_KEY)));
 expect(state!.user_id).toBe(user);
 expect((await handler(request('finish',{state:response.state,code:'one-time-code'}))).status).toBe(200);
 expect(connection!.refresh_cipher).not.toContain('refresh-secret');
 expect(await unseal(connection!.refresh_cipher,env.MAIL_TOKEN_KEY)).toBe('refresh-secret');
 // The consumed OAuth state cannot exchange another code.
 const second=await handler(request('finish',{state:response.state,code:'one-time-code'}));
 expect(second.status).toBe(400);
});

it('同期は既知メールをスキップし、候補保存後だけページを進め、失敗したページを再試行できる',async()=>{
 const connection={user_id:user,refresh_cipher:await seal('refresh',env.MAIL_TOKEN_KEY),label:'就活',scan_after:1794900000,page_token:'page2',scan_started:1795000000};
 const writes:Record<string,unknown>[]=[];let inserted:unknown[]=[];let failSave=false;
 const handler=createMailHandler(env,async(input,init)=>{
  const url=new URL(String(input));
  if(url.pathname==='/auth/v1/user')return json({id:user});
  if(url.pathname==='/rest/v1/rpc/claim_mail_sync')return json([connection]);
  if(url.hostname==='oauth2.googleapis.com')return json({access_token:'access'});
  if(url.pathname.endsWith('/messages')){
   expect(url.searchParams.get('pageToken')).toBe('page2');
   expect(url.searchParams.get('q')).toContain('before:1795000001');
   expect(url.searchParams.get('q')).toContain('label:"就活"');
   return json({messages:[{id:'known'},{id:'fresh'}],nextPageToken:'page3'});
  }
  if(url.pathname==='/rest/v1/mail_candidates'){
   if(init?.method==='POST'){
    expect(new Headers(init.headers).get('Prefer')).toBe('resolution=ignore-duplicates');
    if(failSave)return json({error:'save failed'},500);
    inserted=JSON.parse(String(init.body));return new Response(null,{status:201});
   }
   return json(url.searchParams.get('message_key')==='eq.known'?[{id:'already-saved'}]:[]);
  }
  if(url.pathname.endsWith('/messages/fresh'))return json({internalDate:'1794900000000',payload:{mimeType:'text/plain',headers:[{name:'Subject',value:'ES締切の案内'},{name:'From',value:'採用 <jobs@example.com>'}],body:{data:b64(new TextEncoder().encode('企業名：みらい商事\nES提出期限：2027年1月20日 17:00'))}}});
  if(url.pathname==='/rest/v1/mail_connections'){
   if(init?.method==='PATCH'){writes.push(JSON.parse(String(init.body)));return new Response(null,{status:204});}
   return json([{user_id:user}]);
  }
  throw Error('Unexpected request '+url.pathname);
 });
 const result=await handler(request('sync'));
 expect(result.status).toBe(200);expect(await result.json()).toMatchObject({more:true});
 expect(inserted.length).toBeGreaterThan(0);
 expect(inserted[0]).toMatchObject({user_id:user,source:'gmail',message_key:'fresh'});
 expect(writes[0]).toMatchObject({page_token:'page3',scan_after:connection.scan_after});
 expect(writes.at(-1)).toEqual({lease_until:null,lease_id:null});
 writes.length=0;failSave=true;
 expect((await handler(request('sync'))).status).toBe(400);
 expect(writes[0]).toMatchObject({page_token:''});
 expect(writes[0]).not.toHaveProperty('scan_after');
 expect(writes.at(-1)).toEqual({lease_until:null,lease_id:null});
});

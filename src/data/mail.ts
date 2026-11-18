import { mailCallback } from './mail-callback';
import { supabase } from './supabase';
import type { MailCandidate } from '../../supabase/functions/_shared/mail-parser';
export interface MailRow { id:string; source:'gmail'|'forward'; message_key:string; subject:string; sender:string; received_at:string; candidate:MailCandidate; state:string }
export interface MailStatus { gmailReady:boolean; forwardReady:boolean; connection:{email:string;label:string;last_sync:string|null;last_error:string}|null; address:string|null }
export async function mailAction<T>(action:string, data:Record<string,string>={}):Promise<T> {
  if(!supabase) throw new Error('メール連携はログインして使う公開版で利用できます。');
  const {data:result,error}=await supabase.functions.invoke('mail-bridge',{body:{action,...data}});
  if(error) {
    let message='メール連携に接続できませんでした。公開設定とログイン状態を確認してください。';
    if(error.context instanceof Response) {try {message=(await error.context.json()).error??message;}catch{/* response can be empty */}}
    throw new Error(message);
  }
  if(result?.error) throw new Error(result.error);
  return result as T;
}
export async function mailCandidates():Promise<MailRow[]> {
  if(!supabase) return [];
  const {data,error}=await supabase.from('mail_candidates').select('id,source,message_key,subject,sender,received_at,candidate,state').eq('state','pending').order('received_at',{ascending:false}).limit(100);
  if(error) throw new Error('確認待ちメールを読み込めませんでした。');
  return data as MailRow[];
}
export async function reviewMail(id:string, company:string, kind:string, date:string, time:string, target:string|null, expected:string|null) {
  const {data,error}=await supabase!.rpc('review_mail_candidate',{p_id:id,p_company:company,p_kind:kind,p_date:date,p_time:time||null,p_target:target,p_expected:expected});
  if(error) throw new Error(error.message);
  return data as string;
}
export async function ignoreMail(id:string) {
  const {error}=await supabase!.rpc('ignore_mail_candidate',{p_id:id});
  if(error) throw new Error('候補を非表示にできませんでした。');
}

let callbackResult:Promise<string>|null=null;
export function finishMailCallback():Promise<string>|null {
  if(!mailCallback) return null;
  if(!callbackResult) callbackResult=(async()=>{
    if(mailCallback.error) return mailCallback.error;
    try {await mailAction('finish',{code:mailCallback.code,state:mailCallback.state});return 'Gmailを接続しました。「応募メール」から取り込みを開始できます。';}
    catch(e){return e instanceof Error?e.message:'Gmailに接続できませんでした。';}
  })();
  return callbackResult;
}

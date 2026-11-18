/** GmailのcodeをSupabaseログイン用codeと混同しないよう、SDK初期化前に取り出す。 */
export interface MailCallback { code:string;state:string;error:string }
export function captureMailCallback(url:URL,expected:string|null):MailCallback|null {
  if(url.searchParams.get('mail_callback')!=='1') return null;
  const state=url.searchParams.get('state')??'';
  return {code:url.searchParams.get('code')??'',state,error:url.searchParams.has('error')?'Googleでの接続をキャンセルしました。':!state||state!==expected?'接続の確認情報が一致しません。この画面から接続し直してください。':''};
}
export const mailCallback:(MailCallback|null)=(()=>{
  if(typeof window==='undefined') return null;
  const url=new URL(window.location.href);
  if(url.searchParams.get('mail_callback')!=='1') return null;
  let result:MailCallback;
  try {result=captureMailCallback(url,sessionStorage.getItem('mail-oauth-state'))!;sessionStorage.removeItem('mail-oauth-state');}
  catch {result={code:'',state:'',error:'認証情報を端末に保存できませんでした。ブラウザの保存設定を確認してください。'};}
  for(const key of ['mail_callback','code','state','scope','authuser','prompt','error','error_description'])url.searchParams.delete(key);
  window.history.replaceState(null,'',url.pathname+url.search+url.hash);
  return result;
})();

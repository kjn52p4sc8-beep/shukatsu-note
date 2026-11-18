import { useEffect, useState } from 'react';
import type { Entry } from '../core/types';
import { isDate,isTime } from '../core/dates';
import { mailAction, mailCandidates, reviewMail, ignoreMail, type MailRow, type MailStatus } from '../data/mail';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/toast';
import { parseMail } from '../../supabase/functions/_shared/mail-parser';

function CandidateReview({ row,entries,onSaved,onIgnored }: {row:MailRow;entries:Entry[];onSaved:()=>Promise<void>;onIgnored:()=>Promise<void>}) {
  const [company,setCompany]=useState(row.candidate.company),[kind,setKind]=useState(row.candidate.kind);
  const [date,setDate]=useState(row.candidate.date),[time,setTime]=useState(row.candidate.time);
  const [target,setTarget]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const existing=entries.find(e=>e.id===target);
  const related=entries.filter(e=>e.company===company);
  const act=async(ignore=false)=>{
    setBusy(true);setError('');
    try {
      if(ignore) {await ignoreMail(row.id);await onIgnored();return;}
      if(!company.trim()||!isDate(date)||(time&&!isTime(time))) throw new Error('企業名と実在する締切日時を確認してください。');
      await reviewMail(row.id,company.trim(),kind,date,time,target||null,existing?new Date(existing.editedAt).toISOString():null);
      await onSaved();toast(target?'締切を更新しました':'メールの締切を登録しました');
    } catch(e) {setError(e instanceof Error?e.message:'登録できませんでした');} finally {setBusy(false);}
  };
  return <section className="mail-review">
    <h3>{row.subject || '件名なし'}</h3><p className="muted break">{row.sender} ・{new Date(row.received_at).toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo'})}</p>
    <span className="pill">応募メール由来・要確認</span><p>{row.candidate.reason}</p>
    <blockquote className="mail-evidence">{row.candidate.evidence}</blockquote>
    <p className="hint">差出人やURLだけでは公式と確認できません。募集コースと原文を確認してください。</p>
    {row.source==='gmail' && <a href={`https://mail.google.com/mail/#all/${encodeURIComponent(row.message_key)}`} target="_blank" rel="noopener noreferrer">Gmailで原文を開く ↗</a>}
    {row.candidate.links.map(link=><a className="break" key={link} href={link} target="_blank" rel="noopener noreferrer">{link}</a>)}
    <label className="fg">企業名<input className="field" value={company} maxLength={100} onChange={e=>setCompany(e.target.value)}/></label>
    <label className="fg">募集コース・締切の種類<input className="field" value={kind} maxLength={40} onChange={e=>setKind(e.target.value)}/></label>
    <div className="two"><label className="fg">締切日<input className="field" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label className="fg">締切時刻（日本時間）<input className="field" type="time" value={time} onChange={e=>setTime(e.target.value)}/></label></div>
    <p className="hint">時刻を空にすると、その日の終わりとして管理します。</p>
    {!!related.length && <p className="warn">同じ企業の登録が {related.length} 件あります。期限変更なら更新先を選んでください。</p>}
    <label className="fg">登録方法<select className="field" value={target} onChange={e=>setTarget(e.target.value)}><option value="">新しい締切として追加</option>{entries.map(e=><option key={e.id} value={e.id}>{e.company}・{e.kind}・{e.dDate||'未登録'}を更新</option>)}</select></label>
    {existing && <p className="warn">変更前：{existing.dDate} {existing.dTime||'時刻未登録'} → 変更後：{date} {time||'時刻未登録'}。他の入力内容はそのまま残します。</p>}
    {error&&<p className="err" role="alert">{error}</p>}
    <div className="row"><button className="btn primary" disabled={busy} onClick={()=>void act()}>{target?'確認して締切を更新':'確認して登録'}</button><button className="btn" disabled={busy} onClick={()=>void act(true)}>この候補を非表示</button></div>
  </section>;
}

export function MailDialog({cloud,entries,onSync,onClose}:{cloud:boolean;entries:Entry[];onSync:()=>Promise<void>;onClose:()=>void}) {
  const [status,setStatus]=useState<MailStatus|null>(null),[rows,setRows]=useState<MailRow[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [label,setLabel]=useState(''),[demo,setDemo]=useState('');
  const load=async()=>{const [s,r]=await Promise.all([mailAction<MailStatus>('status'),mailCandidates()]);setStatus(s);setRows(r);};
  useEffect(()=>{if(!cloud)return;let alive=true;Promise.all([mailAction<MailStatus>('status'),mailCandidates()]).then(([s,r])=>{if(alive){setStatus(s);setRows(r);}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[cloud]);
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'処理に失敗しました');}finally{setBusy(false);}};
  return <Modal title="応募メールから締切を取り込む" onClose={onClose} keepOnBackdrop>
    <p>Gmail・転送メールから締切の候補を集めます。確認して登録した締切が、一覧と通知の対象になります。</p>
    <p className="hint">公式サイトを確認した情報とは区別します。メールの本文全体・添付ファイルはアプリに保存しません。</p>
    {!cloud?<p className="warn">メール連携はログインして使う公開版で利用できます。この版では下のサンプルで読み取り方を試せます。</p>:<>
      <section><h3>Gmail</h3>
      {status?.connection?<><p className="break">接続中：{status.connection.email}</p><p className="muted">対象：{status.connection.label?`ラベル「${status.connection.label}」`:'就活キーワードを含むメール'}。最初は過去30日分。</p>
        {status.connection.last_sync&&<p>最終取得：{new Date(status.connection.last_sync).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}</p>}
        {status.connection.last_error&&<p className="err">{status.connection.last_error}</p>}
        <div className="row"><button className="btn primary" disabled={busy} onClick={()=>void run(async()=>{const result=await mailAction<{more?:boolean;busy?:boolean}>('sync');await load();setMessage(result.busy?'別の取り込みが進行中です。少し待って更新してください。':result.more?'続きを取り込めます。「今すぐ取り込む」を押してください。':'メールを確認しました。確認待ちの一覧をご覧ください。');})}>今すぐ取り込む</button>
        <button className="btn" disabled={busy} onClick={()=>void run(async()=>{await mailAction('disconnect');await load();})}>Gmail連携を解除</button></div></>:<>
        <p>Googleではメール全体の読み取り権限を許可します。実際の取得は就活キーワードのメール、または指定ラベルに絞ります。メールの送信・削除は行いません。</p>
        <label className="fg">Gmailのラベル名（任意）<input className="field" maxLength={100} value={label} onChange={e=>setLabel(e.target.value)} placeholder="例：就活"/></label>
        <button className="btn primary" disabled={busy||!status?.gmailReady} onClick={()=>void run(async()=>{const r=await mailAction<{url:string;state:string}>('start',{label});sessionStorage.setItem('mail-oauth-state',r.state);window.location.assign(r.url);})}>GoogleでGmailを接続</button>
        {status&&!status.gmailReady&&<p className="muted">Gmail連携の公開設定はまだ完了していません。</p>}
      </>}</section>
      <section><h3>iCloudなどからメールを転送</h3><p>必要な応募メールだけを専用アドレスに転送してください。iCloudのパスワードは不要です。</p>
        {status?.address?<><label className="fg">あなたの転送先<input className="field" readOnly value={status.address}/></label><div className="row"><button className="btn" onClick={()=>void run(async()=>{await navigator.clipboard.writeText(status.address!);setMessage('転送先をコピーしました');})}>転送先をコピー</button><button className="btn" disabled={busy} onClick={()=>void run(async()=>{await mailAction('forward-disable');await load();})}>転送の受信を停止</button></div><p className="hint">受信を停止すると、この転送先は使えなくなります。</p></>:<button className="btn" disabled={busy||!status?.forwardReady} onClick={()=>void run(async()=>{await mailAction('forward-enable');await load();})}>専用の転送先を作る</button>}
        {status&&!status.forwardReady&&<p className="muted">転送メールの受信設定はまだ完了していません。</p>}
      </section>
      <section><div className="row"><h3 className="grow">確認待ち（最新100件）</h3><button className="btn" disabled={busy} onClick={()=>void run(load)}>一覧を更新</button></div>
      {status&&rows.length===0&&<p>確認待ちのメールはありません。</p>}
      {rows.map(row=><CandidateReview key={row.id} row={row} entries={entries} onSaved={async()=>{await onSync();await load();}} onIgnored={load}/>)}</section>
    </>}
    {error&&<p className="err" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <details><summary>サンプルで読み取り方を試す</summary><button className="btn" onClick={()=>setDemo('企業名：みらい商事\nES提出期限：2027年1月20日 17:00\n適性検査 締切：2027年1月22日 23:59')}>架空のメールを表示</button><textarea className="field" aria-label="試し読みするメール本文" value={demo} maxLength={10000} onChange={e=>setDemo(e.target.value)}/>
    {demo&&parseMail({subject:'',from:'',text:demo,receivedAt:new Date().toISOString()}).map((c,i)=><div className="mail-demo" key={i}><b>{c.company||'企業名は確認が必要'}・{c.kind}</b><p>{c.date||'日付未確定'} {c.time}</p><p className="muted">{c.reason}</p></div>)}<p className="hint">ここに貼った内容は外部へ送信・保存されません。</p></details>
  </Modal>;
}

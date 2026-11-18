import { useState } from 'react';
import { ES_LIMITS, type Entry, type ESDraft, type InterviewNote } from '../core/types';
import { characterCount, gmailUrl } from '../core/companies';
import { newId } from '../core/entries';
import { jstDateStr } from '../core/dates';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/toast';

export function CareerNotebook({ entry, tab: initialTab, focusId, onPatch, onClose, onExport, storageOK }: {
  entry: Entry; tab: 'es' | 'interview';
  /** 開いたときに選んでおく原稿・面接記録（ホームの一覧から開いた場合） */
  focusId?: string; onPatch: (patch: Partial<Entry>) => void; onClose: () => void; onExport: () => void; storageOK: boolean;
}) {
  const [tab, setTab] = useState(initialTab);
  const [selectedES, setSelectedES] = useState((entry.esDrafts.find(d => d.id === focusId) ?? entry.esDrafts[0])?.id ?? '');
  const [selectedInterview, setSelectedInterview] = useState((entry.interviews.find(d => d.id === focusId) ?? entry.interviews[0])?.id ?? '');
  const [deleting, setDeleting] = useState('');
  const es = entry.esDrafts.find(d => d.id === selectedES);
  const interview = entry.interviews.find(d => d.id === selectedInterview);
  const updateES = (patch: Partial<ESDraft>) => onPatch({ esDrafts: entry.esDrafts.map(d => d.id === selectedES ? { ...d, ...patch } : d) });
  const updateInterview = (patch: Partial<InterviewNote>) => onPatch({ interviews: entry.interviews.map(d => d.id === selectedInterview ? { ...d, ...patch } : d) });
  const addES = (limit: number) => {
    const draft = { id: newId(), title: '自己PR', limit, text: '' };
    onPatch({ esDrafts: [...entry.esDrafts, draft] }); setSelectedES(draft.id);
  };
  const addInterview = () => {
    const note = { id: newId(), date: jstDateStr(Date.now()), round: '一次面接', question: '', answer: '', reflection: '' };
    onPatch({ interviews: [...entry.interviews, note] }); setSelectedInterview(note.id);
  };
  const remove = () => {
    if (tab === 'es') { onPatch({ esDrafts: entry.esDrafts.filter(d => d.id !== selectedES) }); setSelectedES(''); }
    else { onPatch({ interviews: entry.interviews.filter(d => d.id !== selectedInterview) }); setSelectedInterview(''); }
    setDeleting('');
  };
  return <Modal title={`${entry.company}のノート`} onClose={onClose} keepOnBackdrop>
    <p className={storageOK ? 'autosave' : 'warn'} role="status">{storageOK ? '入力内容はこの端末に自動保存されます' : '端末に保存できません。閉じる前にコピーか書き出しをしてください。'}</p>
    <div className="tabs" role="tablist" aria-label="ノートの種類">
      <button role="tab" aria-selected={tab === 'es'} onClick={() => { setTab('es'); setDeleting(''); }}>ESストック</button>
      <button role="tab" aria-selected={tab === 'interview'} onClick={() => { setTab('interview'); setDeleting(''); }}>面接ノート</button>
    </div>
    {tab === 'es' ? <div className="stack" role="tabpanel" aria-label="ESストック">
      <p className="muted">設問や文字数に合わせて原稿を残せます。コピーして応募フォームへ。</p>
      <div className="quick">{[400, 800, 1200].map(limit => <button key={limit} type="button" disabled={entry.esDrafts.length >= 50} onClick={() => addES(limit)}>＋ {limit}文字</button>)}</div>
      {!!entry.esDrafts.length && <label className="fg">保存した原稿
        <select className="field" value={selectedES} onChange={e => { setSelectedES(e.target.value); setDeleting(''); }}>
          <option value="">原稿を選ぶ</option>{entry.esDrafts.map(d => <option key={d.id} value={d.id}>{d.title || '無題'}・{d.limit}文字</option>)}
        </select>
      </label>}
      {!entry.esDrafts.length && <div className="notebook-empty">まだ原稿はありません。文字数を選んで、最初の一文を残しましょう。</div>}
      {es && <>
        <label className="fg">設問・タイトル<input className="field" value={es.title} maxLength={100} onChange={e => updateES({ title: e.target.value })} /></label>
        <label className="fg">文字数の上限<select className="field" value={es.limit} onChange={e => updateES({ limit: Number(e.target.value) })}>{ES_LIMITS.map(n => <option key={n} value={n}>{n}文字</option>)}</select></label>
        <p className={characterCount(es.text) > es.limit ? 'err' : 'character-meter'} role="status">{characterCount(es.text)} / {es.limit}文字　{characterCount(es.text) > es.limit ? `${characterCount(es.text) - es.limit}文字オーバー` : `あと${es.limit - characterCount(es.text)}文字`}</p>
        <label className="fg">ES本文<textarea className="field writing-area" value={es.text} maxLength={20000} onChange={e => updateES({ text: e.target.value })} placeholder="あなたの経験や、伝えたいことを書いてみましょう。" /></label>
        <p className="hint">改行を除き、空白・句読点を含みます。応募先のカウント方法も確認してください。超過しても原稿は保存します。</p>
        <button className="btn primary" onClick={async () => { try { await navigator.clipboard.writeText(es.text); toast('ESをコピーしました'); } catch { toast('コピーできませんでした。本文を選択してコピーしてください'); } }}>本文をコピー</button>
      </>}
    </div> : <div className="stack" role="tabpanel" aria-label="面接ノート">
      <p className="muted">聞かれたこと、答えたこと。次の面接に向けた気づきを残しましょう。</p>
      <button className="btn primary" disabled={entry.interviews.length >= 50} onClick={addInterview}>＋ 面接を記録</button>
      {!!entry.interviews.length && <label className="fg">保存した面接<select className="field" value={selectedInterview} onChange={e => { setSelectedInterview(e.target.value); setDeleting(''); }}>
        <option value="">面接を選ぶ</option>{entry.interviews.map(d => <option key={d.id} value={d.id}>{d.date} {d.round || '面接'}</option>)}
      </select></label>}
      {!entry.interviews.length && <div className="notebook-empty">面接が終わったら、忘れないうちにひとこと。</div>}
      {interview && <>
        <div className="two">
          <label className="fg">面接日<input type="date" className="field" value={interview.date} onChange={e => updateInterview({ date: e.target.value })} /></label>
          <label className="fg">面接の段階<input className="field" maxLength={100} value={interview.round} onChange={e => updateInterview({ round: e.target.value })} /></label>
        </div>
        <label className="fg">聞かれた質問<textarea className="field" maxLength={10000} value={interview.question} onChange={e => updateInterview({ question: e.target.value })} placeholder="例：学生時代に力を入れたことは？" /></label>
        <label className="fg">自分の回答<textarea className="field" maxLength={10000} value={interview.answer} onChange={e => updateInterview({ answer: e.target.value })} /></label>
        <label className="fg">振り返り・次に活かすこと<textarea className="field" maxLength={10000} value={interview.reflection} onChange={e => updateInterview({ reflection: e.target.value })} /></label>
      </>}
    </div>}
    <div className="row notebook-footer">
      <button className="btn" onClick={onExport}>この企業を書き出す</button>
      <a className="btn" href={gmailUrl(entry.company)} target="_blank" rel="noopener noreferrer">Gmailで検索 ↗</a>
      {(tab === 'es' ? es : interview) && (deleting ? <><span className="err">この記録を削除しますか？</span><button className="btn danger" onClick={remove}>記録を削除する</button><button className="btn" onClick={() => setDeleting('')}>やめる</button></> : <button className="btn danger" onClick={() => setDeleting('yes')}>この記録を削除</button>)}
    </div>
  </Modal>;
}

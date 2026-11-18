import { useState } from 'react';
import type { Entry } from '../core/types';
import { Modal } from '../ui/Modal';

export function DeleteEntryDialog({ entry, entries, onDelete, onClose }: {
  entry: Entry; entries: Entry[]; onDelete: (ids: string[]) => void; onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  const related = entries.filter(e => e.company === entry.company);
  const targets = all ? related : [entry];
  const drafts = targets.reduce((n, e) => n + e.esDrafts.length, 0);
  const interviews = targets.reduce((n, e) => n + e.interviews.length, 0);
  return <Modal title="企業の登録を削除" onClose={onClose} keepOnBackdrop>
    <p><b>{entry.company}</b>の登録を削除します。</p>
    {related.length > 1 && <label className="check-row">
      <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />
      同じ企業の登録をすべて削除する（{related.length}件）
    </label>}
    <ul className="rows">{targets.map(e => <li key={e.id}>{e.kind || '種類未設定'}・{e.dDate || '締切未登録'} {e.dTime}</li>)}</ul>
    <p className="warn">この登録に保存したES {drafts}件・面接ノート {interviews}件・メモも一緒に削除されます。</p>
    <p className="hint">削除直後のお知らせから8秒間、元に戻せます。必要な記録は先にExcel・Wordやバックアップに保存してください。</p>
    <p className="hint">アプリの一覧と、同期後の通知対象から外れます。外部の応募・Gmailのメール・Googleカレンダーの予定は取り消しません。</p>
    <div className="row">
      <button className="btn" type="button" onClick={onClose}>キャンセル</button>
      <button className="btn danger" type="button" onClick={() => onDelete(targets.map(e => e.id))}>削除する</button>
    </div>
  </Modal>;
}

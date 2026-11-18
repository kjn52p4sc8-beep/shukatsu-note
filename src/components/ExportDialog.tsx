import { jstDateStr } from '../core/dates';
import { useState } from 'react';
import type { Entry } from '../core/types';
import { Modal } from '../ui/Modal';
import { saveBinary } from '../ui/files';
import { excelBlob, wordBlob } from '../core/office';
import { EMBEDDED } from '../data/config';

export function ExportDialog({ entries, onClose }: { entries: Entry[]; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const download = async (type: 'xlsx' | 'docx') => {
    // お試しページ（埋め込み）ではファイルを保存できないので、作成を始める前に知らせる
    if (EMBEDDED) return setMessage('このお試しページではファイルを保存できません。公開したアプリで書き出してください。');
    setBusy(true); setMessage('');
    try {
      const blob = await (type === 'xlsx' ? excelBlob(entries) : wordBlob(entries));
      await saveBinary(`就活しめきりボード_${jstDateStr(Date.now()).replace(/-/g, '')}.${type}`, blob);
      setMessage('ファイルを作成しました。ダウンロード先、または共有先で確認してください。');
    } catch (e) { setMessage(e instanceof Error ? e.message : '書き出せませんでした。もう一度お試しください。'); }
    finally { setBusy(false); }
  };
  return <Modal title="Excel・Wordに書き出す" onClose={onClose} keepOnBackdrop>
    <p>選択した {entries.length} 件の企業情報・締切・ES・面接ノートをまとめます。</p>
    <button className="btn primary" disabled={busy || !entries.length} onClick={() => void download('xlsx')}>Excel（.xlsx）を保存</button>
    <p className="muted">企業・締切、ESストック、面接ノートの3シート。表として編集できます。</p>
    <button className="btn" disabled={busy || !entries.length} onClick={() => void download('docx')}>Word（.docx）を保存</button>
    <p className="muted">企業ごとに見出しと本文をまとめた文書。推敲や印刷に使えます。</p>
    {busy && <p role="status">ファイルを作成しています…</p>}
    {message && <p role="status">{message}</p>}
  </Modal>;
}

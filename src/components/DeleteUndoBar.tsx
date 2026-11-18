import { useEffect, useState } from 'react';
import type { Entry } from '../core/types';

/** 削除を元に戻せる時間 */
export const UNDO_MS = 8000;

/** 1回の削除操作で消した登録の束 */
export interface DeletedBatch {
  id: number;
  entries: Entry[];
  /** この時刻（UTCミリ秒）を過ぎたら元に戻せない */
  expiresAt: number;
}

/** 束の説明。「みらい商事の登録を削除しました」「みらい商事の登録2件を削除しました」など */
export function batchMessage(batch: DeletedBatch): string {
  const names = Array.from(new Set(batch.entries.map((e) => e.company)));
  const who = names.length === 1 ? names[0] : `${names[0]}ほか${names.length - 1}社`;
  return batch.entries.length === 1 ? `${who}の登録を削除しました` : `${who}の登録${batch.entries.length}件を削除しました`;
}

/**
 * 削除の取り消し専用の表示。ほかのお知らせとは別の枠なので、削除のあとに別の操作をしても
 * 取り消しが消えない。続けて削除したときは新しい順に1つずつ元に戻せる（それぞれ削除から8秒間）。
 */
export function DeleteUndoBar({ batches, onUndo, onExpire }: {
  batches: DeletedBatch[];
  onUndo: (batch: DeletedBatch) => void;
  onExpire: (ids: number[]) => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!batches.length) return;
    const next = Math.min(...batches.map((b) => b.expiresAt));
    const t = setTimeout(() => {
      const at = Date.now();
      setNow(at);
      const gone = batches.filter((b) => b.expiresAt <= at).map((b) => b.id);
      if (gone.length) onExpire(gone);
    }, Math.max(0, next - Date.now()) + 20);
    return () => clearTimeout(t);
  }, [batches, onExpire, now]);

  const live = batches.filter((b) => b.expiresAt > Date.now());
  const latest = live[live.length - 1];
  if (!latest) return null;
  return (
    <div className="toast undo-bar" role="status">
      <span>
        {batchMessage(latest)}
        {live.length > 1 && <small>（ほかに {live.length - 1} 回分を元に戻せます）</small>}
      </span>
      <button type="button" onClick={() => onUndo(latest)}>
        元に戻す
      </button>
    </div>
  );
}

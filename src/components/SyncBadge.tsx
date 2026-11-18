import type { SyncStatus } from '../data/store';

interface Props {
  sync: SyncStatus;
  onClick: () => void;
}

/** ヘッダーに出す同期の状態。押すとすぐ同期する。 */
export function SyncBadge({ sync, onClick }: Props) {
  if (sync.phase === 'local') return null;
  const label =
    sync.phase === 'syncing'
      ? '同期中…'
      : sync.phase === 'offline'
        ? sync.pending
          ? `オフライン（未同期${sync.pending}件）`
          : 'オフライン'
        : sync.phase === 'error'
          ? '同期エラー'
          : sync.pending
            ? `未同期${sync.pending}件`
            : '同期済み';
  return (
    <button className={'sync s-' + sync.phase} type="button" onClick={onClick} title="押すと今すぐ同期します" aria-live="polite">
      <i aria-hidden="true" />
      {label}
    </button>
  );
}

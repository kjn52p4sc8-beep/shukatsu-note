import { useRef, useState } from 'react';
import { legacyIdToUuid, parseBackup, toBackupJSON, toCSV } from '../core/backup';
import { allEvents, buildICS } from '../core/calendar';
import { fmtDate, jstDateStr, jstTimeStr } from '../core/dates';
import { sampleEntries } from '../core/entries';
import type { Entry } from '../core/types';
import { deleteAccount, signOut, type AuthUser } from '../data/auth';
import { EMBEDDED } from '../data/config';
import type { Snapshot, Store } from '../data/store';
import { disablePush } from '../push/push';
import { useInstallPrompt } from '../ui/install';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/toast';
import { PushSection } from './PushSection';
import { ReminderChecks } from './Reminders';

interface Props {
  store: Store;
  snap: Snapshot;
  /** ログイン中の利用者。この端末だけに保存する版では null */
  user: AuthUser | null;
  onSaveFile: (filename: string, text: string, mime: string) => void;
  onChangePassword: () => void;
  onClose: () => void;
}

const todayTag = () => jstDateStr(Date.now()).replace(/-/g, '');

function syncText(snap: Snapshot): string {
  const { phase, pending, lastSyncAt, message } = snap.sync;
  const last = lastSyncAt ? `最後の同期: ${fmtDate(jstDateStr(lastSyncAt), Date.now())} ${jstTimeStr(lastSyncAt)}` : 'まだ同期していません';
  if (phase === 'syncing') return '同期しています…';
  if (phase === 'offline') return `オフラインです。${pending ? `まだ送れていない変更が ${pending} 件あります。` : ''}つながったら自動で同期します。`;
  if (phase === 'error') return `同期できませんでした: ${message}`;
  return pending ? `${last}（未同期 ${pending} 件）` : last;
}

export function SettingsDialog({ store, snap, user, onSaveFile, onChangePassword, onClose }: Props) {
  const install = useInstallPrompt();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<{ name: string; entries: Entry[]; overlap: number } | null>(null);
  const [confirm, setConfirm] = useState<'' | 'signout' | 'delete'>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // ---- アカウント ----
  const doSignOut = async () => {
    setBusy(true);
    await disablePush().catch(() => undefined);
    store.clearLocal();
    await signOut();
  };
  const doDelete = async () => {
    setBusy(true);
    setError('');
    try {
      await disablePush().catch(() => undefined);
      await deleteAccount();
      store.clearLocal();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'うまくいきませんでした。');
      setBusy(false);
    }
  };

  // ---- 読み込み ----
  const onFile = async (file: File) => {
    try {
      const items = parseBackup(file.name, await file.text());
      if (!items.length) throw new Error('読み込める項目がありませんでした');
      // 以前のブラウザ保存版のIDは、利用者ごとに決まったIDに直す（同じファイルを2回読んでも二重にならない）
      const scope = user?.id ?? 'local';
      const entries: Entry[] = [];
      for (const { entry, legacyId } of items) {
        entries.push(legacyId ? { ...entry, id: await legacyIdToUuid(scope, legacyId) } : entry);
      }
      const current = new Set(snap.entries.map((e) => e.id));
      setPendingImport({ name: file.name, entries, overlap: entries.filter((e) => current.has(e.id)).length });
    } catch (e) {
      setPendingImport(null);
      toast('読み込めませんでした：' + (e instanceof Error && e.message ? e.message : 'ファイルの形式を確認してください'));
    }
  };
  const applyImport = async (replace: boolean) => {
    if (!pendingImport) return;
    const { entries } = pendingImport;
    store.importEntries(entries, replace);
    setPendingImport(null);
    toast(entries.length + ' 件を読み込みました');
  };

  return (
    <Modal title="設定・書き出し" onClose={onClose}>
      {user ? (
        <section>
          <h3>アカウントと同期</h3>
          <p className="break">{user.email || 'ログイン中'}</p>
          <p className="muted" id="sync-text">
            {syncText(snap)}
          </p>
          {confirm === '' && (
            <div className="row">
              <button className="btn small" type="button" onClick={() => void store.sync()} disabled={snap.sync.phase === 'syncing'}>
                今すぐ同期
              </button>
              <button className="btn small" type="button" onClick={onChangePassword}>
                パスワードを変更
              </button>
              <button className="btn small" type="button" onClick={() => (snap.sync.pending ? setConfirm('signout') : void doSignOut())} disabled={busy}>
                ログアウト
              </button>
              <button className="btn small danger" type="button" onClick={() => setConfirm('delete')}>
                アカウントを削除
              </button>
            </div>
          )}
          {confirm === 'signout' && (
            <div className="row">
              <span className="err grow">
                まだ送れていない変更が {snap.sync.pending} 件あります。いまログアウトすると、その変更は失われます。
              </span>
              <button className="btn small danger" type="button" onClick={doSignOut} disabled={busy}>
                それでもログアウト
              </button>
              <button className="btn small" type="button" onClick={() => setConfirm('')}>
                やめる
              </button>
            </div>
          )}
          {confirm === 'delete' && (
            <div className="row">
              <span className="err grow">
                アカウントと、登録したすべてのエントリーを削除します。元に戻せません。必要なら先にバックアップを書き出してください。
              </span>
              <button className="btn small danger" type="button" onClick={doDelete} disabled={busy}>
                {busy ? '削除中…' : '完全に削除する'}
              </button>
              <button className="btn small" type="button" onClick={() => setConfirm('')} disabled={busy}>
                やめる
              </button>
            </div>
          )}
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
        </section>
      ) : (
        <p className="warn">
          この版はログインなしで、データをこの端末のブラウザの中だけに保存します。ほかの端末とは同期されません。ブラウザのデータを消すと内容も消えるため、ときどきバックアップを書き出してください。
        </p>
      )}

      <PushSection offsets={snap.settings.pushOffsets} onOffsets={(v) => store.updateSettings({ pushOffsets: v })} />

      <section>
        <h3>カレンダーに渡すリマインダー</h3>
        <ReminderChecks
          value={snap.settings.icsReminders}
          onChange={(v) => store.updateSettings({ icsReminders: v })}
          label="カレンダーに渡すリマインダー"
        />
        <p className="muted">
          .ics ファイル（iPhone・Mac・Outlookなど）に通知として書き込みます。Googleカレンダーのリンクでは通知を指定できないため、Google側の既定の通知が使われます。
        </p>
        <div className="row">
          <button
            className="btn small" type="button"
            onClick={() => {
              const evs = allEvents(snap.entries);
              if (!evs.length) return toast('書き出せる締切がありません');
              onSaveFile('就活しめきりボード_' + todayTag() + '.ics', buildICS(evs, snap.settings.icsReminders, Date.now()), 'text/calendar');
            }}
          >
            全締切をまとめて .ics で書き出す
          </button>
        </div>
      </section>

      <section>
        <h3>サンプルで試す</h3>
        <p className="muted">架空の企業5件（締切・提出物つき）を追加します。使い方が分かったら、ホームの「サンプルを全部消す」で消せます。</p>
        <div className="row">
          <button
            className="btn small" type="button"
            onClick={() => {
              store.saveEntries(sampleEntries(Date.now()));
              toast('サンプルを5件入れました');
              onClose();
            }}
          >
            サンプルデータを入れる
          </button>
        </div>
      </section>

      <section>
        <h3>バックアップ</h3>
        <p className="muted">
          JSONは完全な控え、CSVは表計算ソフトでも開けます。以前のブラウザ保存版で書き出したファイルも、ここから読み込めます。
        </p>
        <div className="row">
          <button
            className="btn small" type="button"
            onClick={() => onSaveFile('就活しめきりボード_バックアップ_' + todayTag() + '.json', toBackupJSON(snap.entries, Date.now()), 'application/json')}
          >
            JSONで書き出す
          </button>
          <button className="btn small" type="button" onClick={() => onSaveFile('就活しめきりボード_バックアップ_' + todayTag() + '.csv', toCSV(snap.entries), 'text/csv')}>
            CSVで書き出す
          </button>
          <button className="btn small" type="button" onClick={() => fileRef.current?.click()}>
            ファイルから読み込む
          </button>
          <input
            ref={fileRef} id="imp-file" type="file" accept=".json,.csv,application/json,text/csv" hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = '';
            }}
          />
        </div>
        {pendingImport && (
          <div className="stack">
            <p className="strong">
              「{pendingImport.name}」から {pendingImport.entries.length} 件を読み込みます。
            </p>
            <p className="muted">
              {pendingImport.overlap > 0
                ? `うち ${pendingImport.overlap} 件はすでに登録されている企業です。「追加する」を選ぶと、その ${pendingImport.overlap} 件は読み込んだ内容で上書きされ、二重にはなりません。`
                : '今の登録と重なるものはありません。「追加する」を選ぶと、今の登録はそのまま残ります。'}
              「置き換える」を選ぶと、今の登録はすべて消えて、ファイルの内容だけになります。
            </p>
            <div className="row">
              <button className="btn small primary" type="button" onClick={() => void applyImport(false)}>
                今のデータに追加する
              </button>
              <button className="btn small danger" type="button" onClick={() => void applyImport(true)}>
                今のデータと置き換える
              </button>
              <button className="btn small" type="button" onClick={() => setPendingImport(null)}>
                やめる
              </button>
            </div>
          </div>
        )}
      </section>

      {!EMBEDDED && (
      <section>
        <h3>ホーム画面に追加（アプリのように開く）</h3>
        <ul className="plain">
          <li>
            <b>iPhone（Safari）</b>：共有ボタン →「ホーム画面に追加」
          </li>
          <li>
            <b>Android（Chrome）</b>：右上のメニュー →「ホーム画面に追加」または「アプリをインストール」
          </li>
        </ul>
        {install && (
          <div className="row">
            <button className="btn small" type="button" onClick={install}>
              この端末にインストールする
            </button>
          </div>
        )}
      </section>
      )}

      <section>
        <h3>データについて</h3>
        {user ? (
          <p className="muted">
            登録した内容はサーバーに保存され、ログインした本人だけが読み書きできます。オフラインでも使えるよう、この端末にも控えを置いています（ログアウトすると端末の控えは消えます）。就活サイトのIDやパスワードは保存しません。
          </p>
        ) : (
          <p className="muted">入力した内容はこのブラウザの中にだけ保存され、どこにも送信されません。</p>
        )}
        <p className="muted">
          {snap.storageOK ? `現在 ${snap.entries.length} 件を保存しています。` : 'このブラウザでは端末への保存が無効になっています。'}
        </p>
      </section>
    </Modal>
  );
}

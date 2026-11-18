import { MailDialog } from './MailDialog';
import { finishMailCallback } from '../data/mail';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { characterCount, gmailUrl } from '../core/companies';
import { deadlineMs, fmtDate, shortLeft, weekRange, DAY } from '../core/dates';
import { checkProgress, newId, pendingEntries, platformCounts, sampleEntries, sortEntries } from '../core/entries';
import { ES_LIMITS, type Entry, type Status } from '../core/types';
import type { AuthUser } from '../data/auth';
import { EMBEDDED } from '../data/config';
import type { Store } from '../data/store';
import { saveFile } from '../ui/files';
import { BellIcon, BuildingIcon, CalendarIcon, ChatIcon, ChevronIcon, DocIcon, MailIcon, MenuIcon, SearchIcon, TableIcon } from '../ui/icons';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/toast';
import { useNow } from '../ui/useNow';
import { CalendarDialog } from './CalendarDialog';
import { CareerNotebook } from './CareerNotebook';
import { EntryCard } from './EntryCard';
import { DeleteEntryDialog } from './DeleteEntryDialog';
import { DeleteUndoBar, UNDO_MS, type DeletedBatch } from './DeleteUndoBar';
import { EntryForm } from './EntryForm';
import { ExportDialog } from './ExportDialog';
import { NextBoard } from './NextBoard';
import { NotificationDialog } from './NotificationDialog';
import { PasswordDialog } from './PasswordDialog';
import { SettingsDialog } from './SettingsDialog';
import { SyncBadge } from './SyncBadge';

interface Props {
  store: Store;
  user: AuthUser | null;
  /** パスワード再設定のリンクから開いた */
  recovery?: boolean;
}

type Dialog =
  | { type: 'none' }
  | { type: 'form'; id: string | null }
  | { type: 'calendar'; id: string }
  | { type: 'settings' }
  | { type: 'password' }
  | { type: 'notebook'; id: string; tab: 'es' | 'interview'; focusId?: string }
  | { type: 'library' }
  /** ホームの「ESの文字数別保存」から開く、その文字数の原稿一覧 */
  | { type: 'eslist'; limit: number }
  | { type: 'mail' }
  | { type: 'gmail' }
  | { type: 'calendar-pick' }
  | { type: 'notifications' }
  | { type: 'export'; id?: string };

const NONE = '__none';
/** ホームにいつも出しておく文字数のタイル */
const HOME_LIMITS = [400, 800, 1200];

export function BoardScreen({ store, user, recovery }: Props) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const now = useNow();
  const [mailNotice,setMailNotice]=useState('');
  useEffect(()=>{if(!user)return;let alive=true;const result=finishMailCallback();if(result)void result.then(message=>{if(alive)setMailNotice(message);});return()=>{alive=false;};},[user]);
  const [dialog, setDialog] = useState<Dialog>({ type: 'none' });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [recoveryDone, setRecoveryDone] = useState(false);
  const [textFile, setTextFile] = useState<{ name: string; text: string } | null>(null);
  const [alertClosed, setAlertClosed] = useState(false);
  const [q, setQ] = useState('');
  const [platform, setPlatform] = useState('');
  const [status, setStatus] = useState<'' | Status>('');
  const [view, setView] = useState<'all' | 'pending' | 'week' | 'overdue' | 'submitted'>('all');

  const entries = snap.entries;
  const pending = useMemo(() => pendingEntries(entries, now), [entries, now]);
  const counts = useMemo(() => platformCounts(entries), [entries]);
  const wk = weekRange(now);
  const near = pending.filter((it) => deadlineMs(it)! - now <= 3 * DAY);
  const weekCount = pending.filter((it) => deadlineMs(it)! < wk.end).length;

  const unresolved = entries.filter((it) => it.status === 'undecided').length;
  const overdue = entries.filter((it) => it.status === 'undecided' && deadlineMs(it) !== null && deadlineMs(it)! < now).length;
  const submitted = entries.filter((it) => it.status === 'submitted').length;
  const resetFilters = () => { setQ(''); setPlatform(''); setStatus(''); setView('all'); };
  const changeView = (v: typeof view) => { setView(v); setStatus(''); };
  const markSubmitted = (id: string) => { store.patchEntry(id, { status: 'submitted' }); toast('提出済みにしました', { label: '元に戻す', run: () => store.patchEntry(id, { status: 'undecided' }) }); };

  // 選んでいたプラットフォームの項目がなくなったら、絞り込みを外す
  const platformValue = platform && counts.some(([k]) => (k === '未設定' ? NONE : k) === platform) ? platform : '';

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sortEntries(entries, now).filter((it) => {
      if (needle && ![it.company, it.kind, it.platform, it.memo].some((s) => s.toLowerCase().includes(needle))) return false;
      if (platformValue && (platformValue === NONE ? it.platform !== '' : it.platform !== platformValue)) return false;
      if (status && it.status !== status) return false;
      const ms = deadlineMs(it);
      if (view === 'submitted' && it.status !== 'submitted') return false;
      if (['pending', 'week', 'overdue'].includes(view) && it.status !== 'undecided') return false;
      if (view === 'week' && (ms === null || ms < now || ms >= wk.end)) return false;
      if (view === 'overdue' && (ms === null || ms >= now)) return false;
      return true;
    });
  }, [entries, now, q, platformValue, status, view, wk.end]);

  const find = (id: string | null) => (id ? entries.find((e) => e.id === id) ?? null : null);
  const close = () => setDialog({ type: 'none' });

  // 削除の取り消しは、ほかのお知らせに上書きされないよう専用の枠で持つ
  const [undoBatches, setUndoBatches] = useState<DeletedBatch[]>([]);
  const batchSeq = useRef(0);
  const deleteEntries = (ids: string[]) => {
    const deleted = store.getSnapshot().entries.filter(e => ids.includes(e.id));
    if (!deleted.length) { setDeleteId(null); return; }
    store.deleteEntries(deleted.map(e => e.id));
    setDeleteId(null);
    close();
    const batch = { id: ++batchSeq.current, entries: deleted, expiresAt: Date.now() + UNDO_MS };
    setUndoBatches((list) => [...list, batch]);
  };
  const undoDelete = (batch: DeletedBatch) => {
    // すでに別の端末や操作で戻っている登録は上書きしない
    const active = new Set(store.getSnapshot().entries.map(e => e.id));
    const restore = batch.entries.filter(e => !active.has(e.id));
    if (restore.length) store.saveEntries(restore);
    setUndoBatches((list) => list.filter((b) => b.id !== batch.id));
    toast(restore.length ? '元に戻しました' : 'すでに元に戻っています');
  };
  const expireUndo = useCallback((ids: number[]) => setUndoBatches((list) => list.filter((b) => !ids.includes(b.id))), []);

  const onSaveFile = async (name: string, text: string, mime: string) => {
    if (!(await saveFile(name, text, mime))) setTextFile({ name, text });
  };

  const onCheck = (id: string, checkId: string, done: boolean) => {
    const it = find(id);
    if (!it) return;
    const checklist = it.checklist.map((c) => (c.id === checkId ? { ...c, done } : c));
    store.patchEntry(id, { checklist });
    if (checkProgress({ checklist }).complete) toast('提出物のチェックが完了しました。応募後に「提出済みにする」を押してください');
  };

  // ---- ホームの「ESの文字数別保存」「面接ノート」用に、全企業の記録を集める ----
  const allDrafts = useMemo(() => entries.flatMap((e) => e.esDrafts.map((d) => ({ entry: e, draft: d }))), [entries]);
  const limits = useMemo(
    () => ES_LIMITS.filter((n) => HOME_LIMITS.includes(n) || allDrafts.some((x) => x.draft.limit === n)),
    [allDrafts],
  );
  const allInterviews = useMemo(
    () =>
      entries
        .flatMap((e) => e.interviews.map((note) => ({ entry: e, note })))
        .sort((a, b) => b.note.date.localeCompare(a.note.date)),
    [entries],
  );
  const companies = useMemo(() => Array.from(new Set(entries.map((e) => e.company))), [entries]);
  const withDates = useMemo(() => sortEntries(entries.filter((e) => e.dDate || e.eDate), now), [entries, now]);
  const [newDraftEntry, setNewDraftEntry] = useState('');

  /** 選んだ企業に、その文字数の原稿を新しく作って開く */
  const createDraft = (entry: Entry, limit: number) => {
    const draft = { id: newId(), title: '自己PR', limit, text: '' };
    store.patchEntry(entry.id, { esDrafts: [...entry.esDrafts, draft] });
    setDialog({ type: 'notebook', id: entry.id, tab: 'es', focusId: draft.id });
  };
  const openCalendarPicker = () => {
    if (!withDates.length) return toast('締切か開催日を登録すると、カレンダーに追加できます');
    setDialog(withDates.length === 1 ? { type: 'calendar', id: withDates[0].id } : { type: 'calendar-pick' });
  };

  const editing = dialog.type === 'form' ? find(dialog.id) : null;
  const deleting = find(deleteId);
  const noteEntry = dialog.type === 'notebook' ? find(dialog.id) : null;
  const calEntry = dialog.type === 'calendar' ? find(dialog.id) : null;
  const hasSample = entries.some((e) => e.sample);

  return (
    <>
      <header className="hero">
        <div className="hero-in">
          <button className="icon-btn" id="btn-settings" type="button" aria-label="設定" title="設定・書き出し" onClick={() => setDialog({ type: 'settings' })}>
            <MenuIcon />
          </button>
          <div className="hero-title">
            <h1>就活ノート</h1>
            <p>今日の一歩を、未来につなげよう。</p>
          </div>
          <button className="icon-btn" type="button" aria-label="通知設定" title="通知設定" onClick={() => setDialog({ type: 'notifications' })}>
            <BellIcon />
          </button>
        </div>
        <SyncBadge sync={snap.sync} onClick={() => void store.sync()} />
      </header>

      <main className="wrap sheet" id="app">
        {mailNotice && <p className="note" role="status">{mailNotice}</p>}
        {!alertClosed && near.length > 0 && (
          <div className="alert" role="alert">
            <ul>
              {near.slice(0, 4).map((it) => (
                <li key={it.id}>
                  {it.company}
                  {it.kind ? `（${it.kind}）` : ''}の締切まで <b>{shortLeft(deadlineMs(it)!, now)}です！</b>
                </li>
              ))}
              {near.length > 4 && <li>ほか {near.length - 4} 件</li>}
            </ul>
            <button className="x" type="button" aria-label="お知らせを閉じる" onClick={() => setAlertClosed(true)}>
              ×
            </button>
          </div>
        )}

        {EMBEDDED && (
          <p className="warn">
            <b>お試し版</b>です。入力した内容はこのブラウザの中だけに保存されます。ログイン・端末間の同期・プッシュ通知は、公開したアプリで使えます。
          </p>
        )}

        {hasSample && (
          <div className="note">
            <p>
              <b>サンプル</b>のデータが入っています（架空の企業）。使い方が分かったら消してください。
            </p>
            <button
              className="btn small" type="button"
              onClick={() => {
                store.deleteEntries(entries.filter((e) => e.sample).map((e) => e.id));
                toast('サンプルを消しました');
              }}
            >
              サンプルを全部消す
            </button>
          </div>
        )}
        {!snap.storageOK && (
          <p className="warn">
            このブラウザでは端末にデータを保存できない設定になっています。
            {user ? 'オフラインでは使えません。' : 'ページを閉じると入力内容が消えます（プライベートブラウズを解除するか、別のブラウザで開いてください）。'}
          </p>
        )}
        {snap.sync.phase === 'error' && <p className="warn">同期できませんでした: {snap.sync.message}</p>}

        <section className="sec" aria-labelledby="sec-next">
          <h2 id="sec-next">直近の締切</h2>
          <NextBoard
            entry={pending[0]} now={now} unresolved={unresolved} onSubmit={markSubmitted}
            onEdit={(id) => setDialog({ type: 'form', id })}
            onCalendar={(id) => setDialog({ type: 'calendar', id })}
          />
        </section>

        <label className="search-box">
          <SearchIcon />
          <input
            id="q" type="search" placeholder="企業名を検索" aria-label="企業名・内容・メモで検索" autoComplete="off"
            value={q} onChange={(e) => setQ(e.target.value)}
          />
        </label>

        <section className="sec" aria-labelledby="sec-list">
        <h2 id="sec-list">企業一覧</h2>
        <nav className="quick-filters" aria-label="締切の表示切り替え">
          {([['all', 'すべて', entries.length], ['pending', '未提出', unresolved], ['week', '今週', weekCount], ['overdue', '期限切れ', overdue], ['submitted', '提出済み', submitted]] as const).map(([v, label, count]) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => changeView(v)}>{label}<b>{count}</b></button>
          ))}
        </nav>
        <div className="filters" role="group" aria-label="絞り込み">
          <details className="filter-details">
          <summary>詳しい絞り込み{platformValue || status ? '（設定中）' : ''}</summary>
          <div className="filter-fields">
          <select
            className="field" id="flt-platform" aria-label="プラットフォームで絞り込み"
            value={platformValue} onChange={(e) => setPlatform(e.target.value)}
          >
            <option value="">すべてのプラットフォーム</option>
            {counts.map(([k]) => (
              <option key={k} value={k === '未設定' ? NONE : k}>
                {k}
              </option>
            ))}
          </select>
          <select
            className="field" id="flt-status" aria-label="状態で絞り込み"
            value={status} onChange={(e) => { setStatus(e.target.value as '' | Status); setView('all'); }}
          >
            <option value="">すべての状態</option>
            <option value="undecided">未定</option>
            <option value="submitted">提出済み・申込済み</option>
            <option value="skipped">見送り</option>
          </select>
          </div>
          </details>
          {(q || platformValue || status || view !== 'all') && <button className="btn small" type="button" onClick={resetFilters}>絞り込みを解除</button>}
        </div>

        <p className="count-line" id="count-line" role="status">
          {entries.length ? `締切が近い順に ${shown.length} 件を表示（全 ${entries.length} 件）` : ''}
        </p>

        <ul className="list" id="list">
          {shown.map((it) => (
            <EntryCard
              key={it.id} entry={it} now={now}
              onEdit={(id) => setDialog({ type: 'form', id })}
              onDelete={setDeleteId}
              onCalendar={(id) => setDialog({ type: 'calendar', id })}
              onStatus={(id, s) => {
                if (s === 'submitted') markSubmitted(id);
                else store.patchEntry(id, { status: s });
              }}
              onNote={(id, tab) => setDialog({ type: 'notebook', id, tab })}
              onCheck={onCheck}
            />
          ))}
          {shown.length === 0 &&
            (!snap.ready ? (
              <li className="empty">読み込んでいます…</li>
            ) : entries.length ? (
              <li className="empty">条件に合う項目がありません。絞り込みを変えてみてください。</li>
            ) : (
              <li className="empty">
                <p>まだ何も登録されていません。右下の「＋ 追加」から始めましょう。</p>
                <p>
                  <button className="btn small" type="button" onClick={() => store.saveEntries(sampleEntries(Date.now()))}>
                    サンプルを入れて試してみる
                  </button>
                </p>
              </li>
            ))}
        </ul>
        </section>

        <section className="sec" aria-labelledby="sec-es">
          <h2 id="sec-es">ESの文字数別保存</h2>
          <div className="es-tiles">
            {limits.map((limit) => {
              const n = allDrafts.filter((x) => x.draft.limit === limit).length;
              return (
                <button key={limit} type="button" aria-label={`ES ${limit}字（${n}件）`} onClick={() => { setNewDraftEntry(''); setDialog({ type: 'eslist', limit }); }}>
                  <DocIcon />
                  <b>{limit}字</b>
                  <small>{n ? `${n}件` : 'まだなし'}</small>
                </button>
              );
            })}
          </div>
        </section>

        <section className="sec" aria-labelledby="sec-interview">
          <h2 id="sec-interview">面接ノート</h2>
          <ul className="rows">
            {allInterviews.slice(0, 3).map(({ entry, note }) => (
              <li key={note.id}>
                <button className="row-link" type="button" onClick={() => setDialog({ type: 'notebook', id: entry.id, tab: 'interview', focusId: note.id })}>
                  <span className="ico lav"><ChatIcon /></span>
                  <span className="row-text">
                    <b>{note.round || '面接'}メモ</b>
                    <small>{entry.company}{note.date ? `・${fmtDate(note.date, now)}` : ''}</small>
                  </span>
                  <span className="chev"><ChevronIcon /></span>
                </button>
              </li>
            ))}
            <li>
              <button className="row-link" type="button" onClick={() => setDialog({ type: 'library' })}>
                <span className="ico lav"><ChatIcon /></span>
                <span className="row-text">
                  <b>{allInterviews.length > 3 ? `すべての記録を見る（${allInterviews.length}件）` : '面接を記録する'}</b>
                  <small>{allInterviews.length ? '企業ごとのESと面接の記録' : '聞かれたこと・答えたことを残せます'}</small>
                </span>
                <span className="chev"><ChevronIcon /></span>
              </button>
            </li>
          </ul>
        </section>

        <section className="sec out-links" aria-label="ほかのアプリと連携">
          <button type="button" onClick={()=>setDialog({type:'mail'})}><span className="ico white"><MailIcon /></span>応募メールから締切を取り込む<ChevronIcon /></button>
          <button type="button" onClick={() => (companies.length ? setDialog({ type: 'gmail' }) : toast('企業を登録すると、Gmailでその企業のメールを探せます'))}>
            <span className="ico white"><MailIcon /></span>
            Gmailで検索
          </button>
          <button type="button" onClick={openCalendarPicker}>
            <span className="ico white"><CalendarIcon /></span>
            Googleカレンダーに追加
          </button>
          <button type="button" onClick={() => setDialog({ type: 'export' })}>
            <span className="ico white"><TableIcon /></span>
            Excel・Wordに書き出す
          </button>
        </section>

        <p className="foot">
          {user
            ? '登録した内容は、ログインした本人だけが見られます。オフラインでも使え、つながったときに自動で同期します。'
            : 'データはこのブラウザの中にだけ保存され、どこにも送信されません。大事な締切は「カレンダーに追加」でリマインダーを設定してください。'}
        </p>
      </main>

      <button className="btn primary fab" id="btn-add" type="button" onClick={() => setDialog({ type: 'form', id: null })}>
        ＋ 追加
      </button>

      {dialog.type === 'form' && (
        <EntryForm
          key={dialog.id ?? 'new'}
          entry={editing}
          companies={entries.map(e => e.company)}
          onClose={close}
          onSave={(entry) => {
            store.saveEntry(entry);
            close();
            toast(editing ? '保存しました' : '追加しました');
          }}
          onDelete={setDeleteId}
        />
      )}
      {deleting && <DeleteEntryDialog key={deleting.id} entry={deleting} entries={entries} onDelete={deleteEntries} onClose={() => setDeleteId(null)} />}
      {calEntry && (
        <CalendarDialog
          entry={calEntry}
          reminders={snap.settings.icsReminders}
          onReminders={(v) => store.updateSettings({ icsReminders: v })}
          onSaveFile={onSaveFile}
          onClose={close}
        />
      )}
      {dialog.type === 'notebook' && noteEntry && <CareerNotebook key={noteEntry.id} entry={noteEntry} tab={dialog.tab} focusId={dialog.focusId}
        onPatch={patch => store.patchEntry(noteEntry.id, patch)} storageOK={snap.storageOK} onClose={close}
        onExport={() => setDialog({ type: 'export', id: noteEntry.id })} />}
      {dialog.type === 'notifications' && <NotificationDialog settings={snap.settings} onChange={patch => store.updateSettings(patch)} onClose={close} />}
      {dialog.type === 'export' && <ExportDialog entries={dialog.id ? entries.filter(e => e.id === dialog.id) : entries} onClose={close} />}
      {dialog.type === 'eslist' && (() => {
        const limit = dialog.limit;
        const list = allDrafts.filter((x) => x.draft.limit === limit);
        const target = entries.find((e) => e.id === newDraftEntry) ?? (entries.length === 1 ? entries[0] : null);
        return (
          <Modal title={`ES（${limit}字）`} onClose={close}>
            {list.length ? (
              <ul className="rows">
                {list.map(({ entry, draft }) => (
                  <li key={draft.id}>
                    <button className="row-link" type="button" onClick={() => setDialog({ type: 'notebook', id: entry.id, tab: 'es', focusId: draft.id })}>
                      <span className="ico sage"><DocIcon /></span>
                      <span className="row-text">
                        <b>{draft.title || '無題'}</b>
                        <small>{entry.company}・{characterCount(draft.text)} / {draft.limit}字</small>
                      </span>
                      <span className="chev"><ChevronIcon /></span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="notebook-empty">{limit}字の原稿はまだありません。</div>
            )}
            <section>
              <h3>{limit}字の原稿を新しく書く</h3>
              {entries.length === 0 ? (
                <button className="btn primary" type="button" onClick={() => setDialog({ type: 'form', id: null })}>企業を登録して始める</button>
              ) : (
                <>
                  {entries.length > 1 && (
                    <label className="fg">
                      どの企業の原稿ですか
                      <select className="field" value={newDraftEntry} onChange={(e) => setNewDraftEntry(e.target.value)}>
                        <option value="">企業を選ぶ</option>
                        {entries.map((e) => (
                          <option key={e.id} value={e.id}>{e.company}{e.kind ? `（${e.kind}）` : ''}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button className="btn primary" type="button" disabled={!target || target.esDrafts.length >= 50} onClick={() => target && createDraft(target, limit)}>
                    ＋ {limit}字の原稿を作る
                  </button>
                </>
              )}
            </section>
          </Modal>
        );
      })()}
      {dialog.type === 'gmail' && (
        <Modal title="Gmailで検索" onClose={close}>
          <p className="muted">企業名で検索したGmailを別のタブで開きます。Gmailへのログインが必要です。この検索操作ではメールを読み取りません。自動取り込みは「応募メールから締切を取り込む」で別途連携します。</p>
          <ul className="rows">
            {companies.map((name) => (
              <li key={name}>
                <a className="row-link" href={gmailUrl(name)} target="_blank" rel="noopener noreferrer">
                  <span className="ico sage"><BuildingIcon /></span>
                  <span className="row-text"><b>{name}</b><small>この企業のメールを探す ↗</small></span>
                  <span className="chev"><ChevronIcon /></span>
                </a>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {dialog.type === 'calendar-pick' && (
        <Modal title="Googleカレンダーに追加" onClose={close}>
          <p className="muted">カレンダーに入れる予定を選んでください。</p>
          <ul className="rows">
            {withDates.map((e) => (
              <li key={e.id}>
                <button className="row-link" type="button" onClick={() => setDialog({ type: 'calendar', id: e.id })}>
                  <span className="ico peach"><CalendarIcon /></span>
                  <span className="row-text">
                    <b>{e.company}</b>
                    <small>
                      {[e.dDate && `締切 ${fmtDate(e.dDate, now)} ${e.dTime}`, e.eDate && `開催 ${fmtDate(e.eDate, now)} ${e.eTime}`].filter(Boolean).join('　')}
                    </small>
                  </span>
                  <span className="chev"><ChevronIcon /></span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {dialog.type === 'library' && <Modal title="ES・面接ノート" onClose={close}>
        <p className="muted">企業ごとに原稿と面接の記録をまとめます。まず企業を選んでください。</p>
        {!entries.length && <button className="btn primary" onClick={() => setDialog({ type: 'form', id: null })}>企業を登録して始める</button>}
        <div className="stack">{entries.map(e => <div className="library-item" key={e.id}><h3>{e.company}</h3><p className="muted">{e.kind}{e.dDate && ` ・締切 ${e.dDate}`}</p><div className="row">
          <button className="btn" onClick={() => setDialog({ type: 'notebook', id: e.id, tab: 'es' })}>ESストック {e.esDrafts.length}</button>
          <button className="btn" onClick={() => setDialog({ type: 'notebook', id: e.id, tab: 'interview' })}>面接ノート {e.interviews.length}</button>
        </div></div>)}</div>
      </Modal>}
      {dialog.type === 'mail' && <MailDialog cloud={!!user} entries={entries} onSync={()=>store.sync()} onClose={close} />}
      {dialog.type === 'settings' && (
        <SettingsDialog
          store={store} snap={snap} user={user}
          onSaveFile={onSaveFile}
          onChangePassword={() => setDialog({ type: 'password' })}
          onClose={close}
        />
      )}
      {dialog.type === 'password' && <PasswordDialog onClose={close} />}
      {recovery && !recoveryDone && <PasswordDialog recovery onClose={() => setRecoveryDone(true)} />}

      {textFile && (
        <Modal title={textFile.name} onClose={() => setTextFile(null)}>
          <p className="muted">
            この画面ではファイルを直接保存できません。内容をコピーして、メモ帳などに「{textFile.name}」という名前で保存してください。
          </p>
          <textarea className="field mono" readOnly value={textFile.text} />
          <div className="row">
            <button
              className="btn primary" type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(textFile.text);
                  toast('コピーしました');
                } catch {
                  toast('コピーできませんでした。長押しや Ctrl+C でコピーしてください');
                }
              }}
            >
              コピーする
            </button>
          </div>
        </Modal>
      )}
      <DeleteUndoBar batches={undoBatches} onUndo={undoDelete} onExpire={expireUndo} />
    </>
  );
}

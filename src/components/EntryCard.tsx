import { useId, useState, type ReactNode } from 'react';
import { calEvent, googleUrl } from '../core/calendar';
import { gmailUrl } from '../core/companies';
import { DAY, countdownText, deadlineMs, fmtDate, shortLeft, urgency } from '../core/dates';
import { checkProgress } from '../core/entries';
import { STATUS_LABEL, STEPS, type Entry } from '../core/types';
import { BuildingIcon, ChevronIcon } from '../ui/icons';

interface Props {
  entry: Entry;
  now: number;
  onEdit: (id: string) => void;
  onCalendar: (id: string) => void;
  onStatus: (id: string, status: Entry['status']) => void;
  onNote: (id: string, tab: 'es' | 'interview') => void;
  onCheck: (id: string, checkId: string, done: boolean) => void;
}

/** メモの中のURLをリンクにする */
function linkify(text: string): ReactNode[] {
  return text.split(/(https?:\/\/[^\s<>"']+)/g).map((part, i) =>
    i % 2 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

/**
 * 企業一覧の1行。ふだんは企業名と締切だけの行で、押すと詳細（提出物・メモ・操作）が開く。
 * すぐ対応が必要なもの（未提出で、期限切れか締切が7日以内）は最初から開いておく。
 */
export function EntryCard({ entry: it, now, onEdit, onCalendar, onStatus, onCheck, onNote }: Props) {
  const ms = deadlineMs(it);
  const [open, setOpen] = useState(() => it.status === 'undecided' && ms !== null && ms - Date.now() <= 7 * DAY);
  const [checksOpen, setChecksOpen] = useState(it.status === 'undecided');
  const bodyId = useId();
  let u: string = urgency(it, now);
  if (it.status === 'submitted') u = 'calm';
  if (it.status === 'skipped') u = 'normal';
  const cp = checkProgress(it);
  const googleEvent = calEvent(it, it.dDate ? 'deadline' : 'event');
  const si = STEPS.indexOf(it.step);
  // 行の右端に出す短いひとこと（詳しい残り時間は、開いた中に出す）
  const left =
    it.status === 'submitted' ? '提出済み' : it.status === 'skipped' ? '見送り' : ms === null ? '締切未登録' : ms < now ? '期限切れ' : shortLeft(ms, now);

  return (
    <li className={`card u-${u} st-${it.status}${open ? ' open' : ''}`}>
      <button className="card-head" type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        <span className="ico sage"><BuildingIcon /></span>
        <span className="card-title">
          <span className="name">{it.company}</span>
          <span className="card-sub">
            {ms !== null && (
              <span className="when">
                <span className="d">{fmtDate(it.dDate, now)}</span> <span className="t">{it.dTime || '時刻未定'}</span>
              </span>
            )}
            <span className={'pill s-' + it.status}>{STATUS_LABEL[it.status]}</span>
            {cp.complete && <span className="pill done">チェック完了</span>}
            {it.sample && <span className="pill sample">サンプル</span>}
          </span>
        </span>
        <span className="left">{left}</span>
        <span className="chev"><ChevronIcon /></span>
      </button>

      {open && (
        <div className="card-body" id={bodyId}>
          {(it.kind || it.platform) && (
            <div className="chips">
              {it.kind && <span className="chip">{it.kind}</span>}
              {it.platform && <span className="chip plat">{it.platform}</span>}
            </div>
          )}
          {ms !== null && it.status === 'undecided' && (
            <p className="event">
              <b>{ms >= now ? '締切まで' : '締切'}</b>　{countdownText(ms, now)}
            </p>
          )}

          {si >= 0 && (
            <div className="steps">
              <span className="bar" aria-hidden="true">
                {STEPS.map((s, i) => (
                  <i key={s} className={i <= si ? 'on' : ''} />
                ))}
              </span>
              <span>
                選考ステップ：{it.step}（{si + 1}/{STEPS.length}）
              </span>
            </div>
          )}

          {it.eDate && (
            <p className="event">
              <b>開催</b>　{fmtDate(it.eDate, now)}
              {it.eTime ? ' ' + it.eTime : ''}
            </p>
          )}

          {cp.total > 0 && (
            <details className="checks" open={checksOpen} onToggle={(e) => setChecksOpen(e.currentTarget.open)}>
              <summary>
                提出物 {cp.done}/{cp.total}
                {cp.complete ? '　チェック完了' : ''}
              </summary>
              <ul>
                {it.checklist.map((c) => (
                  <li key={c.id}>
                    <label>
                      <input type="checkbox" checked={c.done} onChange={(e) => onCheck(it.id, c.id, e.target.checked)} />
                      {c.text}
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {it.memo && <p className="memo">{linkify(it.memo)}</p>}

          <div className="note-links">
            <button type="button" onClick={() => onNote(it.id, 'es')}>ESストック <b>{it.esDrafts.length}</b></button>
            <button type="button" onClick={() => onNote(it.id, 'interview')}>面接ノート <b>{it.interviews.length}</b></button>
          </div>
          <div className="actions">
            <a className="btn small" href={gmailUrl(it.company)} target="_blank" rel="noopener noreferrer">Gmailで検索 ↗</a>
            {googleEvent && <a className="btn small" href={googleUrl(googleEvent)} target="_blank" rel="noopener noreferrer">Googleカレンダー ↗</a>}
            {it.url && (
              <a className="btn small" href={it.url} target="_blank" rel="noopener noreferrer">
                マイページを開く ↗
              </a>
            )}
            {(it.dDate || it.eDate) && (
              <button className="btn small" type="button" onClick={() => onCalendar(it.id)}>
                カレンダーに追加
              </button>
            )}
            {it.status === 'undecided' ? (
              <button className="btn small primary" type="button" onClick={() => onStatus(it.id, 'submitted')}>
                提出済みにする
              </button>
            ) : (
              <button className="btn small" type="button" onClick={() => onStatus(it.id, 'undecided')}>
                未定に戻す
              </button>
            )}
            <button className="btn small" type="button" onClick={() => onEdit(it.id)}>
              編集
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

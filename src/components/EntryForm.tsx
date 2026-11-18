import { useState, type FormEvent } from 'react';
import { DAY, isDate, isTime, jstDateStr } from '../core/dates';
import { newId, safeUrl } from '../core/entries';
import { KINDS, PLATFORMS, QUICK_CHECKS, STEPS, type CheckItem, type Entry, type Status } from '../core/types';
import { CompanyInput } from './CompanyInput';
import { Modal } from '../ui/Modal';

interface Props {
  /** 編集するエントリー。新規追加のときは null */
  entry: Entry | null;
  companies: string[];
  onSave: (entry: Entry) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const CUSTOM = '__custom';

/** 「一覧から選ぶ／自由入力」の選択肢の状態 */
function choiceState(list: string[], value: string, fallback: string) {
  if (!value) return { sel: fallback, custom: '' };
  return list.includes(value) ? { sel: value, custom: '' } : { sel: CUSTOM, custom: value };
}

export function EntryForm({ entry, companies, onSave, onDelete, onClose }: Props) {
  const [company, setCompany] = useState(entry?.company ?? '');
  const [kind, setKind] = useState(() => choiceState(KINDS, entry ? entry.kind : KINDS[0], KINDS[0]));
  const [platform, setPlatform] = useState(() => choiceState(PLATFORMS, entry?.platform ?? '', ''));
  const [dDate, setDDate] = useState(entry?.dDate ?? '');
  const [dTime, setDTime] = useState(entry?.dTime ?? '');
  const [eDate, setEDate] = useState(entry?.eDate ?? '');
  const [eTime, setETime] = useState(entry?.eTime ?? '');
  const [status, setStatus] = useState<Status>(entry?.status ?? 'undecided');
  const [step, setStep] = useState(entry?.step ?? '');
  const [checks, setChecks] = useState<CheckItem[]>(() => (entry ? entry.checklist.map((c) => ({ ...c })) : []));
  const [newCheck, setNewCheck] = useState('');
  const [url, setUrl] = useState(entry?.url ?? '');
  const [memo, setMemo] = useState(entry?.memo ?? '');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const addCheck = (text: string) => {
    const t = text.trim().slice(0, 60);
    if (t) setChecks((cs) => [...cs, { id: newId(), text: t, done: false }]);
  };
  const have = new Set(checks.map((c) => c.text));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = company.trim();
    if (!name) return setError('企業名を入力してください。');
    if ((dDate && !isDate(dDate)) || (eDate && !isDate(eDate))) return setError('実在する日付を入力してください。');
    if ((dTime && !isTime(dTime)) || (eTime && !isTime(eTime))) return setError('時刻は00:00〜23:59で入力してください。');
    if (dTime && !dDate) return setError('締切の時刻を入れるときは、日付も入れてください。');
    if (eTime && !eDate) return setError('開催時刻を入れるときは、開催日も入れてください。');
    const rawUrl = url.trim();
    if (rawUrl && !safeUrl(rawUrl)) return setError('マイページURLは https:// から始まるアドレスを入れてください。');
    // 入力欄に残っている項目も追加する
    const pending = newCheck.trim().slice(0, 60);
    const checklist = pending ? [...checks, { id: newId(), text: pending, done: false }] : checks;
    onSave({
      id: entry?.id ?? newId(),
      company: name,
      kind: kind.sel === CUSTOM ? kind.custom.trim() : kind.sel,
      platform: platform.sel === CUSTOM ? platform.custom.trim() : platform.sel,
      dDate,
      dTime: dDate ? dTime : '',
      eDate,
      eTime: eDate ? eTime : '',
      status,
      step,
      checklist,
      url: safeUrl(rawUrl),
      memo,
      esDrafts: entry?.esDrafts ?? [],
      interviews: entry?.interviews ?? [],
      sample: entry?.sample ?? false,
      editedAt: Date.now(),
      deletedAt: null,
    });
  };

  return (
    <Modal title={entry ? 'エントリーを編集' : 'エントリーを追加'} onClose={onClose} keepOnBackdrop>
      <form className="form" onSubmit={submit} noValidate>
        <div className="fg">
          <label htmlFor="f-company">企業名（必須）</label>
          <CompanyInput value={company} onChange={setCompany} registered={companies} autoFocus={!entry} />
        </div>

        <div className="two">
          <div className="fg">
            <label htmlFor="f-kind">内容</label>
            <select className="field" id="f-kind" value={kind.sel} onChange={(e) => setKind({ ...kind, sel: e.target.value })}>
              {KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
              <option value={CUSTOM}>自由入力…</option>
            </select>
            {kind.sel === CUSTOM && (
              <input
                className="field" type="text" maxLength={40} placeholder="内容を入力" aria-label="内容（自由入力）"
                value={kind.custom} onChange={(e) => setKind({ ...kind, custom: e.target.value })} autoFocus
              />
            )}
          </div>
          <div className="fg">
            <label htmlFor="f-platform">応募プラットフォーム</label>
            <select
              className="field" id="f-platform" value={platform.sel}
              onChange={(e) => setPlatform({ ...platform, sel: e.target.value })}
            >
              <option value="">選択してください</option>
              {PLATFORMS.map((p) => (
                <option key={p}>{p}</option>
              ))}
              <option value={CUSTOM}>自由入力…</option>
            </select>
            {platform.sel === CUSTOM && (
              <input
                className="field" type="text" maxLength={40} placeholder="サイト名を入力"
                aria-label="応募プラットフォーム（自由入力）"
                value={platform.custom} onChange={(e) => setPlatform({ ...platform, custom: e.target.value })} autoFocus
              />
            )}
          </div>
        </div>

        <div className="fg">
          <span className="lbl">申込締切（日本時間）</span>
          <div className="two">
            <input className="field" id="f-ddate" type="date" aria-label="申込締切の日付" value={dDate} onChange={(e) => setDDate(e.target.value)} />
            <input className="field" id="f-dtime" type="time" aria-label="申込締切の時刻" value={dTime} onChange={(e) => setDTime(e.target.value)} />
          </div>
          <div className="quick date-shortcuts" aria-label="締切の日付を簡単入力">
            {([[0, '今日'], [1, '明日'], [7, '1週間後']] as const).map(([days, label]) => (
              <button key={days} type="button" onClick={() => setDDate(jstDateStr(Date.now() + days * DAY))}>{label}</button>
            ))}
            <button type="button" onClick={() => setDTime('23:59')}>23:59</button>
          </div>
          <span className="hint">時刻が分からなければ日付だけでOK（その日の終わりを締切として扱います）</span>
        </div>

        <div className="fg">
          <span className="lbl">開催日時（説明会・面接など。任意）</span>
          <div className="two">
            <input className="field" id="f-edate" type="date" aria-label="開催日" value={eDate} onChange={(e) => setEDate(e.target.value)} />
            <input className="field" id="f-etime" type="time" aria-label="開催時刻" value={eTime} onChange={(e) => setETime(e.target.value)} />
          </div>
        </div>

        <div className="two">
          <div className="fg">
            <label htmlFor="f-status">状態</label>
            <select className="field" id="f-status" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              <option value="undecided">未定</option>
              <option value="submitted">提出済み・申込済み</option>
              <option value="skipped">見送り</option>
            </select>
          </div>
          <div className="fg">
            <label htmlFor="f-step">選考ステップ</label>
            <select className="field" id="f-step" value={step} onChange={(e) => setStep(e.target.value)}>
              <option value="">未設定</option>
              {STEPS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="fg">
          <span className="lbl">提出物チェックリスト</span>
          <ul className="chk-edit">
            {checks.map((c, i) => (
              <li key={c.id}>
                <input
                  type="checkbox" checked={c.done} aria-label={c.text + ' を提出済みにする'}
                  onChange={(e) => setChecks((cs) => cs.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))}
                />
                <span>{c.text}</span>
                <button type="button" aria-label={c.text + 'を削除'} onClick={() => setChecks((cs) => cs.filter((_, j) => j !== i))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="row">
            <input
              className="field grow" type="text" maxLength={60} placeholder="項目を追加（例：ES）" aria-label="提出物の項目名"
              value={newCheck} onChange={(e) => setNewCheck(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  addCheck(newCheck);
                  setNewCheck('');
                }
              }}
            />
            <button
              className="btn small" type="button"
              onClick={() => {
                addCheck(newCheck);
                setNewCheck('');
              }}
            >
              追加
            </button>
          </div>
          <div className="quick">
            {QUICK_CHECKS.filter((t) => !have.has(t)).map((t) => (
              <button key={t} type="button" onClick={() => addCheck(t)}>
                ＋ {t}
              </button>
            ))}
          </div>
        </div>

        <div className="fg">
          <label htmlFor="f-url">マイページURL</label>
          <input
            className="field" id="f-url" type="url" inputMode="url" placeholder="https://" autoComplete="off"
            value={url} onChange={(e) => setUrl(e.target.value)}
          />
          <span className="hint">IDやパスワードは保存しません。URLだけ入れてください</span>
        </div>

        <div className="fg">
          <label htmlFor="f-memo">メモ（出典・URLなど）</label>
          <textarea className="field" id="f-memo" maxLength={2000} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>

        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}

        <div className="form-footer">
        {confirmDelete && entry ? (
          <div className="row">
            <span className="err grow">この項目を削除します。元に戻せません。</span>
            <button className="btn danger" type="button" onClick={() => onDelete(entry.id)}>
              削除する
            </button>
            <button className="btn" type="button" onClick={() => setConfirmDelete(false)}>
              やめる
            </button>
          </div>
        ) : (
          <div className="row">
            <button className="btn primary grow" type="submit">
              保存する
            </button>
            {entry && (
              <button className="btn danger" type="button" onClick={() => setConfirmDelete(true)}>
                削除
              </button>
            )}
          </div>
        )}
        </div>
      </form>
    </Modal>
  );
}

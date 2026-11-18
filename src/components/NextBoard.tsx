import { countdownParts, deadlineMs, fmtDate, urgency } from '../core/dates';
import type { Entry } from '../core/types';
import { CalendarIcon } from '../ui/icons';

interface Props {
  entry: Entry | undefined;
  now: number;
  unresolved: number;
  onSubmit: (id: string) => void;
  onEdit: (id: string) => void;
  onCalendar: (id: string) => void;
  /** まだ1件も登録がないときだけ渡す。サンプルを入れて試せるようにする */
  onSample?: () => void;
  onAdd?: () => void;
}

/** いちばん近い締切。企業名と「あと◯日」をひと目で読めるカードにする */
export function NextBoard({ entry: it, now, unresolved, onSubmit, onEdit, onCalendar, onSample, onAdd }: Props) {
  if (!it) {
    return (
      <section className="board empty" aria-live="polite">
        <div className="board-main">
          <span className="ico peach"><CalendarIcon /></span>
          <div className="board-text">
            <div className="count">{unresolved ? 'これからの締切はありません' : '未提出の締切はありません'}</div>
            <p className="meta">
              {unresolved
                ? `期限切れ・締切未登録の未提出が ${unresolved} 件あります。一覧で確認してください。`
                : onSample
                  ? 'まず企業を追加しましょう。サンプルで使い方を試すこともできます。'
                  : '右下の「＋ 追加」からエントリーを登録できます。'}
            </p>
          </div>
        </div>
        {onSample && (
          <div className="row">
            {onAdd && (
              <button className="btn small primary" type="button" onClick={onAdd}>
                ＋ 企業を追加する
              </button>
            )}
            <button className="btn small" type="button" onClick={onSample}>
              サンプルを入れて試してみる
            </button>
          </div>
        )}
      </section>
    );
  }
  const ms = deadlineMs(it)!;
  const p = countdownParts(ms, now);
  // 大きく出す単位と、その下に小さく添える端数
  const [big, unit, rest] =
    p.d > 0 ? [p.d, '日', p.h ? `${p.h}時間` : ''] : p.h > 0 ? [p.h, '時間', p.m ? `${p.m}分` : ''] : [p.m, '分', ''];

  return (
    <section className={'board u-' + urgency(it, now)} aria-live="polite">
      <div className="board-main">
        <span className="ico peach"><CalendarIcon /></span>
        <div className="board-text">
          <div className="who">
            {it.company}
            {it.sample && <> <span className="pill sample">サンプル</span></>}
          </div>
          <p className="meta">
            {it.kind && <span className="chip-outline">{it.kind}</span>}
            <span>
              締切 {fmtDate(it.dDate, now)} {it.dTime || '時刻未定'}
              {it.platform ? `・${it.platform}` : ''}
            </span>
          </p>
        </div>
        <div className="count">
          <span>あと</span>
          <b>
            {big}
            <span>{unit}</span>
          </b>
          {rest && <span>{rest}</span>}
        </div>
      </div>
      <div className="row">
        <button className="btn small" type="button" onClick={() => onSubmit(it.id)}>提出済みにする</button>
        {it.url && (
          <a className="btn small" href={it.url} target="_blank" rel="noopener noreferrer">
            マイページを開く ↗
          </a>
        )}
        <button className="btn small" type="button" onClick={() => onCalendar(it.id)}>
          カレンダーに追加
        </button>
        <button className="btn small" type="button" onClick={() => onEdit(it.id)}>
          編集
        </button>
      </div>
    </section>
  );
}

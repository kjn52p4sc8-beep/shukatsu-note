import { useEffect, useRef, useState } from 'react';
import { isDate, isTime } from '../core/dates';
import { formatDateInput, parseDateInput, parseTimeInput } from '../core/parse';
import { CalendarIcon, ClockIcon } from '../ui/icons';

interface Props {
  kind: 'date' | 'time';
  id: string;
  /** 読み上げ用の名前（例：申込締切の日付） */
  label: string;
  /** 'YYYY-MM-DD' / 'HH:MM'。直せない文字が打たれている間は、その文字のまま渡す（保存時にエラーにする） */
  value: string;
  onChange: (value: string) => void;
}

/**
 * 日付・時刻の入力欄。キーボードで「2026/11/20」「1120」「18:00」などと直接打てて、貼り付けもできる。
 * 右のボタンからは、端末のカレンダー・時計で選べる。
 */
export function DateTimeField({ kind, id, label, value, onChange }: Props) {
  const parse = kind === 'date' ? parseDateInput : parseTimeInput;
  const valid = kind === 'date' ? isDate(value) : isTime(value);
  const show = (v: string) => (kind === 'date' ? formatDateInput(v) : v);
  const [text, setText] = useState(() => show(value));
  const pickerRef = useRef<HTMLInputElement>(null);

  // 「明日」「23:59」などのボタンで外から値が変わったら、表示も合わせる
  useEffect(() => {
    setText((cur) => (parse(cur) === value || cur === value ? cur : show(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const openPicker = () => {
    const el = pickerRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };

  return (
    <div className="dt-field">
      <input
        className="field" id={id} type="text" inputMode="numeric" autoComplete="off" aria-label={label}
        placeholder={kind === 'date' ? '2026/11/20' : '18:00'}
        aria-invalid={text.trim() !== '' && parse(text) === null}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parse(e.target.value);
          onChange(e.target.value.trim() === '' ? '' : parsed ?? e.target.value.trim());
        }}
        onBlur={() => {
          const parsed = parse(text);
          if (parsed) setText(show(parsed));
        }}
      />
      <span className="dt-picker">
        <button type="button" tabIndex={-1} aria-hidden="true" onClick={openPicker}>
          {kind === 'date' ? <CalendarIcon /> : <ClockIcon />}
        </button>
        {/* 端末の日付・時刻の選択画面。iPhone ではこの透明な欄を直接タップして開く */}
        <input
          ref={pickerRef} type={kind} aria-label={label + 'を' + (kind === 'date' ? 'カレンダー' : '時計') + 'から選ぶ'}
          value={valid ? value : ''}
          onChange={(e) => {
            onChange(e.target.value);
            setText(show(e.target.value));
          }}
        />
      </span>
    </div>
  );
}

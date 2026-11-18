import { REMINDERS } from '../core/types';

interface Props {
  value: number[];
  onChange: (next: number[]) => void;
  label: string;
}

/** 「前日 / 3時間前 / 1時間前」のチェックボックス */
export function ReminderChecks({ value, onChange, label }: Props) {
  return (
    <div className="rems" role="group" aria-label={label}>
      {REMINDERS.map(([min, text]) => (
        <label key={min}>
          <input
            type="checkbox"
            checked={value.includes(min)}
            onChange={(e) => onChange(e.target.checked ? [...value, min] : value.filter((v) => v !== min))}
          />
          {text}
        </label>
      ))}
    </div>
  );
}

import { useState } from 'react';
import { companySuggestions } from '../core/companies';

export function CompanyInput({ value, onChange, registered, autoFocus }: { value: string; onChange: (v: string) => void; registered: string[]; autoFocus: boolean }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const suggestions = companySuggestions(value, registered);
  const visible = open && suggestions.length > 0;
  const choose = (name: string) => { onChange(name); setOpen(false); setActive(-1); };
  return <div className="company-picker">
    <input id="f-company" className="field" role="combobox" aria-autocomplete="list" aria-expanded={visible} aria-controls="company-options"
      aria-activedescendant={visible && active >= 0 ? `company-option-${active}` : undefined}
      value={value} onChange={e => { onChange(e.target.value); setOpen(true); setActive(-1); }}
      onFocus={() => setOpen(true)} onBlur={() => { setOpen(false); setActive(-1); }} autoFocus={autoFocus}
      autoComplete="off" maxLength={100} placeholder="1文字から候補を表示（例：と）"
      onKeyDown={e => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Escape' && visible) { e.stopPropagation(); setOpen(false); }
        if (e.key === 'ArrowDown' && suggestions.length) { e.preventDefault(); setOpen(true); setActive(i => (i + 1) % suggestions.length); }
        if (e.key === 'ArrowUp' && suggestions.length) { e.preventDefault(); setOpen(true); setActive(i => (i - 1 + suggestions.length) % suggestions.length); }
        if (e.key === 'Enter' && visible && active >= 0) { e.preventDefault(); choose(suggestions[active]); }
      }} />
    {visible && <ul id="company-options" role="listbox" aria-label="企業名の候補" className="company-options">
      {suggestions.map((name, i) => <li role="option" aria-selected={active === i} id={`company-option-${i}`} key={name}
        onMouseDown={e => e.preventDefault()} onClick={() => choose(name)}>{name}<span>選択</span></li>)}
    </ul>}
    <span className="hint">登録済みの企業・主要企業の候補です。候補にない企業も自由に入力できます。</span>
  </div>;
}

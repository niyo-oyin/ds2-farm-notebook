import { useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react';
import { useApp, type HorseOption } from './app-context';
import { store } from '../store/userdata';
import { nameSearch } from './name-search';

export interface HorseSelectHandle { focus: () => void }

/** 検索で上位に来た区分からまとめ、区分内の一致順を保つ。表示とキー操作に同じ順序を使う。 */
export function horseSelectOptions(options: HorseOption[], query: string): HorseOption[] {
  const groups = new Map<string, HorseOption[]>();
  for (const option of nameSearch(query).filter(options, (o) => [o.name]).slice(0, 80)) {
    const group = groups.get(option.group);
    if (group) group.push(option);
    else groups.set(option.group, [option]);
  }
  return [...groups.values()].flat();
}

export const HorseSelect = forwardRef<HorseSelectHandle, {
  onCreate?: (name: string) => void; disabled?: boolean; value: string; onChange: (key: string) => void; options: HorseOption[]; placeholder?: string; 'aria-label'?: string; clearAfterSelect?: boolean;
  /** 一覧の末尾に、計画馬を候補に出すかの切り替えを置く（設定 hidePlanned。父母を選ぶ場面で使う） */
  plannedToggle?: boolean;
}>(function HorseSelect({ onCreate, disabled = false, value, onChange, options, placeholder, 'aria-label': ariaLabel, clearAfterSelect = false, plannedToggle = false }, ref) {
  const app = useApp();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => { input.current?.focus(); input.current?.select(); } }));
  const selected = options.find((o) => o.key === value);
  useEffect(() => { if (!open) setText(selected?.name ?? ''); }, [selected, open]);
  useEffect(() => {
    const f = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('mousedown', f);
    return () => removeEventListener('mousedown', f);
  }, []);
  const filtered = useMemo(() => horseSelectOptions(options, text !== selected?.name ? text : ''), [text, options, selected]);
  const choose = (o: HorseOption) => { onChange(o.key); setOpen(false); setText(clearAfterSelect ? '' : o.name); };
  const clear = () => { onChange(''); setText(''); setOpen(false); input.current?.focus(); };
  return (
    <div className="combo" ref={wrap}>
      <input disabled={disabled} ref={input} value={text} placeholder={placeholder ?? '馬名で検索'} aria-label={ariaLabel}
        onFocus={(e) => { setOpen(true); setActive(0); e.target.select(); }}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'ArrowDown') { setActive((a) => Math.min(a + 1, filtered.length - 1)); e.preventDefault(); }
          else if (e.key === 'ArrowUp') { setActive((a) => Math.max(a - 1, 0)); e.preventDefault(); }
          else if (e.key === 'Enter' && open && filtered[active]) { choose(filtered[active]); e.preventDefault(); }
          else if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
        }} />
      {!disabled && (text || value) && <button type="button" className="combo-clear" title="クリア" aria-label="クリア" onMouseDown={(e) => e.preventDefault()} onClick={clear}>×</button>}
      {!disabled && open && (
        <div className="list">
          {filtered.map((o, i) => (
            <div key={o.key}>
              {(i === 0 || filtered[i - 1].group !== o.group) && <div className="group">{o.group}</div>}
              <div className={'item' + (i === active ? ' active' : '')} onMouseEnter={() => setActive(i)} onClick={() => choose(o)}>
                <span>{o.name}</span><span className="muted small">{o.sub}</span>
              </div>
            </div>
          ))}
          {!filtered.length && <div className="item muted">該当なし</div>}
          {onCreate && text.trim() && <button type="button" className="item" onClick={() => { onCreate(text.trim()); setOpen(false); }}>「{text.trim()}」を別の馬として追加</button>}
          {plannedToggle && <label className="combo-toggle" onMouseDown={(e) => e.preventDefault()}><input type="checkbox" checked={!!app.data.settings.hidePlanned} onChange={(e) => store.setSettings({ hidePlanned: e.target.checked })} />計画馬を非表示</label>}
        </div>
      )}
    </div>
  );
});

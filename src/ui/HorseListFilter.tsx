import { useId, useRef } from 'react';

export interface HorseListFilterOption { value: string; label: string }

/** 選択肢はポップオーバー内に置き、一覧には現在の条件だけを表示する。 */
export function HorseListFilter({ label, options, excluded, onChange, preset }: {
  label: string; options: HorseListFilterOption[]; excluded: string[]; onChange: (excluded: string[]) => void;
  preset?: { label: string; excluded: string[] };
}) {
  const id = useId();
  const popup = useRef<HTMLDivElement>(null);
  const selected = options.filter(o => !excluded.includes(o.value));
  const omitted = options.filter(o => excluded.includes(o.value));
  const all = selected.length === options.length;
  const summary = all ? 'すべて' : !selected.length ? '選択なし' : omitted.length === 1 && selected.length > 2 ? `${omitted[0].label}以外` : selected.map(o => o.label).join('・');
  return <div className="horse-basic-filter">
    <span id={`${id}-label`}>{label}</span>
    <button type="button" popoverTarget={id} aria-label={`${label}：${summary}`} title={summary} className={!all ? 'active' : ''} onClick={e => {
      const rect = e.currentTarget.getBoundingClientRect();
      const panel = popup.current!;
      panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 268))}px`;
      panel.style.top = `${Math.min(rect.bottom + 4, Math.max(8, window.innerHeight - 300))}px`;
    }}><span>{summary}</span><span aria-hidden="true">▾</span></button>
    <div ref={popup} id={id} popover="auto" className="horse-filter-popover" role="group" aria-labelledby={`${id}-label`}>
      <div className="horse-filter-popover-actions"><label><input type="checkbox" checked={all} ref={el => { if (el) el.indeterminate = !all && selected.length > 0; }} onChange={e => onChange(e.target.checked ? [] : options.map(o => o.value))} />すべて</label>{preset && <button type="button" onClick={() => onChange(preset.excluded)}>{preset.label}</button>}</div>
      <div className="horse-filter-options">{options.map(o => <label key={o.value}><input type="checkbox" checked={!excluded.includes(o.value)} onChange={e => onChange(e.target.checked ? excluded.filter(x => x !== o.value) : [...excluded, o.value])} />{o.label}</label>)}</div>
      <button type="button" className="horse-filter-done" popoverTarget={id} popoverTargetAction="hide">完了</button>
    </div>
  </div>;
}

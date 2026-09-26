import type { HorseOption } from './app-context';
import { HorseSelect } from './HorseSelect';

export interface ResultFilter {
  label: string;
  value: string;
  options: HorseOption[];
  onChange: (key: string) => void;
}

/** 探索結果を馬で絞り込む。選択肢が1頭しかない欄は出さない */
export function SearchResultFilters({ filters, count, total }: { filters: ResultFilter[]; count: number; total: number }) {
  const active = filters.some((f) => f.value);
  return <div className="toolbar result-filters" role="group" aria-label="探索結果の絞り込み">
    {filters.filter((f) => f.value || f.options.length > 1).map((f) => <div className="field" key={f.label}><span>{f.label}</span><HorseSelect value={f.value} onChange={f.onChange} options={f.options} aria-label={f.label} placeholder="馬名で絞り込み" /></div>)}
    {active && <><button type="button" onClick={() => filters.forEach((f) => f.onChange(''))}>絞り込みを解除</button><span className="small muted" role="status">{count.toLocaleString()} / {total.toLocaleString()}件</span></>}
  </div>;
}

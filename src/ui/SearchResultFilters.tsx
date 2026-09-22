import { useMemo } from 'react';
import type { HorseOption } from './app-context';
import { HorseSelect } from './HorseSelect';

export function SearchResultFilters({ results, horse, final, onHorseChange, onFinalChange, count }: {
  results: { steps: { sire: string; sireName: string }[] }[];
  horse: string;
  final?: string;
  onHorseChange: (key: string) => void;
  onFinalChange?: (key: string) => void;
  count: number;
}) {
  const options = useMemo(() => {
    const all = new Map<string, HorseOption>(), last = new Map<string, HorseOption>();
    for (const result of results) result.steps.forEach((step, i) => {
      const option = { key: step.sire, name: step.sireName, group: '探索結果の種牡馬' };
      all.set(step.sire, option);
      if (i === result.steps.length - 1) last.set(step.sire, option);
    });
    const sorted = (map: Map<string, HorseOption>) => [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    return { all: sorted(all), last: sorted(last) };
  }, [results]);
  return <div className="toolbar result-filters" role="group" aria-label="探索結果の絞り込み">
    <div className="field"><span>経路に含む種牡馬</span><HorseSelect value={horse} onChange={onHorseChange} options={options.all} aria-label="経路に含む種牡馬" placeholder="馬名で絞り込み" /></div>
    {onFinalChange && <div className="field"><span>最後の種牡馬</span><HorseSelect value={final ?? ''} onChange={onFinalChange} options={options.last} aria-label="最後の種牡馬" placeholder="馬名で絞り込み" /></div>}
    {(horse || final) && <><button type="button" onClick={() => { onHorseChange(''); onFinalChange?.(''); }}>絞り込みを解除</button><span className="small muted" role="status">{count.toLocaleString()} / {results.length.toLocaleString()}件</span></>}
  </div>;
}

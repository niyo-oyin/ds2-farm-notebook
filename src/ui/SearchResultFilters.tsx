import { useMemo } from 'react';
import type { HorseOption } from './app-context';
import { HorseSelect } from './HorseSelect';

export function SearchResultFilters({ results, horse, final, origin, onHorseChange, onFinalChange, onOriginChange, count }: {
  results: { steps: { sire: string; sireName: string; dam?: string; damName?: string }[] }[];
  horse: string;
  final?: string;
  /** 起点の繁殖牝馬。起点が複数の探索でだけ使う */
  origin?: string;
  onHorseChange: (key: string) => void;
  onFinalChange?: (key: string) => void;
  onOriginChange?: (key: string) => void;
  count: number;
}) {
  const options = useMemo(() => {
    const all = new Map<string, HorseOption>(), last = new Map<string, HorseOption>(), origins = new Map<string, HorseOption>();
    for (const result of results) result.steps.forEach((step, i) => {
      if (i === 0 && step.dam) origins.set(step.dam, { key: step.dam, name: step.damName ?? step.dam, group: '起点の繁殖牝馬' });
      const option = { key: step.sire, name: step.sireName, group: '探索結果の種牡馬' };
      all.set(step.sire, option);
      if (i === result.steps.length - 1) last.set(step.sire, option);
    });
    const sorted = (map: Map<string, HorseOption>) => [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    return { all: sorted(all), last: sorted(last), origins: sorted(origins) };
  }, [results]);
  return <div className="toolbar result-filters" role="group" aria-label="探索結果の絞り込み">
    {onOriginChange && options.origins.length > 1 && <div className="field"><span>起点の繁殖牝馬</span><HorseSelect value={origin ?? ''} onChange={onOriginChange} options={options.origins} aria-label="起点の繁殖牝馬で絞り込み" placeholder="馬名で絞り込み" /></div>}
    <div className="field"><span>経路に含む種牡馬</span><HorseSelect value={horse} onChange={onHorseChange} options={options.all} aria-label="経路に含む種牡馬" placeholder="馬名で絞り込み" /></div>
    {onFinalChange && <div className="field"><span>最後の種牡馬</span><HorseSelect value={final ?? ''} onChange={onFinalChange} options={options.last} aria-label="最後の種牡馬" placeholder="馬名で絞り込み" /></div>}
    {(horse || final || origin) && <><button type="button" onClick={() => { onHorseChange(''); onFinalChange?.(''); onOriginChange?.(''); }}>絞り込みを解除</button><span className="small muted" role="status">{count.toLocaleString()} / {results.length.toLocaleString()}件</span></>}
  </div>;
}

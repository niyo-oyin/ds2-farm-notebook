import { useMemo, useState } from 'react';
import { nodePath } from '../core/pedigree';
import { useApp } from './app-context';
import { HorseDialog } from './HorseDialog';
import { nameSearch } from './name-search';
import './AncestorPedigreeReferences.css';

export function AncestorPedigreeReferences({ ancestorId }: { ancestorId: string }) {
  const { master } = useApp();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const groups = useMemo(() => [
    { label: '種牡馬', horses: master.stallions },
    { label: '繁殖牝馬', horses: master.broodmares },
  ].map(({ label, horses }) => ({
    label,
    entries: horses.flatMap(horse => {
      const positions = horse.ancestors.flatMap((id, index) => id === ancestorId ? [nodePath(index + 2)] : []);
      return positions.length ? [{ horse, positions }] : [];
    }).sort((a, b) => a.horse.name.localeCompare(b.horse.name, 'ja')),
  })), [master, ancestorId]);
  const total = groups.reduce((sum, group) => sum + group.entries.length, 0);
  return <>
    <section className="sheet-section ancestor-references">
      <div className="sheet-section-heading"><h3>血統に登場する馬<span>{total}頭</span></h3><span className="small muted">4代血統内</span></div>
      {total ? <>
        <input className="ancestor-references-search" aria-label="血統に登場する馬を検索" placeholder="馬名で絞り込み" value={query} onChange={e => setQuery(e.target.value)} />
        <div className="ancestor-reference-groups">{groups.map(group => {
          const entries = nameSearch(query).filter(group.entries, entry => [entry.horse.name]);
          return <div key={group.label}>
            <h4>{group.label}<span className="small muted">{query ? `${entries.length} / ${group.entries.length}` : group.entries.length}頭</span></h4>
            {entries.length ? <ul className="ancestor-reference-list" aria-label={`${group.label}の参照先`}>{entries.map(({ horse, positions }) => <li key={horse.id}>
              <button type="button" onClick={() => setSelected(horse.id)}>
                <span className="ancestor-reference-name">{horse.name}</span>
                <span className="ancestor-reference-position">{positions.join('・')}</span>
                <span aria-hidden="true">›</span>
              </button>
            </li>)}</ul> : <p className="small muted">{query ? '該当する馬はいません' : '該当なし'}</p>}
          </div>;
        })}</div>
      </> : <p className="small muted">種牡馬・繁殖牝馬の4代血統内には登場しません。</p>}
    </section>
    {selected && <HorseDialog horseKey={selected} onClose={() => setSelected(null)} />}
  </>;
}

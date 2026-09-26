import type { OwnedHorse } from '../core/types';

export function PlanHorseName({ name, candidates, selected, onChange, label }: {
  name: string; candidates: OwnedHorse[]; selected?: OwnedHorse; onChange: (id: string) => void; label: string;
}) {
  if (candidates.length > 1) return <select className="plan-horse-choice" aria-label={label} value={selected?.id ?? ''} onChange={(e) => onChange(e.target.value)}>
    <option value="">所有馬を選択（{candidates.length}頭）</option>
    {candidates.map((h) => <option key={h.id} value={h.id}>{h.name}（{h.category}）</option>)}
  </select>;
  return <b>{selected ? <a href={`#/horses?id=${encodeURIComponent(selected.id)}`}>{selected.name}</a> : name}</b>;
}

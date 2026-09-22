import { useMemo } from 'react';
import type { MasterHorse } from '../core/types';
import { useApp } from './app-context';

export interface StallionFilterState {
  includeOverseas: boolean;
  distance: string;        // 走らせたい距離（m）。空なら不問
  dirt: '' | '○' | '◎';    // ダート適性の下限
  grown: string[];         // 許容する成長型
  ranks: { key: 'jisseki' | 'antei' | 'konjo' | 'kenko' | 'kisyo'; min: '' | 'A' | 'B' | 'C' }[];
  applyToIntermediate: boolean;
}
export const EMPTY_FILTER: StallionFilterState = { includeOverseas: true, distance: '', dirt: '', grown: [], ranks: [
  { key: 'jisseki', min: '' }, { key: 'antei', min: '' }, { key: 'konjo', min: '' }, { key: 'kenko', min: '' }, { key: 'kisyo', min: '' },
], applyToIntermediate: false };
const RANK_LABEL = { jisseki: '実績', antei: '安定', konjo: '底力', kenko: '健康', kisyo: '気性' } as const;
const RANK_ORDER: Record<string, number> = { A: 3, B: 2, C: 1 };
const DIRT_ORDER: Record<string, number> = { '◎': 3, '○': 2, '◯': 2, '△': 1 };

export function isFilterActive(f: StallionFilterState): boolean {
  return !!f.distance || !!f.dirt || f.grown.length > 0 || f.ranks.some((r) => r.min);
}

/** 種牡馬が絞り込み条件を満たすか。属性が不明（'-' や null）の馬は条件を付けた項目では外す */
export function matchesStallion(s: MasterHorse, f: StallionFilterState): boolean {
  const a = s.attrs as { dist?: [number, number]; grown?: string | null; dirt?: string | null; jisseki?: string | null; antei?: string | null; konjo?: string | null; kenko?: string | null; kisyo?: string | null };
  if (f.distance) { const d = Number(f.distance); if (!a.dist || !(a.dist[0] <= d && d <= a.dist[1])) return false; }
  if (f.dirt) { if (!a.dirt || (DIRT_ORDER[a.dirt] ?? 0) < DIRT_ORDER[f.dirt]) return false; }
  if (f.grown.length) { if (!a.grown || !f.grown.includes(a.grown)) return false; }
  for (const r of f.ranks) if (r.min) { const v = a[r.key]; if (!v || (RANK_ORDER[v] ?? 0) < RANK_ORDER[r.min]) return false; }
  return true;
}

export function StallionFilter({ value, onChange, showIntermediate }: { value: StallionFilterState; onChange: (v: StallionFilterState) => void; showIntermediate?: boolean }) {
  const app = useApp();
  const growns = useMemo(() => [...new Set(app.master.stallions.map((s) => (s.attrs as { grown?: string | null }).grown).filter((g): g is string => !!g && g !== '-'))], [app]);
  return (
    <div className="stallion-filter">
      <div className="stallion-filter-fields">
        <label className="field">距離（m）<input type="number" step={100} min={1000} max={3600} value={value.distance} onChange={(e) => onChange({ ...value, distance: e.target.value })} placeholder="不問" /></label>
        <label className="field">ダート適性<select value={value.dirt} onChange={(e) => onChange({ ...value, dirt: e.target.value as StallionFilterState['dirt'] })}><option value="">不問</option><option value="○">○以上</option><option value="◎">◎のみ</option></select></label>
        {value.ranks.map((r, i) => (
          <label key={r.key} className="field">{RANK_LABEL[r.key]}
            <select value={r.min} onChange={(e) => onChange({ ...value, ranks: value.ranks.map((x, k) => (k === i ? { ...x, min: e.target.value as typeof r.min } : x)) })}>
              <option value="">不問</option><option value="A">A</option><option value="B">B以上</option><option value="C">C以上</option>
            </select>
          </label>
        ))}
      </div>
      <div className="checks stallion-growth">
        <span>成長型</span>
        {growns.map((g) => <label key={g}><input type="checkbox" checked={value.grown.includes(g)} onChange={(e) => onChange({ ...value, grown: e.target.checked ? [...value.grown, g] : value.grown.filter((x) => x !== g) })} />{g}</label>)}
        <div className="checks stallion-options">
          <label><input type="checkbox" checked={!value.includeOverseas} onChange={(e) => onChange({ ...value, includeOverseas: !e.target.checked })} />海外種牡馬を除外</label>
          {showIntermediate && <label><input type="checkbox" checked={value.applyToIntermediate} onChange={(e) => onChange({ ...value, applyToIntermediate: e.target.checked })} />能力条件を途中の種牡馬にも適用</label>}
        </div>
      </div>
    </div>
  );
}

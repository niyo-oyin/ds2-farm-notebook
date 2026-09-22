import { useMemo, useState } from 'react';
import type { MasterHorse } from '../core/types';
import { baseMaster } from '../data/base-master';
import { requestCapture } from '../store/jobs';
import { useApp } from './app-context';
import { HorseDialog } from './HorseDialog';
import { nameSearch } from './name-search';
import { catalogHorses, horseCell, horseColumns, sortHorses } from './master-horse-catalog';
import { DataMaintenanceFilters } from './DataMaintenanceFilters';
import { matchesMaintenance } from './data-maintenance';
import './MasterHorsesPage.css';

export function MasterHorsesPage({ kind, initialHorseKey }: { kind: MasterHorse['kind']; initialHorseKey?: string | null }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const [system, setSystem] = useState('');
  const [access, setAccess] = useState('');
  const [maintenance, setMaintenance] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialHorseKey ?? null);
  const [creating, setCreating] = useState(false);
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'price', direction: 'desc' });
  const edits = useMemo(() => new Map(app.data.masterEdits.map(e => [e.id, e])), [app.data.masterEdits]);
  const all = useMemo(() => catalogHorses(app.master, baseMaster, app.data.masterEdits, kind), [app.master, app.data.masterEdits, kind]);
  const list = useMemo(() => {
    const search = nameSearch(q);
    return sortHorses(all.filter(h => {
      const e = edits.get(h.id);
      const locked = !!h.unlock?.trim() || h.breedingRightPrice != null;
      return search.matches(h.name, h.smallSystem)
        && (!system || h.bigSystem === system)
        && (!access || (access === 'unlocked' ? !locked : access === 'locked' ? locked : h.breedingRightPrice != null))
        && matchesMaintenance(maintenance, [e?.added && 'added', !!e && !e.added && !e.hidden && 'edited', e?.hidden && 'hidden']);
    }), sort.key, sort.direction);
  }, [all, edits, system, access, maintenance, q, sort]);
  const label = kind === 'stallion' ? '種牡馬' : '繁殖牝馬';
  const columns = horseColumns(kind);
  const sortLabel = sort.key === 'dist' ? '距離上限' : columns.find(c => c.key === sort.key)?.label;
  return <div className="master-page">
    <div className="master-catalog-tools">
      <input aria-label={`${label}を検索`} placeholder="馬名・小系統で検索" value={q} onChange={e => setQ(e.target.value)} />
      <select aria-label="大系統で絞り込み" value={system} onChange={e => setSystem(e.target.value)}><option value="">大系統：すべて</option>{app.master.meta.bigSystems.map(s => <option key={s} value={s}>{s}系</option>)}</select>
      <select aria-label="解禁条件で絞り込み" value={access} onChange={e => setAccess(e.target.value)}><option value="">解禁条件：すべて</option><option value="unlocked">解禁条件なし</option><option value="locked">要解禁</option>{kind === 'stallion' && <option value="right">種付け権が必要</option>}</select>
      <span className="small muted" role="status">{list.length}頭</span>
      <div className="master-catalog-actions"><button type="button" onClick={() => requestCapture(kind === 'stallion' ? ['種牡馬', '種付け'] : [label])}>写真から登録</button><button type="button" className="primary" onClick={() => setCreating(true)}>＋ {label}を追加</button></div>
    </div>
    <DataMaintenanceFilters options={[['added', '追加した馬'], ['edited', '修正あり'], ['hidden', '非表示']]} selected={maintenance} onChange={setMaintenance} />
    <div className="master-catalog-caption small muted"><span>金額：万円　— 未確認</span><span>{sortLabel} {sort.direction === 'desc' ? '↓ 降順' : '↑ 昇順'}</span></div>
    <div className="table-wrap master-catalog-scroll"><table className="master-catalog" aria-label={`${label}の能力比較`}>
      <thead><tr>{columns.map(c => <th key={c.key} className={c.numeric ? 'num' : ''} aria-sort={sort.key === c.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => setSort({ key: c.key, direction: sort.key === c.key ? sort.direction === 'asc' ? 'desc' : 'asc' : ['name', 'grown'].includes(c.key) ? 'asc' : 'desc' })}>{c.label}<span aria-hidden="true">{sort.key === c.key ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ' ↕'}</span></button></th>)}<th aria-label="詳細" /></tr></thead>
      <tbody>{list.map(h => { const e = edits.get(h.id); return <tr key={h.id} className={selectedId === h.id ? 'selected' : ''} onClick={() => setSelectedId(h.id)}>
        <td><div className="master-catalog-name"><button type="button" aria-label={`${h.name}の詳細`} onClick={() => setSelectedId(h.id)}>{h.name}</button>{h.breedingRightPrice != null && <span className="pill">要種付け権</span>}{e && <span className="pill">{e.hidden ? '非表示' : e.added ? '追加' : '修正あり'}</span>}</div><div className="master-list-sub">{h.smallSystem ? `${h.smallSystem}系` : '系統未設定'}{h.unlock && ' · 要解禁'}</div></td>
        {columns.slice(1).map(c => { const value = horseCell(h, c.key); return <td key={c.key} className={c.numeric ? 'num' : ''}><span className={value === '—' ? 'muted' : value === 'A' ? 'master-rating-a' : undefined} aria-label={value === '—' ? '未確認' : undefined}>{value}</span></td>; })}<td aria-hidden="true">›</td>
      </tr>; })}</tbody>
    </table></div>
    {!list.length && <p className="empty">該当する{label}がありません。</p>}
    {(creating || selectedId) && <HorseDialog mode="data" horseKey={creating ? undefined : selectedId!} kind={kind} onClose={() => { setCreating(false); setSelectedId(null); }} onSaved={h => { setCreating(false); setSelectedId(h.id); }} sequence={creating ? undefined : { ids: list.map(h => h.id), onSelect: setSelectedId }} />}
  </div>;
}

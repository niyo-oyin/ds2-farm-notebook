import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { OwnedHorse } from '../core/types';
import { HORSE_CATEGORIES, horseAge, sexAgeLabel } from '../core/owned-horse';
import { PageHeading } from './icons';
import { useApp, ownedParentKeys } from './app-context';
import { ActionDialog } from './ActionDialog';
import { store, horsePlanLinks } from '../store/userdata';
import { imageUrl } from '../api';
import { navigate } from './router';
import { requestCapture } from '../store/jobs';
import { nameSearch } from './name-search';
import { HorseSheet, type HorseSheetHandle } from './HorseSheet';
import './HorsesPage.css';
import { HorsePlaceholder } from './HorsePlaceholder';
import { HorseSelect } from './HorseSelect';
import { HorseListFilter } from './HorseListFilter';
import { OWNED_SORTS, EMPTY_OWNED_FILTER, compareOwnedHorses, matchesOwnedHorse, type OwnedSort, EMPTY_OWNED_BASIC_FILTER, matchesOwnedBasic, type OwnedBasicFilter } from './owned-horse-list';

const mq = typeof matchMedia !== 'undefined' ? matchMedia('(max-width: 900px)') : null;
const useNarrow = () => useSyncExternalStore((cb) => { mq?.addEventListener('change', cb); return () => mq?.removeEventListener('change', cb); }, () => !!mq?.matches);
const scrollTop = () => window.scrollTo(0, 0);
const SORT_KEY = 'ds2tool.horses.sort';
const loadSort = (): OwnedSort => {
  try { const s = JSON.parse(localStorage.getItem(SORT_KEY) ?? '') as OwnedSort; if (OWNED_SORTS.some(x => x.key === s.key) && typeof s.desc === 'boolean') return s; } catch { /* 既定 */ }
  return { key: 'updated', desc: true };
};

const BASIC_FILTER_KEY = 'ds2tool.horses.basicFilter';
const loadBasicFilter = (): OwnedBasicFilter => {
  try {
    const filter = JSON.parse(localStorage.getItem(BASIC_FILTER_KEY) ?? '');
    if (filter && ['categories', 'sexes', 'ages'].every(key => Array.isArray(filter[key]) && filter[key].every((v: unknown) => typeof v === 'string'))) return filter;
  } catch { /* 既定 */ }
  return EMPTY_OWNED_BASIC_FILTER;
};

export function HorsesPage({ params }: { params: URLSearchParams }) {
  const app = useApp();
  const narrow = useNarrow();
  const sheet = useRef<HorseSheetHandle>(null);
  const leave = () => sheet.current?.canLeave() ?? true;
  const [selectedId, setSelectedId] = useState<string | null>(params.get('id'));
  const [editing, setEditing] = useState<string | null>(params.get('new') ? 'new' : null);
  const [q, setQ] = useState('');
  const [excluded, setExcluded] = useState<OwnedBasicFilter>(loadBasicFilter);
  const changeBasicFilter = (next: OwnedBasicFilter) => { setExcluded(next); localStorage.setItem(BASIC_FILTER_KEY, JSON.stringify(next)); };
  const [filter, setFilter] = useState(EMPTY_OWNED_FILTER);
  const [addingMaster, setAddingMaster] = useState(false);
  const [sort, setSort] = useState<OwnedSort>(loadSort);
  const changeSort = (next: OwnedSort) => { setSort(next); localStorage.setItem(SORT_KEY, JSON.stringify(next)); };
  const [message, setMessage] = useState(params.get('saved') ? '所有馬を保存しました' : '');
  const [error, setError] = useState('');
  const linksByHorse = useMemo(() => new Map(app.data.horses.map((h) => [h.id, horsePlanLinks(app.data, h.id)])), [app.data]);
  const label = (key: string) => key ? app.resolver.label(key) : '未登録';
  const parentsByHorse = useMemo(() => new Map(app.data.horses.map(h => [h.id, ownedParentKeys(app, h)])), [app]);
  const parentOptions = (role: 'sire' | 'dam') => [...new Set([...parentsByHorse.values()].map(p => p[role]).filter(Boolean))].map(key => ({ key, name: label(key), group: role === 'sire' ? '父' : '母', sub: '' })).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const ages = [...new Set(app.data.horses.map(h => horseAge(h.profile?.birthYear, app.data.settings.gameYear)).filter((n): n is number => n !== undefined))].sort((a, b) => a - b);
  const detailCount = Object.values(filter).filter(Boolean).length;
  const filtered = !!q || Object.values(excluded).some(values => values.length > 0) || detailCount > 0;
  const clearFilters = () => { setQ(''); changeBasicFilter(EMPTY_OWNED_BASIC_FILTER); setFilter(EMPTY_OWNED_FILTER); };
  const horses = nameSearch(q).filter(app.data.horses.filter(h => {
    return matchesOwnedBasic(h, excluded, app.data.settings.gameYear)
      && matchesOwnedHorse(h, filter, parentsByHorse.get(h.id)!, !!linksByHorse.get(h.id)?.length);
  }), h => [h.name, label(parentsByHorse.get(h.id)!.sire), label(parentsByHorse.get(h.id)!.dam), ...(linksByHorse.get(h.id)?.map(l => l.plan?.name ?? l.foal?.name) ?? [])]).sort(compareOwnedHorses(sort, app.data.settings.gameYear));
  const selected = app.data.horses.find((h) => h.id === selectedId) ?? (!narrow ? horses[0] : undefined);
  const detailVisible = !!editing || !!selected;
  const finish = (h: OwnedHorse) => {
    setSelectedId(h.id); setEditing(null); setMessage(''); setError('');
    if (editing === 'new') navigate('/horses', { id: h.id, saved: '1' });
  };
  const remove = (horse: OwnedHorse) => {
    if (!confirm(`${horse.name} を削除しますか？`)) return;
    const err = store.deleteHorse(horse.id);
    if (err) setError(err); else { setSelectedId(null); setMessage(`${horse.name} を削除しました`); }
  };
  return <div className="horses-page">
    <PageHeading icon="horse" title="所有馬" count={{ value: app.data.horses.length, unit: '頭' }} actions={<><button onClick={() => requestCapture(['育成馬', '入厩馬', '血統'])}>写真から取り込み</button><button onClick={() => { if (!leave()) return; setAddingMaster(true); }}>データの繁殖牝馬から追加</button><button className="primary" onClick={() => { if (editing === 'new' || !leave()) return; setEditing('new'); setError(''); scrollTop(); }}>＋ 所有馬を登録</button></>} />
    {message && <div className="horse-feedback" role="status">{message}</div>}
    {error && <div className="error" role="alert">{error}</div>}
    <div className={'horses-workspace' + (detailVisible ? ' has-detail' : '')}>
      <aside className="horse-list-panel">
        <div className="horse-search"><input aria-label="所有馬を検索" placeholder="馬名・父母・計画名で検索" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="horse-list-filters">
          <HorseListFilter label="区分" options={HORSE_CATEGORIES.map(value => ({ value, label: value }))} excluded={excluded.categories} onChange={categories => changeBasicFilter({ ...excluded, categories })} preset={{ label: '引退以外', excluded: ['引退'] }} />
          <HorseListFilter label="性別" options={[{ value: 'M', label: '牡' }, { value: 'F', label: '牝' }, { value: 'unknown', label: '未確認' }]} excluded={excluded.sexes} onChange={sexes => changeBasicFilter({ ...excluded, sexes })} />
          <HorseListFilter label="年齢" options={[...ages.map(n => ({ value: String(n), label: `${n}歳` })), { value: 'unknown', label: '未確認' }]} excluded={excluded.ages} onChange={ages => changeBasicFilter({ ...excluded, ages })} />
        </div>
        <details className="horse-detail-filters"><summary>詳細条件{detailCount > 0 && <span className="tag">{detailCount}</span>}</summary><div className="horse-detail-filter-fields">
          <label className="field">父<HorseSelect aria-label="父で絞り込み" value={filter.sire} onChange={sire => setFilter({ ...filter, sire })} options={parentOptions('sire')} placeholder="すべて" /></label>
          <label className="field">母<HorseSelect aria-label="母で絞り込み" value={filter.dam} onChange={dam => setFilter({ ...filter, dam })} options={parentOptions('dam')} placeholder="すべて" /></label>
          <label className="field">成長型<select value={filter.growth} onChange={e => setFilter({ ...filter, growth: e.target.value })}><option value="">すべて</option>{['早熟', '普通', '持続', '晩成'].map(g => <option key={g}>{g}</option>)}</select></label>
          <label className="field">距離適性（m）<input type="number" min={0} step={100} value={filter.distance} onChange={e => setFilter({ ...filter, distance: e.target.value })} placeholder="不問" /></label>
          <label className="field">馬場適性<select value={filter.surface} onChange={e => setFilter({ ...filter, surface: e.target.value })}><option value="">すべて</option><option value="turf">芝 ○以上</option><option value="dirt">ダート ○以上</option></select></label>
          <label className="field">計画との紐付け<select value={filter.linked} onChange={e => setFilter({ ...filter, linked: e.target.value })}><option value="">すべて</option><option value="linked">紐付けあり</option><option value="unlinked">紐付けなし</option></select></label>
        </div></details>
        <div className="horse-list-caption"><span>{horses.length} / {app.data.horses.length}頭{filtered && <button type="button" className="horse-filter-reset" onClick={clearFilters}>解除</button>}</span><span className="horse-list-sort">
          <select aria-label="所有馬の並び順" value={sort.key} onChange={e => { const key = e.target.value as OwnedSort['key']; changeSort({ key, desc: !['name', 'age', 'category', 'sex'].includes(key) }); }}>{OWNED_SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
          <button type="button" className="horse-list-sortdir" aria-label={sort.desc ? '降順（押すと昇順）' : '昇順（押すと降順）'} title={sort.desc ? '降順（押すと昇順）' : '昇順（押すと降順）'} onClick={() => changeSort({ ...sort, desc: !sort.desc })}>{sort.desc ? '↓' : '↑'}</button>
        </span></div>
        <div className="horse-list">{horses.map((h) => {
          const links = linksByHorse.get(h.id) ?? [];
          const plans = [...new Map(links.flatMap(({ plan, foal }) => plan ? [[plan.id, plan.name] as const] : foal ? [[foal.id, foal.name] as const] : [])).entries()];
          const { sire, dam } = ownedParentKeys(app, h);
          const parents = `${label(sire)} × ${label(dam)}`;
          const missing = !sire && !dam;
          return <button key={h.id} className={'horse-list-item' + (selected?.id === h.id ? ' selected' : '')} aria-pressed={selected?.id === h.id} onClick={() => { if ((!editing && selected?.id === h.id) || !leave()) return; setSelectedId(h.id); setEditing(null); setError(''); if (narrow) scrollTop(); }}>
            <span className="portrait horse-list-thumb">{h.imageId ? <img src={imageUrl(h.imageId)} alt="" loading="lazy" /> : <HorsePlaceholder category={h.category} sex={h.sex} />}</span>
            <span className="horse-list-body">
              <span className="horse-list-title"><b className="horse-list-name">{h.name}</b><span className={`pill cat-${h.category}`}>{h.category}</span><span className={`pill sex-${h.sex ?? 'none'}`}>{sexAgeLabel(h.sex, horseAge(h.profile?.birthYear, app.data.settings.gameYear))}</span>{h.profile?.color && <span className="pill">{h.profile.color}</span>}{sort.key === 'earnings' && <span className="horse-sort-value">{h.profile?.earnings == null ? '賞金未確認' : `${h.profile.earnings.toLocaleString()}万`}</span>}{(['speed', 'stamina', 'power'] as string[]).includes(sort.key) && <span className="horse-sort-value">{OWNED_SORTS.find(s => s.key === sort.key)?.label} {h.abilities?.race?.[sort.key as 'speed' | 'stamina' | 'power'] ?? '—'}</span>}</span>
              {missing
                ? <span className="horse-list-parents missing">血統未登録</span>
                : <span className="horse-list-parents" title={parents}>{sire ? label(sire) : <em className="missing">未登録</em>} × {dam ? label(dam) : <em className="missing">未登録</em>}</span>}
              {plans.length > 0 && <span className="horse-list-plans" aria-label={`対応する計画: ${plans.map(([, name]) => name).join("、")}`}>{plans.slice(0, 2).map(([id, name]) => <span className="horse-plan-label" key={id} title={name}>{name}</span>)}{plans.length > 2 && <span className="horse-plan-more" title={plans.slice(2).map(([, name]) => name).join('、')} aria-label={`ほかの計画: ${plans.slice(2).map(([, name]) => name).join('、')}`}>+{plans.length - 2}</span>}</span>}
            </span>
            <span className="horse-list-chevron" aria-hidden="true">›</span>
          </button>;
        })}</div>
        {!horses.length && <div className="horse-list-empty">{app.data.horses.length ? <>該当する所有馬はありません<button onClick={clearFilters}>絞り込みを解除</button></> : <>所有馬はまだ登録されていません<button onClick={() => setEditing('new')}>最初の所有馬を登録</button></>}</div>}
      </aside>
      <div className="horse-detail-panel" onFocusCapture={() => { if (selected && !editing && selectedId !== selected.id) setSelectedId(selected.id); }}>
        {narrow && detailVisible && <button className="horse-back" onClick={() => { if (!leave()) return; setSelectedId(null); setEditing(null); scrollTop(); }}>‹ 所有馬一覧へ</button>}
        {editing || selected ? <HorseSheet ref={sheet} key={editing ?? selected!.id} horse={editing === 'new' ? undefined : selected} initialPlannedId={editing === 'new' ? params.get('planned') : null} initialParents={editing === 'new' ? { sire: params.get('sire') ?? '', dam: params.get('dam') ?? '' } : undefined} onSave={finish} onCancel={() => setEditing(null)} onRemove={selected ? () => remove(selected) : undefined} /> : <div className="horse-detail-empty"><h3>所有馬の血統と能力を確認</h3><p>一覧から馬を選択してください。</p></div>}
      </div>
    </div>
    {addingMaster && <AddMasterMareDialog onClose={() => setAddingMaster(false)} onAdded={(added) => { setAddingMaster(false); if (added.length) setSelectedId(added[0].id); setEditing(null); setMessage(added.length === 1 ? `${added[0].name} を所有馬に追加しました` : `${added.length}頭を所有馬に追加しました`); setError(''); }} />}
  </div>;
}

/** データの繁殖牝馬（実在馬）を所有馬として追加する。血統・能力はデータのものを使う。ゲーム開始時のように複数頭をまとめて追加できる */
function AddMasterMareDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (horses: OwnedHorse[]) => void }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState('');
  const owned = new Set(app.data.horses.flatMap((h) => (h.masterKey ? [h.masterKey] : [])));
  const mares = nameSearch(q).filter(app.master.broodmares.filter((b) => !owned.has(b.id)), (b) => [b.name]);
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const add = () => {
    try {
      onAdded(picked.flatMap((id) => {
        const mare = app.master.broodmares.find((b) => b.id === id);
        return mare ? [store.addHorse({ kind: 'owned', name: mare.name, sex: 'F', category: '繁殖牝馬', masterKey: mare.id, sireKey: '', damKey: '', memo: '' })] : [];
      }));
    } catch (e) { setError((e as Error).message); }
  };
  return <ActionDialog title="データの繁殖牝馬から追加" onClose={onClose}>
    <input className="master-mare-search" aria-label="繁殖牝馬を検索" placeholder="馬名で検索" value={q} onChange={(e) => setQ(e.target.value)} />
    <ul className="master-mare-list" aria-label="追加する繁殖牝馬">{mares.map((b) => <li key={b.id}><label className={picked.includes(b.id) ? 'selected' : ''}>
      <input type="checkbox" checked={picked.includes(b.id)} onChange={() => toggle(b.id)} />
      <span className="master-mare-name">{b.name}</span>
      <span className="master-mare-sub">{b.smallSystem ?? '-'}系 · {b.purchasePrice ? `${b.purchasePrice.toLocaleString()}万` : b.priceUnknown ? '購入価格未確認' : '初期から'}</span>
    </label></li>)}</ul>
    {!mares.length && <p className="small muted">該当する繁殖牝馬はありません。</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="action-dialog-actions"><button type="button" onClick={onClose}>キャンセル</button><button type="button" className="primary" disabled={!picked.length} onClick={add}>{picked.length ? `${picked.length}頭を所有馬に追加` : '所有馬に追加'}</button></div>
  </ActionDialog>;
}

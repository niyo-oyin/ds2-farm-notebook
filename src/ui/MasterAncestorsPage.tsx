import { useMemo, useState, useSyncExternalStore } from 'react';
import { horseIdentities, newAncestorId } from '../core/horse-identity';
import type { AncestorInfo } from '../core/types';
import { baseMaster } from '../data/base-master';
import { store } from '../store/userdata';
import { useApp } from './app-context';
import { EffectChips } from './Pedigree';
import { nameSearch } from './name-search';
import { DataMaintenanceFilters } from './DataMaintenanceFilters';
import { matchesMaintenance } from './data-maintenance';
import './MasterHorsesPage.css';

const mq = typeof matchMedia !== 'undefined' ? matchMedia('(max-width: 900px)') : null;
const useNarrow = () => useSyncExternalStore((cb) => { mq?.addEventListener('change', cb); return () => mq?.removeEventListener('change', cb); }, () => !!mq?.matches);

/** 祖先マスター（個体ごとの大系統・性別・因子）の一覧と編集。血統表の因子と系統の札はここから表示する */
export function MasterAncestorsPage() {
  const app = useApp();
  const narrow = useNarrow();
  const [q, setQ] = useState('');
  const [system, setSystem] = useState('');
  const [effect, setEffect] = useState('');
  const [sex, setSex] = useState('');
  const [maintenance, setMaintenance] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');
  const editsById = useMemo(() => new Map(app.data.ancestorEdits.map((e) => [e.id, e])), [app.data.ancestorEdits]);
  // 祖先マスターにない馬も、血統表に現れる名前は「未登録」として一覧に出す（系統や因子を後から登録できるように）
  const registered = useMemo(() => new Set(app.master.ancestors.filter(a => a.effectsKnown !== false).map((a) => a.id)), [app.master.ancestors]);
  const unregistered = useMemo(() => {
    return [...horseIdentities(app.master).values()].filter(h => !app.master.ancestors.some(a => a.id === h.id)).map((h): AncestorInfo => ({ ...h, system: null, effects: [] }));
  }, [app.master]);
  const list = nameSearch(q).filter([...app.master.ancestors, ...unregistered].filter((a) => {
    const isRegistered = registered.has(a.id);
    return (!system || a.system === Number(system))
      && (!effect || (effect === 'none' ? isRegistered && a.effects.length === 0 : a.effects.includes(effect)))
      && (!sex || a.sex === sex)
      && matchesMaintenance(maintenance, [editsById.has(a.id) && 'edited', !isRegistered && 'unregistered', !a.system && 'noSystem']);
  }).sort((a, b) => a.name.localeCompare(b.name, 'ja')), (a) => [a.name]);
  const current = selected ? [...app.master.ancestors, ...unregistered].find((a) => a.id === selected) : (!narrow && !creating ? list[0] : undefined);
  const detailVisible = creating || !!current;
  return <div className="master-page">
    {message && <div className="horse-feedback" role="status">{message}</div>}
    <div className="master-catalog-tools">
      <input aria-label="祖先を検索" placeholder="名前で検索" value={q} onChange={(e) => setQ(e.target.value)} />
      <select aria-label="大系統で絞り込み" value={system} onChange={(e) => setSystem(e.target.value)}><option value="">大系統：すべて</option>{app.master.meta.bigSystems.map((s, i) => <option key={s} value={i + 1}>{s}系</option>)}</select>
      <select aria-label="因子で絞り込み" value={effect} onChange={(e) => setEffect(e.target.value)}><option value="">因子：すべて</option>{app.master.meta.crossEffects.map((e) => <option key={e} value={e}>{e}</option>)}<option value="none">因子なし</option></select>
      <select aria-label="性別で絞り込み" value={sex} onChange={(e) => setSex(e.target.value)}><option value="">性別：すべて</option><option value="M">牡</option><option value="F">牝</option></select>
      <span className="small muted" role="status">{list.length}頭</span>
      <div className="master-catalog-actions"><button type="button" className="primary" onClick={() => { setCreating(true); setSelected(null); }}>＋ 祖先を追加</button></div>
    </div>
    <DataMaintenanceFilters options={[['edited', '追加・修正あり'], ['unregistered', '未登録'], ['noSystem', '大系統未登録']]} selected={maintenance} onChange={setMaintenance} />
    <div className={'master-workspace' + (detailVisible ? ' has-detail' : '')}>
      <aside className="master-list-panel">
        <div className="master-list">{list.map((a) => <button key={a.id} type="button" className={'master-list-item' + (current?.id === a.id && !creating ? ' selected' : '')} aria-pressed={current?.id === a.id && !creating} onClick={() => { setSelected(a.id); setCreating(false); setMessage(''); }}>
          <span className="master-list-title"><b>{a.name}</b>{!registered.has(a.id) && <span className="pill cat-未分類">未登録</span>}{editsById.has(a.id) && <span className="pill">{baseMaster.ancestors.some((b) => b.id === a.id) ? '修正あり' : '追加'}</span>}{a.effects.length > 0 && <EffectChips effects={a.effects} size="sm" />}</span>
          <span className="master-list-sub">{registered.has(a.id) ? `${a.system ? `${app.master.meta.bigSystems[a.system - 1]}系` : '大系統未登録'} · ${a.sex === 'M' ? '牡' : a.sex === 'F' ? '牝' : '性別不明'}` : '血統表に現れるが祖先マスターに登録がない'}</span>
        </button>)}</div>
      </aside>
      <div className="master-detail-panel">
        {narrow && detailVisible && <button type="button" className="horse-back" onClick={() => { setSelected(null); setCreating(false); }}>‹ 祖先一覧へ</button>}
        {creating ? <AncestorSheet key="new" info={null} onDone={(id, name) => { setCreating(false); setSelected(id); setMessage(`${name} を追加しました`); }} onCancel={() => setCreating(false)} />
          : current ? <AncestorSheet key={current.id + (editsById.get(current.id)?.updatedAt ?? '')} info={current} onDone={(id, name) => { setSelected(id); setMessage(`${name} を保存しました`); }} onCancel={() => undefined} onReverted={() => setMessage('取り消しました')} />
            : <div className="horse-detail-empty"><h3>祖先の系統と因子を確認・修正</h3><p>一覧から選ぶか、追加してください。</p></div>}
      </div>
    </div>
  </div>;
}

function AncestorSheet({ info, onDone, onCancel, onReverted }: { info: AncestorInfo | null; onDone: (id: string, name: string) => void; onCancel: () => void; onReverted?: () => void }) {
  const app = useApp();
  const bigSystems = app.master.meta.bigSystems;
  const inBase = !!info && baseMaster.ancestors.some((b) => b.id === info.id);
  const edited = !!info && app.data.ancestorEdits.some((e) => e.id === info.id);
  const isRegistered = !!info && app.master.ancestors.some((a) => a.id === info.id);
  const [name, setName] = useState(info?.name ?? '');
  const [system, setSystem] = useState(info?.system ? String(info.system) : '');
  const [sex, setSex] = useState<'M' | 'F' | ''>(info?.sex ?? '');
  const [effects, setEffects] = useState<string[]>(info?.effects ?? []);
  const [error, setError] = useState('');
  const save = () => {
    const n = name.trim();
    if (!n) { setError('名前を入力してください'); return; }
    const id = info?.id ?? newAncestorId();
    store.saveAncestorEdits([{ id, name: n, system: system ? Number(system) : null, sex: sex || null, effects }]);
    onDone(id, n);
  };
  const revert = () => {
    if (!info || !confirm(inBase ? `${info.name} の修正を取り消して元の値に戻しますか？` : `${info.name} を削除しますか？`)) return;
    const error = store.deleteAncestorEdit(info.id);
    if (error) setError(error); else onReverted?.();
  };
  return <form className="master-sheet" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
    <div className="master-sheet-head">
      <div><span className="small muted">{info ? (inBase ? (edited ? 'マスター（修正あり）' : 'マスター') : isRegistered ? '追加した祖先' : '未登録（血統表に現れる名前）') : '新しい祖先'}</span><h2>{name || '（名前未入力）'}</h2></div>
      <div className="master-sheet-actions">
        {info && edited && <button type="button" className="danger" onClick={revert}>{inBase ? '修正を取り消す' : 'この祖先を削除'}</button>}
        {!info && <button type="button" onClick={onCancel}>キャンセル</button>}
        <button type="submit" className="primary">{info && isRegistered ? '保存' : '登録'}</button>
      </div>
      <div role={error ? 'alert' : 'status'} className={error ? 'sheet-error' : 'sheet-save-status'}>{error}</div>
    </div>
    <div className="master-sections">
      <section className="sheet-section">
        <div className="sheet-section-heading"><h3>基本情報</h3></div>
        <div className="master-fields">
          <label className="field">名前<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field">大系統<select value={system} onChange={(e) => setSystem(e.target.value)}><option value="">未登録</option>{bigSystems.map((s, i) => <option key={s} value={i + 1}>{s}系</option>)}</select></label>
          <label className="field">性別<select value={sex} onChange={(e) => setSex(e.target.value as typeof sex)}><option value="">不明</option><option value="M">牡</option><option value="F">牝</option></select></label>
        </div>
        <p className="small muted">大系統は面白い配合・見事な配合の判定に、性別は牝馬クロスの判定に使う。</p>
      </section>
      <section className="sheet-section">
        <div className="sheet-section-heading"><h3>因子</h3><span className="small muted">ゲームの血統・クロス画面で馬名の右に付くチップ</span></div>
        <div className="sheet-effect-options">{app.master.meta.crossEffects.map((effect) => <label key={effect} className={effects.includes(effect) ? 'selected' : ''}><input type="checkbox" aria-label={`因子 ${effect}`} checked={effects.includes(effect)} onChange={(e) => setEffects(e.target.checked ? [...effects, effect] : effects.filter((x) => x !== effect))} /><EffectChips effects={[effect]} /><span>{effect}</span></label>)}</div>
      </section>
    </div>
  </form>;
}

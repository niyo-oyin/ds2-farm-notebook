import { useId, useMemo, useState } from 'react';
import { horseUnlockConditions } from '../core/master-horse';
import type { AncestorInfo, MasterHorse } from '../core/types';
import { GROWTH_TYPES, DIRT_APTITUDES, ABILITY_RANKS } from '../core/owned-horse';
import { OMOSHIRO_SLOTS, MIGOTO_SLOTS, SLOT_LABELS, charSys, deriveCodes, diffAgainstBase, fillFromParents, newMasterId, sysChar, validateMasterHorse } from '../core/master-edits';
import { baseMaster } from '../data/base-master';
import { store } from '../store/userdata';
import { useApp } from './app-context';
import { horseIdentities, newAncestorId } from '../core/horse-identity';
import { HorseSelect } from './HorseSelect';
import { ancestorOptions } from './ancestor-options';
import { nodePath } from '../core/pedigree';
import { EffectChips, SystemBadge } from './Pedigree';
import { ActionDialog } from './ActionDialog';
import { MatingHints } from './MatingHints';
import { catalogHorses, horseCell, horseColumns } from './master-horse-catalog';
import './MasterHorsesPage.css';
import './HorseDialog.css';

type Kind = MasterHorse['kind'];
const COAT_COLORS = ['鹿毛', '黒鹿毛', '青鹿毛', '青毛', '栗毛', '栃栗毛', '芦毛', '白毛'];
interface HorseSequence { ids: string[]; onSelect: (id: string) => void }

/** データ一覧と探索結果で共用する、種牡馬・繁殖牝馬の閲覧・編集ダイアログ。 */
export function HorseDialog({ horseKey, kind = 'stallion', onClose, onSaved, sequence, mode = 'search' }: { mode?: 'data' | 'search'; horseKey?: string; kind?: Kind; onClose: () => void; onSaved?: (horse: MasterHorse) => void; sequence?: HorseSequence }) {
  const app = useApp();
  const [createdId, setCreatedId] = useState<string | null>(null);
  const key = horseKey ?? createdId;
  const horse = useMemo(() => key ? [...catalogHorses(app.master, baseMaster, app.data.masterEdits, 'stallion'), ...catalogHorses(app.master, baseMaster, app.data.masterEdits, 'broodmare')].find(h => h.id === key) : null, [app.master, app.data.masterEdits, key]);
  if (key && !horse) return <ActionDialog title="馬の詳細" onClose={onClose}><p className="muted">この馬の情報は表示できません。</p></ActionDialog>;
  return <HorseDetails mode={mode} key={key ?? 'new'} kind={horse?.kind ?? kind} horse={horse ?? null} onClose={onClose} sequence={sequence} onDone={h => { if (!horseKey) setCreatedId(h.id); onSaved?.(h); }} />;
}

function HorseOverview({ horse }: { horse: MasterHorse }) {
  return <>
    <div className="horse-dialog-meta">{horse.overseas && <span className="pill">海外種牡馬</span>}<span className={`pill cat-${horse.kind === 'stallion' ? '種牡馬' : '繁殖牝馬'}`}>{horse.kind === 'stallion' ? '種牡馬' : '繁殖牝馬'}</span><span>{horse.bigSystem ? `${horse.bigSystem}系` : '大系統未設定'} / {horse.smallSystem ? `${horse.smallSystem}系` : '小系統未設定'}</span><span>{horse.kind === 'stallion' ? '種付料' : '購入価格'} {horseCell(horse, 'price')}{!horse.priceUnknown && (horse.kind === 'stallion' || !!horse.purchasePrice) ? '万円' : ''}</span>{horse.color && <span>{horse.color}</span>}{horseUnlockConditions(horse).map(c => <span key={c} className="tag warn">解禁条件: {c}</span>)}</div>
    <dl className="horse-dialog-attrs">{horseColumns(horse.kind).slice(2).map(c => <div key={c.key}><dt>{c.label}</dt><dd>{horseCell(horse, c.key)}</dd></div>)}</dl>
  </>;
}

interface Form { overseas: boolean; name: string; price: string; purchasePrice: string; breedingRightPrice: string; color: string; bigSystem: string; smallSystem: string; unlock: string; hidden: boolean; priceUnknown: boolean; ancestors: string[]; omoshiro: string[]; migoto: string[]; attrs: Record<string, string> }
const ATTR_FIELDS: Record<Kind, { key: string; label: string; type: 'number' | 'select'; options?: readonly string[] }[]> = {
  stallion: [
    { key: 'distMin', label: '距離下限（m）', type: 'number' }, { key: 'distMax', label: '距離上限（m）', type: 'number' },
    { key: 'grown', label: '成長', type: 'select', options: GROWTH_TYPES }, { key: 'dirt', label: 'ダート', type: 'select', options: DIRT_APTITUDES },
    { key: 'kenko', label: '体質', type: 'select', options: ABILITY_RANKS }, { key: 'kisyo', label: '気性', type: 'select', options: ABILITY_RANKS },
    { key: 'jisseki', label: '実績', type: 'select', options: ABILITY_RANKS }, { key: 'konjo', label: '底力', type: 'select', options: ABILITY_RANKS }, { key: 'antei', label: '安定', type: 'select', options: ABILITY_RANKS },
  ],
  broodmare: [
    { key: 'speed', label: 'スピード', type: 'number' }, { key: 'stamina', label: 'スタミナ', type: 'number' }, { key: 'power', label: 'パワー', type: 'number' },
    { key: 'dirt', label: 'ダート', type: 'select', options: DIRT_APTITUDES }, { key: 'kenko', label: '体質', type: 'select', options: ABILITY_RANKS }, { key: 'kisyo', label: '気性', type: 'select', options: ABILITY_RANKS },
  ],
};
const attrsToForm = (attrs: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'dist' && Array.isArray(v)) { out.distMin = String(v[0] ?? ''); out.distMax = String(v[1] ?? ''); }
    else if (v !== null && v !== undefined && k !== 'type') out[k] = String(v);
  }
  return out;
};
const formToAttrs = (kind: Kind, f: Record<string, string>, base: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...base };
  for (const { key, type } of ATTR_FIELDS[kind]) {
    if (key === 'distMin' || key === 'distMax') continue;
    out[key] = f[key] ? (type === 'number' ? Number(f[key]) : f[key]) : null;
  }
  if (kind === 'stallion') out.dist = f.distMin && f.distMax ? [Number(f.distMin), Number(f.distMax)] : null;
  return out;
};

function HorseDetails({ kind, horse, onDone, onClose, sequence, mode }: { mode: 'data' | 'search'; kind: Kind; horse: MasterHorse | null; onDone: (h: MasterHorse) => void; onClose: () => void; sequence?: HorseSequence }) {
  const app = useApp();
  const bigSystems = app.master.meta.bigSystems;
  const edit = horse ? app.data.masterEdits.find((e) => e.id === horse.id) : undefined;
  const base = horse ? (kind === 'stallion' ? baseMaster.stallions : baseMaster.broodmares).find(h => h.id === horse.id) : undefined;
  const isPublic = !!base;
  const [newAncestors, setNewAncestors] = useState<AncestorInfo[]>([]);
  const [identityId, setIdentityId] = useState('');
  const initial = (): Form => ({
    overseas: !!horse?.overseas,
    name: horse?.name ?? '', price: String(horse?.price ?? (kind === 'stallion' ? '' : 0)), purchasePrice: String(horse?.purchasePrice ?? ''), breedingRightPrice: String(horse?.breedingRightPrice ?? ''),
    color: horse?.color ?? '', bigSystem: horse?.bigSystem ?? '', smallSystem: horse?.smallSystem ?? '', unlock: horse?.unlock ?? '', hidden: !!edit?.hidden, priceUnknown: !!horse?.priceUnknown,
    ancestors: horse ? [...horse.ancestors, ...Array(30 - horse.ancestors.length).fill('')] : Array(30).fill(''),
    omoshiro: (horse?.omoshiro ?? '????').split(''), migoto: (horse?.migoto ?? '????').split(''),
    attrs: attrsToForm(horse?.attrs ?? {}),
  });
  const [form, setForm] = useState<Form>(initial);
  const [baseline, setBaseline] = useState<Form>(initial);
  const [editing, setEditing] = useState(mode === 'data' || !horse);
  const [pedEditing, setPedEditing] = useState(false);
  const [tab, setTab] = useState<'pedigree' | 'hints'>('pedigree');
  const [pending, setPending] = useState<'close' | 'cancel' | 'revert' | null>(null);
  const [saved, setSaved] = useState(false);
  const formId = useId();
  const dirty = editing && JSON.stringify(form) !== JSON.stringify(baseline);
  const finish = (action: 'close' | 'cancel') => {
    setPending(null); setNewAncestors([]);
    if (action === 'close' || !horse) onClose();
    else { const f = initial(); setForm(f); setBaseline(f); setEditing(mode === 'data'); setPedEditing(false); setSaved(false); setError(''); }
  };
  const requestFinish = (action: 'close' | 'cancel') => { if (dirty) setPending(action); else finish(action); };
  const beginEdit = () => { setNewAncestors([]); const f = initial(); setForm(f); setBaseline(f); setEditing(true); setSaved(false); setError(''); };
  const [error, setError] = useState('');
  const change = (patch: Partial<Form>) => { setForm({ ...form, ...patch }); setSaved(false); setError(''); };
  const smalls = useMemo(() => [...new Set([...app.master.stallions, ...app.master.broodmares].map((h) => h.smallSystem).filter((s): s is string => !!s))].sort(), [app.master]);
  const draftMaster = useMemo(() => ({ ...app.master, ancestors: [...app.master.ancestors, ...newAncestors] }), [app.master, newAncestors]);
  const ancestorsOptions = useMemo(() => ancestorOptions(draftMaster), [draftMaster]);
  const identities = useMemo(() => horseIdentities(draftMaster), [draftMaster]);
  const reusableAncestors = app.master.ancestors.filter(a => a.name === form.name.trim() && !app.resolver.master(a.id));
  const byId = useMemo(() => new Map([...app.master.stallions, ...app.master.broodmares].map((h) => [h.id, h])), [app.master]);
  const derived = deriveCodes(form.bigSystem || null, form.ancestors, app.ctx.ancestors, bigSystems);
  const toHorse = (): MasterHorse => ({
    ...horse, id: horse?.id ?? (reusableAncestors.some(a => a.id === identityId) ? identityId : newMasterId(kind)), kind, sex: kind === 'stallion' ? 'M' : 'F',
    overseas: kind === 'stallion' && form.overseas,
    name: form.name.trim(), price: kind === 'stallion' && !form.priceUnknown ? Number(form.price || 0) : 0, priceUnknown: form.priceUnknown, color: form.color.trim() || null,
    bigSystem: form.bigSystem || null, smallSystem: form.smallSystem.trim() || null,
    omoshiro: horse?.omoshiro == null && form.omoshiro.join('') === '????' ? null : form.omoshiro.join(''), migoto: kind === 'stallion' && !(horse?.migoto == null && form.migoto.join('') === '????') ? form.migoto.join('') : null,
    ancestors: form.ancestors.map((a) => a.trim()), unlock: form.unlock.trim() || null,
    purchasePrice: !form.priceUnknown && kind === 'broodmare' && form.purchasePrice.trim() ? Number(form.purchasePrice) : null,
    breedingRightPrice: kind === 'stallion' && form.breedingRightPrice.trim() ? Number(form.breedingRightPrice) : null,
    attrs: formToAttrs(kind, form.attrs, horse?.attrs ?? {}),
  });
  const save = () => {
    if (!editing || (horse && !dirty)) return;
    try {
      const next = toHorse();
      validateMasterHorse(next);
      for (const field of ATTR_FIELDS[kind].filter(f => f.type === 'number')) {
        const raw = form.attrs[field.key];
        if (raw && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) throw new Error(`${field.label}は0以上の数値で入力してください`);
      }
      if (kind === 'stallion' && !!form.attrs.distMin !== !!form.attrs.distMax) throw new Error('距離は下限と上限の両方を入力してください');
      if (Number(form.attrs.distMin) > Number(form.attrs.distMax)) throw new Error('距離上限は下限以上にしてください');
      if (newAncestors.length) store.saveAncestorEdits(newAncestors.filter(a => next.ancestors.includes(a.id)));
      if (isPublic && base) {
        const data = diffAgainstBase(base, next);
        if (!Object.keys(data).length && !form.hidden) {
          if (edit) { const error = store.deleteMasterEdit(horse!.id); if (error) throw new Error(error); }
        } else {
          store.saveMasterEdit({ id: horse!.id, kind, added: false, hidden: form.hidden || undefined, data });
        }
      } else {
        const { id: _id, kind: _kind, ...data } = next;
        store.saveMasterEdit({ id: next.id, kind, added: true, data });
      }
      setEditing(mode === 'data'); setPedEditing(false); setPending(null); setBaseline(form); setSaved(true); onDone(next);
    } catch (e) { setError((e as Error).message); }
  };
  const revert = () => {
    if (!horse) return;
    const err = store.deleteMasterEdit(horse.id);
    if (err) setError(err); else onClose();
  };
  const codeSelect = (which: 'omoshiro' | 'migoto', slots: (number | 'self')[]) => <div className="master-codes">{slots.map((slot, i) => {
    const value = form[which][i] ?? '?', d = which === 'omoshiro' ? derived.omoshiro[i] : derived.migoto[i];
    return <label key={String(slot)} className="field"><span>{SLOT_LABELS[String(slot)]}{d !== '?' && d !== value && <em className="master-derived" title="祖先マスターからの導出値と異なります"> 導出: {charSys(d, bigSystems)}</em>}</span>
      <select value={value} onChange={(e) => { const arr = [...form[which]]; arr[i] = e.target.value; change({ [which]: arr } as Partial<Form>); }}><option value="?">不明</option>{bigSystems.map((s) => <option key={s} value={sysChar(s, bigSystems)}>{s}系</option>)}</select></label>;
  })}</div>;
  const cells = [];
  const ancestors = editing ? form.ancestors : horse?.ancestors ?? form.ancestors;
  for (let generation = 1; generation <= 4; generation++) {
    const span = 1 << (4 - generation);
    for (let row = 0; row < (1 << generation); row++) {
      const n = (1 << generation) + row, idx = n - 2;
      const info = app.ctx.ancestors.get(ancestors[idx]?.trim() ?? '');
      cells.push(<div key={n} className={'master-anc ' + (n % 2 ? 'dam' : 'sire')} style={{ gridColumn: generation, gridRow: `${row * span + 1} / span ${span}` }}>
        {editing && pedEditing ? <HorseSelect options={ancestorsOptions} onCreate={name => { const id = newAncestorId(); setNewAncestors([...newAncestors, { id, name, sex: n % 2 ? 'F' : 'M', system: null, effects: [], effectsKnown: false }]); const a = [...form.ancestors]; a[idx] = id; change({ ancestors: a }); }} aria-label={nodePath(n)} placeholder={nodePath(n)} value={form.ancestors[idx]} onChange={(id) => { const a = [...form.ancestors]; a[idx] = id; change({ ancestors: a }); }} /> : <span>{(ancestors[idx] ? identities.get(ancestors[idx])?.name ?? '（未登録）' : '') || <span className="muted">（不明）</span>}</span>}
        {!!info?.effects.length && <EffectChips effects={info.effects} size="sm" />}
      </div>);
      if (generation === 4 && n % 2 === 0) cells.push(<div key={`sys-${n}`} className="master-anc-sys" style={{ gridColumn: 5, gridRow: `${row * span + 1} / span 2` }}><SystemBadge system={info?.system ? bigSystems[info.system - 1] : null} /></div>);
    }
  }
  const index = horse ? sequence?.ids.indexOf(horse.id) ?? -1 : -1;
  return <ActionDialog title={horse?.name ?? `新しい${kind === 'stallion' ? '種牡馬' : '繁殖牝馬'}`} wide className="horse-detail-dialog" onClose={() => requestFinish('close')} actions={<div className="horse-dialog-header-actions">
    {editing ? <>
      {horse && (edit || !isPublic) && <button type="button" className="danger" onClick={() => setPending('revert')}>{isPublic ? '修正を取り消す' : 'この馬を削除'}</button>}
      {(mode === 'search' || dirty || !horse) && <button type="button" onClick={() => requestFinish('cancel')}>{mode === 'data' && horse ? '変更を戻す' : 'キャンセル'}</button>}
      {(dirty || !horse) && <button type="submit" form={formId} className="primary">{horse ? '保存する' : '追加する'}</button>}
    </> : <>
      {horse && <a href={`#/data?tab=${kind === 'stallion' ? 'stallions' : 'broodmares'}&horse=${encodeURIComponent(horse.id)}`} onClick={onClose}>データで確認する</a>}
      <button type="button" onClick={beginEdit}>編集</button>
    </>}
  </div>}>
    {pending && <div className="horse-dialog-confirm" role="alert"><span>{pending === 'revert' ? isPublic ? '修正を取り消して元の値に戻しますか？' : 'この馬を削除しますか？' : '保存していない変更を破棄しますか？'}</span><button type="button" autoFocus onClick={() => setPending(null)}>{pending === 'revert' ? 'キャンセル' : '編集を続ける'}</button><button type="button" className="danger" onClick={() => pending === 'revert' ? (setPending(null), revert()) : finish(pending)}>{pending === 'revert' ? isPublic ? '元に戻す' : '削除する' : '破棄する'}</button></div>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="horse-dialog-toolbar">
      {sequence && index >= 0 && <div className="horse-dialog-stepper"><button type="button" disabled={dirty || index === 0} onClick={() => sequence.onSelect(sequence.ids[index - 1])}>‹ 前の馬</button><span>{index + 1} / {sequence.ids.length}</span><button type="button" disabled={dirty || index === sequence.ids.length - 1} onClick={() => sequence.onSelect(sequence.ids[index + 1])}>次の馬 ›</button></div>}
      <span className="small muted" role="status">{dirty ? '未保存の変更' : saved ? '保存しました' : edit?.hidden ? '非表示' : edit ? isPublic ? '修正あり' : '追加した馬' : ''}</span>
    </div>
    <form id={formId} className="horse-dialog-form" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
    {!editing && horse && <HorseOverview horse={horse} />}
    <div className="master-sections">
      {editing && <>
      <section className="sheet-section">
        <div className="sheet-section-heading"><h3>基本情報</h3></div>
        <div className="master-fields">
          <label className="field">馬名<input value={form.name} onChange={(e) => change({ name: e.target.value })} /></label>
          {!horse && reusableAncestors.length > 0 && <label className="field">登録済みの祖先との対応<select value={identityId} onChange={e => setIdentityId(e.target.value)}><option value="">同名の別馬として追加</option>{reusableAncestors.map(a => <option key={a.id} value={a.id}>{a.name}（{a.sex === 'M' ? '牡' : a.sex === 'F' ? '牝' : '性別不明'}・{a.id}）</option>)}</select></label>}
          {kind === 'stallion' ? <label className="field">種付料（万円）<input type="number" min={0} disabled={form.priceUnknown} value={form.price} onChange={(e) => change({ price: e.target.value })} /></label>
            : <label className="field">購入価格（万円、空欄は初期から利用可）<input type="number" min={0} disabled={form.priceUnknown} value={form.purchasePrice} onChange={(e) => change({ purchasePrice: e.target.value })} /></label>}
          <label className="field">毛色<select value={form.color} onChange={(e) => change({ color: e.target.value })}><option value="">未確認</option>{[...new Set([...COAT_COLORS, form.color].filter(Boolean))].map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="field">大系統<select value={form.bigSystem} onChange={(e) => change({ bigSystem: e.target.value })}><option value="">未設定</option>{bigSystems.map((s) => <option key={s} value={s}>{s}系</option>)}</select></label>
          <label className="field">小系統<input list="master-smalls" value={form.smallSystem} onChange={(e) => change({ smallSystem: e.target.value })} /><datalist id="master-smalls">{smalls.map((s) => <option key={s} value={s} />)}</datalist></label>
          <label className="field">解禁条件<input value={form.unlock} placeholder="例: 皐月賞に勝利" onChange={(e) => change({ unlock: e.target.value })} /></label>
          {kind === 'stallion' && <label className="field">種付け権購入額（万円）<input type="number" min={0} placeholder="条件なし" value={form.breedingRightPrice} onChange={e => change({ breedingRightPrice: e.target.value })} /></label>}
          {kind === 'stallion' && <label className="field">種牡馬の区分<select value={form.overseas ? 'overseas' : 'domestic'} onChange={e => change({ overseas: e.target.value === 'overseas' })}><option value="domestic">国内</option><option value="overseas">海外</option></select></label>}
          <label className="master-hidden"><input type="checkbox" checked={form.priceUnknown} onChange={e => change({ priceUnknown: e.target.checked })} /><span>{kind === 'stallion' ? '種付料' : '購入価格'}は未確認</span></label>
          {isPublic && <label className="master-hidden"><input type="checkbox" checked={form.hidden} onChange={(e) => change({ hidden: e.target.checked })} /><span>非表示にする</span></label>}
        </div>
      </section>
      <section className="sheet-section">
        <div className="sheet-section-heading"><h3>能力・評価</h3></div>
        <div className="master-fields">{ATTR_FIELDS[kind].map(({ key, label, type, options }) => <label key={key} className="field">{label}{type === 'select'
          ? <select value={form.attrs[key] ?? ''} onChange={(e) => change({ attrs: { ...form.attrs, [key]: e.target.value } })}><option value="">未確認</option>{options!.map((o) => <option key={o}>{o}</option>)}</select>
          : <input type="number" min={0} value={form.attrs[key] ?? ''} placeholder="未確認" onChange={(e) => change({ attrs: { ...form.attrs, [key]: e.target.value } })} />}</label>)}</div>
      </section>
      </>}
      <div className="horse-dialog-tabs" role="tablist" aria-label="馬の詳細内容"><button type="button" role="tab" aria-selected={tab === 'pedigree'} onClick={() => setTab('pedigree')}>血統表</button>{horse && <button type="button" role="tab" aria-selected={tab === 'hints'} onClick={() => setTab('hints')}>配合の手がかり</button>}</div>
      {tab === 'pedigree' ? <>
      <section className="sheet-section master-pedigree-section">
        <div className="sheet-section-heading"><h3>血統（4代）</h3>{editing && <div className="horse-dialog-pedigree-actions">{pedEditing && <button type="button" onClick={() => change({ ancestors: fillFromParents(form.ancestors, byId) })}>父母の血統から埋める</button>}<button type="button" onClick={() => setPedEditing(!pedEditing)}>{pedEditing ? '血統表の表示に戻す' : '血統表を編集'}</button></div>}</div>
        <div className="sheet-pedigree-scroll"><div className="master-pedigree" style={{ gridTemplateColumns: 'repeat(4, minmax(150px, 1fr)) 52px', gridTemplateRows: 'repeat(16, minmax(30px, auto))' }}>{cells}</div></div>

      </section>
      {editing && <details className="sheet-section"><summary>系統コードを編集</summary>
        <div className="sheet-section-heading"><h3>系統コード</h3><button type="button" onClick={() => change({ omoshiro: derived.omoshiro.split(''), migoto: derived.migoto.split('') })}>祖先マスターから導出</button></div>
        <p className="small muted">面白い配合・見事な配合の判定に使う大系統。祖先が祖先マスターにあれば導出できる。導出できない位置は手で選ぶ。</p>
        <h4 className="master-code-title">面白用（本馬・父母父・母父・母母父）</h4>
        {codeSelect('omoshiro', OMOSHIRO_SLOTS)}
        {kind === 'stallion' && <><h4 className="master-code-title">見事用（父父母父・父母母父・母父母父・母母母父）</h4>{codeSelect('migoto', MIGOTO_SLOTS)}</>}
      </details>}
      </> : horse && <MatingHints horse={horse} />}
    </div>
  </form>
  {!dirty && horse && <div className="action-dialog-actions"><a href={`#/search?${kind === 'stallion' ? 'stallion' : 'mare'}=${encodeURIComponent(horse.id)}&mode=one`} onClick={onClose}>この馬の相手を探す</a></div>}
  </ActionDialog>;
}

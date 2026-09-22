import { type CSSProperties, forwardRef, useEffect, useImperativeHandle, useId, useMemo, useRef, useState } from 'react';
import { checkWorkspace, workspaceGeneration } from '../store/workspace';
import type { HorseAbilities, HorseCategory, HorseRecord, OwnedHorse, RaceEntry, Sex } from '../core/types';
import { HORSE_CATEGORIES, horseAge, isUnnamedHorse, pedigreeEffectCounts, pedigreeIssue, sexAgeLabel } from '../core/owned-horse';
import { canReadHorseStory } from '../core/horse-story';
import { HorseNameSuggestions } from './HorseNameSuggestions';
import { PORTRAIT_MAX_SIDE, deleteImage, imageToBase64, imageUrl, uploadImage } from '../api';
import { foalNodes, makeFoalRecord, nodePath, unknownRecord } from '../core/pedigree';
import { allUserHorses, horsePlanLinks, store } from '../store/userdata';
import { requestCapture } from '../store/jobs';
import { useApp, sireOptions, damOptions, type HorseOption } from './app-context';
import { HorseSelect, type HorseSelectHandle } from './HorseSelect';
import { EFFECT_CHIP, EffectChips, SystemBadge } from './Pedigree';
import { navigate } from './router';
import { HorseAbilitiesEditor } from './HorseAbilitiesEditor';
import { nameSearch } from './name-search';
import { applyRaceEdits } from '../core/races';
import { baseRaces } from '../data/races';
import { RaceResultsEditor } from './RaceResultsEditor';
import './HorseSheet.css';

const COAT_COLORS = ['鹿毛', '黒鹿毛', '青鹿毛', '青毛', '栗毛', '栃栗毛', '芦毛', '白毛'];
type SheetForm = {
  name: string; sex: Sex | ''; category: HorseCategory; excludeFromSearch: boolean; color: string; birthYear: string;
  earnings: string; earningsCurrent: string; wins: string; rank: string; stable: string; weight: string; record: string; races: RaceEntry[];
  sireKey: string; damKey: string; smallSystem: string; abilities: HorseAbilities;
  effects: string[]; memo: string;
  plannedIds: string[];
  /** 画像: 既存のID。差し替えは portrait、削除は imageId を空にする */
  imageId: string; portrait: { file: File; url: string } | null;
};
/** 上段の帯の最小高さ（px）。要約列の最小内容がこれに収まるよう CSS 側の寸法と合わせる */
const BAND_MIN = 200;
export interface HorseSheetHandle { canLeave: () => boolean }

export const HorseSheet = forwardRef<HorseSheetHandle, {
  horse?: OwnedHorse; initialPlannedId: string | null; initialParents?: { sire: string; dam: string }; onSave: (horse: OwnedHorse) => void; onCancel: () => void; onRemove?: () => void;
}>(function HorseSheet({ horse, initialPlannedId, initialParents, onSave, onCancel, onRemove }, ref) {
  const app = useApp();
  const planned = app.data.plannedHorses.find((h) => h.id === initialPlannedId);
  const originalLinks = horse ? horsePlanLinks(app.data, horse.id) : [];
  const actualParent = (key = '') => {
    const parent = app.data.plannedHorses.find((h) => h.id === key);
    const ids = parent?.realizedIds.filter((id) => app.data.horses.some((h) => h.id === id)) ?? [];
    return parent ? ids.length === 1 ? ids[0] : '' : key;
  };
  const initial: SheetForm = {
    name: horse?.name ?? '', sex: horse?.sex ?? '', category: horse?.category ?? '現役', excludeFromSearch: horse?.excludeFromSearch ?? false,
    color: horse?.profile?.color ?? '', birthYear: String(horse?.profile?.birthYear ?? ''),
    earnings: String(horse?.profile?.earnings ?? ''), earningsCurrent: String(horse?.profile?.earningsCurrent ?? ''), wins: horse?.profile?.wins ?? '',
    rank: horse?.profile?.rank ?? '', stable: horse?.profile?.stable ?? '', weight: horse?.profile?.weight ?? '', record: horse?.profile?.record ?? '', races: horse?.profile?.races ?? [],
    imageId: horse?.imageId ?? '', portrait: null,
    sireKey: horse?.sireKey ?? actualParent(planned?.sireKey ?? initialParents?.sire), damKey: horse?.damKey ?? actualParent(planned?.damKey ?? initialParents?.dam),
    smallSystem: horse?.smallSystemOverride ?? '',
    abilities: horse?.abilities ?? {},
    effects: horse?.effects ?? [], memo: horse?.memo ?? '',
    plannedIds: horse ? originalLinks.map((l) => l.foal.id) : planned ? [planned.id] : [],
  };
  // 編集していない間は同期された最新の値を表示。編集途中の入力は再同期で消さない。
  const [draft, setDraft] = useState<SheetForm | null>(null);
  const form = draft ?? initial;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(initial);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linkEditing, setLinkEditing] = useState(false);
  // 馬名は表示が基本。ペンで編集欄に切り替え、確定（Enter・欄外）で表示に戻す。新規登録は最初から編集欄
  const [nameEditing, setNameEditing] = useState(!horse);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (nameEditing) nameInput.current?.focus(); }, [nameEditing]);
  const [tab, setTab] = useState('basic');
  const tabId = useId();
  const races = useMemo(() => applyRaceEdits(baseRaces, app.data.raceEdits), [app.data.raceEdits]);
  const tabs = [{ id: 'basic', label: '基本情報' }, { id: 'pedigree', label: '血統表' }, { id: 'records', label: '戦績' }, { id: 'plans', label: '計画' }];
  const pedigreeMissing = !form.sireKey || !form.damKey;
  // 配合確認・探索は保存済みの血統で判定するので、保存済みの値で可否を決める
  const actionBlock = horse ? (!horse.sex ? '性別を設定すると使えます' : pedigreeIssue(horse)) : null;
  const change = (patch: Partial<SheetForm>) => { setDraft({ ...form, ...patch }); setSaved(false); setError(''); };
  // 既存の馬は自動保存。新規登録だけ明示のボタンで登録し、入力途中の離脱を防ぐ。
  const canLeave = () => {
    if (horse || !dirty) return true;
    setError('登録していない入力があります。「所有馬を登録」か「キャンセル」を選んでください。');
    return false;
  };
  useImperativeHandle(ref, () => ({ canLeave }));
  useEffect(() => {
    if (horse || !dirty) return;
    const unload = (e: BeforeUnloadEvent) => e.preventDefault();
    const follow = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('a[href^="#/"]')) return;
      e.preventDefault(); e.stopPropagation();
      setError('登録していない入力があります。「所有馬を登録」か「キャンセル」を選んでください。');
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', follow, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', follow, true); };
  }, [dirty, horse]);

  const sireOpts = useMemo(() => sireOptions(app, { includePlanned: false }).filter((h) => h.key !== horse?.id), [app, horse?.id]);
  const damOpts = useMemo(() => damOptions(app, { includePlanned: false }).filter((h) => h.key !== horse?.id), [app, horse?.id]);
  const smalls = [...new Set(app.master.stallions.map((s) => s.smallSystem).filter((s): s is string => !!s))].sort();
  const bloodline = useMemo(() => {
    try {
      const sire = app.resolver.get(form.sireKey), dam = app.resolver.get(form.damKey);
      const rec = makeFoalRecord(sire, dam, { key: horse?.id ?? 'u:draft', name: form.name, sex: form.sex || null, kind: 'owned', smallSystemOverride: form.smallSystem || null }, app.rules);
      return { rec, nodes: foalNodes(sire ?? unknownRecord(), dam ?? unknownRecord()), error: '' };
    } catch (e) { return { rec: unknownRecord(), nodes: Array<string>(64).fill(''), error: (e as Error).message }; }
  }, [app, form.sireKey, form.damKey, form.name, form.sex, form.smallSystem, horse]);
  const bigSystems = [...new Set([...app.master.stallions, ...app.master.broodmares]
    .filter((h) => h.smallSystem === bloodline.rec.smallSystem && h.bigSystem)
    .map((h) => h.bigSystem!))];
  const bigSystem = bigSystems.length === 1 ? bigSystems[0] : null;
  const factorContext = useMemo(() => ({
    ancestors: app.ctx.ancestors,
    userAncestors: new Map(allUserHorses(app.data).filter((h) => h.effects !== undefined).map((h) => [h.id, { id: h.id, name: h.name, sex: h.sex, system: null, effects: h.effects! }])),
  }), [app]);
  const ancestors = pedigreeEffectCounts(bloodline.nodes, factorContext);
  const links = form.plannedIds.flatMap((id) => {
    const foal = app.data.plannedHorses.find((h) => h.id === id);
    if (!foal) return [];
    const plan = app.data.plans.find((p) => p.steps.some((s) => s.foalId === id));
    return [{ foal, plan, stepIndex: plan?.steps.findIndex((s) => s.foalId === id) ?? -1 }];
  });
  const usages = horse ? app.data.plans.filter((p) => p.startKey === horse.id || p.steps.some((s) => s.sire === horse.id || s.dam === horse.id)) : [];

  const formGeneration = useRef(workspaceGeneration());
  const save = async () => {
    if (formGeneration.current !== workspaceGeneration()) return;
    const snapshot = form;
    if (!form.name.trim()) { setError('馬名を入力してください'); return; }
    const number = (s: string) => s.trim() ? Number(s) : undefined;
    const text = (s: string) => s.trim() || undefined;
    const races = form.races.map((r) => ({ ...r, date: r.date.trim(), place: r.place.trim(), race: r.race.trim(), finish: r.finish.trim() })).filter((r) => r.date || r.place || r.race || r.finish);
    const profile = {
      color: text(form.color), birthYear: number(form.birthYear), earnings: number(form.earnings), earningsCurrent: number(form.earningsCurrent), wins: text(form.wins),
      rank: text(form.rank), stable: text(form.stable), weight: text(form.weight), record: text(form.record), races: races.length ? races : undefined,
    };
    setSaving(true);
    try {
      let imageId: string | undefined = form.imageId || undefined;
      if (form.portrait) imageId = await uploadImage(await imageToBase64(form.portrait.file, PORTRAIT_MAX_SIDE, undefined, 0, true));
      checkWorkspace(formGeneration.current);
      const patch = {
        name: form.name.trim(), sex: form.sex || null, category: form.category, excludeFromSearch: form.excludeFromSearch, sireKey: form.sireKey, damKey: form.damKey,
        smallSystemOverride: form.smallSystem || null, profile: Object.values(profile).some((v) => v !== undefined) ? profile : undefined,
        abilities: form.abilities, effects: form.effects.length ? form.effects : undefined, memo: form.memo, imageId,
      };
      let result: OwnedHorse;
      if (horse) {
        store.updateHorse(horse.id, patch, form.plannedIds);
        result = { ...horse, ...patch };
      } else result = store.addHorse({ ...patch, kind: 'owned' }, form.plannedIds);
      if (horse?.imageId && horse.imageId !== imageId) void deleteImage(horse.imageId);
      // 保存中に続けて入力していたら、その入力は残す
      setDraft((d) => (d === snapshot ? null : d)); setError(''); setSaved(true); onSave(result);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };
  const latest = useRef({ save, dirty: false });
  useEffect(() => { latest.current = { save, dirty: !!horse && dirty }; });
  useEffect(() => {
    if (!horse || !dirty || saving) return;
    const t = setTimeout(() => void save(), 600);
    return () => clearTimeout(t);
  }, [draft, saving]); // eslint-disable-line react-hooks/exhaustive-deps
  // 別の馬や画面へ移る前に、待機中の自動保存を流す
  useEffect(() => () => { if (latest.current.dirty) void latest.current.save(); }, []);
  const portraitUrl = form.portrait?.url ?? (form.imageId ? imageUrl(form.imageId) : '');
  // 上段は高さを揃えた帯。帯の高さ（= 写真の一辺）は名前側の実測高さで決め、要約列はそれに合わせて伸縮する。
  // 件数で伸びる「対応する計画」は帯に置かず、計画タブに置く。
  const identityMain = useRef<HTMLDivElement>(null);
  const [bandHeight, setBandHeight] = useState(BAND_MIN);
  useEffect(() => {
    const el = identityMain.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBandHeight(Math.max(BAND_MIN, Math.round(el.getBoundingClientRect().height))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const choosePortrait = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('画像ファイルを選んでください'); return; }
    change({ portrait: { file, url: URL.createObjectURL(file) } });
  };

  return <form className="horse-sheet" noValidate onSubmit={(e) => { e.preventDefault(); if (!horse) void save(); }}>
    <div className="sheet-toolbar">
      <div role={error ? 'alert' : 'status'} className={error ? 'sheet-error' : 'sheet-save-status'}>{error || (saving ? '保存中…' : horse && dirty ? '入力中…' : saved ? '保存しました' : '')}</div>
      {horse ? <div className="sheet-toolbar-actions">
        <span className="sheet-action-wrap" title={actionBlock ?? undefined}><button type="button" disabled={!!actionBlock} onClick={() => navigate('/mating', horse.sex === 'M' ? { sire: horse.id } : { dam: horse.id })}>配合確認</button></span>
        <span className="sheet-action-wrap" title={actionBlock ?? undefined}><button type="button" disabled={!!actionBlock} onClick={() => navigate('/search', horse.sex === 'M' ? { stallion: horse.id, mode: 'one' } : { mare: horse.id })}>配合探索</button></span>
        {canReadHorseStory(horse, app.data.settings.gameYear) && <button type="button" disabled={saving || dirty} title={dirty ? "入力内容の保存後に開けます" : undefined} onClick={() => navigate('/horses/story', { id: horse.id })}>{horse.story ? '愛馬の一篇を読む' : '愛馬の一篇'}</button>}
        <details className="sheet-more">
          <summary aria-label="その他の操作" title="その他の操作">…</summary>
          <div className="sheet-more-menu"><button type="button" className="danger" onClick={onRemove}>この馬を削除</button></div>
        </details>
      </div> : <div className="sheet-toolbar-actions">
        <button type="button" onClick={onCancel}>キャンセル</button>
        <button className="primary" type="submit" disabled={saving}>{saving ? '登録中…' : '所有馬を登録'}</button>
      </div>}
    </div>
    <div className="sheet-overview" style={{ '--band-height': `${bandHeight}px` } as CSSProperties}>
      <div className="sheet-portrait">
        <div className="portrait">{portraitUrl ? <img src={portraitUrl} alt={`${form.name || '所有馬'}の画像`} /> : <span className="portrait-empty">画像なし</span>}
          {portraitUrl && <button type="button" className="sheet-portrait-remove" aria-label="写真を外す" title="写真を外す" onClick={() => { if (confirm('この馬の写真を外しますか？')) change({ portrait: null, imageId: '' }); }}><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>}
          <div className="sheet-portrait-bar">
            <label><input type="file" accept="image/*" onChange={(e) => { choosePortrait(e.target.files?.[0]); e.target.value = ''; }} />写真を変更</label>
          </div>
        </div>
      </div>
      <section className="sheet-identity" aria-label="主な基本情報">
        <div className="sheet-identity-main" ref={identityMain}>
          <div className="sheet-identity-badges"><span className={`pill cat-${form.category}`}>{form.category}</span>{form.rank && <span className="pill rank">{form.rank}</span>}{!horse && <span className="small muted">新しい所有馬</span>}</div>
          {nameEditing
            ? <div className="sheet-name editing"><input ref={nameInput} aria-label="馬名" required value={form.name} placeholder="馬名を入力" onChange={(e) => change({ name: e.target.value })} onBlur={() => { if (horse && form.name.trim()) setNameEditing(false); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (form.name.trim()) setNameEditing(false); } }} /></div>
            : <div className="sheet-name"><h2>{form.name || '（馬名未設定）'}</h2><button type="button" className="sheet-name-edit" aria-label="馬名を編集" title="馬名を編集" onClick={() => setNameEditing(true)}>✎</button></div>}
          {isUnnamedHorse(form.name) && <HorseNameSuggestions key={JSON.stringify([form.name, form.sex, form.sireKey, form.damKey, form.color, app.data.settings.farm])} name={form.name} sex={form.sex} color={form.color} sireKey={form.sireKey} damKey={form.damKey} onSelect={name => { change({ name }); setNameEditing(false); }} />}
          <div className="sheet-identity-meta">
            <span className={`pill sex-${form.sex || 'none'}`}>{sexAgeLabel(form.sex || null, horseAge(form.birthYear ? Number(form.birthYear) : undefined, app.data.settings.gameYear))}</span>
            <span className="pill">{form.color || '毛色未登録'}</span>
            <span className="pill">{form.birthYear ? `${form.birthYear}年生` : '生年未登録'}</span>
            {form.category === '現役' && form.record && <span className="pill">{form.record}</span>}
          </div>
          <dl className="sheet-parents-summary">
            <div className="sire"><dt>父</dt><dd>{form.sireKey ? app.resolver.label(form.sireKey) : '未登録'}</dd></div>
            <div className="dam"><dt>母</dt><dd>{form.damKey ? app.resolver.label(form.damKey) : '未登録'}</dd></div>
          </dl>
        </div>
      </section>
      <aside className="sheet-context" aria-label="戦績の要約・メモ">
        <div className="sheet-card-row">
          <section className="sheet-card"><div className="sheet-card-heading"><h3>総賞金</h3></div><p className={'sheet-card-value' + (form.earnings ? '' : ' muted')}>{form.earnings ? `${Number(form.earnings).toLocaleString()}万円` : '未登録'}</p></section>
          <section className="sheet-card"><div className="sheet-card-heading"><h3>主な勝ち鞍</h3></div><p className={'sheet-card-value sheet-card-clamp' + (form.wins ? '' : ' muted')} title={form.wins || undefined}>{form.wins || '未登録'}</p></section>
        </div>
        <section className="sheet-card sheet-memo">
          <div className="sheet-card-heading"><h3><label htmlFor={`${tabId}-memo`}>メモ</label></h3></div>
          <textarea id={`${tabId}-memo`} value={form.memo} placeholder="この馬について残しておきたいこと" onChange={(e) => change({ memo: e.target.value })} />
        </section>
      </aside>
    </div>
    <div className="sheet-tabs" role="tablist" aria-label="所有馬の詳細">
      {tabs.map((t, i) => <button type="button" role="tab" key={t.id} id={`${tabId}-${t.id}`} aria-controls={`${tabId}-${t.id}-panel`} aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)} onKeyDown={(e) => {
        const next = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
        if (next === null) return;
        e.preventDefault(); setTab(tabs[next].id);
        e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}>{t.label}{t.id === 'plans' && links.length > 0 && <span className="sheet-tab-count">{links.length}</span>}{t.id === 'pedigree' && pedigreeMissing && <WarnMark title={!form.sireKey && !form.damKey ? '血統が未登録' : !form.sireKey ? '父が未登録' : '母が未登録'} />}</button>)}
    </div>
    <div className="sheet-tab-panel" role="tabpanel" id={`${tabId}-basic-panel`} aria-labelledby={`${tabId}-basic`} hidden={tab !== 'basic'}>
      <div className="sheet-basic-layout">
        <section className="sheet-section sheet-details">
          <div className="sheet-section-heading"><h3>基本情報</h3></div>
          <dl className="sheet-info-table">
            <div><dt><label htmlFor={`${tabId}-category`}>区分</label></dt><dd><select id={`${tabId}-category`} value={form.category} onChange={(e) => { const category = e.target.value as HorseCategory; change({ category, sex: category === '繁殖牝馬' ? 'F' : category === '種牡馬' ? 'M' : form.sex }); }}>{HORSE_CATEGORIES.map((s) => <option key={s}>{s}</option>)}</select></dd></div>
            <div><dt><label htmlFor={`${tabId}-sex`}>性別</label></dt><dd><select id={`${tabId}-sex`} value={form.sex} onChange={(e) => { const sex = e.target.value as SheetForm['sex']; const category = ['繁殖牝馬', '種牡馬'].includes(form.category) ? sex === 'F' ? '繁殖牝馬' : sex === 'M' ? '種牡馬' : '未分類' : form.category; change({ sex, category }); }}><option value="">未確認</option><option value="F">牝</option><option value="M">牡</option></select></dd></div>
            <div><dt><label htmlFor={`${tabId}-color`}>毛色</label></dt><dd><select id={`${tabId}-color`} value={form.color} onChange={(e) => change({ color: e.target.value })}><option value="">未登録</option>{[...new Set([...COAT_COLORS, ...(form.color ? [form.color] : [])])].map((color) => <option key={color}>{color}</option>)}</select></dd></div>
            <div><dt><label htmlFor={`${tabId}-birth`}>生年</label></dt><dd><input id={`${tabId}-birth`} type="number" min="1" step="1" value={form.birthYear} placeholder="未登録" onChange={(e) => change({ birthYear: e.target.value })} /></dd></div>
            <div><dt><label htmlFor={`${tabId}-system`}>小系統</label></dt><dd><select id={`${tabId}-system`} value={form.smallSystem} onChange={(e) => change({ smallSystem: e.target.value })}><option value="">{bloodline.rec.smallSystem && !form.smallSystem ? `${bloodline.rec.smallSystem}系` : '未確認'}</option>{smalls.map((sys) => <option key={sys} value={sys}>{sys}系</option>)}</select>{bloodline.rec.smallSystemSource === '父から推定' && <span className="sheet-info-source">父から推定</span>}</dd></div>
            <div><dt>大系統</dt><dd>{bigSystem ? <span className="sheet-system-code">{bigSystem}系</span> : <span className="muted">未確認</span>}</dd></div>
            <div><dt>配合探索</dt><dd><label className="sheet-search-exclude"><input type="checkbox" checked={!form.excludeFromSearch} onChange={(e) => change({ excludeFromSearch: !e.target.checked })} />候補に含める</label></dd></div>
            {horse && <div><dt>登録日</dt><dd>{new Date(horse.createdAt).toLocaleDateString('ja-JP')}</dd></div>}
          </dl>
        </section>
        <HorseAbilitiesEditor value={form.abilities} category={form.category} onChange={(abilities) => change({ abilities })} />
      <section className="sheet-section sheet-factors">
        <div className="sheet-section-heading"><h3>本馬の因子</h3></div>
        <div className="sheet-effect-options">{app.master.meta.crossEffects.map((effect) => <label key={effect} className={form.effects.includes(effect) ? 'selected' : ''}><input type="checkbox" aria-label={`本馬の因子 ${effect}`} checked={form.effects.includes(effect)} onChange={(e) => {
          change({ effects: e.target.checked ? [...form.effects, effect] : form.effects.filter((x) => x !== effect) });
        }} /><EffectChips effects={[effect]} /><span>{effect}</span></label>)}</div>
        {!form.effects.length && <span className="small muted">因子未確認（ゲーム画面で確認したらチェック）</span>}
        <div className="sheet-ancestor-factors"><div className="sheet-section-heading"><h4>血統内の因子数</h4><span className="small muted">4代内・延べ</span></div>
          <div className="sheet-effect-counts">{app.master.meta.crossEffects.map((effect) => <div key={effect} title={`${effect}: 確認できた因子 ${ancestors.counts[effect] ?? 0}個`}><span className={'fx ' + (EFFECT_CHIP[effect]?.cls ?? '')}>{EFFECT_CHIP[effect]?.label ?? effect}</span><span>{effect}</span><b>{ancestors.counts[effect] ?? 0}</b></div>)}</div>
          {ancestors.unknown > 0 && <p className="small muted">因子未確認の祖先 {ancestors.unknown}頭</p>}
        </div>
      </section>
      </div>
    </div>
    <div className="sheet-tab-panel" role="tabpanel" id={`${tabId}-pedigree-panel`} aria-labelledby={`${tabId}-pedigree`} hidden={tab !== 'pedigree'}>
      <section className="sheet-section sheet-bloodline">
      {pedigreeMissing && <p className="sheet-pedigree-notice"><WarnMark title="" /><span>{!form.sireKey && !form.damKey ? '血統が未登録です。' : !form.sireKey ? '父が未登録です。' : '母が未登録です。'}「血統表を編集」で選ぶか、ゲームの血統・クロス画面の写真から登録できます。</span>{horse && <button type="button" onClick={() => requestCapture(['血統'], { id: horse.id, name: horse.name })}>写真から血統を登録</button>}</p>}
      <HorseBloodline nodes={bloodline.nodes} record={bloodline.rec} sireKey={form.sireKey} damKey={form.damKey} sireOpts={sireOpts} damOpts={damOpts} onSire={(sireKey) => change({ sireKey })} onDam={(damKey) => change({ damKey })} />
      {bloodline.error && <p className="error">{bloodline.error}</p>}

      </section>
    </div>
    <div className="sheet-tab-panel" role="tabpanel" id={`${tabId}-records-panel`} aria-labelledby={`${tabId}-records`} hidden={tab !== 'records'}>
      <section className="sheet-section">
        <div className="sheet-section-heading"><h3>戦績</h3><span className="small muted">入厩馬の画面の項目</span></div>
        <div className="sheet-record-fields">
          <label className="field">クラス<input value={form.rank} placeholder="OP、1勝 など" onChange={(e) => change({ rank: e.target.value })} /></label>
          <label className="field">所属<input value={form.stable} placeholder="美浦 / ○○厩舎" onChange={(e) => change({ stable: e.target.value })} /></label>
          <label className="field">馬体重<input value={form.weight} placeholder="444kg (+6kg)" onChange={(e) => change({ weight: e.target.value })} /></label>
          <label className="field">戦績<input value={form.record} placeholder="28戦6勝" onChange={(e) => change({ record: e.target.value })} /></label>
          <label className="field">収得賞金（万円）<input type="number" min="0" step="any" placeholder="未登録" value={form.earningsCurrent} onChange={(e) => change({ earningsCurrent: e.target.value })} /></label>
          <label className="field">総賞金（万円）<input type="number" min="0" step="any" placeholder="未登録" value={form.earnings} onChange={(e) => change({ earnings: e.target.value })} /></label>
          <label className="field sheet-wins">主な勝ち鞍<input value={form.wins} placeholder="未登録" onChange={(e) => change({ wins: e.target.value })} /></label>
        </div>
        <RaceResultsEditor value={form.races} races={races} onChange={(races) => change({ races })} />
        {!!horse?.observations?.length && <div className="sheet-observations"><h4>読み取り履歴</h4><ul>{[...horse.observations].reverse().map((o, i) => <li key={i}>{new Date(o.at).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })} · {o.screen}{o.age !== undefined ? ` · ${o.age}歳` : ''}{o.source === 'manual' ? ' · 手入力' : ''}</li>)}</ul></div>}
      </section>
    </div>
    <div className="sheet-tab-panel" role="tabpanel" id={`${tabId}-plans-panel`} aria-labelledby={`${tabId}-plans`} hidden={tab !== 'plans'}>
      <section className="sheet-section sheet-plans">
        <div className="sheet-section-heading"><h3>対応する計画 <span>{links.length}件</span></h3><button type="button" aria-expanded={linkEditing} onClick={() => setLinkEditing(!linkEditing)}>{linkEditing ? '選択を閉じる' : '紐付けを編集'}</button></div>
        {links.length ? <ul className="sheet-plan-list">{links.map(({ plan, foal, stepIndex }) => <li key={foal.id}>
          <a href={plan ? `#/plans?id=${encodeURIComponent(plan.id)}` : `#/plans?foal=${encodeURIComponent(foal.id)}`}>{plan?.name ?? foal.name}</a>
          <span>{stepIndex >= 0 ? `${stepIndex + 1}回目の実産駒 · ${foal.name}` : '単独の計画馬の実産駒'}</span>
          {linkEditing && <button type="button" aria-label={`${plan?.name ?? foal.name}との紐付けを解除`} onClick={() => change({ plannedIds: form.plannedIds.filter((id) => id !== foal.id) })}>解除</button>}
        </li>)}</ul> : !linkEditing && <p className="sheet-card-empty">この馬に対応する計画馬はありません。計画の産駒として生まれた馬なら「紐付けを編集」から選べます。</p>}
        {linkEditing && <PlanHorsePicker value={form.plannedIds} onChange={(plannedIds) => change({ plannedIds })} />}
        {usages.length > 0 && <div className="sheet-plan-usage"><h4>この馬を配合に使う計画</h4>{usages.map((p) => <a key={p.id} href={`#/plans?id=${encodeURIComponent(p.id)}`}>{p.name}</a>)}</div>}
      </section>
    </div>
  </form>;
});

/** 注意マーク。血統の未登録など、判定に影響する欠けを示す */
function WarnMark({ title }: { title: string }) {
  return <svg className="warn-mark" viewBox="0 0 16 16" width="14" height="14" role={title ? 'img' : undefined} aria-label={title || undefined} aria-hidden={title ? undefined : true}>{title && <title>{title}</title>}<path d="M8 1.5 15 14H1z" fill="var(--danger)" /><path d="M8 6v4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /><circle cx="8" cy="12" r=".9" fill="#fff" /></svg>;
}

function HorseBloodline({ nodes, record, sireKey, damKey, sireOpts, damOpts, onSire, onDam }: {
  nodes: string[]; record: HorseRecord; sireKey: string; damKey: string; sireOpts: HorseOption[]; damOpts: HorseOption[]; onSire: (key: string) => void; onDam: (key: string) => void;
}) {
  const app = useApp();
  const [gens, setGens] = useState<3 | 4 | 5>(3);
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const parentInput = useRef<HorseSelectHandle>(null);
  useEffect(() => { if (editing) parentInput.current?.focus(); }, [editing]);
  const infoOf = (key: string) => {
    const user = app.resolver.user(key);
    return app.ctx.ancestors.get(key) ?? (user ? { id: user.id, name: user.name, sex: user.sex, effects: user.effects, effectsKnown: user.effects !== undefined, system: null } : undefined);
  };
  const cells = [];
  for (let generation = 1; generation <= gens; generation++) {
    const span = 1 << (gens - generation);
    for (let row = 0; row < (1 << generation); row++) {
      const n = (1 << generation) + row, key = nodes[n], info = infoOf(key ?? '');
      const name = key ? record.labels[key] ?? app.resolver.label(key) : '未登録';
      const cls = 'sheet-ancestor ' + (n % 2 ? 'dam' : 'sire') + (!key ? ' unknown' : '') + (selected === n ? ' selected' : '');
      const style = { gridColumn: generation, gridRow: `${row * span + 1} / span ${span}` };
      cells.push(n < 4 ? <button key={n} type="button" className={cls + ' sheet-parent'} style={style} aria-label={`${n === 2 ? '父' : '母'}: ${name}`} aria-pressed={selected === n} onClick={() => setSelected(selected === n ? null : n)}>
        <span className="sheet-parent-label"><span>{n === 2 ? '父' : '母'}</span></span>
        <b>{name}</b>
        {info?.effects?.length ? <EffectChips effects={info.effects} /> : null}
      </button> : <button key={n} type="button" className={cls} style={style} disabled={!key} aria-label={`${nodePath(n)}: ${name}`} aria-pressed={selected === n} onClick={() => setSelected(selected === n ? null : n)} title={`${nodePath(n)}: ${name}`}>
        <span className="sheet-ancestor-name">{name}</span>{!!info?.effects?.length && <EffectChips effects={info.effects} size="sm" />}
      </button>);
      // 最後の世代の父側（牡）の祖先には大系統の札を右に出す
      if (generation === gens && n % 2 === 0) cells.push(<div key={`sys-${n}`} className="sheet-ancestor-sys" style={{ gridColumn: gens + 1, gridRow: `${row * span + 1} / span ${span * 2}` }}><SystemBadge system={info?.system ? app.master.meta.bigSystems[info.system - 1] : null} /></div>);
    }
  }
  const selectedKey = selected ? nodes[selected] : '';
  const selectedInfo = selectedKey ? infoOf(selectedKey) : undefined;
  const selectedName = selectedKey ? record.labels[selectedKey] ?? app.resolver.label(selectedKey) : '';
  return <>
    <div className="sheet-section-heading"><h3>血統表</h3><div className="sheet-bloodline-tools"><button type="button" aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? '編集を閉じる' : '血統表を編集'}</button><div className="segmented" aria-label="血統表の表示世代">{([3, 4, 5] as const).map((g) => <button type="button" key={g} className={gens === g ? 'primary' : ''} aria-pressed={gens === g} onClick={() => { setGens(g); setSelected(null); }}>{g}代</button>)}</div></div></div>
    {editing && <div className="sheet-parent-editor"><label className="field">父<HorseSelect ref={parentInput} value={sireKey} options={sireOpts} onChange={onSire} aria-label="所有馬の父" /></label><label className="field">母<HorseSelect value={damKey} options={damOpts} onChange={onDam} aria-label="所有馬の母" /></label></div>}
    <div className="sheet-pedigree-scroll" role="region" aria-label={`${gens}代血統表`} tabIndex={0}>
      <div className="sheet-generation-headings" style={{ gridTemplateColumns: `repeat(${gens}, minmax(164px, 1fr)) 52px` }}>{Array.from({ length: gens }, (_, i) => <span key={i}>{i + 1}代</span>)}<span>系統</span></div>
      <div className="sheet-pedigree" style={{ gridTemplateColumns: `repeat(${gens}, minmax(164px, 1fr)) 52px`, gridTemplateRows: `repeat(${1 << gens}, minmax(30px, auto))` }}>{cells}</div>
    </div>
    {selected && selectedKey && <div className="sheet-ancestor-detail"><div><b>{selectedName}</b><span>{nodePath(selected)}</span>{selectedInfo?.system && <span>{app.master.meta.bigSystems[selectedInfo.system - 1]}系</span>}</div><div>因子 {selectedInfo?.effects && selectedInfo.effectsKnown !== false ? selectedInfo.effects.length ? <EffectChips effects={selectedInfo.effects} /> : 'なし' : '未確認'}</div><button type="button" onClick={() => setSelected(null)}>閉じる</button></div>}
  </>;
}

function PlanHorsePicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const options = nameSearch(q).filter(app.data.plannedHorses.map((foal) => {
    const plan = app.data.plans.find((p) => p.steps.some((s) => s.foalId === foal.id));
    return { foal, title: plan?.name ?? '単独の計画馬', step: plan?.steps.findIndex((s) => s.foalId === foal.id) ?? -1 };
  }), ({ foal, title }) => [title, foal.name]);
  return <div className="horse-plan-picker">
    <input aria-label="紐付ける計画を検索" placeholder="計画名・計画馬名で検索" value={q} onChange={(e) => setQ(e.target.value)} />
    <div className="horse-plan-options">{options.map(({ foal, title, step }) => <label key={foal.id} className={value.includes(foal.id) ? 'selected' : ''}><input type="checkbox" checked={value.includes(foal.id)} onChange={(e) => onChange(e.target.checked ? [...value, foal.id] : value.filter((id) => id !== foal.id))} /><span><b>{title}</b><small>{step >= 0 ? `${step + 1}回目 · ` : ''}{foal.name}</small></span></label>)}</div>
    {!options.length && <div className="horse-empty-inline">{app.data.plannedHorses.length ? '該当する計画馬はありません' : '計画馬はまだありません'} <a href="#/plans">配合計画へ</a></div>}
  </div>;
}

import { useMemo, useState } from 'react';
import { hasBox, imageUrl, type CardScreen, type ImportJob, type MasterScreen, type PedigreeScreen } from '../api';
import { horseNameKey, newAncestorId } from '../core/horse-identity';
import { ancestorOptions } from './ancestor-options';
import { useApp, sireOptions, damOptions } from './app-context';
import { HorseSelect } from './HorseSelect';
import type { OwnedHorse } from '../core/types';
import { PEDIGREE_SLOTS, RACE_ABILITY_FIELDS, RACE_TRAIT_FIELDS, applyCardReading, cardMatchCandidates, cardPatchDiff, inferredGameYear, pedigreeMatchCandidates, type MatchCandidate } from '../core/owned-horse';
import { addMasterJob, applyCardJob, applyMasterJob, applyPedigreeJob, matchName, toCardReading, type AppliedInfo } from './import-apply';
import { applyMasterFields, compareAncestorFactors, homebredBlockReason, masterDiffRows, masterFromReading, prepareReadingAncestors, type MasterFieldKey } from '../core/master-edits';
import { BreedingResult } from './BreedingResult';
import { store } from '../store/userdata';

const STATUS: Record<ImportJob['status'], string> = { queued: '待機中', running: '解析中', done: '完了', failed: '失敗' };
const time = (iso: string) => new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

/** 1件のジョブ。解析が終わったら画面の種類に応じて反映先を選び、差分を確認して登録・更新する */
export function ImportJobCard({ job, onDismiss, onRetry, onApplied }: { job: ImportJob; onDismiss: () => void; onRetry: () => void; onApplied?: (info: AppliedInfo) => void }) {
  const r = job.result;
  // 反映後のジョブの後始末（破棄と次への移動）は呼び出し側が onApplied で行う
  const done = (h: OwnedHorse) => onApplied?.({ name: h.name, href: `#/horses?id=${encodeURIComponent(h.id)}` });
  return <div className={`card import-job status-${job.status}`}>
    <div className="import-job-head">
      <img className="import-job-photo" src={imageUrl(job.imageId)} alt="" loading="lazy" />
      <span className={`pill job-${job.status}`}>{STATUS[job.status]}</span>
      <span className="small muted">{r ? r.screen_type : '写真'} · {time(job.createdAt)}{job.model ? ` · ${job.model}` : ''}</span>
      <span className="import-job-actions">
        {job.status === 'failed' && <button type="button" onClick={onRetry}>再試行</button>}
        <button type="button" onClick={onDismiss}>破棄</button>
      </span>
    </div>
    {job.status === 'failed' && <div className="error">{job.error}</div>}
    {job.status === 'done' && r && (r.screen_type === '育成馬' || r.screen_type === '入厩馬') && <CardResult job={job} reading={r} onDone={done} />}
    {job.status === 'done' && r && r.screen_type === '血統' && <PedigreeResult job={job} reading={r} onDone={(info) => onApplied?.(info)} />}
    {job.status === 'done' && r && (r.screen_type === '種牡馬' || r.screen_type === '繁殖牝馬') && <MasterResult reading={r} onDone={(info) => onApplied?.(info)} />}
    {job.status === 'done' && r && r.screen_type === '種付け' && <BreedingResult job={job} reading={r} onDone={(info) => onApplied?.(info)} />}
    {job.status === 'done' && r && r.screen_type === 'その他' && <p className="small muted" style={{ marginTop: 8 }}>{job.scope.join('・')}のどの画面でもないと判別されました。{r.notes && `理由: ${r.notes}`}</p>}
  </div>;
}

/** 反映先の選択。候補（理由付き）と、その他の所有馬からの選択。新規登録を許すかは呼び出し側で決める */
function TargetPicker({ name, value, onChange, candidates, allowNew, newHint, fixed }: { name: string; value: string; onChange: (id: string) => void; candidates: MatchCandidate[]; allowNew: boolean; newHint: string; fixed?: OwnedHorse }) {
  const app = useApp();
  if (fixed) return <p className="small import-target-fixed">反映先: <b>{fixed.name}</b>（{fixed.category}）</p>;
  const top = candidates.slice(0, 4);
  return <fieldset className="import-target">
    <legend>反映先</legend>
    {allowNew && <label className={value === '' ? 'selected' : ''}><input type="radio" name={name} checked={value === ''} onChange={() => onChange('')} /><span><b>新しい所有馬として登録</b><small>{newHint}</small></span></label>}
    {top.map((c) => <label key={c.horse.id} className={value === c.horse.id ? 'selected' : ''}><input type="radio" name={name} checked={value === c.horse.id} onChange={() => onChange(c.horse.id)} /><span><b>{c.horse.name}</b><small>{c.horse.category} · {c.reasons.join('・')}</small></span></label>)}
    {!top.length && !allowNew && <p className="sheet-card-empty">候補がありません。下の一覧から選んでください。</p>}
    <label className="import-target-other">その他の所有馬
      <select value={top.some((c) => c.horse.id === value) ? '' : value} onChange={(e) => onChange(e.target.value)}>
        <option value="">選択…</option>
        {[...app.data.horses].filter((h) => !top.some((c) => c.horse.id === h.id)).sort((a, b) => a.name.localeCompare(b.name, 'ja')).map((h) => <option key={h.id} value={h.id}>{h.name}（{h.category}）</option>)}
      </select>
    </label>
  </fieldset>;
}

function CardResult({ job, reading, onDone }: { job: ImportJob; reading: CardScreen; onDone: (horse: OwnedHorse) => void }) {
  const app = useApp();
  const card = useMemo(() => toCardReading(reading), [reading]);
  const fixed = job.targetHorseId ? app.data.horses.find((h) => h.id === job.targetHorseId) : undefined;
  const candidates = useMemo(() => cardMatchCandidates(card, app.data.horses, (h) => (h.damKey ? app.resolver.label(h.damKey) : '')), [card, app]);
  const [targetId, setTargetId] = useState(fixed?.id ?? (candidates[0]?.exact || (candidates[0]?.score ?? 0) >= 60 ? candidates[0].horse.id : ''));
  const [savePortrait, setSavePortrait] = useState(hasBox(reading.card.horse_box));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const target = app.data.horses.find((h) => h.id === targetId);
  const gameYear = app.data.settings.gameYear;
  const patch = applyCardReading(target, card, new Date().toISOString(), gameYear);
  const diff = cardPatchDiff(target, patch);
  const inferred = inferredGameYear(card, patch);
  const yearAdvance = inferred !== undefined && inferred > (gameYear ?? -Infinity) ? inferred : undefined;
  const traitValues = Object.values(reading.card.traits);
  const apply = async () => {
    setBusy(true); setErr('');
    try { onDone(await applyCardJob(job, reading, target, savePortrait)); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const c = reading.card;
  return <div className="import-card">
    <div className="import-card-title"><b>{c.name || '（馬名なし）'}</b>{c.class && <span className="pill rank">{c.class}</span>}<span>{c.sex}{c.age >= 0 ? c.age : ''}</span>{c.color && <span>{c.color}</span>}{c.distance && c.distance !== '-' && <span>{c.distance}</span>}</div>
    <div className="import-card-marks">{RACE_ABILITY_FIELDS.map(({ key, label }) => <div key={key} className={c.abilities[key] !== '-' ? 'known' : ''}><span>{label}</span><b>{c.abilities[key] || '-'}</b></div>)}</div>
    <div className="import-card-marks traits">{RACE_TRAIT_FIELDS.map(({ key, label }, i) => <div key={key} className={traitValues[i] !== '-' ? 'known' : ''}><span>{label}</span><b>{traitValues[i] || '-'}</b></div>)}</div>
    {(c.record || c.earnings_total || c.stable) && <div className="small">{[c.record, c.earnings_current && `収得 ${c.earnings_current}`, c.earnings_total && `総賞金 ${c.earnings_total}`, c.stable].filter(Boolean).join(' · ')}</div>}
    {reading.notes && <div className="small muted">読み取りメモ: {reading.notes}</div>}
    <TargetPicker name={`${job.id}-target`} value={targetId} onChange={setTargetId} candidates={candidates} allowNew newHint="登録後に血統表から父母を設定" fixed={fixed} />
    {target && <p className="small muted">{target.name} の続きとして重ねます。{patch.name !== target.name ? `名前は「${patch.name}」に変わります。` : ''}「-」の項目は今の値を保ちます。</p>}
    {diff.length ? <table className="import-diff"><tbody>{diff.map((d) => <tr key={d.label}><th>{d.label}</th><td className="muted">{d.before}</td><td>→</td><td>{d.after}</td></tr>)}{yearAdvance !== undefined && <tr><th>ゲーム内の年</th><td className="muted">{gameYear !== undefined ? `${gameYear}年` : '未設定'}</td><td>→</td><td>{yearAdvance}年（{c.name}が{c.age}歳のため）</td></tr>}</tbody></table> : <p className="small muted">変わる項目はありません。</p>}
    <div className="import-apply">
      {hasBox(reading.card.horse_box) && <label className="small"><input type="checkbox" checked={savePortrait} onChange={(e) => setSavePortrait(e.target.checked)} />馬の画像を切り出して保存</label>}
      <button type="button" className="primary" disabled={busy} onClick={() => void apply()}>{busy ? '反映中…' : target ? `${target.name} に反映` : '所有馬として登録'}</button>
      {err && <span className="error">{err}</span>}
    </div>
  </div>;
}

function PedigreeResult({ job, reading, onDone }: { job: ImportJob; reading: PedigreeScreen; onDone: (info: AppliedInfo) => void }) {
  const app = useApp();
  const p = reading.pedigree;
  const sOpts = useMemo(() => sireOptions(app, { includePlanned: false }), [app]);
  const dOpts = useMemo(() => damOptions(app, { includePlanned: false }), [app]);
  const fixed = job.targetHorseId ? app.data.horses.find((h) => h.id === job.targetHorseId) : undefined;
  const candidates = useMemo(() => pedigreeMatchCandidates(p, app.data.horses, (key) => app.resolver.label(key)), [p, app]);
  const [targetId, setTargetId] = useState(fixed?.id ?? ((candidates[0]?.score ?? 0) >= 50 ? candidates[0].horse.id : ''));
  const [sireKey, setSireKey] = useState(() => matchName(p.sire, sOpts));
  const [damKey, setDamKey] = useState(() => matchName(p.dam, dOpts));
  const [err, setErr] = useState('');
  const target = app.data.horses.find((h) => h.id === targetId);
  // 写っている祖先の因子を祖先マスターと突き合わせ、新規・相違だけを既定で反映する
  const [factorIds, setFactorIds] = useState<Record<string, string>>({});
  const factorRows = useMemo(() => compareAncestorFactors(p.ancestors ?? [], app.master, factorIds), [p.ancestors, app.master, factorIds]);
  const [factorSkip, setFactorSkip] = useState<Set<string>>(() => new Set());
  const factorTargets = factorRows.filter((r) => r.status !== '一致' && r.status !== '要選択' && !factorSkip.has(r.name));
  const saveFactors = () => { if (factorTargets.length) store.saveAncestorEdits(factorTargets.map((r) => ({ id: r.id ?? newAncestorId(), name: r.id ? app.resolver.label(r.id) : r.name, system: r.id ? app.ctx.ancestors.get(r.id)?.system ?? null : null, sex: r.id ? app.ctx.ancestors.get(r.id)?.sex ?? null : null, effects: r.factors }))); };
  const apply = () => {
    if (!target) {
      if (!factorTargets.length) { setErr('反映先の所有馬を選んでください（血統画面には馬名がないため、新規登録はできません）'); return; }
      saveFactors(); onDone({ name: `祖先の因子 ${factorTargets.length}頭`, href: '#/data?tab=ancestors' }); return;
    }
    if (!sireKey && !damKey) { setErr('父か母を選んでください'); return; }
    try { saveFactors(); const h = applyPedigreeJob(target, sireKey, damKey); onDone({ name: h.name, href: `#/horses?id=${encodeURIComponent(h.id)}` }); } catch (e) { setErr((e as Error).message); }
  };
  return <div className="import-card">
    <dl className="import-pedigree-read">{PEDIGREE_SLOTS.map(({ key, label }) => <div key={key} className={key === 'sire' || key === 'dam' ? 'main' : ''}><dt>{label}</dt><dd>{(p[key] as string) || <span className="muted">—</span>}</dd></div>)}</dl>
    {p.crosses.length > 0 && <div className="small muted">クロス: {p.crosses.map((x) => `${x.name} ${x.generations} ${x.percent}`).join(' / ')}</div>}
    {reading.notes && <div className="small muted">読み取りメモ: {reading.notes}</div>}
    <TargetPicker name={`${job.id}-target`} value={targetId} onChange={setTargetId} candidates={candidates} allowNew={false} newHint="" fixed={fixed} />
    <div className="grid2">
      <label className="field">父として登録{p.sire && !sireKey && <span className="error"> 「{p.sire}」は候補にありません</span>}<HorseSelect value={sireKey} onChange={setSireKey} options={sOpts} aria-label="父" /></label>
      <label className="field">母として登録{p.dam && !damKey && <span className="error"> 「{p.dam}」は候補にありません</span>}<HorseSelect value={damKey} onChange={setDamKey} options={dOpts} aria-label="母" /></label>
    </div>
    {target && (target.sireKey || target.damKey) && <p className="small muted">{target.name} の現在の血統（{target.sireKey ? app.resolver.label(target.sireKey) : '未登録'} × {target.damKey ? app.resolver.label(target.damKey) : '未登録'}）を置き換えます。</p>}
    {factorRows.length > 0 && <details className="import-factors" open={factorRows.some((r) => r.status !== '一致')}>
      <summary>祖先の因子（{factorRows.length}頭を読み取り、新規 {factorRows.filter((r) => r.status === '新規').length}・相違 {factorRows.filter((r) => r.status === '相違').length}・一致 {factorRows.filter((r) => r.status === '一致').length}）</summary>
      <p className="small muted">新規と相違の祖先は祖先マスターに反映する（チェックを外すと反映しない）。一致は変更なし。</p>
      <table className="import-diff"><tbody>{factorRows.map((r) => <tr key={r.name} className={r.status === '一致' ? 'muted' : factorSkip.has(r.name) ? 'excluded' : ''}>
        <td>{r.status !== '一致' && r.status !== '要選択' && <input type="checkbox" aria-label={`${r.name} の因子を反映する`} checked={!factorSkip.has(r.name)} onChange={(e) => setFactorSkip((s) => { const n = new Set(s); if (e.target.checked) n.delete(r.name); else n.add(r.name); return n; })} />}</td>
        <th>{r.name}{(r.status === '要選択' || factorIds[r.name]) && <HorseSelect aria-label={`${r.name} の個体`} value={factorIds[r.name] ?? ''} onChange={id => setFactorIds({ ...factorIds, [r.name]: id })} options={ancestorOptions(app.master).filter(o => horseNameKey(o.name) === horseNameKey(r.name))} />}</th><td className="muted">{r.known ? (r.known.length ? r.known.join('・') : '因子なし') : r.id ? '因子未確認' : '未登録'}</td><td>→</td><td>{r.factors.length ? r.factors.join('・') : '因子なし'}<span className="small muted"> {r.status}</span></td></tr>)}</tbody></table>
    </details>}
    <div className="import-apply">
      <button type="button" className="primary" onClick={apply}>{target ? `${target.name} の血統として登録${factorTargets.length ? `（祖先の因子 ${factorTargets.length}頭も反映）` : ''}` : factorTargets.length ? `祖先の因子 ${factorTargets.length}頭だけ反映` : '血統として登録'}</button>
      {err && <span className="error">{err}</span>}
    </div>
  </div>;
}

/** 種牡馬・繁殖牝馬の画面をマスターデータに登録・更新する。自家生産馬は拒否する */
function MasterResult({ reading, onDone }: { reading: MasterScreen; onDone: (info: AppliedInfo) => void }) {
  const app = useApp();
  const kind = reading.screen_type === '種牡馬' ? 'stallion' : 'broodmare';
  const m = reading.master;
  const block = homebredBlockReason(m, app.data.horses, app.data.plannedHorses);
  const list = kind === 'stallion' ? app.master.stallions : app.master.broodmares;
  const norm = (s: string) => s.replace(/[\s・()（）]/g, '');
  const candidates = list.filter(h => norm(h.name) === norm(m.name));
  const [targetId, setTargetId] = useState('');
  const existing = candidates.length === 1 ? candidates[0] : candidates.find(h => h.id === targetId);
  const [parentIds, setParentIds] = useState<Partial<Record<'sire' | 'dam' | 'dam_sire', string>>>({});
  const prepared = useMemo(() => prepareReadingAncestors(app.master, m, parentIds), [app.master, m, parentIds]);
  const next = masterFromReading(kind, m, existing ?? null, prepared.master, app.ctx.ancestors, prepared.parentIds);
  const identityLabel = (id: string) => prepared.additions.find(a => a.id === id)?.name ?? app.resolver.label(id);
  const needsSelection = candidates.length > 1 && !existing || prepared.ambiguous.length > 0;
  const rows = masterDiffRows(existing ?? null, next, app.master.meta.bigSystems, identityLabel);
  // 更新のときは項目ごとに反映するか選べる（既定は全部）
  const [excluded, setExcluded] = useState<Set<MasterFieldKey>>(() => new Set());
  const selected = rows.map((r) => r.key).filter((k) => !excluded.has(k));
  const [err, setErr] = useState('');
  const apply = () => {
    if (needsSelection) { setErr('同名馬の候補から対象の馬を選んでください'); return; }
    try { onDone(existing ? applyMasterJob(existing, applyMasterFields(existing, next, selected), prepared.additions) : addMasterJob(next, prepared.additions)); }
    catch (e) { setErr((e as Error).message); }
  };
  const toggle = (key: MasterFieldKey) => setExcluded((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const label = kind === 'stallion' ? '種牡馬' : '繁殖牝馬';
  return <div className="import-card">
    <div className="import-card-title"><b>{m.name || '（馬名なし）'}</b><span className={`pill cat-${label}`}>{label}</span><span>{m.sex}{m.age >= 0 ? m.age : ''}</span>{m.color && <span>{m.color}</span>}{m.big_system && <span>{m.big_system}系 / {m.small_system}</span>}</div>
    <dl className="import-pedigree-read"><div className="main"><dt>父</dt><dd>{m.sire || '—'}</dd></div><div className="main"><dt>母</dt><dd>{m.dam || '—'}</dd></div><div><dt>母父</dt><dd>{m.dam_sire || '—'}</dd></div><div><dt>{kind === 'stallion' ? '種付料' : '販売価格'}</dt><dd>{(kind === 'stallion' ? m.fee : m.price) || '—'}</dd></div></dl>
    {kind === 'stallion' && <div className="small">{[m.distance, m.growth && `成長 ${m.growth}`, m.dirt && `ダート ${m.dirt}`, m.kenko && `体質 ${m.kenko}`, m.kisyo && `気性 ${m.kisyo}`, m.jisseki && `実績 ${m.jisseki}`, m.konjo && `底力 ${m.konjo}`, m.antei && `安定 ${m.antei}`].filter(Boolean).join(' · ')}</div>}
    {reading.notes && <div className="small muted">読み取りメモ: {reading.notes}</div>}
    {candidates.length > 1 && <label className="field">更新する馬<HorseSelect value={targetId} onChange={setTargetId} options={ancestorOptions(app.master).filter(o => candidates.some(h => h.id === o.key))} /></label>}
    {(['sire', 'dam', 'dam_sire'] as const).filter(field => prepared.ambiguous.includes(field) || parentIds[field]).map(field => <label className="field" key={field}>{field === 'sire' ? '父' : field === 'dam' ? '母' : '母父'}「{m[field]}」の候補<HorseSelect value={parentIds[field] ?? ''} onChange={id => setParentIds({ ...parentIds, [field]: id })} options={ancestorOptions(app.master).filter(o => norm(o.name) === norm(m[field]))} /></label>)}
    {block ? <div className="error">{block}</div> : <>
      <p className="small">{existing ? <><b>{existing.name}</b> を更新します（読めた項目だけを重ねます）。</> : <>新しい{label}として登録します。</>}</p>
      {rows.length ? <>
        {existing && <div className="import-fields-head"><span className="small muted">更新する項目を選ぶ</span><button type="button" onClick={() => setExcluded(new Set())}>すべて</button><button type="button" onClick={() => setExcluded(new Set(rows.map((r) => r.key)))}>すべて外す</button></div>}
        <table className="import-diff"><tbody>{rows.map((d) => <tr key={d.key} className={excluded.has(d.key) ? 'excluded' : ''}>
          {existing && <td><input type="checkbox" aria-label={`${d.label}を更新する`} checked={!excluded.has(d.key)} onChange={() => toggle(d.key)} /></td>}
          <th>{d.label}</th><td className="muted">{d.before}</td><td>→</td><td>{d.after}</td></tr>)}</tbody></table>
      </> : <p className="small muted">変わる項目はありません。</p>}
      <div className="import-apply"><button type="button" className="primary" disabled={needsSelection || (!!existing && rows.length > 0 && selected.length === 0)} onClick={apply}>{existing ? `${existing.name} を更新${rows.length ? `（${selected.length}項目）` : ''}` : `${label}として追加`}</button>{err && <span className="error">{err}</span>}</div>
    </>}
  </div>;
}

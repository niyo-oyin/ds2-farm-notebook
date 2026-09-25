// 読み取り結果の反映。確認ダイアログ（ImportJobCard）と、設定による自動反映（ImportTray）で共有する。
import { PORTRAIT_MAX_SIDE, fetchImage, hasBox, imageToBase64, uploadImage, type CardScreen, type ImportJob, type PedigreeScreen } from '../api';
import type { AncestorInfo, MasterHorse, OwnedHorse } from '../core/types';
import { applyMasterEdits, compareAncestorFactors, diffAgainstBase, homebredBlockReason, prepareReadingAncestors, masterFromReading, type NicksProposal } from '../core/master-edits';
import { newAncestorId } from '../core/horse-identity';
import { baseMaster } from '../data/base-master';
import { applyCardReading, cardMatchCandidates, inferredGameYear, parseFoalName, pedigreeMatchCandidates, type CardReading } from '../core/owned-horse';
import { getUserData, store } from '../store/userdata';
import { checkWorkspace, workspaceGeneration } from '../store/workspace';
import { sireOptions, damOptions, type AppCtx, type HorseOption } from './app-context';

export const toCardReading = (r: CardScreen): CardReading => ({ ...r.card, screen_type: r.screen_type });
/** 反映後にトレイへ知らせる内容（名前と開くリンク） */
export interface AppliedInfo { name: string; href: string }

/** 読み取った名前を父母の候補に照合する（完全一致 → 空白・記号を除いた一致） */
export function matchName(name: string, options: HorseOption[]): string {
  const matches = matchingNames(name, options);
  return matches.length === 1 ? matches[0].key : '';
}

function matchingNames(name: string, options: HorseOption[]): HorseOption[] {
  if (!name) return [];
  const norm = (s: string) => s.replace(/[\s・()（）]/g, '').toLowerCase();
  const n = norm(name);
  const exact = options.filter(o => o.name === name);
  return exact.length ? exact : options.filter(o => norm(o.name) === n);
}

/** 仮名から未設定の母を補完する。登録済みの血統は変更しない。 */
export function inferCardDam(app: Pick<AppCtx, 'master' | 'data'>, name: string, target?: OwnedHorse) {
  if (target?.damKey || target?.masterKey) return null;
  const foal = parseFoalName(name);
  if (!foal) return null;
  const options = damOptions(app, { includePlanned: false }).filter(o => o.key !== target?.id);
  const matches = matchingNames(foal.damName, options);
  return { name: foal.damName, key: matches.length === 1 ? matches[0].key : '', ambiguous: matches.length > 1 };
}

const applyingCards = new Map<string, Promise<OwnedHorse>>();
/** 同じ取り込みの手動・自動反映は処理を共有する。反映済みなら保存先を返す。 */
export function applyCardJob(job: ImportJob, reading: CardScreen, target: OwnedHorse | undefined, savePortrait: boolean): Promise<OwnedHorse> {
  const generation = workspaceGeneration();
  const key = `${generation}:${job.id}`;
  const pending = applyingCards.get(key);
  if (pending) return pending;
  const applied = getUserData().horses.find(h => h.observations?.some(o => o.importJobId === job.id));
  if (applied) return Promise.resolve(applied);
  const run = saveCardJob(job, reading, target?.id, savePortrait, generation).finally(() => { applyingCards.delete(key); });
  applyingCards.set(key, run);
  return run;
}

/** カードを所有馬に反映し、年齢と生年から推定した年が進んでいれば設定も更新する。 */
async function saveCardJob(job: ImportJob, reading: CardScreen, targetId: string | undefined, savePortrait: boolean, generation: number): Promise<OwnedHorse> {
  const card = toCardReading(reading);
  let imageId: string | undefined;
  // 切り出しは付加情報なので、写真の取得や保存に失敗しても反映は続ける
  if (savePortrait && hasBox(reading.card.horse_box)) {
    try { imageId = await uploadImage(await imageToBase64(await fetchImage(job.imageId), PORTRAIT_MAX_SIDE, reading.card.horse_box, 0.04, true)); }
    catch (e) { console.warn(`馬の画像を保存できませんでした: ${(e as Error).message}`); }
  }
  checkWorkspace(generation);
  const data = getUserData();
  const applied = data.horses.find(h => h.observations?.some(o => o.importJobId === job.id));
  if (applied) return applied;
  const target = targetId ? data.horses.find(h => h.id === targetId) : undefined;
  if (targetId && !target) throw new Error('反映先の所有馬が見つかりません');
  const gameYear = data.settings.gameYear;
  const patch = applyCardReading(target, card, new Date().toISOString(), gameYear);
  const master = applyMasterEdits(baseMaster, data.masterEdits, data.ancestorEdits, data.kottaEdits, data.nicksEdits);
  const inferredDam = inferCardDam({ master, data }, card.name, target);
  const parents = { sireKey: target?.sireKey ?? '', damKey: target?.damKey || inferredDam?.key || '' };
  patch.observations = patch.observations?.map((o, i, all) => i === all.length - 1 ? { ...o, importJobId: job.id } : o);
  if (!patch.name.trim()) throw new Error('馬名が読み取れていません');
  let saved: OwnedHorse;
  if (target) { store.updateHorse(target.id, { ...patch, ...parents, ...(imageId ? { imageId } : {}) }); saved = { ...target, ...patch, ...parents, ...(imageId ? { imageId } : {}) }; }
  // 複数タブ・端末で同じジョブを同時反映しても、同期先では同じ馬になる。
  else saved = store.addHorse({ kind: 'owned', ...patch, id: `u:import:${job.id}`, ...parents, imageId });
  const inferred = inferredGameYear(card, patch);
  if (inferred !== undefined && inferred > (gameYear ?? -Infinity)) store.setSettings({ gameYear: inferred });
  return saved;
}

/** 血統画面で読んだ祖先の因子のうち、祖先マスターに未登録の馬だけを登録する（自動反映用。既存の値は書き換えない） */
export function saveNewAncestorFactors(app: AppCtx, reading: PedigreeScreen) {
  const rows = compareAncestorFactors(reading.pedigree.ancestors ?? [], app.master).filter((r) => r.status === '新規');
  if (rows.length) store.saveAncestorEdits(rows.map((r) => ({ id: r.id ?? newAncestorId(), name: r.id ? app.resolver.label(r.id) : r.name, system: r.id ? app.ctx.ancestors.get(r.id)?.system ?? null : null, sex: r.id ? app.ctx.ancestors.get(r.id)?.sex ?? null : null, effects: r.factors })));
}

/** 血統画面の父母を所有馬に登録する */
export function applyPedigreeJob(target: OwnedHorse, sireKey: string, damKey: string): OwnedHorse {
  const patch = { sireKey, damKey, observations: [...(target.observations ?? []), { at: new Date().toISOString(), screen: '血統', source: 'photo' as const }] };
  store.updateHorse(target.id, patch);
  return { ...target, ...patch };
}

/** 種付け画面から起こしたニックスの提案を表に記録する（不整合は除く）。備考に画面の情報を残す */
export function applyNicksProposals(proposals: NicksProposal[], mareName: string): number {
  const rows = proposals.filter((p) => p.status !== '不整合');
  const date = new Date().toISOString().slice(0, 10);
  for (const p of rows) store.saveNicksEdit({ sire: p.sire, dam: p.dam, level: p.level, source: '実機確認', note: `種付け画面 ${date}（母 ${mareName}）: ${p.stallions.slice(0, 3).join('、')}${p.stallions.length > 3 ? ` 他${p.stallions.length - 3}頭` : ''}` });
  return rows.length;
}

export type AutoDecision =
  | { kind: 'card'; reading: CardScreen; target: OwnedHorse | undefined }
  | { kind: 'pedigree'; reading: PedigreeScreen; target: OwnedHorse; sireKey: string; damKey: string }
  | { kind: 'master'; existing: MasterHorse | null; next: MasterHorse; additions: AncestorInfo[] };
/**
 * 反映先が確実なときだけ自動反映の判断を返す。迷いがあれば null（手動）。
 * カード: 反映先固定、馬名一致なら更新。候補が1頭もなければ新規登録。
 * 血統: 反映先固定、または仮名の母名が一致する候補が1頭だけで、父母とも候補に見つかるとき。
 */
export function autoDecision(app: AppCtx, job: ImportJob): AutoDecision | null {
  const r = job.result;
  if (!r || job.status !== 'done') return null;
  const { importAutoApply, importAutoMasterUpdate, importAutoMasterAdd } = app.data.settings;
  const fixed = job.targetHorseId ? app.data.horses.find((h) => h.id === job.targetHorseId) : undefined;
  if (job.targetHorseId && !fixed) return null;
  if (r.screen_type === '育成馬' || r.screen_type === '入厩馬') {
    if (!r.card.name.trim()) return null;
    const candidates = cardMatchCandidates(toCardReading(r), app.data.horses, (h) => (h.damKey ? app.resolver.label(h.damKey) : ''));
    const target = fixed ?? (candidates[0]?.exact ? candidates[0].horse : undefined);
    if (!target && candidates.length) return null;
    const dam = inferCardDam(app, r.card.name, target);
    if (dam && !dam.key) return null;
    return { kind: 'card', reading: r, target };
  }
  // マスターの馬の自動更新・新規追加は、それぞれの設定が有効な場合に行う。
  if (r.screen_type === '種牡馬' || r.screen_type === '繁殖牝馬') {
    if (homebredBlockReason(r.master, app.data.horses, app.data.plannedHorses)) return null;
    const kind = r.screen_type === '種牡馬' ? 'stallion' : 'broodmare';
    const norm = (s: string) => s.replace(/[\s・()（）]/g, '');
    const matches = (kind === 'stallion' ? app.master.stallions : app.master.broodmares).filter(h => norm(h.name) === norm(r.master.name));
    if (matches.length > 1) return null;
    const existing = matches[0] ?? null;
    const prepared = prepareReadingAncestors(app.master, r.master);
    if (prepared.ambiguous.length || !(existing ? importAutoMasterUpdate : importAutoMasterAdd)) return null;
    return { kind: 'master', existing, next: masterFromReading(kind, r.master, existing, prepared.master, prepared.parentIds), additions: prepared.additions };
  }
  if (!importAutoApply) return null;
  if (r.screen_type === '血統') {
    const sireKey = matchName(r.pedigree.sire, sireOptions(app, { includePlanned: false }));
    const damKey = matchName(r.pedigree.dam, damOptions(app, { includePlanned: false }));
    if (!sireKey || !damKey) return null;
    if (fixed) return { kind: 'pedigree', reading: r, target: fixed, sireKey, damKey };
    const byFoalName = pedigreeMatchCandidates(r.pedigree, app.data.horses, (key) => app.resolver.label(key)).filter((c) => c.reasons.includes('仮名の母名が一致'));
    if (byFoalName.length === 1) return { kind: 'pedigree', reading: r, target: byFoalName[0].horse, sireKey, damKey };
    return null;
  }
  return null;
}

/** 種牡馬・繁殖牝馬の読み取りをマスターデータに新しい馬として追加する */
export function addMasterJob(next: MasterHorse, additions: AncestorInfo[] = []): AppliedInfo {
  if (additions.length) store.saveAncestorEdits(additions);
  const { id: _id, kind: _kind, ...data } = next;
  store.saveMasterEdit({ id: next.id, kind: next.kind, added: true, data });
  return { name: next.name, href: `#/data?tab=${next.kind === 'stallion' ? 'stallions' : 'broodmares'}` };
}
/** 種牡馬・繁殖牝馬の読み取りをマスターデータに反映する（既存馬の更新） */
export function applyMasterJob(existing: MasterHorse, next: MasterHorse, additions: AncestorInfo[] = []): AppliedInfo {
  if (additions.length) store.saveAncestorEdits(additions.filter(a => next.ancestors.includes(a.id)));
  const base = (existing.kind === 'stallion' ? baseMaster.stallions : baseMaster.broodmares).find(h => h.id === existing.id);
  if (!base) {
    const { id: _id, kind: _kind, ...data } = next;
    store.saveMasterEdit({ id: existing.id, kind: existing.kind, added: true, data });
  } else {
    const data = diffAgainstBase(base, next);
    if (Object.keys(data).length) store.saveMasterEdit({ id: existing.id, kind: existing.kind, added: false, data });
  }
  return { name: next.name, href: `#/data?tab=${existing.kind === 'stallion' ? 'stallions' : 'broodmares'}` };
}

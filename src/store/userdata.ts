// ユーザーデータ（所有馬・計画馬・配合計画・設定）。ブラウザ内保存とファイル書き出し/読み込み。
import { useSyncExternalStore } from 'react';
import type { HorseKey, OwnedHorse, PlannedHorse } from '../core/types';
import { validateOwnedDetails } from '../core/owned-horse';
import { applyMasterEdits, pairKey, type AncestorEdit, type KottaEdit, type MasterEdit, type NicksEdit } from '../core/master-edits';
import type { SearchGoal, SearchRequest, SearchResult } from '../core/search';
import { EMPTY_RACE_FIELDS, validateRace, type RaceEdit } from '../core/races';
import { baseMaster } from '../data/base-master';
import { baseRaces } from '../data/races';
import { acceptRecords, onSyncConflict, pushDiff, pull, pushAll, toRecords } from './sync';
import { USER_DATA_KEY, workspaceGeneration } from './workspace';
import { resetImportJobs } from './jobs';
import { resetSearchJobs } from './search-jobs';
import { api } from '../api';
import type { RecordsResponse, SaveSlot } from '../shared/save-data';
import { allUserHorses, emptyUserData, normalizeUserData, setHorsePlanLinks, validateOwnedParents, type UserData, type Plan, type PlanStep, type Settings } from './model';
export type { Plan, PlanStep, Settings, UserData } from './model';
export { allUserHorses, horsePlanLinks, plannedProgress, realizedProgress } from './model';

let state: UserData = load();
const listeners = new Set<() => void>();
let appliedGeneration = workspaceGeneration();
export function useWorkspaceGeneration() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => appliedGeneration);
}

function load(): UserData {
  try {
    const raw = localStorage.getItem(USER_DATA_KEY);
    if (!raw) return emptyUserData();
    return normalizeUserData(JSON.parse(raw));
  } catch { return emptyUserData(); }
}
// 状態と世代を1回で保存する。他のタブの保存と混ざっても、世代とデータが食い違わない。
function persist() { localStorage.setItem(USER_DATA_KEY, JSON.stringify({ ...state, syncGeneration: appliedGeneration })); }
function set(next: UserData, sync = true) {
  const prev = state;
  state = next; persist(); listeners.forEach((l) => l());
  if (sync) pushDiff(prev, next);
}
function applyRemote(next: UserData) {
  if (appliedGeneration !== workspaceGeneration()) {
    appliedGeneration = workspaceGeneration();
    resetImportJobs();
    resetSearchJobs();
  }
  set(next, false);
}

/** クリック時点の端末の状態を丸ごと保存する。通常同期の未送信分も含まれる。 */
export async function saveSnapshot(slot: number, name: string, revision: string | null): Promise<SaveSlot> {
  return (await api<{ save: SaveSlot }>(`/api/saves/${slot}`, { method: 'PUT', body: JSON.stringify({ name, revision, generation: workspaceGeneration(), records: toRecords(state) }) })).save;
}
export async function loadSnapshot(save: SaveSlot) {
  const result = await api<RecordsResponse>(`/api/saves/${save.slot}/load`, { method: 'POST', body: JSON.stringify({ revision: save.revision, generation: workspaceGeneration() }) });
  const next = acceptRecords(state, result);
  if (next) applyRemote(next);
}

/** サーバ同期の開始: 初回は全件取得と未送信分の送信、その後は定期的に差分取得 */
let runSync: ((full: boolean) => Promise<void>) | null = null;
/** 今すぐ同期（取得と未送信分の送信） */
export async function syncNow() { if (runSync) { await runSync(false); pushAll(state); } }

export function startSync(intervalMs = 15000) {
  let pending: Promise<void> | null = null;
  const run = (full: boolean): Promise<void> => {
    if (pending) return pending;
    pending = (async () => {
      const next = await pull(() => state, full);
      if (next) applyRemote(next);
    })().finally(() => { pending = null; });
    return pending;
  };
  runSync = run;
  onSyncConflict(() => { void (pending ?? Promise.resolve()).then(() => run(true)); });
  void (async () => {
    await run(true);
    pushAll(state); // サーバ側が新しければ無視されるので安全
  })();
  const t = setInterval(() => void run(false), intervalMs);
  return () => { clearInterval(t); if (runSync === run) { runSync = null; onSyncConflict(() => {}); } };
}

export const uid = (p: string) => `${p}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const now = () => new Date().toISOString();

export function useUserData(): UserData {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}
export const getUserData = () => state;

type NewHorse<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };
type HorsePatch<T> = Partial<Omit<T, 'id' | 'kind' | 'createdAt' | 'updatedAt'>>;
function checkIdentity(patch: object) {
  if ('kind' in patch || 'id' in patch) throw new Error('所有馬と計画馬の区分・IDは変更できません');
  if ('masterKey' in patch) throw new Error('データの繁殖牝馬との対応は変更できません');
}
function removeHorse(id: string, planned: boolean): string | null {
  const ref = allUserHorses(state).find((h) => h.sireKey === id || h.damKey === id);
  if (ref) return `${ref.name} の親として参照されています`;
  const plan = state.plans.find((p) => p.startKey === id || p.steps.some((s) => s.sire === id || s.dam === id || s.foalId === id));
  if (plan) return `計画「${plan.name}」で使われています`;
  const t = now();
  set({ ...state,
    horses: planned ? state.horses : state.horses.filter((h) => h.id !== id),
    plannedHorses: state.plannedHorses.filter((h) => !planned || h.id !== id).map((h) => h.realizedIds.includes(id) ? { ...h, realizedIds: h.realizedIds.filter((r) => r !== id), updatedAt: t } : h),
  });
  return null;
}

export const store = {
  addHorse(h: NewHorse<OwnedHorse>, plannedIds: string[] = []): OwnedHorse {
    if (h.kind !== 'owned' || h.id?.startsWith('p:')) throw new Error('計画馬を所有馬として登録することはできません');
    const horse: OwnedHorse = { ...h, id: h.id ?? uid('u'), createdAt: now(), updatedAt: now() };
    if (allUserHorses(state).some((x) => x.id === horse.id)) throw new Error('同じIDの馬が登録済みです');
    if (horse.masterKey && state.horses.some((x) => x.masterKey === horse.masterKey)) throw new Error('この繁殖牝馬はすでに所有馬に登録されています');
    validateOwnedParents(state, horse);
    validateOwnedDetails(horse);
    set(setHorsePlanLinks({ ...state, horses: [...state.horses, horse] }, horse.id, plannedIds, now()));
    return horse;
  },
  updateHorse(id: string, patch: HorsePatch<OwnedHorse>, plannedIds?: string[]) {
    checkIdentity(patch);
    const old = state.horses.find((h) => h.id === id);
    if (!old) throw new Error('所有馬が見つかりません');
    const horse: OwnedHorse = { ...old, ...patch, updatedAt: now() };
    validateOwnedParents(state, horse);
    validateOwnedDetails(horse);
    let next = { ...state, horses: state.horses.map((h) => h.id === id ? horse : h) };
    if (plannedIds) next = setHorsePlanLinks(next, id, plannedIds, now());
    set(next);
  },
  addPlannedHorse(h: NewHorse<PlannedHorse>): PlannedHorse {
    if (h.kind !== 'planned' || h.id?.startsWith('u:')) throw new Error('計画馬の区分が不正です');
    const horse: PlannedHorse = { ...h, id: h.id ?? uid('p'), createdAt: now(), updatedAt: now() };
    if (allUserHorses(state).some((x) => x.id === horse.id)) throw new Error('同じIDの馬が登録済みです');
    set({ ...state, plannedHorses: [...state.plannedHorses, horse] });
    return horse;
  },
  updatePlannedHorse(id: string, patch: HorsePatch<PlannedHorse>) {
    checkIdentity(patch);
    if (!state.plannedHorses.some((h) => h.id === id)) throw new Error('計画馬が見つかりません');
    if (patch.realizedIds?.some((key) => !state.horses.some((h) => h.id === key))) throw new Error('紐付け先の所有馬が見つかりません');
    set({ ...state, plannedHorses: state.plannedHorses.map((h) => h.id === id ? { ...h, ...patch, updatedAt: now() } : h) });
  },
  linkPlannedHorse(foalId: string, horseId: string, linked: boolean) {
    const ids = state.plannedHorses.filter((h) => h.realizedIds.includes(horseId)).map((h) => h.id);
    store.updateHorse(horseId, {}, linked ? [...new Set([...ids, foalId])] : ids.filter((id) => id !== foalId));
  },
  deleteHorse(id: string): string | null {
    if (!state.horses.some((h) => h.id === id)) return '所有馬が見つかりません';
    return removeHorse(id, false);
  },
  deletePlannedHorse(id: string): string | null {
    if (!state.plannedHorses.some((h) => h.id === id)) return '計画馬が見つかりません';
    return removeHorse(id, true);
  },
  addPlan(p: Omit<Plan, 'id' | 'createdAt' | 'updatedAt'>): Plan {
    const plan: Plan = { ...p, id: uid('plan'), createdAt: now(), updatedAt: now() };
    set({ ...state, plans: [...state.plans, plan] });
    return plan;
  },
  updatePlan(id: string, patch: Partial<Plan>) {
    set({ ...state, plans: state.plans.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: now() } : p)) });
  },
  deletePlan(id: string) {
    const plan = state.plans.find((p) => p.id === id);
    if (!plan) return;
    const plans = state.plans.filter((p) => p.id !== id);
    // 実産駒との関係や、他の血統・計画に必要な仮想馬は残す。
    set({ ...state, plans, plannedHorses: dropPlannedHorses(state, id, new Set(plan.steps.map((s) => s.foalId)), plans) });
  },
  /** マスターの馬の修正・追加・非表示を保存する（同じIDは置き換え） */
  saveMasterEdit(edit: Omit<MasterEdit, 'updatedAt'>) {
    const next: MasterEdit = { ...edit, updatedAt: now() };
    set({ ...state, masterEdits: [...state.masterEdits.filter((e) => e.id !== edit.id), next] });
    return next;
  },
  /** 修正を取り消す（マスターの馬は元の値に戻る。追加した馬は消える） */
  deleteMasterEdit(id: string): string | null {
    const ref = allUserHorses(state).find((h) => h.sireKey === id || h.damKey === id);
    if (ref) return `${ref.name} の親として参照されています`;
    const plan = state.plans.find((p) => p.startKey === id || p.steps.some((s) => s.sire === id || s.dam === id));
    if (plan) return `計画「${plan.name}」で使われています`;
    set({ ...state, masterEdits: state.masterEdits.filter((e) => e.id !== id) });
    return null;
  },
  /** 祖先マスターの追加・修正を保存する（IDが同じなら置き換え）。複数まとめて保存できる */
  saveAncestorEdits(edits: Omit<AncestorEdit, 'updatedAt'>[]) {
    const t = now();
    const ids = new Set(edits.map((e) => e.id));
    set({ ...state, ancestorEdits: [...state.ancestorEdits.filter((e) => !ids.has(e.id)), ...edits.map((e) => ({ ...e, updatedAt: t }))] });
  },
  deleteAncestorEdit(id: string): string | null {
    if (!baseMaster.ancestors.some(a => a.id === id)) {
      const master = applyMasterEdits(baseMaster, state.masterEdits, state.ancestorEdits, state.kottaEdits);
      const ref = [...master.stallions, ...master.broodmares].find(h => h.ancestors.includes(id));
      if (ref) return `${ref.name} の血統に使われています`;
      if (master.kotta.some(pair => pair.includes(id))) return '凝ったペアに使われています';
    }
    set({ ...state, ancestorEdits: state.ancestorEdits.filter(e => e.id !== id) });
    return null;
  },
  /** 凝ったペア表の行を保存する（同じ父側ID・母側IDなら置き換え） */
  saveKottaEdit(edit: Omit<KottaEdit, 'updatedAt'>) {
    const k = pairKey(edit.sire, edit.dam);
    set({ ...state, kottaEdits: [...state.kottaEdits.filter((e) => pairKey(e.sire, e.dam) !== k), { ...edit, updatedAt: now() }] });
  },
  deleteKottaEdit(sire: string, dam: string) { const k = pairKey(sire, dam); set({ ...state, kottaEdits: state.kottaEdits.filter((e) => pairKey(e.sire, e.dam) !== k) }); },
  /** ニックス相性表の行を保存する（同じ父小系統・母小系統なら置き換え） */
  saveNicksEdit(edit: Omit<NicksEdit, 'updatedAt'>) {
    const k = pairKey(edit.sire, edit.dam);
    set({ ...state, nicksEdits: [...state.nicksEdits.filter((e) => pairKey(e.sire, e.dam) !== k), { ...edit, updatedAt: now() }] });
  },
  deleteNicksEdit(sire: string, dam: string) { const k = pairKey(sire, dam); set({ ...state, nicksEdits: state.nicksEdits.filter((e) => pairKey(e.sire, e.dam) !== k) }); },
  saveRaceEdit(edit: Omit<RaceEdit, 'updatedAt'>) {
    const base = baseRaces.find((race) => race.id === edit.id);
    if (!edit.added && !base) throw new Error('レースが見つかりません');
    validateRace({ ...EMPTY_RACE_FIELDS, ...base, ...edit.data });
    set({ ...state, raceEdits: [...state.raceEdits.filter((e) => e.id !== edit.id), { ...edit, updatedAt: now() }] });
  },
  deleteRaceEdit(id: string) { set({ ...state, raceEdits: state.raceEdits.filter((e) => e.id !== id) }); },
  setSettings(patch: Partial<Settings>) { set({ ...state, settings: { ...state.settings, ...patch, updatedAt: now() } }); },
  exportJson(): string { return JSON.stringify(state, null, 2); },
  importJson(text: string) {
    const d = normalizeUserData(JSON.parse(text));
    const t = now();
    set({ ...d, horses: d.horses.map((h) => ({ ...h, updatedAt: t })), plannedHorses: d.plannedHorses.map((h) => ({ ...h, updatedAt: t })), plans: d.plans.map((p) => ({ ...p, updatedAt: t })), masterEdits: d.masterEdits.map((e) => ({ ...e, updatedAt: t })), ancestorEdits: d.ancestorEdits.map((e) => ({ ...e, updatedAt: t })), kottaEdits: d.kottaEdits.map((e) => ({ ...e, updatedAt: t })), nicksEdits: d.nicksEdits.map((e) => ({ ...e, updatedAt: t })), raceEdits: d.raceEdits.map((e) => ({ ...e, updatedAt: t })), settings: { ...d.settings, updatedAt: t } });
  },
  reset() { const d = emptyUserData(); set({ ...d, settings: { ...d.settings, updatedAt: now() } }); },
};

type FinalRole = 'stallion' | 'broodmare' | 'none';

/** 経路の各配合に計画馬を作る。途中産駒は繁殖牝馬の予定、最後は指定した役割。offset は計画の中での通し番号の開始 */
function plannedSteps(planId: string, planName: string, startKey: HorseKey, result: SearchResult, finalRole: FinalRole, offset: number) {
  const steps: PlanStep[] = [];
  const created: PlannedHorse[] = [];
  let dam = startKey;
  result.steps.forEach((st, i) => {
    const last = i === result.steps.length - 1;
    const foal: PlannedHorse = {
      id: uid('p'), kind: 'planned', name: last ? `${planName} 最終産駒` : `${planName} ${offset + i + 1}代目`, sex: null,
      desiredSex: last ? (finalRole === 'stallion' ? 'M' : finalRole === 'broodmare' ? 'F' : undefined) : 'F',
      role: last ? (finalRole === 'none' ? undefined : finalRole) : 'broodmare',
      sireKey: st.sire, damKey: dam, status: '繁殖入り予定', planId,
      achieved: { born: false, sexOk: false, bred: false }, realizedIds: [], createdAt: now(), updatedAt: now(),
    };
    created.push(foal);
    steps.push({ sire: st.sire, dam, foalId: foal.id });
    dam = foal.id;
  });
  return { steps, created };
}

/** 計画から外す計画馬のうち、所有馬を紐付けた馬と、他の血統・計画で使う馬を残す（残す馬は計画から切り離す） */
function dropPlannedHorses(data: UserData, planId: string, foalIds: Set<string>, plans: Plan[], extra: PlannedHorse[] = []): PlannedHorse[] {
  const all = [...data.plannedHorses, ...extra];
  const keep = new Set([...data.horses, ...all].filter((h) => !foalIds.has(h.id)).flatMap((h) => [h.sireKey, h.damKey]));
  for (const p of plans) { keep.add(p.startKey); for (const s of p.steps) { keep.add(s.sire); keep.add(s.dam); keep.add(s.foalId); } }
  for (const h of all) if (h.realizedIds.length) keep.add(h.id);
  // 残す計画馬の祖先も残す。
  let changed = true;
  while (changed) { changed = false; for (const h of all) if (keep.has(h.id)) for (const parent of [h.sireKey, h.damKey]) if (parent && !keep.has(parent)) { keep.add(parent); changed = true; } }
  const t = now();
  return all.filter((h) => !foalIds.has(h.id) || keep.has(h.id)).map((h) => foalIds.has(h.id) && h.planId === planId ? { ...h, planId: undefined, updatedAt: t } : h);
}

/** 探索結果を計画として保存する。途中産駒は計画馬（繁殖牝馬予定）として登録する */
export function savePlanFromResult(
  name: string, startKey: HorseKey, result: SearchResult, goals: SearchGoal[], request: SearchRequest | undefined,
  rulesVersion: string, dataVersion: string, finalRole: FinalRole,
): Plan {
  const planId = uid('plan');
  const { steps, created } = plannedSteps(planId, name, startKey, result, finalRole, 0);
  const plan: Plan = { id: planId, name, createdAt: now(), updatedAt: now(), startKey, steps, goals, request, rulesVersion, dataVersion, memo: '' };
  set({ ...state, plannedHorses: [...state.plannedHorses, ...created], plans: [...state.plans, plan] });
  return plan;
}

/**
 * 計画の fromIndex 回目以降を、同じ母から探し直した経路に置き換える。
 * それより前の手順と、外した手順のうち所有馬を紐付けた計画馬は残す。
 */
export function replacePlanSteps(
  planId: string, fromIndex: number, result: SearchResult, goals: SearchGoal[], request: SearchRequest | undefined,
  rulesVersion: string, dataVersion: string, finalRole: FinalRole,
): Plan {
  const plan = state.plans.find((p) => p.id === planId);
  if (!plan) throw new Error('計画が見つかりません');
  const from = plan.steps[fromIndex];
  if (!from) throw new Error('計画の手順が見つかりません');
  if (result.steps[0]?.dam !== from.dam) throw new Error('経路の起点が計画の手順の母と違います');
  const { steps, created } = plannedSteps(planId, plan.name, from.dam, result, finalRole, fromIndex);
  const next: Plan = { ...plan, steps: [...plan.steps.slice(0, fromIndex), ...steps], goals, request, rulesVersion, dataVersion, updatedAt: now() };
  const plans = state.plans.map((p) => (p.id === planId ? next : p));
  const removed = new Set(plan.steps.slice(fromIndex).map((s) => s.foalId));
  set({ ...state, plans, plannedHorses: dropPlannedHorses(state, planId, removed, plans, created) });
  return next;
}

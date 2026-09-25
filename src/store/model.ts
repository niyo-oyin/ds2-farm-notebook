import type { HorseKey, OwnedHorse, PlannedHorse, UserHorse } from '../core/types';
import { isBreedingHorse } from '../core/owned-horse';
import type { RuleOptions } from '../core/rules';
import type { SearchGoal, SearchRequest } from '../core/search';
import type { AncestorEdit, KottaEdit, MasterEdit, NicksEdit } from '../core/master-edits';
import type { RaceEdit } from '../core/races';

export interface PlanStep { sire: HorseKey; dam: HorseKey; foalId: string; }
export interface Plan {
  id: string; name: string; createdAt: string; updatedAt: string;
  startKey: HorseKey; steps: PlanStep[]; goals: SearchGoal[];
  request?: SearchRequest; rulesVersion: string; dataVersion: string; memo: string;
}
export interface HorseNameAffix { text: string; position: 'prefix' | 'suffix'; }
export interface FarmSettings {
  name?: string;
  separateBySex?: boolean;
  commonAffix?: HorseNameAffix;
  maleAffix?: HorseNameAffix;
  femaleAffix?: HorseNameAffix;
}
export interface Settings {
  farm?: FarmSettings;
  rules: Partial<RuleOptions>;
  hideLocked?: boolean;
  hidePurchase?: boolean;
  /** 父母の選択リストに計画馬を出さない。表示だけの設定で、探索の相手の候補には影響しない */
  hidePlanned?: boolean;
  /** 探索の相手の候補（総当たりの相手、数世代探索・ループ探索の種牡馬）に計画馬を入れない。既定はオン（未設定なら除外）。選択リストの表示とは連動しない */
  excludePlannedFromSearch?: boolean;
  /** ゲーム内の現在年（例 29）。年齢 = 年 − 生年。カードの反映で推定した年が進んでいれば自動で更新する */
  gameYear?: number;
  /** 写真の取り込み: 解析が終わったら確認ダイアログを自動で開く */
  importAutoOpen?: boolean;
  /** 縦長の取り込み写真を90度回転する向き。未設定なら回転しない。 */
  importPortraitRotation?: 'left' | 'right';
  /** 写真の取り込み: 反映先が確実なときは確認なしで反映する */
  importAutoApply?: boolean;
  /** 種牡馬・繁殖牝馬の画面: 同名のマスターの馬があれば確認なしで更新する */
  importAutoMasterUpdate?: boolean;
  /** 種牡馬・繁殖牝馬の画面: マスターデータにない馬を確認なしで追加する（自家生産馬の拒否判定は常に効く） */
  importAutoMasterAdd?: boolean;
  updatedAt?: string;
}
export interface UserData {
  version: 2;
  horses: OwnedHorse[];
  plannedHorses: PlannedHorse[];
  plans: Plan[];
  /** マスターデータ（種牡馬・繁殖牝馬）への追加・修正・非表示 */
  masterEdits: MasterEdit[];
  /** 祖先マスター（大系統・性別・因子）への追加・修正 */
  ancestorEdits: AncestorEdit[];
  /** 凝ったペア表への追加・確認・無効化 */
  kottaEdits: KottaEdit[];
  /** ニックス相性表への追加・訂正 */
  nicksEdits: NicksEdit[];
  raceEdits: RaceEdit[];
  settings: Settings;
}
export const emptyUserData = (): UserData => ({ version: 2, horses: [], plannedHorses: [], plans: [], masterEdits: [], ancestorEdits: [], kottaEdits: [], nicksEdits: [], raceEdits: [], settings: { rules: {} } });
export const allUserHorses = (data: UserData): UserHorse[] => [...data.horses, ...data.plannedHorses];

/** 保存データの形を確かめる。所有馬と計画馬は別配列で、混ぜない。 */
export function normalizeUserData(raw: unknown): UserData {
  const d = raw as UserData;
  if (!d || d.version !== 2 || !Array.isArray(d.horses) || !Array.isArray(d.plannedHorses) || !Array.isArray(d.plans)) throw new Error('データの形式が違います');
  if (d.horses.some((h) => h.kind !== 'owned') || d.plannedHorses.some((h) => h.kind !== 'planned')) throw new Error('馬の区分が不正です');
  const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
  return { version: 2, horses: d.horses, plannedHorses: d.plannedHorses, plans: d.plans, masterEdits: list(d.masterEdits), ancestorEdits: list(d.ancestorEdits), kottaEdits: list(d.kottaEdits), nicksEdits: list(d.nicksEdits), raceEdits: list(d.raceEdits), settings: { ...emptyUserData().settings, ...d.settings } };
}

export function horsePlanLinks(data: UserData, horseId: string) {
  return data.plannedHorses.filter((h) => h.realizedIds.includes(horseId)).map((foal) => {
    const plan = data.plans.find((p) => p.steps.some((s) => s.foalId === foal.id));
    return { foal, plan, stepIndex: plan?.steps.findIndex((s) => s.foalId === foal.id) ?? -1 };
  });
}

export function realizedProgress(foal: PlannedHorse, horses: OwnedHorse[]) {
  const linked = horses.filter((h) => foal.realizedIds.includes(h.id));
  const suitable = linked.filter((h) => !foal.desiredSex || h.sex === foal.desiredSex);
  return { born: linked.length > 0, sexOk: suitable.length > 0, bred: suitable.some(isBreedingHorse) };
}
export function plannedProgress(foal: PlannedHorse, horses: OwnedHorse[]) {
  const actual = realizedProgress(foal, horses);
  return { born: actual.born || !!foal.achieved?.born, sexOk: !foal.desiredSex || actual.sexOk || !!foal.achieved?.sexOk, bred: actual.bred || !!foal.achieved?.bred };
}

/** 所有馬の血統には実個体とマスターの馬だけを登録する。 */
export function validateOwnedParents(data: UserData, horse: Pick<OwnedHorse, 'id' | 'sireKey' | 'damKey'>) {
  const planned = new Set(data.plannedHorses.map((h) => h.id));
  if ([horse.sireKey, horse.damKey].some((id) => planned.has(id) || id.startsWith('p:'))) throw new Error('所有馬の父母には、計画馬ではなく実際の馬を指定してください');
  const ancestors = new Map(data.horses.map((h) => [h.id, h]));
  const walk = (id: string, path: Set<string>) => {
    if (!id) return;
    if (id === horse.id || path.has(id)) throw new Error('親子関係が循環しています');
    const parent = ancestors.get(id);
    if (parent) { const next = new Set(path).add(id); walk(parent.sireKey, next); walk(parent.damKey, next); }
  };
  walk(horse.sireKey, new Set()); walk(horse.damKey, new Set());
}

/** 一つの関係の正本は計画馬の realizedIds。逆方向の関係を別途保存しない。 */
export function setHorsePlanLinks(data: UserData, horseId: string, foalIds: string[], updatedAt: string): UserData {
  if (!data.horses.some((h) => h.id === horseId)) throw new Error('所有馬が見つかりません');
  if (foalIds.some((id) => !data.plannedHorses.some((h) => h.id === id))) throw new Error('計画馬が見つかりません');
  return { ...data, plannedHorses: data.plannedHorses.map((h) => {
    const linked = h.realizedIds.includes(horseId), shouldLink = foalIds.includes(h.id);
    if (linked === shouldLink) return h;
    return { ...h, realizedIds: shouldLink ? [...h.realizedIds, horseId] : h.realizedIds.filter((id) => id !== horseId), updatedAt };
  }) };
}

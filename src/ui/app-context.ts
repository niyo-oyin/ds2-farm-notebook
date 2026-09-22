import { horseUnlockConditions } from '../core/master-horse';
import { createContext, useContext } from 'react';
import type { MasterData } from '../core/types';
import type { RuleOptions } from '../core/rules';
import type { JudgeContext } from '../core/judge';
import type { HorseResolver } from '../core/pedigree';
import type { UserData } from '../store/userdata';
import { pedigreeIssue } from '../core/owned-horse';

export interface AppCtx { master: MasterData; rules: RuleOptions; ctx: JudgeContext; resolver: HorseResolver; data: UserData; }
export const AppContext = createContext<AppCtx | null>(null);
export const useApp = (): AppCtx => {
  const c = useContext(AppContext);
  if (!c) throw new Error('AppContext');
  return c;
};

export interface HorseOption { key: string; name: string; group: string; sub?: string; }

export interface OptionFilter {
  /** 探索で使える馬だけ（利用可能な種牡馬の設定、探索除外、引退、計画馬の探索対象外を反映） */
  onlyAvailable?: boolean;
  /** 計画馬を含める。選択リストは設定 hidePlanned、探索の相手の候補は設定 excludePlannedFromSearch を渡す（互いに連動しない） */
  includePlanned?: boolean;
  /** 血統（父母）が登録済みの所有馬だけ。配合確認・探索は判定に血統が要るため */
  requirePedigree?: boolean;
  includeOverseas?: boolean;
}
/** 探索の相手の候補に計画馬を入れるか（設定 excludePlannedFromSearch。未設定は除外） */
export const includePlannedInSearch = (app: AppCtx) => app.data.settings.excludePlannedFromSearch === false;
const ownedOk = (h: UserData['horses'][number], f: OptionFilter) => (!f.onlyAvailable || (!h.excludeFromSearch && h.category !== '引退')) && (!f.requirePedigree || !pedigreeIssue(h));
/** 父候補: 種牡馬 + 牡の所有馬 + 種牡馬予定の計画馬 */
export function sireOptions(app: AppCtx, { onlyAvailable = false, includePlanned = true, requirePedigree = false, includeOverseas = true }: OptionFilter = {}): HorseOption[] {
  const master = app.master.stallions
    .filter((s) => includeOverseas || !s.overseas)
    .filter((s) => !(onlyAvailable && app.data.settings.hideLocked && horseUnlockConditions(s).length > 0))
    .map((s) => ({ key: s.id, name: s.name, group: '種牡馬', sub: `${s.priceUnknown ? '種付料未確認' : `${s.price}万`} / ${s.smallSystem ?? '-'}系${horseUnlockConditions(s).map(c => ` / 要解禁: ${c}`).join('')}` }));
  const own = [...app.data.horses, ...(includePlanned ? app.data.plannedHorses : [])]
    .filter((h) => (h.kind === 'owned' ? h.sex === 'M' : h.role === 'stallion' || h.desiredSex === 'M'))
    .filter((h) => (h.kind === 'owned' ? ownedOk(h, { onlyAvailable, requirePedigree }) : !onlyAvailable || h.status !== '探索対象外'))
    .map((h) => ({ key: h.id, name: h.name, group: h.kind === 'owned' ? '所有馬' : '計画馬', sub: h.kind === 'owned' ? h.category : h.status }));
  return [...own, ...master];
}
/** 母候補: 繁殖牝馬 + 牝の所有馬 + 繁殖牝馬予定の計画馬 */
export function damOptions(app: AppCtx, { onlyAvailable = false, includePlanned = true, requirePedigree = false }: OptionFilter = {}): HorseOption[] {
  const master = app.master.broodmares
    .filter((b) => !(onlyAvailable && app.data.settings.hidePurchase && b.purchasePrice))
    .map((b) => ({ key: b.id, name: b.name, group: '繁殖牝馬', sub: `${b.smallSystem ?? '-'}系${b.purchasePrice ? ` / ${b.purchasePrice.toLocaleString()}万` : b.priceUnknown ? ' / 購入価格未確認' : ''}` }));
  const own = [...app.data.horses, ...(includePlanned ? app.data.plannedHorses : [])]
    .filter((h) => (h.kind === 'owned' ? h.sex === 'F' : h.role === 'broodmare' || h.desiredSex === 'F'))
    .filter((h) => (h.kind === 'owned' ? ownedOk(h, { onlyAvailable, requirePedigree }) : !onlyAvailable || h.status !== '探索対象外'))
    .map((h) => ({ key: h.id, name: h.name, group: h.kind === 'owned' ? '所有馬' : '計画馬', sub: h.kind === 'owned' ? h.category : h.status }));
  return [...own, ...master];
}

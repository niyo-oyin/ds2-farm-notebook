import type { HorseRecord } from './types';
import type { RuleOptions } from './rules';
import type { SearchGoal } from './search';

/** 各枠で取り得る系統。? はデータ自体が不明な枠で、候補未選択とは区別する。 */
type Domain = string;

/**
 * 母の4枠に必要な系統を割り当てられるか。
 * 枠同士が同じ種牡馬に由来する制約は緩めて調べるため、成立候補を落とさない。
 */
function canMatch(domains: Domain[], target: string, multiset: boolean): boolean {
  const required = multiset ? [...target] : [...new Set(target)];
  let reachable = new Set([0]);
  for (const domain of domains) {
    const next = new Set<number>();
    for (const mask of reachable) {
      required.forEach((system, i) => {
        const bit = 1 << i;
        if (domain.includes(system) && (!multiset || !(mask & bit))) next.add(mask | bit);
      });
    }
    if (!next.size) return false;
    reachable = next;
  }
  return reachable.has((1 << required.length) - 1);
}

/** 面白用8枠で増やせる種類数の上限。枠間の相関を無視した安全側の見積もり。 */
function canReachDiversity(sire: string, domains: Domain[], threshold: number): boolean {
  const fixed = new Set([...sire].filter((c) => c !== '?'));
  let openSlots = [...sire].filter((c) => c === '?').length;
  let unknownSlots = openSlots;
  const possible = new Set(fixed);
  for (const domain of domains) {
    if (domain.length === 1 && domain !== '?') fixed.add(domain);
    else openSlots++;
    if (domain.includes('?')) unknownSlots++;
    for (const c of domain) if (c !== '?') possible.add(c);
  }
  return Math.min(fixed.size + openSlots, possible.size + unknownSlots) >= threshold;
}

/**
 * 系統を必要とする目標だけに使う、血統表構築前の必要条件フィルター。
 * 成立を確定する処理ではなく、通過した候補は必ず通常の全理論判定に渡す。
 */
export function createSystemPrefilter(start: HorseRecord, pool: HorseRecord[], goals: SearchGoal[], rules: RuleOptions) {
  const needsOmoshiro = goals.some((g) => g.type === 'omoshiro' || g.type === 'perfect' || g.type === 'perfectKotta');
  const needsMigoto = goals.some((g) => g.type === 'migoto' || g.type === 'perfect' || g.type === 'perfectKotta');
  if (!needsOmoshiro && !needsMigoto) return null;

  const poolDomains = [0, 2].map((i) => [...new Set(pool.map((s) => s.omoshiro[i]))].join(''));
  const slot = (s: HorseRecord | null, index: 0 | 2): Domain => s ? s.omoshiro[index] : poolDomains[index / 2];

  return (sire: HorseRecord, layers: (HorseRecord | null)[]): boolean => {
    // 娘の面白用系統は父[0,2]・母[0,2]。最終母に残るのは直近3頭まで。
    const n = layers.length;
    let domains: Domain[] = n === 0 ? [...start.omoshiro] : [
      slot(layers[n - 1], 0), slot(layers[n - 1], 2),
      n >= 2 ? slot(layers[n - 2], 0) : start.omoshiro[0],
      n >= 3 ? slot(layers[n - 3], 0) : start.omoshiro[n === 1 ? 2 : 0],
    ];

    // 不明データは不一致とみなさない。未確定の扱いは通常判定に委ねる。
    if (needsMigoto && !sire.migoto.includes('?') && !domains.some((d) => d.includes('?'))) {
      if (new Set(sire.migoto).size < rules.migotoMinSystems) return false;
      domains = domains.map((d) => [...d].filter((c) => sire.migoto.includes(c)).join(''));
      if (domains.some((d) => !d.length)) return false;
      if (needsOmoshiro && !canReachDiversity(sire.omoshiro, domains, rules.omoshiroThreshold)) return false;
      if (!canMatch(domains, sire.migoto, rules.migotoMode === 'multiset')) return false;
    } else if (needsOmoshiro && !canReachDiversity(sire.omoshiro, domains, rules.omoshiroThreshold)) return false;
    return true;
  };
}

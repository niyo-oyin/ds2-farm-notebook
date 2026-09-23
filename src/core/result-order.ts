// 探索結果の並べ方と、判定が同じ経路の畳み込み。
import type { JudgementSummary, SearchGoal, SearchResult } from './search';

export interface Ranked { cost: number; matings?: number; s: JudgementSummary }

/** 目標で本数を指定した因子。おすすめ順ではこれらのクロスが多いほど上に置く */
export const wantedEffects = (goals: SearchGoal[]) => goals.flatMap((g) => (g.type === 'crossEffect' && g.effect ? [g.effect] : []));

const theories = (s: JudgementSummary) => [s.omoshiro, s.migoto, s.kotta].filter((v) => v === '成立').length;

/**
 * おすすめ順: 危険な配合でない → 成立した配合理論（面白・見事・凝った）の数 → ニックスの段階 → 指定した因子のクロス本数 → 費用 → 配合回数。
 * 完璧な配合は面白と見事、完璧／凝った配合は3つすべての成立として数える。
 */
export function recommendedCompare(a: Ranked, b: Ranked, wanted: string[]): number {
  const wantedCount = (x: Ranked) => wanted.reduce((n, e) => n + (x.s.effectCounts[e] ?? 0), 0);
  return Number(a.s.dangerous === '成立') - Number(b.s.dangerous === '成立')
    || theories(b.s) - theories(a.s)
    || b.s.nicksLevel - a.s.nicksLevel
    || wantedCount(b) - wantedCount(a)
    || a.cost - b.cost
    || (a.matings ?? 0) - (b.matings ?? 0);
}

/** 最終配合の判定のうち、画面に出して比べる値すべて。これが同じ経路は最終産駒の見込みが同じ */
const outcomeKey = (r: SearchResult) => {
  const last = r.steps[r.steps.length - 1];
  const s = last.judgement;
  return JSON.stringify([r.steps[0].dam, last.sire, s.omoshiro, s.migoto, s.perfect, s.perfectKotta, s.kotta, s.nicks, s.nicksLevel, s.dangerous, s.outbreed,
    s.hasUnknownSlots, s.omoshiroCount, s.crossCount, s.mareCrossCount, Object.entries(s.effectCounts).sort(), s.nitro.speed, s.nitro.stamina, s.nitro.power]);
};

/**
 * 起点・最後の種牡馬・最終配合の判定がすべて同じ経路のうち、費用と配合回数のどちらでも上回られる経路を畳む。
 * 最後の種牡馬が違う経路は比べない（種牡馬は産駒の距離や成長などを左右し、判定だけでは優劣を決められない）。
 */
export function foldDominated(results: SearchResult[]): { shown: SearchResult[]; folded: number } {
  const groups = new Map<string, SearchResult[]>();
  for (const r of results) {
    const key = outcomeKey(r);
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }
  const keep = new Set<SearchResult>();
  for (const g of groups.values()) {
    // 費用の安い順に見て、それまでより配合回数が少ない経路だけが費用と回数の両方で上回られない
    let fewest = Infinity;
    for (const r of [...g].sort((a, b) => a.cost - b.cost || a.matings - b.matings)) {
      if (r.matings < fewest) { keep.add(r); fewest = r.matings; }
    }
  }
  const shown = results.filter((r) => keep.has(r));
  return { shown, folded: results.length - shown.length };
}

import { describe, expect, it } from 'vitest';
import { baseMaster as M } from '../src/data/base-master';
import { HorseResolver } from '../src/core/pedigree';
import { makeContext } from '../src/core/judge';
import { DEFAULT_RULES } from '../src/core/rules';
import { searchLineage, type SearchResult } from '../src/core/search';
import { foldDominated } from '../src/core/result-order';

const resolver = new HorseResolver(M, [], DEFAULT_RULES);
const env = { ctx: makeContext(M), rules: DEFAULT_RULES, resolve: (k: string) => resolver.get(k) };

describe('判定が同じ経路の畳み込み', () => {
  it('畳んだ経路には、起点・最後の種牡馬・最終配合の判定が同じで、費用も配合回数も多くない経路が必ず残る', async () => {
    const pool = M.stallions.slice(0, 25).map((s) => s.id);
    const report = await searchLineage(env, { startMares: [M.broodmares[2].id], stallionPool: pool, intermediateStallion: null, finalStallion: null, finalPool: null, minMatings: 1, maxMatings: 3, goals: [{ type: 'omoshiro' }], maxCost: null, maxEvaluations: 10_000_000, allowRepeatStallion: true });
    const { shown, folded } = foldDominated(report.results);
    expect(folded).toBeGreaterThan(0);
    expect(shown.length + folded).toBe(report.results.length);
    const outcome = (r: SearchResult) => { const last = r.steps.at(-1)!; return JSON.stringify([r.steps[0].dam, last.sire, { ...last.judgement, crosses: undefined, effectCounts: Object.entries(last.judgement.effectCounts).sort() }]); };
    const kept = new Set(shown);
    for (const r of report.results.filter((x) => !kept.has(x))) {
      expect(shown.some((s) => outcome(s) === outcome(r) && s.cost <= r.cost && s.matings <= r.matings)).toBe(true);
    }
    // 残した経路どうしは、同じ判定なら費用か回数のどちらかで勝っている
    for (const a of shown) for (const b of shown) {
      if (a === b || outcome(a) !== outcome(b)) continue;
      expect(a.cost <= b.cost && a.matings <= b.matings).toBe(false);
    }
  });
});

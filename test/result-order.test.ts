import { describe, expect, it } from 'vitest';
import { baseMaster as M } from '../src/data/base-master';
import { HorseResolver } from '../src/core/pedigree';
import { makeContext } from '../src/core/judge';
import { DEFAULT_RULES } from '../src/core/rules';
import { searchDesigns, type DesignResult } from '../src/core/design-search';
import { foldDominated } from '../src/core/result-order';

const resolver = new HorseResolver(M, [], DEFAULT_RULES);
const env = { ctx: makeContext(M), rules: DEFAULT_RULES, resolve: (k: string) => resolver.get(k) };

describe('判定が同じ設計の畳み込み', () => {
  it('畳んだ設計には、起点と最後の配合の判定が同じで、費用・世代数・系統の強さのどれでも劣らない設計が必ず残る', async () => {
    const pool = M.stallions.slice(0, 8).map((s) => s.id);
    const report = await searchDesigns(env, {
      colt: { starts: [M.broodmares[0].id], sires: pool, minGenerations: 0, maxGenerations: 1, required: null },
      filly: { starts: [M.broodmares[2].id], minGenerations: 0, maxGenerations: 2, required: null },
      stallionPool: pool, goals: [{ type: 'notDangerous' }], strongLines: false, maxCost: null, maxEvaluations: 10_000_000,
    });
    const { shown, folded } = foldDominated(report.results);
    expect(folded).toBeGreaterThan(0);
    expect(shown.length + folded).toBe(report.results.length);
    const outcome = (r: DesignResult) => JSON.stringify([r.colt.start, r.filly.start, { ...r.merge.judgement, crosses: undefined, effectCounts: Object.entries(r.merge.judgement.effectCounts).sort() }]);
    const strength = (r: DesignResult) => r.strength ?? { weakest: Infinity, mean: Infinity };
    const noWorse = (a: DesignResult, b: DesignResult) => a.cost <= b.cost && a.generations <= b.generations && strength(a).weakest >= strength(b).weakest && strength(a).mean >= strength(b).mean;
    const kept = new Set(shown);
    for (const r of report.results.filter((x) => !kept.has(x))) {
      expect(shown.some((s) => outcome(s) === outcome(r) && noWorse(s, r))).toBe(true);
    }
    // 残した設計どうしは、同じ判定なら費用・世代数・系統の強さのどれかで勝っている
    for (const a of shown) for (const b of shown) {
      if (a === b || outcome(a) !== outcome(b)) continue;
      expect(noWorse(a, b) && !noWorse(b, a)).toBe(false);
    }
  }, 30_000);
});

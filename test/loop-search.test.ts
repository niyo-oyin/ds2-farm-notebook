import { beforeAll, describe, expect, it } from 'vitest';
import { baseMaster } from '../src/data/base-master';
import { HorseResolver, makeFoalRecord } from '../src/core/pedigree';
import { judge, makeContext } from '../src/core/judge';
import { DEFAULT_RULES } from '../src/core/rules';
import { searchLoopEntry, searchLoops, type LoopReport } from '../src/core/loop-search';
import { goalVerdict, type SearchGoal } from '../src/core/search';

const M = baseMaster;
const resolver = new HorseResolver(M, [], DEFAULT_RULES);
const env = { ctx: makeContext(M), rules: DEFAULT_RULES, resolve: (k: string) => resolver.get(k) };
const pool = M.stallions.map((s) => s.id);

describe('凝った配合ループの探索', { timeout: 30_000 }, () => {
  let r: LoopReport;
  beforeAll(async () => {
    let found = 0;
    r = await searchLoops(env, { stallionPool: pool, minLength: 5, maxLength: 5, goals: [{ type: 'kotta' }, { type: 'notDangerous' }], maxCost: null, maxEvaluations: 1_000_000 }, { yieldEvery: 1, onFound: () => { found++; }, shouldStop: () => found >= 30 });
    expect(r.results).toHaveLength(30);
  }, 30_000);
  it('周期のどの世代でも凝った配合が成立し危険な配合にならず、回転して同じ周期は重複しない', () => {
    const canonical = new Set<string>();
    for (const x of r.results) {
      expect(x.length).toBe(5);
      for (const st of x.steps) { expect(st.judgement.kotta).toBe('成立'); expect(st.judgement.dangerous).toBe('不成立'); }
      const keys = x.steps.map((s) => s.sire);
      const rotations = keys.map((_, i) => [...keys.slice(i), ...keys.slice(0, i)].join('>'));
      for (const rot of rotations) expect(canonical.has(rot)).toBe(false);
      canonical.add(rotations[0]);
    }
  });
  it('定常状態の判定は、実際の繁殖牝馬から2周回した2周目の判定と一致する', () => {
    const mare = M.broodmares[0];
    for (const x of r.results.slice(0, 3)) {
      let m = resolver.get(mare.id)!;
      const verdicts: string[] = [];
      for (let n = 0; n < x.length * 2; n++) {
        const s = resolver.get(x.steps[n % x.length].sire)!;
        if (n >= x.length) verdicts.push(judge(s, m, env.ctx).kotta.verdict);
        m = makeFoalRecord(s, m, { key: `t:${n}`, name: `${n}`, sex: 'F', kind: 'planned' }, DEFAULT_RULES);
      }
      expect(verdicts).toEqual(x.steps.map(() => '成立'));
    }
  });
  it('選んだ牝馬から周期に入る経路は、導入の配合の後に周期の回転が続き、周期の全世代で目標が成立する', async () => {
    const goals: SearchGoal[] = [{ type: 'kotta' }, { type: 'notDangerous' }];
    const cycle = r.results[0].steps.map((s) => s.sire);
    const mare = M.broodmares[0].id;
    const entry = await searchLoopEntry(env, { mare, cycle, goals, bridgePool: pool, maxBridge: 2, maxEvaluations: 1_000_000 });
    const route = entry.result!;
    expect(route.steps[0].dam).toBe(mare);
    const cyclePart = route.steps.slice(entry.bridge).map((s) => s.sire);
    expect(cyclePart).toHaveLength(5);
    const rotations = cycle.map((_, i) => [...cycle.slice(i), ...cycle.slice(0, i)].join('>'));
    expect(rotations).toContain(cyclePart.join('>'));
    // 保存した経路を実際の牝馬から組み直しても、周期の各世代で目標が成立する
    let m = resolver.get(mare)!;
    route.steps.forEach((st, i) => {
      const s = resolver.get(st.sire)!;
      const j = judge(s, m, env.ctx);
      if (i >= entry.bridge) for (const g of goals) expect(goalVerdict(j, g)).toBe('成立');
      else expect(j.dangerous.verdict).toBe('不成立');
      m = makeFoalRecord(s, m, { key: `e:${i}`, name: `${i}`, sex: 'F', kind: 'planned' }, DEFAULT_RULES);
    });
  });
});

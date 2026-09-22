import { beforeAll, describe, expect, it } from 'vitest';
import { baseMaster } from '../src/data/base-master';
import { HorseResolver, makeFoalRecord } from '../src/core/pedigree';
import { judge, makeContext } from '../src/core/judge';
import { DEFAULT_RULES } from '../src/core/rules';
import { loopFromMare, searchLoops, type LoopReport } from '../src/core/loop-search';

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
  it('1周目の経路は選んだ牝馬から作り、世代ごとの判定を持つ', () => {
    const first = loopFromMare(env, M.broodmares[0].id, r.results[0].steps.map((s) => s.sire), [{ type: 'kotta' }]);
    expect(first.steps).toHaveLength(5);
    expect(first.steps[0].dam).toBe(M.broodmares[0].id);
    expect(first.steps.map((s) => s.sire)).toEqual(r.results[0].steps.map((s) => s.sire));
    expect(first.goals[0].goal.type).toBe('kotta');
  });
});

import { describe, expect, it } from 'vitest';
import { baseMaster as M } from '../src/data/base-master';
import { HorseResolver, makeFoalRecord } from '../src/core/pedigree';
import { judge, makeContext } from '../src/core/judge';
import { DEFAULT_RULES } from '../src/core/rules';
import { goalVerdict, type SearchGoal } from '../src/core/search';
import { searchHomebredSires } from '../src/core/homebred';

const resolver = new HorseResolver(M, [], DEFAULT_RULES);
const env = { ctx: makeContext(M), rules: DEFAULT_RULES, resolve: (k: string) => resolver.get(k) };

describe('自家製種牡馬づくり', () => {
  it('牡の産駒を種牡馬として付けた時に目標が成立する相手を、母自身を除いてすべて数え、最小頭数に届き、生まれる配合も危険でない産駒だけを返す', async () => {
    const mares = M.broodmares.slice(0, 8).map((m) => m.id);
    const pool = M.stallions.slice(0, 40).map((s) => s.id);
    const goals: SearchGoal[] = [{ type: 'kotta' }, { type: 'notDangerous' }];
    const report = await searchHomebredSires(env, { dams: mares, stallionPool: pool, targets: mares, goals, minMatches: 2, maxEvaluations: 10_000_000 });
    expect(report.status).toBe('完了');
    const found = new Map(report.results.map((r) => [`${r.sire}>${r.dam}`, r.matches.map((m) => m.mare)]));
    for (const dam of mares) for (const sire of pool) {
      const safeBirth = judge(resolver.get(sire)!, resolver.get(dam)!, env.ctx).dangerous.verdict === '不成立';
      const colt = makeFoalRecord(resolver.get(sire)!, resolver.get(dam)!, { key: 'p:t', name: 't', sex: 'M', kind: 'planned' }, DEFAULT_RULES);
      const expected = mares.filter((t) => t !== dam && goals.every((g) => goalVerdict(judge(colt, resolver.get(t)!, env.ctx), g) === '成立'));
      expect(found.get(`${sire}>${dam}`) ?? []).toEqual(safeBirth && expected.length >= 2 ? expected : []);
    }
    expect(report.results.length).toBeGreaterThan(0);
  });
});

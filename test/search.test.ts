import { describe, it, expect } from 'vitest';
import { baseMaster } from '../src/data/base-master';
import { HorseResolver } from '../src/core/pedigree';
import { judge, makeContext } from '../src/core/judge';
import { DEFAULT_RULES } from '../src/core/rules';
import { bruteForceOneGeneration } from '../src/core/search';

const M = baseMaster;
const ctx = makeContext(M);
const resolver = new HorseResolver(M, [], DEFAULT_RULES);
const env = { ctx, rules: DEFAULT_RULES, resolve: (k: string) => resolver.get(k) };
describe('探索', () => {
  it('種牡馬を固定して母候補を総当たりしても、父母の向きと配合判定を保つ', () => {
    const sires = M.stallions.slice(0, 2).map((s) => s.id);
    const dams = M.broodmares.slice(0, 4).map((d) => d.id);
    const fromSires = sires.flatMap((sire) => bruteForceOneGeneration(env, [sire], dams));
    const fromDams = dams.flatMap((dam) => bruteForceOneGeneration(env, sires, [dam]));
    expect(fromSires).toHaveLength(sires.length * dams.length);
    expect(new Set(fromSires.map((r) => `${r.sire}>${r.dam}`))).toEqual(new Set(sires.flatMap((sire) => dams.map((dam) => `${sire}>${dam}`))));
    for (const row of fromSires) {
      expect(fromDams.find((r) => r.sire === row.sire && r.dam === row.dam)?.judgement).toEqual(row.judgement);
      expect(row.judgement).toEqual(judge(resolver.get(row.sire)!, resolver.get(row.dam)!, ctx));
    }
  });
});

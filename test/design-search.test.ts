import { describe, expect, it } from 'vitest';
import { baseMaster as M } from '../src/data/base-master';
import { HorseResolver, makeFoalRecord, unknownRecord } from '../src/core/pedigree';
import { judge, makeContext } from '../src/core/judge';
import { DEFAULT_RULES, type RuleOptions } from '../src/core/rules';
import { goalVerdict, summarize, type SearchEnv, type SearchGoal } from '../src/core/search';
import { designEnv, lineRecords, searchDesigns, type DesignRequest, type DesignResult } from '../src/core/design-search';
import { foldDominated, lineStrength } from '../src/core/result-order';
import type { HorseRecord, Judgement, PlannedHorse } from '../src/core/types';
import { planned } from './horse-fixtures';

const key = (r: DesignResult) => [r.colt.start, ...r.colt.steps.map((s) => s.sire), '|', r.filly.start, ...r.filly.steps.map((s) => s.sire)].join('>');

interface Line { start: HorseRecord; sires: HorseRecord[]; final: HorseRecord; judgements: Judgement[] }
/** 起点から種牡馬の列をすべて並べた系統（探索とは別のキーで組み立てる） */
function allLines(env: SearchEnv, side: string, starts: HorseRecord[], pool: HorseRecord[], min: number, max: number, required: string | null, sex: 'M' | 'F'): Line[] {
  const out: Line[] = [];
  const walk = (start: HorseRecord, sires: HorseRecord[], dams: HorseRecord[], judgements: Judgement[]) => {
    const g = sires.length;
    if (g >= Math.max(min, 1) && (!required || sires.some((s) => s.key === required))) {
      const path = sires.map((s) => s.key).join('>');
      const colt = `ref:${side}:${start.key}:${path}:M`;
      if (sex === 'M') env.ctx.parents.set(colt, [sires[g - 1].key, dams[g - 1].key]);
      const final = sex === 'F' ? dams[g] : makeFoalRecord(sires[g - 1], dams[g - 1], { key: colt, name: '牡', sex: 'M', kind: 'planned' }, env.rules);
      out.push({ start, sires, final, judgements });
    }
    if (g === max) return;
    for (const s of pool) {
      const path = [...sires, s].map((x) => x.key).join('>');
      const key = `ref:${side}:${start.key}:${path}`;
      env.ctx.parents.set(key, [s.key, dams[g].key]);
      const female = makeFoalRecord(s, dams[g], { key, name: '牝', sex: 'F', kind: 'planned' }, env.rules);
      walk(start, [...sires, s], [...dams, female], [...judgements, judge(s, dams[g], env.ctx)]);
    }
  };
  for (const start of starts) walk(start, [], [start], []);
  return out;
}

/** 牡と牝のすべての組を判定する素朴な全探索。作った馬は父母を判定の材料に加える（計画馬と同じ扱い） */
function exhaustive(base: SearchEnv, req: DesignRequest): DesignResult[] {
  const env: SearchEnv = { ...base, ctx: { ...base.ctx, parents: new Map(base.ctx.parents), kottaProfiles: new Map() } };
  const resolve = (keys: string[]) => keys.map((k) => env.resolve(k)!);
  const pool = resolve(req.stallionPool);
  const colts: Line[] = [
    ...(req.colt.minGenerations === 0 && !req.colt.required ? resolve(req.colt.sires).map((s) => ({ start: s, sires: [], final: s, judgements: [] })) : []),
    ...(req.colt.maxGenerations > 0 ? allLines(env, 'c', resolve(req.colt.starts), pool, req.colt.minGenerations, req.colt.maxGenerations, req.colt.required, 'M') : []),
  ];
  const fillies = [
    ...(req.filly.minGenerations === 0 && !req.filly.required ? resolve(req.filly.starts).map((s) => ({ start: s, sires: [], final: s, judgements: [] })) : []),
    ...allLines(env, 'f', resolve(req.filly.starts), pool, req.filly.minGenerations, req.filly.maxGenerations, req.filly.required, 'F'),
  ];
  const safe = req.goals.some((g) => g.type === 'notDangerous');
  const ok = (j: Judgement) => (!safe || j.dangerous.verdict === '不成立') && (!req.strongLines || lineStrength(summarize(j)) > 0);
  const out: DesignResult[] = [];
  for (const c of colts) for (const f of fillies) {
    const lineCost = [...c.sires, ...f.sires].reduce((sum, s) => sum + s.price, 0);
    const cost = lineCost + (c.sires.length ? 0 : c.final.price);
    if (req.maxCost != null && cost > req.maxCost) continue;
    if (![...c.judgements, ...f.judgements].every(ok)) continue;
    const j = judge(c.final, f.final, env.ctx);
    const verdicts = req.goals.map((goal) => ({ goal, verdict: goalVerdict(j, goal) }));
    if (!verdicts.every((v) => v.verdict === '成立')) continue;
    const steps = (l: Line) => l.sires.map((s, i) => ({ sire: s.key, sireName: s.name, dam: '', damName: '', cost: s.price, foalName: '', judgement: summarize(l.judgements[i]) }));
    const strengths = [...c.judgements, ...f.judgements].map((x) => lineStrength(summarize(x)));
    out.push({
      colt: { start: c.start.key, startName: c.start.name, steps: steps(c) }, filly: { start: f.start.key, startName: f.start.name, steps: steps(f) },
      merge: { sire: c.final.key, sireName: '', dam: f.final.key, damName: '', cost: c.sires.length ? 0 : c.final.price, foalName: '', judgement: summarize(j) },
      generations: Math.max(c.sires.length, f.sires.length) + 1, cost,
      strength: strengths.length ? { weakest: Math.min(...strengths), mean: strengths.reduce((a, b) => a + b, 0) / strengths.length } : null,
      goals: verdicts,
    });
  }
  return out;
}

/** 探索が素朴な全探索と同じ設計を見つけ、畳んだ後の一覧も一致する */
async function expectExhaustiveMatch(env: SearchEnv, req: DesignRequest) {
  const expected = exhaustive(env, req);
  const actual = await searchDesigns(env, req);
  expect(actual.status).toBe('完了');
  const all = new Set(expected.map(key));
  expect(actual.results.every((r) => all.has(key(r)))).toBe(true);
  expect(actual.results.length + actual.folded).toBe(expected.length);
  expect(new Set(foldDominated(actual.results).shown.map(key))).toEqual(new Set(foldDominated(expected).shown.map(key)));
  return { expected, actual };
}

/** 系統コードだけを持つ馬で組んだ小さな候補集合 */
function fixture(rules: RuleOptions, unknown = false) {
  const starts = [{ ...unknownRecord('start:0'), omoshiro: unknown ? '?bcd' : 'abcd', migoto: 'abcd' }, { ...unknownRecord('start:1'), omoshiro: 'efgh', migoto: 'efgh' }];
  const pool = ['aabb', 'ccdd', 'bbaa', 'ddcc', 'efgh', unknown ? '?edd' : 'bbee'].map((omoshiro, i) => ({ ...unknownRecord(`sire:${i}`), omoshiro, migoto: omoshiro, price: (i + 1) * 100 }));
  const sires = ['abcd', 'aabc', 'efgh', ...(unknown ? ['?bcd'] : [])].map((migoto, i) => ({ ...unknownRecord(`final:${i}`), migoto, omoshiro: i === 2 ? 'abcd' : 'efgh', price: 100 }));
  const horses = new Map([...starts, ...pool, ...sires].map((horse) => [horse.key, horse]));
  const env: SearchEnv = { ctx: makeContext(M, rules), rules, resolve: (k) => horses.get(k) ?? null };
  const request: DesignRequest = {
    colt: { starts: starts.map((h) => h.key), sires: sires.map((h) => h.key), minGenerations: 0, maxGenerations: 2, required: null },
    filly: { starts: starts.map((h) => h.key), minGenerations: 0, maxGenerations: 2, required: null },
    stallionPool: pool.map((h) => h.key), goals: [], strongLines: false, maxCost: null, maxEvaluations: 10_000_000,
  };
  return { env, request };
}

describe('血統設計', () => {
  it.each([
    ['種類の一致', {}, false],
    ['個数を含む一致', { migotoMode: 'multiset' }, false],
    ['一致する種類数の下限', { migotoMinSystems: 4 }, false],
    ['面白い配合の種類数変更', { omoshiroThreshold: 8 }, false],
    ['不明な系統を含む', {}, true],
  ] as [string, Partial<RuleOptions>, boolean][])('系統コードで先に絞っても、%sで全探索と同じ設計を返す', async (_, patch, unknown) => {
    const { env, request } = fixture({ ...DEFAULT_RULES, ...patch }, unknown);
    let found = 0;
    for (const type of ['omoshiro', 'migoto', 'perfect'] as const) {
      for (const strongLines of [false, true]) {
        const { expected } = await expectExhaustiveMatch(env, { ...request, goals: [{ type }], strongLines });
        found += expected.length;
      }
    }
    expect(found).toBeGreaterThan(0);
  }, 60_000);

  it('系統で使う種牡馬と費用の上限を、牡・牝それぞれの系統で守る', async () => {
    const { env, request } = fixture(DEFAULT_RULES);
    const required = request.stallionPool[0];
    for (const maxCost of [null, 700]) {
      for (const side of ['colt', 'filly'] as const) {
        const req = { ...request, goals: [{ type: 'omoshiro' as const }], maxCost, [side]: { ...request[side], required } };
        const { actual } = await expectExhaustiveMatch(env, req);
        expect(actual.results.length).toBeGreaterThan(0);
        for (const r of actual.results) {
          expect(r[side].steps.some((s) => s.sire === required)).toBe(true);
          if (maxCost != null) expect(r.cost).toBeLessThanOrEqual(maxCost);
        }
      }
    }
  }, 60_000);

  it('実際の血統で、凝った配合・ニックス・因子・危険な配合の条件も全探索と一致する', async () => {
    const resolver = new HorseResolver(M, [], DEFAULT_RULES);
    const env: SearchEnv = { ctx: makeContext(M), rules: DEFAULT_RULES, resolve: (k) => resolver.get(k) };
    const pool = M.stallions.slice(0, 10).map((s) => s.id);
    const request: DesignRequest = {
      colt: { starts: M.broodmares.slice(0, 2).map((b) => b.id), sires: pool, minGenerations: 0, maxGenerations: 1, required: null },
      filly: { starts: M.broodmares.slice(2, 4).map((b) => b.id), minGenerations: 0, maxGenerations: 2, required: null },
      stallionPool: pool, goals: [], strongLines: false, maxCost: null, maxEvaluations: 10_000_000,
    };
    const goalSets: SearchGoal[][] = [
      [{ type: 'kotta' }, { type: 'notDangerous' }],
      [{ type: 'nicks', min: 1 }, { type: 'maxCrosses', max: 3 }],
      [{ type: 'crossEffect', effect: '速力', min: 1 }, { type: 'notDangerous' }],
      [{ type: 'outbreed' }],
    ];
    for (const goals of goalSets) {
      for (const strongLines of [false, true]) {
        const { expected, actual } = await expectExhaustiveMatch(env, { ...request, goals, strongLines });
        expect(expected.length, `${goals.map((g) => g.type).join('+')} / ${strongLines}`).toBeGreaterThan(0);
        // 手順の判定と費用は、系統の馬を組み立て直して判定した結果と一致する
        const view = designEnv(env);
        for (const r of actual.results.slice(0, 20)) {
          const colts = lineRecords(view, 'colt', r.colt), fillies = lineRecords(view, 'filly', r.filly);
          r.colt.steps.forEach((s, i) => expect(s.judgement).toEqual(summarize(judge(resolver.get(s.sire)!, colts[i], view.ctx))));
          r.filly.steps.forEach((s, i) => expect(s.judgement).toEqual(summarize(judge(resolver.get(s.sire)!, fillies[i], view.ctx))));
          expect(r.merge.judgement).toEqual(summarize(judge(colts.at(-1)!, fillies.at(-1)!, view.ctx)));
          expect(r.cost).toBe([...r.colt.steps, ...r.filly.steps, r.merge].reduce((sum, s) => sum + s.cost, 0));
        }
      }
    }
  }, 120_000);

  it('探索中の自家製牡馬自身は凝ったペアに使わず、計画馬として保存した後も同じ判定になる', async () => {
    const resolver = new HorseResolver(M, [], DEFAULT_RULES);
    const env: SearchEnv = { ctx: makeContext(M), rules: DEFAULT_RULES, resolve: (k) => resolver.get(k) };
    const pool = M.stallions.slice(0, 20).map((s) => s.id);
    const report = await searchDesigns(env, {
      colt: { starts: M.broodmares.slice(0, 3).map((b) => b.id), sires: [], minGenerations: 1, maxGenerations: 1, required: null },
      filly: { starts: M.broodmares.slice(3, 6).map((b) => b.id), minGenerations: 0, maxGenerations: 1, required: null },
      stallionPool: pool, goals: [], strongLines: false, maxCost: null, maxEvaluations: 10_000_000,
    });
    // 保存した計画と同じ形の計画馬を登録して判定し直す
    const horses: PlannedHorse[] = [];
    const add = (id: string, sire: string, dam: string, sex: 'M' | 'F') => { horses.push(planned(id, { sireKey: sire, damKey: dam, desiredSex: sex, role: sex === 'M' ? 'stallion' : 'broodmare' })); return id; };
    const pairs = report.results.map((r, i) => ({
      r, colt: add(`p:colt:${i}`, r.colt.steps[0].sire, r.colt.start, 'M'),
      filly: r.filly.steps.length ? add(`p:filly:${i}`, r.filly.steps[0].sire, r.filly.start, 'F') : r.filly.start,
    }));
    const saved = new HorseResolver(M, horses, DEFAULT_RULES), ctx = makeContext(M, DEFAULT_RULES, horses);
    expect(pairs.length).toBeGreaterThan(0);
    let established = 0;
    for (const { r, colt, filly } of pairs) {
      const j = judge(saved.get(colt)!, saved.get(filly)!, ctx);
      expect(j.kotta.verdict, `${r.colt.start}>${r.colt.steps[0].sire} × ${r.filly.start}`).toBe(r.merge.judgement.kotta);
      expect(j.kotta.estimatedPairs).toEqual([]);
      if (j.kotta.verdict === '成立') established++;
    }
    // この探索では祖先は実在馬だけ。成立するのは祖先ペアによるもの。
    expect(established).toBeGreaterThan(0);
  }, 60_000);

  it('中止を受け付け、それまでの結果を残す', async () => {
    const { env, request } = fixture(DEFAULT_RULES);
    let calls = 0;
    const report = await searchDesigns(env, { ...request, goals: [{ type: 'omoshiro' }] }, { yieldEvery: 1, shouldStop: () => ++calls > 50, onProgress: () => undefined });
    expect(report.status).toBe('中止');
    expect(calls).toBe(51);
  });
});

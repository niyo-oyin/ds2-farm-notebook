import { describe, it, expect } from 'vitest';
import { baseMaster } from '../src/data/base-master';
import { HorseResolver, makeFoalRecord, unknownRecord } from '../src/core/pedigree';
import { judge, makeContext } from '../src/core/judge';
import { DEFAULT_RULES, type RuleOptions } from '../src/core/rules';
import { searchLineage, searchLineageForward, bruteForceOneGeneration, summarize, type SearchEnv, type SearchRequest, type SearchResult } from '../src/core/search';

const M = baseMaster;
const ctx = makeContext(M);
const resolver = new HorseResolver(M, [], DEFAULT_RULES);
const env = { ctx, rules: DEFAULT_RULES, resolve: (k: string) => resolver.get(k) };
const key = (r: SearchResult) => r.steps.map((s) => s.sire).join('>');
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
  it('枝刈り付き探索と単純全探索の結果が一致する（小さな候補集合）', async () => {
    const pool = M.stallions.slice(0, 25).map((s) => s.id);
    for (const goals of [
      [{ type: 'omoshiro' as const }, { type: 'notDangerous' as const }, { type: 'nitro' as const, stat: 'speed' as const, min: 5 }],
      [{ type: 'kotta' as const }, { type: 'notDangerous' as const }],
      [{ type: 'cross' as const, ancestorId: M.ancestors.find(a => a.name === 'サンデーサイレンス')!.id, name: 'サンデーサイレンス' }, { type: 'maxCrosses' as const, max: 3 }],
      [{ type: 'nicks' as const, min: 1 }, { type: 'outbreed' as const }],
      [{ type: 'nitro' as const, stat: 'speed' as const, min: 14 }, { type: 'avoidEffect' as const, effect: '気性難' }],
      [{ type: 'crossEffect' as const, effect: '速力', min: 2 }, { type: 'minCrosses' as const, min: 2 }, { type: 'maxCrosses' as const, max: 4 }],
    ]) {
      for (const finalStallion of [M.stallions[0].id, null]) {
        const req: SearchRequest = {
          startMare: goals.some((g) => g.type === 'nicks') ? M.broodmares.find((m) => m.name === 'ヴェイパー')!.id : M.broodmares[2].id, stallionPool: pool, intermediateStallion: null, finalStallion, finalPool: finalStallion ? null : pool.slice(0, 8),
          minMatings: 1, maxMatings: 3, goals, maxCost: null, maxEvaluations: 10_000_000, allowRepeatStallion: true,
        };
        const pruned = await searchLineageForward(env, req, {}, true);
        const plain = await searchLineageForward(env, req, {}, false);
        expect(plain.status).toBe('完了');
        expect(plain.results.length, `${goals.map((g) => g.type).join('+')} / ${finalStallion ?? '候補から選択'}`).toBeGreaterThan(0);
        expect(pruned.status).toBe('完了');
        expect(new Set(pruned.results.map(key))).toEqual(new Set(plain.results.map(key)));
        expect(pruned.evaluated).toBeLessThanOrEqual(plain.evaluated);
        // 逆順探索でも各組み合わせを漏れなく返す
        const layered = await searchLineage(env, req);
        expect(layered.status).toBe('完了');
        const expanded = new Set(layered.results.map(key));
        expect(expanded).toEqual(new Set(plain.results.map(key)));
        expect(layered.results.length).toBe(plain.results.length);
      }
    }
  }, 120_000);
  it('費用上限と同一種牡馬の禁止を保ち、成立する全経路を返す', async () => {
    const pool = M.stallions.slice(0, 30).map((s) => s.id);
    const req: SearchRequest = {
      startMare: M.broodmares[0].id, stallionPool: pool, intermediateStallion: null, finalStallion: null, finalPool: null,
      minMatings: 2, maxMatings: 2, goals: [], maxCost: 1200, maxEvaluations: 1e6, allowRepeatStallion: false,
    };
    const expected = await searchLineageForward(env, req);
    const actual = await searchLineage(env, req);
    expect(actual.status).toBe('完了');
    expect(actual.results.length).toBeGreaterThan(0);
    expect(actual.results.map(key).sort()).toEqual(expected.results.map(key).sort());
    for (const row of actual.results) {
      expect(row.cost).toBeLessThanOrEqual(1200);
      expect(row.matings).toBe(2);
      expect(row.steps[0].sire).not.toBe(row.steps[1].sire);
    }
  });

  it('シャトーブランシュからディープインパクト→シスキンを個別の費用・判定で返す', async () => {
    const start = M.broodmares.find((horse) => horse.name === 'シャトーブランシュ')!;
    const deep = M.stallions.find((horse) => horse.name === 'ディープインパクト')!;
    const siskin = M.stallions.find((horse) => horse.name === 'シスキン')!;
    const found: SearchResult[] = [];
    const result = await searchLineage(env, {
      startMare: start.id, stallionPool: M.stallions.map((horse) => horse.id), intermediateStallion: null, finalStallion: null, finalPool: null,
      minMatings: 2, maxMatings: 2, goals: [{ type: 'migoto' }], maxCost: null, maxEvaluations: 1e6, allowRepeatStallion: true,
    }, { onFound: (row) => { found.push(row); } });
    expect(result.status).toBe('完了');
    expect(result.results.length).toBeGreaterThan(200);
    expect(found.map(key).sort()).toEqual(result.results.map(key).sort());
    expect(new Set(result.results.map(key)).size).toBe(result.results.length);
    const row = result.results.find((row) => key(row) === `${deep.id}>${siskin.id}`)!;
    expect(row).toBeDefined();
    expect(row.cost).toBe(resolver.get(deep.id)!.price + resolver.get(siskin.id)!.price);
    const mare = resolver.get(start.id)!, sire = resolver.get(deep.id)!;
    const daughter = makeFoalRecord(sire, mare, { key: 'p:test', name: '産駒', sex: 'F', kind: 'planned' }, DEFAULT_RULES);
    expect(row.steps[0].judgement).toEqual(summarize(judge(sire, mare, ctx)));
    expect(row.steps[1].judgement).toEqual(summarize(judge(resolver.get(siskin.id)!, daughter, ctx)));
    expect(row.steps[1].judgement.migoto).toBe('成立');
    const restricted = await searchLineage(env, { ...result.request, intermediateStallion: deep.id });
    expect(restricted.results).toEqual(result.results.filter((row) => row.steps[0].sire === deep.id));
    expect(restricted.evaluated).toBeLessThan(result.evaluated);
  });

});

function fixture(rules: RuleOptions, unknown = false) {
  const start = { ...unknownRecord('start'), omoshiro: unknown ? '?bcd' : 'abcd' };
  const pool = ['aabb', 'ccdd', 'bbaa', 'ddcc', 'aaaa', unknown ? '?edd' : 'bbee'].map((omoshiro, i) => ({
    ...unknownRecord(`sire:${i}`), omoshiro, price: (i + 1) * 100,
  }));
  const finals = ['abcd', 'aabc', ...(unknown ? ['?bcd'] : [])].map((migoto, i) => ({
    ...unknownRecord(`final:${i}`), migoto, omoshiro: 'efgh', price: 100,
  }));
  const horses = new Map([start, ...pool, ...finals].map((horse) => [horse.key, horse]));
  const env: SearchEnv = { ctx: makeContext(M, rules), rules, resolve: (key) => horses.get(key) ?? null };
  const request: SearchRequest = {
    startMare: start.key, stallionPool: pool.map((horse) => horse.key),
    intermediateStallion: null, finalStallion: null, finalPool: finals.map((horse) => horse.key),
    minMatings: 1, maxMatings: 4, goals: [], maxCost: null,
    maxEvaluations: 1_000_000, allowRepeatStallion: true,
  };
  return { env, request };
}

async function expectExhaustiveMatch(env: SearchEnv, request: SearchRequest) {
  const expected = await searchLineageForward(env, request, {}, false);
  const actual = await searchLineage(env, request);
  expect(expected.status).toBe('完了');
  expect(actual.status).toBe('完了');
  expect(new Set(actual.results.map(key))).toEqual(new Set(expected.results.map(key)));
  expect(actual.evaluated).toBeLessThanOrEqual(expected.evaluated);
  return actual;
}

describe('途中で使う種牡馬の指定', () => {
  it.each([true, false])('複数世代のどの途中位置にも使え、費用と再利用 %s の条件を守る', async (allowRepeatStallion) => {
    const { env, request } = fixture(DEFAULT_RULES);
    for (const maxCost of [null, 900]) {
      const req = { ...request, allowRepeatStallion, maxCost };
      const all = await searchLineageForward(env, req, {}, false);
      const required = request.stallionPool[0];
      const expected = all.results.filter((row) => row.steps.slice(0, -1).some((step) => step.sire === required));
      const actual = await searchLineage(env, { ...req, intermediateStallion: required });
      const forward = await searchLineageForward(env, { ...req, intermediateStallion: required }, {}, false);
      expect(actual.status).toBe('完了');
      expect(expected.length).toBeGreaterThan(0);
      expect(actual.results.map(key).sort()).toEqual(expected.map(key).sort());
      expect(forward.results.map(key).sort()).toEqual(expected.map(key).sort());
    }
  });

  it('最後に使うだけでは条件を満たさず、途中と最後の両方で使うには再利用の許可が必要', async () => {
    const { env, request } = fixture(DEFAULT_RULES);
    const required = request.stallionPool[0];
    const req = { ...request, minMatings: 1, maxMatings: 2, intermediateStallion: required, finalStallion: required };
    const one = await searchLineage(env, { ...req, maxMatings: 1 });
    expect(one.results).toEqual([]);
    const repeated = await searchLineage(env, req);
    expect(repeated.results.map(key)).toEqual([`${required}>${required}`]);
    const distinct = await searchLineage(env, { ...req, allowRepeatStallion: false });
    expect(distinct.results).toEqual([]);
    expect(distinct.evaluated).toBe(0);
  });

  it('指定した馬が候補から外れている場合は、指定を無視せずエラーにする', async () => {
    const { env, request } = fixture(DEFAULT_RULES);
    await expect(searchLineage(env, { ...request, intermediateStallion: 'missing' })).rejects.toThrow('途中で使う種牡馬が探索候補に含まれていません');
  });
});

describe('探索条件に応じた系統の事前絞り込み', () => {
  it.each([
    ['種類の一致', {}, false],
    ['個数を含む一致', { migotoMode: 'multiset' }, false],
    ['一致する種類数の下限', { migotoMinSystems: 4 }, false],
    ['面白い配合の種類数変更', { omoshiroThreshold: 8 }, false],
    ['不明な系統を含む', {}, true],
    ['個数を含む一致と不明な系統', { migotoMode: 'multiset' }, true],
  ] as [string, Partial<RuleOptions>, boolean][])('%sでも4世代までの全探索と一致する', async (_, patch, unknown) => {
    const { env, request } = fixture({ ...DEFAULT_RULES, ...patch }, unknown);
    for (const type of ['omoshiro', 'migoto', 'perfect'] as const) {
      await expectExhaustiveMatch(env, { ...request, goals: [{ type }] });
    }
  }, 30_000);

  it.each([true, false])('費用上限と再利用 %s を保ち、成立する経路を取りこぼさない', async (allowRepeatStallion) => {
    const { env, request } = fixture(DEFAULT_RULES);
    const result = await expectExhaustiveMatch(env, {
      ...request, goals: [{ type: 'perfect' }], maxCost: 900, allowRepeatStallion,
    });
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('逆向きの凝ったペアしかない経路を除外し、詳細判定の回数を減らす', async () => {
    const start = M.broodmares.find((horse) => horse.name === 'ドントテルソフィア')!;
    const final = M.stallions.find((horse) => horse.name === 'Not This Time')!;
    const sunday = M.stallions.find((horse) => horse.name === 'サンデーサイレンス')!;
    const pool = M.stallions.map((horse) => horse.id);
    const request: SearchRequest = {
      startMare: start.id, stallionPool: pool, intermediateStallion: null, finalStallion: final.id, finalPool: null,
      minMatings: 1, maxMatings: 2, goals: [{ type: 'perfectKotta' }], maxCost: null,
      maxEvaluations: 1_000_000, allowRepeatStallion: true,
    };
    const result = await expectExhaustiveMatch(env, request);
    expect(new Set(result.results.map(key)).has(`${sunday.id}>${final.id}`)).toBe(false);
    expect(result.evaluated).toBeLessThan(pool.length / 2);
  });

  it('系統で全候補が除外されても進捗を通知し中止できる', async () => {
    const { env, request } = fixture(DEFAULT_RULES);
    const progress: number[] = [];
    const result = await searchLineage(env, {
      ...request, minMatings: 1, maxMatings: 1, goals: [{ type: 'perfect' }], finalPool: ['final:1'],
    }, {
      yieldEvery: 1, shouldStop: () => true,
      onProgress: (state) => { progress.push(state.pruned); },
    });
    expect(result.status).toBe('中止');
    expect(result.evaluated).toBe(0);
    expect(progress).toEqual([1]);
    expect(result.results).toEqual([]);
  });
});

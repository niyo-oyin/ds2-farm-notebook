// 凝った配合ループの探索: 種牡馬を決まった順で回し、毎世代の産駒牝馬に次の種牡馬を付け続けても目標が成立し続ける周期を探す。
// 定常状態（元の繁殖牝馬が4代の外へ抜けた後）では、母側の血統は直近の種牡馬だけで決まるので、周期の列だけで判定できる。
import type { HorseKey, HorseRecord, Verdict } from './types';
import { makeFoalRecord, unknownRecord } from './pedigree';
import { isMasterKey } from './horse-identity';
import { judge } from './judge';
import { goalVerdict, summarize, type JudgementSummary, type SearchEnv, type SearchGoal, type SearchHooks, type SearchResult, type SearchStatus } from './search';

export interface LoopRequest {
  stallionPool: HorseKey[];
  minLength: number;
  maxLength: number;
  /** 周期のどの世代でも成立させる目標 */
  goals: SearchGoal[];
  /** 1周の種付料合計の上限 */
  maxCost: number | null;
  maxEvaluations: number;
}
export interface LoopStep { sire: HorseKey; sireName: string; cost: number; judgement: JudgementSummary; constraints: string[] }
export interface LoopResult { steps: LoopStep[]; length: number; cost: number; goals: { goal: SearchGoal; verdict: Verdict }[] }
export interface LoopReport { status: SearchStatus; results: LoopResult[]; evaluated: number; pruned: number; elapsedMs: number; request: LoopRequest }

/** 血統表のノード 1..limit のID（マスターの馬の祖先だけ） */
const namesUpTo = (rec: HorseRecord, limit: number): string[] => {
  const out: string[] = [];
  for (let n = 1; n <= limit; n++) { const key = rec.nodes[n]; if (isMasterKey(key)) out.push(key); }
  return out;
};

/** 周期を 2 周ぶん回した仮の牝系。前半で元の牝馬の影響を抜き、後半の各世代を判定する */
function steadyStateJudgements(env: SearchEnv, cycle: HorseRecord[]) {
  const L = cycle.length;
  let mare = unknownRecord('?:base', '（起点）');
  const total = 2 * L + 4;
  const out: { sire: HorseRecord; judgement: ReturnType<typeof judge> }[] = [];
  for (let n = 0; n < total; n++) {
    const s = cycle[n % L];
    if (n >= total - L) out.push({ sire: s, judgement: judge(s, mare, env.ctx) });
    mare = makeFoalRecord(s, mare, { key: `p:loop${n}:${s.key}`, name: `${n + 1}代目（${s.name}産駒）`, sex: 'F', kind: 'planned' }, env.rules);
  }
  return out;
}

/** 周期を深さ優先で列挙する。凝った配合と危険な配合の目標はペア表と1×Nの条件で先に枝を切り、残りは本物の判定で確かめる */
export async function searchLoops(env: SearchEnv, req: LoopRequest, hooks: SearchHooks<LoopResult> = {}): Promise<LoopReport> {
  const t0 = Date.now();
  const pool = req.stallionPool.map((k) => env.resolve(k)).filter((r): r is HorseRecord => !!r && r.missingSlots === 0);
  if (!pool.length) throw new Error('種牡馬の候補がありません');
  const report: LoopReport = { status: '完了', results: [], evaluated: 0, pruned: 0, elapsedMs: 0, request: req };
  const wantKotta = req.goals.some((g) => g.type === 'kotta' || g.type === 'perfectKotta');
  // 自家製種牡馬の血統から成立するペアは登録表にないため、表だけで枝を切らない。
  const canPruneKotta = wantKotta && env.rules.kottaGenerations === 4 && !(env.rules.kottaEstimateHomebred && pool.some(s => s.nodes.some((key, n) => n > 0 && n < 16 && (n === 1 || n % 2 === 0) && key && !isMasterKey(key))));
  const wantSafe = req.goals.some((g) => g.type === 'notDangerous');
  const pairs = env.ctx.kottaPairs;
  // 種牡馬ごとに、母側に来た時のID（世代数ごと）と、その相手を4代以内に持つ種牡馬の集合を前計算する
  const names4 = new Map<HorseRecord, string[]>(pool.map((s) => [s, [...new Set(namesUpTo(s, 15))]]));
  const holders = new Map<string, HorseRecord[]>();
  for (const s of pool) for (const nm of names4.get(s)!) { if (!holders.has(nm)) holders.set(nm, []); holders.get(nm)!.push(s); }
  const partners = new Map<string, Set<string>>();
  for (const key of pairs) { const [a, b] = key.split('|'); if (!partners.has(b)) partners.set(b, new Set()); partners.get(b)!.add(a); }
  const holdersOfPartners = (names: string[]) => { const set = new Set<HorseRecord>(); for (const b of names) for (const a of partners.get(b) ?? []) for (const s of holders.get(a) ?? []) set.add(s); return set; };
  // 母父（3代分）・母母父（2代分）・母母母父（自身）として見た時に、凝ったペアを作れる種牡馬
  const via = [7, 3, 1].map((limit) => new Map<HorseRecord, Set<HorseRecord>>(pool.map((s) => [s, holdersOfPartners(namesUpTo(s, limit))])));
  // 1×N の検査用: 母側5代に現れるID（母父の4代、母母父の3代、母母母父の2代、母母母母父自身）
  const namesAt = [15, 7, 3, 1].map((limit) => new Map<HorseRecord, Set<string>>(pool.map((s) => [s, new Set(namesUpTo(s, limit))])));
  /** prev は直前の世代から新しい順 */
  const kottaOk = (s: HorseRecord, prev: HorseRecord[]) => prev.slice(0, 3).some((p, k) => via[k].get(p)!.has(s));
  const safeOk = (s: HorseRecord, prev: HorseRecord[]) => !prev.slice(0, 4).some((p, k) => namesAt[k].get(p)!.has(s.key));
  const candidates = (prev: HorseRecord[]): HorseRecord[] => {
    if (!canPruneKotta) return pool;
    const set = new Set<HorseRecord>();
    prev.slice(0, 3).forEach((p, k) => { for (const s of via[k].get(p)!) set.add(s); });
    return [...set];
  };

  let sinceYield = 0, stopped = false;
  const yieldEvery = hooks.yieldEvery ?? 20000;
  const tick = async () => {
    if (++sinceYield >= yieldEvery) {
      sinceYield = 0;
      await hooks.onProgress?.({ evaluated: report.evaluated, pruned: report.pruned, found: report.results.length, depth: 0 });
      if (hooks.shouldStop?.()) { stopped = true; report.status = '中止'; }
    }
    if (report.evaluated >= req.maxEvaluations) { stopped = true; report.status = '判定回数上限'; }
  };
  /** 直前の世代（新しい順）を、周期の末尾から巻き戻して返す */
  const previous = (cycle: HorseRecord[], i: number, count: number) => Array.from({ length: count }, (_, k) => cycle[(i - 1 - k + cycle.length) % cycle.length]);

  const verify = async (cycle: HorseRecord[]) => {
    const L = cycle.length;
    // 周期の先頭3世代は、列が閉じて初めて相手が決まる
    for (let i = 0; i < Math.min(4, L); i++) {
      const prev = previous(cycle, i, 4);
      if (canPruneKotta && !kottaOk(cycle[i], prev)) { report.pruned++; return; }
      if (wantSafe && !safeOk(cycle[i], prev)) { report.pruned++; return; }
    }
    const judged = steadyStateJudgements(env, cycle);
    report.evaluated += L;
    const steps: LoopStep[] = [];
    const verdicts = req.goals.map((g) => ({ goal: g, verdict: '成立' as Verdict }));
    for (const { sire, judgement } of judged) {
      for (const v of verdicts) { const r = goalVerdict(judgement, v.goal); if (r === '不成立' || (r === '未確定' && v.verdict === '成立')) v.verdict = r; }
      steps.push({ sire: sire.key, sireName: sire.name, cost: sire.price, judgement: summarize(judgement), constraints: sire.constraints });
    }
    if (verdicts.some((v) => v.verdict !== '成立')) { report.pruned++; return; }
    const result: LoopResult = { steps, length: L, cost: steps.reduce((c, s) => c + s.cost, 0), goals: verdicts };
    report.results.push(result);
    hooks.onFound?.(result);
  };

  for (let L = Math.max(2, req.minLength); L <= req.maxLength && !stopped; L++) {
    const cycle: HorseRecord[] = [];
    const rec = async (i: number, cost: number): Promise<void> => {
      if (stopped) return;
      if (i === L) { await verify(cycle); return; }
      // 4世代目以降は直前の世代が確定しているので、ここで枝を切る
      const prev = cycle.slice(Math.max(0, i - 4), i).reverse();
      const cands = i >= 3 ? candidates(prev) : pool;
      for (const s of cands) {
        if (stopped) return;
        await tick();
        // 回転して同じ周期は、先頭が最小キーのものだけ数える
        if (i > 0 && s.key < cycle[0].key) continue;
        const nextCost = cost + s.price;
        if (req.maxCost != null && nextCost > req.maxCost) { report.pruned++; continue; }
        // 凝ったペアは直前3世代が揃ってから、1×N は分かっている範囲で先に切る
        if (i >= 3 && canPruneKotta && !kottaOk(s, prev)) { report.pruned++; continue; }
        if (wantSafe && (cycle.some((c) => c.key === s.key) || !safeOk(s, prev))) { report.pruned++; continue; }
        cycle.push(s);
        await rec(i + 1, nextCost);
        cycle.pop();
      }
    };
    await rec(0, 0);
  }
  report.results.sort((a, b) => a.length - b.length || a.cost - b.cost);
  report.elapsedMs = Date.now() - t0;
  return report;
}

/** 選んだ繁殖牝馬から周期を1周した実際の経路（計画として保存する用） */
export function loopFromMare(env: SearchEnv, mareKey: HorseKey, cycle: HorseKey[], goals: SearchGoal[]): SearchResult {
  const start = env.resolve(mareKey);
  if (!start) throw new Error('起点の繁殖牝馬が見つかりません');
  const sires = cycle.map((k) => env.resolve(k)).filter((r): r is HorseRecord => !!r);
  if (sires.length !== cycle.length) throw new Error('種牡馬が見つかりません');
  let mare = start;
  const steps: SearchResult['steps'] = [];
  // 1周目は元の牝馬の血統が残るので、定常状態と違って目標が崩れる世代があり得る。世代ごとの最悪の判定を返す
  const verdicts = goals.map((g) => ({ goal: g, verdict: '成立' as Verdict }));
  sires.forEach((s, i) => {
    const j = judge(s, mare, env.ctx);
    for (const v of verdicts) { const r = goalVerdict(j, v.goal); if (r === '不成立' || (r === '未確定' && v.verdict === '成立')) v.verdict = r; }
    const foal = makeFoalRecord(s, mare, { key: `p:loop${i}:${s.key}`, name: `${mare.name}の${i + 1}代目（${s.name}産駒）`, sex: 'F', kind: 'planned' }, env.rules);
    steps.push({ sire: s.key, sireName: s.name, dam: mare.key, damName: mare.name, cost: s.price, foalName: foal.name, judgement: summarize(j), constraints: [...s.constraints, ...(i === 0 ? mare.constraints : [])] });
    mare = foal;
  });
  return { steps, matings: steps.length, cost: steps.reduce((c, s) => c + s.cost, 0), goals: verdicts };
}

// 凝った配合ループの探索: 種牡馬を決まった順で回し、毎世代の産駒牝馬に次の種牡馬を付け続けても目標が成立し続ける周期を探す。
// 定常状態（元の繁殖牝馬が4代の外へ抜けた後）では、母側の血統は直近の種牡馬だけで決まるので、周期の列だけで判定できる。
import type { HorseKey, HorseRecord, Judgement, Verdict } from './types';
import { makeFoalRecord, unknownRecord } from './pedigree';
import { isMasterKey } from './horse-identity';
import { judge } from './judge';
import { goalVerdict, summarize, type JudgementSummary, type SearchEnv, type SearchGoal, type SearchHooks, type SearchResult, type SearchStatus, type SearchStep } from './search';

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

/** 起点の血が抜けるまでに周期を付ける回数。5代血統の外へ出るまで、ただし1周は必ず含める */
const entrySpan = (length: number) => Math.max(length, 5);

type Mating = { sire: HorseRecord; dam: HorseRecord; judgement: Judgement };

const foalOf = (env: SearchEnv, start: HorseRecord, s: HorseRecord, m: HorseRecord, i: number) =>
  makeFoalRecord(s, m, { key: `p:loop${i}:${s.key}`, name: `${start.name}の${i + 1}代目（${s.name}産駒）`, sex: 'F', kind: 'planned' }, env.rules);

/** 導入の配合（offset 回）を付けた後の牝馬から、周期を rotation 番目の種牡馬で入った区間が目標を満たせば、各世代の配合を返す */
function tryRotation(env: SearchEnv, start: HorseRecord, mare: HorseRecord, offset: number, cycle: HorseRecord[], rotation: number, goals: SearchGoal[], count: () => boolean): Mating[] | null {
  const matings: Mating[] = [];
  let m = mare;
  for (let n = 0; n < entrySpan(cycle.length); n++) {
    const s = cycle[(rotation + n) % cycle.length];
    if (!count()) return null;
    const j = judge(s, m, env.ctx);
    if (goals.some((g) => goalVerdict(j, g) !== '成立')) return null;
    matings.push({ sire: s, dam: m, judgement: j });
    m = foalOf(env, start, s, m, offset + n);
  }
  return matings;
}

function toResult(env: SearchEnv, start: HorseRecord, matings: Mating[], goals: SearchGoal[]): SearchResult {
  const steps: SearchStep[] = matings.map(({ sire, dam, judgement }, i) => ({
    sire: sire.key, sireName: sire.name, dam: dam.key, damName: dam.name, cost: sire.price,
    foalName: foalOf(env, start, sire, dam, i).name, judgement: summarize(judgement), constraints: [...sire.constraints, ...(i === 0 ? start.constraints : [])],
  }));
  return { steps, matings: steps.length, cost: steps.reduce((c, s) => c + s.cost, 0), goals: goals.map((goal) => ({ goal, verdict: '成立' as Verdict })) };
}

const resolveEntry = (env: SearchEnv, mareKey: HorseKey, cycleKeys: HorseKey[]) => {
  const start = env.resolve(mareKey);
  if (!start) throw new Error('起点の繁殖牝馬が見つかりません');
  const cycle = cycleKeys.map((k) => env.resolve(k)).filter((r): r is HorseRecord => !!r);
  if (cycle.length !== cycleKeys.length) throw new Error('種牡馬が見つかりません');
  return { start, cycle };
};

export interface LoopEntryRequest {
  mare: HorseKey;
  /** 周期の種牡馬の並び */
  cycle: HorseKey[];
  goals: SearchGoal[];
  /** 導入に使う種牡馬の候補 */
  bridgePool: HorseKey[];
  /** 導入の配合の最大回数 */
  maxBridge: number;
  maxEvaluations: number;
}
export interface LoopEntryReport {
  status: SearchStatus;
  /** 導入の配合と周期の区間を合わせた経路。見つからなければ null */
  result: SearchResult | null;
  /** 経路のうち導入の配合の回数 */
  bridge: number;
  evaluated: number;
  elapsedMs: number;
}

/**
 * 起点の繁殖牝馬から周期に入る実際の経路（計画として保存する用）。
 * 起点の血が5代の外へ抜けるまでは定常状態と判定が違うので、その区間（周期が5以上なら1周）の全世代で目標を確かめる。
 * 周期の入り方（どの種牡馬から付け始めるか）をすべて試し、どの入り方でも崩れるときは周期の前に導入の配合を挟む。
 * 導入の回数が少ない経路を優先し、同じ回数では導入の種付料が最も安い経路を採る。
 * 導入の配合そのものには目標を課さないが、危険な配合を避ける目標があれば導入でも避ける。
 */
export async function searchLoopEntry(env: SearchEnv, req: LoopEntryRequest, hooks: SearchHooks<never> = {}): Promise<LoopEntryReport> {
  const t0 = Date.now();
  const { start, cycle } = resolveEntry(env, req.mare, req.cycle);
  const pool = req.bridgePool.map((k) => env.resolve(k)).filter((r): r is HorseRecord => !!r);
  const wantSafe = req.goals.some((g) => g.type === 'notDangerous');
  const report: LoopEntryReport = { status: '完了', result: null, bridge: 0, evaluated: 0, elapsedMs: 0 };
  let sinceYield = 0, stopped = false;
  const yieldEvery = hooks.yieldEvery ?? 2000;
  const count = () => {
    if (report.evaluated >= req.maxEvaluations) { stopped = true; report.status = '判定回数上限'; }
    if (stopped) return false;
    report.evaluated++;
    return true;
  };
  const tick = async () => {
    if (++sinceYield < yieldEvery) return;
    sinceYield = 0;
    await hooks.onProgress?.({ evaluated: report.evaluated, pruned: 0, found: 0, depth: 0 });
    if (hooks.shouldStop?.()) { stopped = true; report.status = '中止'; }
  };
  let best: { matings: Mating[]; bridgeCost: number } | null = null;
  const rec = async (mare: HorseRecord, bridge: Mating[], remaining: number, cost: number): Promise<void> => {
    if (stopped || (best && best.bridgeCost <= cost)) return;
    if (remaining === 0) {
      for (let r = 0; r < cycle.length && !stopped; r++) {
        await tick();
        const matings = tryRotation(env, start, mare, bridge.length, cycle, r, req.goals, count);
        if (matings) { best = { matings: [...bridge, ...matings], bridgeCost: cost }; return; }
      }
      return;
    }
    for (const s of pool) {
      if (stopped) return;
      if (best && best.bridgeCost <= cost + s.price) continue;
      if (!count()) return;
      await tick();
      const j = judge(s, mare, env.ctx);
      if (wantSafe && j.dangerous.verdict !== '不成立') continue;
      await rec(foalOf(env, start, s, mare, bridge.length), [...bridge, { sire: s, dam: mare, judgement: j }], remaining - 1, cost + s.price);
    }
  };
  for (let b = 0; b <= req.maxBridge && !stopped && !best; b++) await rec(start, [], b, 0);
  const found = best as { matings: Mating[] } | null;
  if (found) {
    report.result = toResult(env, start, found.matings, req.goals);
    report.bridge = found.matings.length - entrySpan(cycle.length);
  }
  report.elapsedMs = Date.now() - t0;
  return report;
}

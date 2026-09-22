// 配合探索: 1世代の総当たりと、牝系を進める枝刈り付き全探索。
import type { HorseKey, HorseRecord, Judgement, Verdict } from './types';
import { makeFoalRecord, unknownRecord } from './pedigree';
import { judge, type JudgeContext } from './judge';
import type { RuleOptions } from './rules';
import { createSystemPrefilter } from './search-prefilter';

export type GoalType = 'omoshiro' | 'migoto' | 'perfect' | 'perfectKotta' | 'kotta' | 'nicks' | 'notDangerous' | 'outbreed' | 'cross' | 'crossEffect' | 'maxCrosses' | 'minCrosses' | 'avoidEffect' | 'nitro' | 'mareCross' | 'inheritEffect';
export type NitroStat = 'speed' | 'stamina' | 'power';
export const NITRO_LABEL: Record<NitroStat, string> = { speed: 'スピード', stamina: 'スタミナ', power: 'パワー' };
export interface SearchGoal {
  type: GoalType;
  name?: string;    // cross: 表示用の祖先名
  ancestorId?: string; // cross: 対象の個体ID
  effect?: string;  // crossEffect: 効果名
  min?: number;     // nicks / crossEffect の最小値
  max?: number;     // maxCrosses の最大本数
  stat?: NitroStat; // nitro の対象
}

export const GOAL_LABELS: Record<GoalType, string> = {
  omoshiro: '面白い配合', migoto: '見事な配合', perfect: '完璧な配合', perfectKotta: '完璧／凝った配合', kotta: '凝った配合', nicks: 'ニックス',
  notDangerous: '危険な配合でない', outbreed: 'アウトブリード', cross: '指定祖先のクロス', crossEffect: '指定効果のクロス',
  maxCrosses: 'クロス本数の上限', minCrosses: 'クロス本数の下限', avoidEffect: '避けたい効果のクロス', nitro: 'ニトロの下限（前作由来）', mareCross: '牝馬クロス',
  inheritEffect: 'アウトブリードで父似・母似どちらでも発動し得る効果',
};

export function goalLabel(g: SearchGoal): string {
  switch (g.type) {
    case 'cross': return `${g.name} のクロス`;
    case 'crossEffect': return `${g.effect} のクロス ${g.min ?? 1}本以上`;
    case 'nicks': return `ニックス 段階${g.min ?? 1}以上`;
    case 'maxCrosses': return `クロス ${g.max ?? 6}本以下`;
    case 'minCrosses': return `クロス ${g.min ?? 1}本以上`;
    case 'avoidEffect': return `${g.effect} のクロスなし`;
    case 'nitro': return `ニトロ ${NITRO_LABEL[g.stat ?? 'speed']} ${g.min ?? 1}以上`;
    case 'mareCross': return `牝馬クロス ${g.min ?? 1}本以上`;
    case 'inheritEffect': return `アウトブリードで両側4代内に ${g.effect} の因子`;
    default: return GOAL_LABELS[g.type];
  }
}

/** 目標に対する判定。未確定は「不明な祖先次第で成立し得る」を意味する */
export function goalVerdict(j: Judgement, g: SearchGoal): Verdict {
  switch (g.type) {
    case 'omoshiro': return j.omoshiro.verdict;
    case 'migoto': return j.migoto.verdict;
    case 'perfect': return j.perfect.verdict;
    case 'perfectKotta': return j.perfectKotta.verdict;
    case 'kotta': return j.kotta.verdict;
    case 'outbreed': return j.outbreed.verdict;
    case 'nicks': {
      if (j.nicks.verdict === '未確定') return '未確定';
      return j.nicks.level >= (g.min ?? 1) ? '成立' : '不成立';
    }
    case 'notDangerous': {
      if (j.dangerous.verdict === '成立') return '不成立';
      return j.dangerous.verdict === '不成立' ? '成立' : '未確定';
    }
    case 'cross': {
      const hit = j.crosses.some((c) => c.key === g.ancestorId);
      return hit ? '成立' : j.hasUnknownSlots ? '未確定' : '不成立';
    }
    case 'crossEffect': {
      const n = j.crosses.filter((c) => c.effects.includes(g.effect ?? '')).length;
      if (n >= (g.min ?? 1)) return '成立';
      return j.hasUnknownSlots || j.crosses.some((c) => !c.effectsKnown) ? '未確定' : '不成立';
    }
    case 'maxCrosses': {
      if (j.crosses.length > (g.max ?? 6)) return '不成立';
      return j.hasUnknownSlots ? '未確定' : '成立';
    }
    case 'minCrosses': {
      if (j.crosses.length >= (g.min ?? 1)) return '成立';
      return j.hasUnknownSlots ? '未確定' : '不成立';
    }
    case 'avoidEffect': {
      // 効果不明の共通祖先（祖先マスター未登録）は避けられているか判断できない
      if (j.crosses.some((c) => c.effects.includes(g.effect ?? ''))) return '不成立';
      return j.hasUnknownSlots || j.crosses.some((c) => !c.effectsKnown) ? '未確定' : '成立';
    }
    case 'nitro': {
      // 不明な欄が埋まると値は増えることはあっても減らない（重複排除は増分を減らすだけ）
      const v = j.nitroReference[g.stat ?? 'speed'];
      if (v >= (g.min ?? 1)) return '成立';
      return j.hasUnknownSlots || j.nitroReference.unknownNames.length > 0 ? '未確定' : '不成立';
    }
    case 'mareCross': {
      if (j.mareCrossCount >= (g.min ?? 1)) return '成立';
      return j.hasUnknownSlots || j.crosses.some((c) => !c.effectsKnown) ? '未確定' : '不成立';
    }
    case 'inheritEffect': {
      // アウトブリードが前提。父似でも母似でも効果が候補にあること
      if (j.crosses.length) return '不成立';
      const e = g.effect ?? '';
      const both = j.inheritance.sireEffects.includes(e) && j.inheritance.damEffects.includes(e);
      if (both && !j.hasUnknownSlots) return '成立';
      if (!both && !j.hasUnknownSlots) return '不成立';
      return '未確定';
    }
  }
}

export interface SearchRequest {
  startMare: HorseKey;
  stallionPool: HorseKey[];
  finalStallion: HorseKey | null;
  /** 最後の配合を除く、いずれかの回で必ず使う種牡馬 */
  intermediateStallion: HorseKey | null;
  finalPool: HorseKey[] | null;
  minMatings: number;
  maxMatings: number;
  goals: SearchGoal[];
  maxCost: number | null;
  maxEvaluations: number;
  allowRepeatStallion: boolean;
}

export interface JudgementSummary {
  omoshiro: Verdict; migoto: Verdict; perfect: Verdict; perfectKotta: Verdict; kotta: Verdict; nicks: Verdict; nicksLevel: number;
  dangerous: Verdict; outbreed: Verdict; crosses: { name: string; gens: string; effects: string[] }[];
  crossCount: number; hasUnknownSlots: boolean; omoshiroCount: number | null;
  nitro: { speed: number; stamina: number; power: number };
  effectCounts: Record<string, number>;
  mareCrossCount: number;
}

export function summarize(j: Judgement): JudgementSummary {
  return {
    omoshiro: j.omoshiro.verdict, migoto: j.migoto.verdict, perfect: j.perfect.verdict, perfectKotta: j.perfectKotta.verdict, kotta: j.kotta.verdict,
    nicks: j.nicks.verdict, nicksLevel: j.nicks.level, dangerous: j.dangerous.verdict, outbreed: j.outbreed.verdict,
    crosses: j.crosses.map((c) => ({ name: c.name, gens: [...c.sireGens, ...c.damGens].sort().join('×'), effects: c.effects })),
    crossCount: j.crosses.length, hasUnknownSlots: j.hasUnknownSlots, omoshiroCount: j.omoshiro.count,
    nitro: { speed: j.nitroReference.speed, stamina: j.nitroReference.stamina, power: j.nitroReference.power },
    effectCounts: j.crosses.reduce<Record<string, number>>((m, c) => { for (const e of c.effects) m[e] = (m[e] ?? 0) + 1; return m; }, {}),
    mareCrossCount: j.mareCrossCount,
  };
}

export interface SearchStep {
  sire: HorseKey; sireName: string; dam: HorseKey; damName: string; cost: number;
  foalName: string; judgement: JudgementSummary;
  constraints?: string[];   // 解禁条件・購入など
}
export interface SearchResult {
  steps: SearchStep[];      // 最後の要素が最終配合
  matings: number;
  cost: number;             // 各予定交配を1回ずつ行う種付け料の合計
  goals: { goal: SearchGoal; verdict: Verdict }[];
}
export type SearchStatus = '完了' | '中止' | '判定回数上限';
export interface SearchReport {
  status: SearchStatus;
  results: SearchResult[];
  evaluated: number;
  pruned: number;
  dataIssues: number;       // 血統不足で未確定になった最終候補の数
  elapsedMs: number;
  request: SearchRequest;
}

export interface SearchHooks<R = SearchResult> {
  shouldStop?: () => boolean;
  onProgress?: (p: { evaluated: number; pruned: number; found: number; depth: number }) => void | Promise<void>;
  /** 結果が1件見つかるたびに呼ぶ。終了を待たずに順次表示するため */
  onFound?: (r: R) => void;
  yieldEvery?: number;
}

export interface SearchEnv {
  ctx: JudgeContext;
  rules: RuleOptions;
  resolve: (key: HorseKey) => HorseRecord | null;
}

/** 1世代の総当たり */
export function bruteForceOneGeneration(env: SearchEnv, sires: HorseKey[], dams: HorseKey[]): { sire: HorseKey; dam: HorseKey; judgement: Judgement }[] {
  const out: { sire: HorseKey; dam: HorseKey; judgement: Judgement }[] = [];
  for (const dk of dams) {
    const d = env.resolve(dk); if (!d) continue;
    for (const sk of sires) {
      const s = env.resolve(sk); if (!s) continue;
      out.push({ sire: sk, dam: dk, judgement: judge(s, d, env.ctx) });
    }
  }
  return out;
}

/** 時間順の深さ優先探索（検証用）。usePruning=false は単純全探索 */
export async function searchLineageForward(env: SearchEnv, req: SearchRequest, hooks: SearchHooks = {}, usePruning = true): Promise<SearchReport> {
  const t0 = Date.now();
  const start = env.resolve(req.startMare);
  if (!start) throw new Error('起点の繁殖牝馬が見つかりません');
  const pool = req.stallionPool.map((k) => env.resolve(k)).filter((r): r is HorseRecord => !!r);
  const intermediate = req.intermediateStallion ? pool.find((s) => s.key === req.intermediateStallion) : null;
  if (req.intermediateStallion && !intermediate) throw new Error('途中で使う種牡馬が探索候補に含まれていません。種牡馬の属性や利用可能な馬の設定を確認してください');
  const finals = req.finalStallion
    ? [env.resolve(req.finalStallion)].filter((r): r is HorseRecord => !!r)
    : (req.finalPool ?? req.stallionPool).map((k) => env.resolve(k)).filter((r): r is HorseRecord => !!r);
  if (!finals.length) throw new Error('最後に付ける種牡馬が見つかりません');
  const minFinalPrice = Math.min(...finals.map((f) => f.price));
  const minPoolPrice = pool.length ? Math.min(...pool.map((p) => p.price)) : 0;
  const unknownSire = unknownRecord();
  const report: SearchReport = { status: '完了', results: [], evaluated: 0, pruned: 0, dataIssues: 0, elapsedMs: 0, request: req };
  let sinceYield = 0;
  const yieldEvery = hooks.yieldEvery ?? 2000;
  let stopped = false;

  const tick = async (depth: number) => {
    if (++sinceYield >= yieldEvery) {
      sinceYield = 0;
      await hooks.onProgress?.({ evaluated: report.evaluated, pruned: report.pruned, found: report.results.length, depth });
      if (hooks.shouldStop?.()) { stopped = true; report.status = '中止'; }
    }
    if (report.evaluated >= req.maxEvaluations) { stopped = true; report.status = '判定回数上限'; }
  };

  /** 残り r 回の配合（最後を含む）でゴールが成立し得るか */
  const feasible = (mare: HorseRecord, remaining: number): boolean => {
    for (let r = 1; r <= remaining; r++) {
      let m = mare;
      for (let i = 1; i < r; i++) m = makeFoalRecord(unknownSire, m, { key: `?:${i}`, name: '（未定）', sex: 'F', kind: 'planned' }, env.rules);
      const candidates = req.finalStallion ? finals : [unknownSire];
      for (const f of candidates) {
        const j = judge(f, m, env.ctx);
        if (req.goals.every((g) => goalVerdict(j, g) !== '不成立')) return true;
      }
    }
    return false;
  };

  const dfs = async (mare: HorseRecord, depth: number, steps: SearchStep[], cost: number, used: Set<HorseKey>): Promise<void> => {
    if (stopped) return;
    const matings = depth + 1;
    const needsIntermediate = !!intermediate && !used.has(intermediate.key);
    if (matings >= req.minMatings && !needsIntermediate) {
      for (const f of finals) {
        if (stopped) return;
        if (!req.allowRepeatStallion && used.has(f.key)) continue;
        const total = cost + f.price;
        if (req.maxCost != null && total > req.maxCost) continue;
        const j = judge(f, mare, env.ctx);
        report.evaluated++;
        await tick(depth);
        const verdicts = req.goals.map((g) => ({ goal: g, verdict: goalVerdict(j, g) }));
        if (verdicts.every((v) => v.verdict === '成立')) {
          const result: SearchResult = {
            steps: [...steps, { sire: f.key, sireName: f.name, dam: mare.key, damName: mare.name, cost: f.price, foalName: '最終産駒', judgement: summarize(j), constraints: [...f.constraints, ...(steps.length === 0 ? mare.constraints : [])] }],
            matings, cost: total, goals: verdicts,
          };
          report.results.push(result);
          hooks.onFound?.(result);
        } else if (verdicts.some((v) => v.verdict === '未確定') && verdicts.every((v) => v.verdict !== '不成立')) {
          report.dataIssues++;
        }
      }
    }
    if (matings >= req.maxMatings) return;
    const candidates = needsIntermediate && matings === req.maxMatings - 1 ? [intermediate!] : pool;
    for (const s of candidates) {
      if (stopped) return;
      if (!req.allowRepeatStallion && used.has(s.key)) continue;
      const nextCost = cost + s.price;
      if (req.maxCost != null && nextCost + minFinalPrice > req.maxCost) { report.pruned++; continue; }
      if (req.maxCost != null && matings + 1 < req.minMatings && nextCost + minPoolPrice * (req.minMatings - matings - 1) + minFinalPrice > req.maxCost) { report.pruned++; continue; }
      const daughter = makeFoalRecord(s, mare, { key: `p:step${matings}:${s.key}`, name: `${mare.name}の${matings}代目（${s.name}産駒）`, sex: 'F', kind: 'planned' }, env.rules);
      if (usePruning && !feasible(daughter, req.maxMatings - matings)) { report.pruned++; continue; }
      const j = judge(s, mare, env.ctx);
      const step: SearchStep = { sire: s.key, sireName: s.name, dam: mare.key, damName: mare.name, cost: s.price, foalName: daughter.name, judgement: summarize(j), constraints: [...s.constraints, ...(steps.length === 0 ? mare.constraints : [])] };
      const nextUsed = new Set(used); nextUsed.add(s.key);
      await dfs(daughter, depth + 1, [...steps, step], nextCost, nextUsed);
    }
  };

  await dfs(start, 0, [], 0, new Set());
  report.elapsedMs = Date.now() - t0;
  return report;
}


/**
 * 牝系を進める探索。
 * 最終産駒の血統表への影響が大きい位置（最後の種牡馬 → 母の父 → 母母の父 …）から逆順に決める。
 * 各段階で残りの位置を「不明」にした最終産駒を判定し、目標が不成立なら枝を切る。
 * 成立する組み合わせは1経路ずつ返し、その組み合わせの費用と判定を持たせる。
 */
export async function searchLineage(env: SearchEnv, req: SearchRequest, hooks: SearchHooks = {}): Promise<SearchReport> {
  const t0 = Date.now();
  const start = env.resolve(req.startMare);
  if (!start) throw new Error('起点の繁殖牝馬が見つかりません');
  const pool = req.stallionPool.map((k) => env.resolve(k)).filter((r): r is HorseRecord => !!r);
  const intermediate = req.intermediateStallion ? pool.find((s) => s.key === req.intermediateStallion) : null;
  if (req.intermediateStallion && !intermediate) throw new Error('途中で使う種牡馬が探索候補に含まれていません。種牡馬の属性や利用可能な馬の設定を確認してください');
  const finals = req.finalStallion
    ? [env.resolve(req.finalStallion)].filter((r): r is HorseRecord => !!r)
    : (req.finalPool ?? req.stallionPool).map((k) => env.resolve(k)).filter((r): r is HorseRecord => !!r);
  if (!finals.length) throw new Error('最後に付ける種牡馬が見つかりません');
  if (!pool.length && req.maxMatings > 1) throw new Error('途中に使う種牡馬の候補がありません');
  const minPoolPrice = pool.length ? Math.min(...pool.map((p) => p.price)) : 0;
  const unknown = unknownRecord();
  const systemPrefilter = createSystemPrefilter(start, pool, req.goals, env.ctx.rules);
  const report: SearchReport = { status: '完了', results: [], evaluated: 0, pruned: 0, dataIssues: 0, elapsedMs: 0, request: req };
  const isCancelled = () => report.status === '中止';
  let sinceYield = 0, stopped = false;
  const yieldEvery = hooks.yieldEvery ?? 2000;
  const tick = async () => {
    if (++sinceYield >= yieldEvery) {
      sinceYield = 0;
      await hooks.onProgress?.({ evaluated: report.evaluated, pruned: report.pruned, found: report.results.length, depth: 0 });
      if (hooks.shouldStop?.()) { stopped = true; report.status = '中止'; }
    }
    if (report.evaluated >= req.maxEvaluations) { stopped = true; report.status = '判定回数上限'; }
  };

  /** layers[j] = j+1 回目の種牡馬（null は未定）。起点から順に娘を作り、最終母を返す */
  const buildMare = (layers: (HorseRecord | null)[]): HorseRecord => {
    let m = start;
    layers.forEach((s, j) => {
      m = makeFoalRecord(s ?? unknown, m, { key: `p:l${j}:${s?.key ?? '?'}`, name: s ? `${m.name}の${j + 1}代目（${s.name}産駒）` : '（未定）', sex: 'F', kind: 'planned' }, env.rules);
    });
    return m;
  };
  const evaluate = async (f: HorseRecord, layers: (HorseRecord | null)[]) => {
    if (systemPrefilter && !systemPrefilter(f, layers)) {
      report.pruned++;
      // 詳細判定に進まない候補が続いても進捗通知と中止を受け付ける。
      await tick();
      return null;
    }
    const j = judge(f, buildMare(layers), env.ctx);
    report.evaluated++;
    await tick();
    return { j, verdicts: req.goals.map((g) => ({ goal: g, verdict: goalVerdict(j, g) })) };
  };
  const makeSteps = (f: HorseRecord, layers: HorseRecord[], finalJudgement: Judgement): SearchStep[] => {
    // 途中の判定を表示用に計算する
    const steps: SearchStep[] = [];
    let m = start;
    layers.forEach((s, jdx) => {
      const jd = judge(s, m, env.ctx);
      const daughter = makeFoalRecord(s, m, { key: `p:l${jdx}:${s.key}`, name: `${m.name}の${jdx + 1}代目（${s.name}産駒）`, sex: 'F', kind: 'planned' }, env.rules);
      const step: SearchStep = { sire: s.key, sireName: s.name, dam: m.key, damName: m.name, cost: s.price, foalName: daughter.name, judgement: summarize(jd), constraints: [...s.constraints, ...(jdx === 0 ? m.constraints : [])] };
      steps.push(step);
      m = daughter;
    });
    steps.push({ sire: f.key, sireName: f.name, dam: m.key, damName: m.name, cost: f.price, foalName: '最終産駒', judgement: summarize(finalJudgement), constraints: [...f.constraints, ...(layers.length === 0 ? m.constraints : [])] });
    return steps;
  };
  const pushResult = (f: HorseRecord, layers: HorseRecord[], j: Judgement, verdicts: SearchResult['goals']) => {
    const steps = makeSteps(f, layers, j);
    const result: SearchResult = { steps, matings: layers.length + 1, cost: steps.reduce((c, s) => c + s.cost, 0), goals: verdicts };
    report.results.push(result);
    hooks.onFound?.(result);
  };

  for (let k = Math.max(intermediate ? 2 : 1, req.minMatings); k <= req.maxMatings && !stopped; k++) {
    const layerCount = k - 1; // 途中の種牡馬の数（最後の1回は finals）
    for (const f of finals) {
      if (stopped) break;
      if (req.maxCost != null && f.price + minPoolPrice * layerCount > req.maxCost) { report.pruned++; continue; }
      if (intermediate && !req.allowRepeatStallion && f.key === intermediate.key) { report.pruned++; continue; }
      const layers: (HorseRecord | null)[] = Array(layerCount).fill(null);
      const used = new Set<HorseKey>([f.key]);
      // pos: 決める位置（layers の添字）。最後の配合に近い側（添字の大きい側）から決める
      const rec = async (pos: number, cost: number, needsIntermediate: boolean): Promise<void> => {
        if (stopped) return;
        const remaining = pos + 1;
        if (needsIntermediate && (remaining === 0 || (req.maxCost != null && cost + intermediate!.price + minPoolPrice * (remaining - 1) > req.maxCost))) {
          report.pruned++;
          await tick();
          return;
        }
        const evaluation = await evaluate(f, layers);
        if (!evaluation || isCancelled()) return;
        const { j, verdicts } = evaluation;
        if (verdicts.some((v) => v.verdict === '不成立')) { report.pruned++; return; }
        if (remaining === 0) {
          if (verdicts.every((v) => v.verdict === '成立')) pushResult(f, layers as HorseRecord[], j, verdicts);
          else report.dataIssues++;
          return;
        }
        // 必須の馬が未使用なら、最後に残った途中の枠はその馬に限定する。
        const candidates = needsIntermediate && remaining === 1 ? [intermediate!] : pool;
        for (const s of candidates) {
          if (stopped) return;
          if (!req.allowRepeatStallion && used.has(s.key)) continue;
          const nextCost = cost + s.price;
          if (req.maxCost != null && nextCost + minPoolPrice * (remaining - 1) > req.maxCost) { report.pruned++; continue; }
          layers[pos] = s; used.add(s.key);
          await rec(pos - 1, nextCost, needsIntermediate && s.key !== intermediate!.key);
          used.delete(s.key); layers[pos] = null;
        }
      };
      await rec(layerCount - 1, f.price, !!intermediate);
    }
  }
  report.results.sort((a, b) => a.matings - b.matings || a.cost - b.cost);
  report.elapsedMs = Date.now() - t0;
  return report;
}

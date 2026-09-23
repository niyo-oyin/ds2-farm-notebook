// 自家製種牡馬づくり: 繁殖牝馬 × 種牡馬で牡の産駒を作り、その産駒を種牡馬として相手の繁殖牝馬群に付けた時に目標が成立する頭数で評価する。
import type { HorseKey, HorseRecord } from './types';
import { makeFoalRecord } from './pedigree';
import { judge } from './judge';
import { goalVerdict, summarize, type JudgementSummary, type SearchEnv, type SearchGoal, type SearchHooks, type SearchStatus } from './search';

export interface HomebredRequest {
  /** 牡の産駒を産ませる繁殖牝馬 */
  dams: HorseKey[];
  /** 産駒の父の候補 */
  stallionPool: HorseKey[];
  /** 産駒を種牡馬として付ける相手の繁殖牝馬 */
  targets: HorseKey[];
  /** 相手に付けた時に成立させる目標 */
  goals: SearchGoal[];
  /** 目標が成立する相手の最小頭数 */
  minMatches: number;
  maxEvaluations: number;
}
export interface HomebredMatch { mare: HorseKey; mareName: string; judgement: JudgementSummary }
export interface HomebredResult {
  sire: HorseKey; sireName: string; dam: HorseKey; damName: string; cost: number;
  /** 牡の産駒が生まれる配合の判定 */
  birth: JudgementSummary;
  /** 産駒を付けた時に目標が成立する相手 */
  matches: HomebredMatch[];
  constraints: string[];
}
export interface HomebredReport { status: SearchStatus; results: HomebredResult[]; evaluated: number; elapsedMs: number; request: HomebredRequest }

const resolveAll = (env: SearchEnv, keys: HorseKey[]) => keys.map((k) => env.resolve(k)).filter((r): r is HorseRecord => !!r);

/** 成立する相手が多い順、同じなら種付料が安い順 */
export const compareHomebred = (a: HomebredResult, b: HomebredResult) => b.matches.length - a.matches.length || a.cost - b.cost;

export async function searchHomebredSires(env: SearchEnv, req: HomebredRequest, hooks: SearchHooks<HomebredResult> = {}): Promise<HomebredReport> {
  const t0 = Date.now();
  const dams = resolveAll(env, req.dams);
  const pool = resolveAll(env, req.stallionPool);
  const targets = resolveAll(env, req.targets);
  if (!dams.length) throw new Error('産駒の母を選んでください');
  if (!pool.length) throw new Error('産駒の父の候補がありません');
  if (!targets.length) throw new Error('産駒を付ける相手の繁殖牝馬を選んでください');
  const report: HomebredReport = { status: '完了', results: [], evaluated: 0, elapsedMs: 0, request: req };
  const yieldEvery = hooks.yieldEvery ?? 2000;
  let sinceYield = 0, stopped = false;
  const tick = async () => {
    if (++sinceYield >= yieldEvery) {
      sinceYield = 0;
      await hooks.onProgress?.({ evaluated: report.evaluated, pruned: 0, found: report.results.length, depth: 0 });
      if (hooks.shouldStop?.()) { stopped = true; report.status = '中止'; }
    }
    if (report.evaluated >= req.maxEvaluations) { stopped = true; report.status = '判定回数上限'; }
  };
  const wantSafe = req.goals.some((g) => g.type === 'notDangerous');
  for (const dam of dams) {
    for (const sire of pool) {
      if (stopped) break;
      // 危険な配合を避ける目標があれば、牡の産駒が生まれる配合でも避ける
      const birth = judge(sire, dam, env.ctx);
      if (wantSafe && birth.dangerous.verdict !== '不成立') continue;
      const colt = makeFoalRecord(sire, dam, { key: `p:colt:${sire.key}:${dam.key}`, name: `${dam.name}の仔（${sire.name}産駒）`, sex: 'M', kind: 'planned' }, env.rules);
      const matches: HomebredMatch[] = [];
      // 母自身には付けない
      const others = targets.filter((t) => t.key !== dam.key);
      for (let i = 0; i < others.length; i++) {
        // 残りがすべて成立しても最小頭数に届かなければ打ち切る
        if (matches.length + others.length - i < req.minMatches) break;
        const j = judge(colt, others[i], env.ctx);
        report.evaluated++;
        await tick();
        if (req.goals.every((g) => goalVerdict(j, g) === '成立')) matches.push({ mare: others[i].key, mareName: others[i].name, judgement: summarize(j) });
      }
      if (matches.length && matches.length >= req.minMatches) {
        const result: HomebredResult = { sire: sire.key, sireName: sire.name, dam: dam.key, damName: dam.name, cost: sire.price, birth: summarize(birth), matches, constraints: [...sire.constraints, ...dam.constraints] };
        report.results.push(result);
        hooks.onFound?.(result);
      }
    }
  }
  report.results.sort(compareHomebred);
  report.elapsedMs = Date.now() - t0;
  return report;
}

// 血統設計: 牡の系統と牝の系統をそれぞれ何世代かかけて作り、最後に両者を配合する探索。
// 面白い配合・見事な配合の成否は両親の系統コード（面白用・見事用の4枠）だけで決まり、系統コードは直近の3世代で決まる。
// そこで牡の系統を系統コードごとにまとめておき、牝の系統はコードの段階で合わせられる牡がいる枝だけを進め、
// 合わせられる組だけを実際の血統で判定する。
import type { HorseKey, HorseRecord, Verdict } from './types';
import { makeFoalRecord } from './pedigree';
import { judge } from './judge';
import { goalVerdict, summarize, type JudgementSummary, type SearchEnv, type SearchGoal, type SearchHooks, type SearchStatus, type SearchStep } from './search';
import { designFront, lineStrength } from './result-order';

export interface DesignLineSpec {
  /** 系統の起点の繁殖牝馬。牝の系統の世代数0では、この馬に直接付ける */
  starts: HorseKey[];
  minGenerations: number;
  maxGenerations: number;
  /** 系統の配合で必ず使う種牡馬 */
  required: HorseKey | null;
}
export interface DesignRequest {
  /** 牡の系統。世代数0では sires の種牡馬を牡としてそのまま付ける */
  colt: DesignLineSpec & { sires: HorseKey[] };
  filly: DesignLineSpec;
  /** 系統の配合に使う種牡馬 */
  stallionPool: HorseKey[];
  /** 牡と牝の配合（最後の配合）で成立させる目標 */
  goals: SearchGoal[];
  /** 系統の配合すべてで、面白・見事・凝った・ニックスのいずれかを成立させる */
  strongLines: boolean;
  maxCost: number | null;
  maxEvaluations: number;
}
export interface DesignLine {
  /** 系統の起点。世代数0の牡の系統では種牡馬そのもの */
  start: HorseKey;
  startName: string;
  /** 起点から順の系統の配合。最後の配合で系統の馬が生まれる */
  steps: SearchStep[];
}
export interface DesignResult {
  colt: DesignLine;
  filly: DesignLine;
  /** 牡と牝の配合 */
  merge: SearchStep;
  /** 長い方の系統の世代数 + 最後の配合 */
  generations: number;
  cost: number;
  /** 系統の配合の強さ（面白・見事・凝った・ニックスの成立数）の最小と平均。系統の配合がなければ null */
  strength: { weakest: number; mean: number } | null;
  goals: { goal: SearchGoal; verdict: Verdict }[];
}
export interface DesignReport {
  status: SearchStatus;
  results: DesignResult[];
  evaluated: number;
  pruned: number;
  /** 不明な祖先で最後の配合が未確定に留まった組の数 */
  dataIssues: number;
  /** 起点と最後の配合の判定が同じで、費用・世代数・系統の強さのすべてで先に見つけた設計に上回られ、省いた数 */
  folded: number;
  elapsedMs: number;
  request: DesignRequest;
}

type Side = 'colt' | 'filly';

/** 系統の途中の馬。起点は depth 0 */
interface Node {
  parent: Node | null;
  sire: HorseRecord | null;
  start: HorseRecord;
  depth: number;
  path: string;
  /** 起点からこの馬までの種付料 */
  cost: number;
  /** この馬の面白用・見事用の系統コード */
  om: string;
  mi: string;
  usedRequired: boolean;
  female?: HorseRecord;
  step?: { summary: JudgementSummary; strength: number; ok: boolean };
}

/** 系統の組み立て。記録と判定は必要になった時に作り、節に残す */
class LineBuilder {
  private env: SearchEnv;
  private side: Side;
  private rule: (s: JudgementSummary) => boolean;
  private onJudge: () => void;
  constructor(env: SearchEnv, side: Side, rule: (s: JudgementSummary) => boolean, onJudge: () => void) {
    this.env = env; this.side = side; this.rule = rule; this.onJudge = onJudge;
  }
  root(start: HorseRecord): Node {
    return { parent: null, sire: null, start, depth: 0, path: start.key, cost: 0, om: start.omoshiro, mi: start.migoto, usedRequired: false, female: start };
  }
  child(node: Node, s: HorseRecord, required: HorseRecord | null): Node {
    return {
      parent: node, sire: s, start: node.start, depth: node.depth + 1, path: `${node.path}>${s.key}`, cost: node.cost + s.price,
      om: s.omoshiro[0] + s.omoshiro[2] + node.om[0] + node.om[2], mi: s.omoshiro[1] + s.omoshiro[3] + node.om[1] + node.om[3],
      usedRequired: node.usedRequired || s.key === required?.key,
    };
  }
  female(node: Node): HorseRecord {
    node.female ??= this.foal(node, 'F');
    return node.female;
  }
  /** 系統の馬。牡の系統の最後は牡として作る（記録は残さない） */
  final(node: Node): HorseRecord {
    return this.side === 'colt' && node.depth > 0 ? this.foal(node, 'M') : this.female(node);
  }
  private foal(node: Node, sex: 'M' | 'F'): HorseRecord {
    const s = node.sire!, dam = this.female(node.parent!);
    const key = `p:d:${this.side}:${node.path}${sex === 'M' ? ':M' : ''}`;
    // 仮の計画馬として父母を判定の材料に加える（自家製の牡が関わる凝ったペアの推定で3代血統をたどるため）
    this.env.ctx.parents.set(key, [s.key, dam.key]);
    const name = `${node.start.name}の${node.depth}代目${sex === 'M' ? 'の牡' : ''}（${s.name}産駒）`;
    return makeFoalRecord(s, dam, { key, name, sex, kind: 'planned' }, this.env.rules);
  }
  step(node: Node) {
    if (!node.step) {
      const summary = summarize(judge(node.sire!, this.female(node.parent!), this.env.ctx));
      this.onJudge();
      node.step = { summary, strength: lineStrength(summary), ok: this.rule(summary) };
    }
    return node.step;
  }
  /** 起点からこの馬までの系統の配合がすべて条件を満たすか */
  valid(node: Node): boolean {
    return !node.parent || (this.valid(node.parent) && this.step(node).ok);
  }
  /** 起点から順の節（起点を除く） */
  chain(node: Node): Node[] {
    const out: Node[] = [];
    for (let n: Node | null = node; n?.parent; n = n.parent) out.unshift(n);
    return out;
  }
  steps(node: Node): SearchStep[] {
    const chain = this.chain(node);
    return chain.map((n, i) => {
      const dam = this.female(n.parent!);
      return {
        sire: n.sire!.key, sireName: n.sire!.name, dam: dam.key, damName: dam.name, cost: n.sire!.price,
        foalName: i === chain.length - 1 ? this.final(n).name : this.female(n).name, judgement: this.step(n).summary,
        constraints: [...n.sire!.constraints, ...(n.depth === 1 ? n.start.constraints : [])],
      };
    });
  }
}

/** 系統の条件: 危険な配合を避ける目標があれば系統の配合でも避け、強い系統を求めるなら配合理論の成立を求める */
const lineRule = (goals: SearchGoal[], strong: boolean) => {
  const safe = goals.some((g) => g.type === 'notDangerous');
  return (s: JudgementSummary) => (!safe || s.dangerous === '不成立') && (!strong || lineStrength(s) > 0);
};

/**
 * 血統設計の判定の材料。探索の中で作る馬は仮の計画馬として父母のリンクを材料に加えるので、元の材料を汚さないよう複製する。
 * lineRecords で作り直した馬を判定する時も、この材料を使う。
 */
export function designEnv(env: SearchEnv): SearchEnv {
  return { ...env, ctx: { ...env.ctx, parents: new Map(env.ctx.parents), kottaProfiles: new Map() } };
}

/** 起点から探索と同じキー・名前で系統の馬を作り直す。records[k] は k 回目の配合で生まれた馬（0 は起点）。env は designEnv で作ったもの */
export function lineRecords(env: SearchEnv, side: Side, line: DesignLine): HorseRecord[] {
  const start = env.resolve(line.start);
  if (!start) return [];
  const builder = new LineBuilder(env, side, () => true, () => undefined);
  const nodes = [builder.root(start)];
  for (const step of line.steps) {
    const s = env.resolve(step.sire);
    if (!s) return [];
    nodes.push(builder.child(nodes[nodes.length - 1], s, null));
  }
  return nodes.map((n, i) => (i === nodes.length - 1 ? builder.final(n) : builder.female(n)));
}

/** 牡の候補。系統の馬（node）か、世代数0の既存の種牡馬（stallion） */
interface Colt { node: Node | null; stallion: HorseRecord | null; cost: number }
interface ColtGroup { om: string; mi: string; colts: Colt[] }

const sorted = (s: string) => [...s].sort().join('');
const uniqueSorted = (s: string) => [...new Set(s)].sort().join('');

export async function searchDesigns(base: SearchEnv, req: DesignRequest, hooks: SearchHooks<DesignResult> = {}): Promise<DesignReport> {
  const t0 = Date.now();
  const env = designEnv(base);
  const resolveAll = (keys: HorseKey[]) => keys.map((k) => env.resolve(k)).filter((r): r is HorseRecord => !!r);
  const pool = resolveAll(req.stallionPool);
  const coltSires = req.colt.minGenerations === 0 ? resolveAll(req.colt.sires) : [];
  const coltStarts = req.colt.maxGenerations > 0 ? resolveAll(req.colt.starts) : [];
  const fillyStarts = resolveAll(req.filly.starts);
  if (!fillyStarts.length) throw new Error('牝の系統の起点の繁殖牝馬を選んでください');
  if (!coltSires.length && !coltStarts.length) throw new Error(req.colt.maxGenerations > 0 ? '牡の系統の起点の繁殖牝馬を選んでください' : '牡として付ける種牡馬が見つかりません');
  if (!pool.length && (req.colt.maxGenerations > 0 || req.filly.maxGenerations > 0)) throw new Error('系統に使う種牡馬の候補がありません');
  const requiredOf = (key: HorseKey | null) => {
    if (!key) return null;
    const r = pool.find((s) => s.key === key);
    if (!r) throw new Error('系統で使う種牡馬が探索候補に含まれていません。種牡馬の属性や利用可能な馬の設定を確認してください');
    return r;
  };
  const coltRequired = requiredOf(req.colt.required);
  const fillyRequired = requiredOf(req.filly.required);

  const report: DesignReport = { status: '完了', results: [], evaluated: 0, pruned: 0, dataIssues: 0, folded: 0, elapsedMs: 0, request: req };
  const accept = designFront();
  let sinceYield = 0, stopped = false;
  const yieldEvery = hooks.yieldEvery ?? 2000;
  const tick = async () => {
    if (++sinceYield >= yieldEvery) {
      sinceYield = 0;
      await hooks.onProgress?.({ evaluated: report.evaluated, pruned: report.pruned, found: report.results.length, depth: 0 });
      if (hooks.shouldStop?.()) { stopped = true; report.status = '中止'; }
    }
    if (report.evaluated >= req.maxEvaluations && !stopped) { stopped = true; report.status = '判定回数上限'; }
  };
  const rule = lineRule(req.goals, req.strongLines);
  const counted = () => { report.evaluated++; };
  const colts = new LineBuilder(env, 'colt', rule, counted);
  const fillies = new LineBuilder(env, 'filly', rule, counted);
  const candidates = (node: Node, max: number, required: HorseRecord | null) => (required && !node.usedRequired && node.depth + 1 === max ? [required] : pool);

  // ---- 牡の候補を系統コードでまとめる ----
  const coltList: Colt[] = coltRequired ? [] : coltSires.map((s) => ({ node: null, stallion: s, cost: s.price }));
  const { minGenerations: cMin, maxGenerations: cMax } = req.colt;
  const collectColts = async (node: Node): Promise<void> => {
    if (stopped) return;
    if (node.depth >= Math.max(1, cMin) && (!coltRequired || node.usedRequired)) coltList.push({ node, stallion: null, cost: node.cost });
    if (node.depth >= cMax) return;
    // 途中の馬は、強い系統を求める時だけ先に判定して枝を切る（それ以外は合わせる相手が見つかってから判定する）
    if (req.strongLines && node.depth > 0) {
      const ok = colts.valid(node);
      await tick();
      if (!ok) { report.pruned++; return; }
    }
    for (const s of candidates(node, cMax, coltRequired)) {
      if (stopped) return;
      if (req.maxCost != null && node.cost + s.price > req.maxCost) { report.pruned++; continue; }
      await collectColts(colts.child(node, s, coltRequired));
    }
  };
  for (const start of coltStarts) await collectColts(colts.root(start));

  const needsOmoshiro = req.goals.some((g) => g.type === 'omoshiro' || g.type === 'perfect' || g.type === 'perfectKotta');
  const needsMigoto = req.goals.some((g) => g.type === 'migoto' || g.type === 'perfect' || g.type === 'perfectKotta');
  const { rules } = env;
  const miKey = rules.migotoMode === 'set' ? uniqueSorted : sorted;
  const groups = new Map<string, ColtGroup>();
  for (const c of coltList) {
    const om = c.stallion ? c.stallion.omoshiro : c.node!.om, mi = c.stallion ? c.stallion.migoto : c.node!.mi;
    const key = `${needsOmoshiro ? sorted(om) : ''}|${needsMigoto ? miKey(mi) : ''}`;
    const g = groups.get(key);
    if (g) g.colts.push(c); else groups.set(key, { om: sorted(om), mi, colts: [c] });
  }
  const allGroups = [...groups.values()];
  const byMigoto = new Map<string, ColtGroup[]>();
  for (const g of allGroups) { const k = miKey(g.mi); byMigoto.set(k, [...(byMigoto.get(k) ?? []), g]); }
  const minColtCost = coltList.reduce((m, c) => Math.min(m, c.cost), Infinity);

  /**
   * 牝の面白用コード f（'*' は未定の枠、'?' は不明な系統）と合わせて面白い配合・見事な配合が成立し得るか。
   * 最後の配合の判定と同じ条件で、未定の枠はどの系統にもなれるとみなす。
   */
  const groupOk = (g: ColtGroup, f: string) => {
    const wild = [...f].filter((c) => c === '*').length;
    if (needsOmoshiro) {
      const known = new Set([...(g.om + f)].filter((c) => c !== '?' && c !== '*'));
      if (known.size + wild < rules.omoshiroThreshold) return false;
    }
    if (needsMigoto) {
      if (g.mi.includes('?') || f.includes('?')) return false;
      const a = new Set(g.mi);
      if (rules.migotoMinSystems > 0 && a.size < rules.migotoMinSystems) return false;
      const fk = [...f].filter((c) => c !== '*');
      if (rules.migotoMode === 'set') {
        if (fk.some((c) => !a.has(c))) return false;
        if ([...a].filter((c) => !fk.includes(c)).length > wild) return false;
      } else {
        const rest = [...g.mi];
        for (const c of fk) { const i = rest.indexOf(c); if (i < 0) return false; rest.splice(i, 1); }
      }
    }
    return true;
  };
  const compatCache = new Map<string, ColtGroup[]>();
  const compatible = (om: string): ColtGroup[] => {
    if (!needsOmoshiro && !needsMigoto) return allGroups;
    const f = sorted(om);
    let hit = compatCache.get(f);
    if (!hit) {
      const scope = needsMigoto && !f.includes('*') ? byMigoto.get(miKey(f)) ?? [] : allGroups;
      hit = scope.filter((g) => groupOk(g, f));
      compatCache.set(f, hit);
    }
    return hit;
  };
  /** 未定の配合を n 回重ねた後の面白用コード */
  const project = (om: string, n: number) => { let o = om; for (let i = 0; i < n; i++) o = `**${o[0]}${o[2]}`; return o; };

  // ---- 牝の系統を進め、合わせられる牡と最後の配合を判定する ----
  const { minGenerations: fMin, maxGenerations: fMax } = req.filly;
  const lineOf = (builder: LineBuilder, node: Node): DesignLine => ({ start: node.start.key, startName: node.start.name, steps: builder.steps(node) });
  const join = async (fNode: Node) => {
    const matches = compatible(fNode.om);
    if (!matches.length) return;
    let filly: HorseRecord | null = null;
    for (const g of matches) for (const c of g.colts) {
      if (stopped) return;
      if (req.maxCost != null && c.cost + fNode.cost > req.maxCost) { report.pruned++; await tick(); continue; }
      if (c.node && !colts.valid(c.node)) { await tick(); continue; }
      if (!filly) {
        const ok = fillies.valid(fNode);
        await tick();
        if (!ok) return;
        filly = fillies.final(fNode);
      }
      const colt = c.stallion ?? colts.final(c.node!);
      const j = judge(colt, filly, env.ctx);
      report.evaluated++;
      const verdicts = req.goals.map((goal) => ({ goal, verdict: goalVerdict(j, goal) }));
      if (verdicts.every((v) => v.verdict === '成立')) {
        const coltLine: DesignLine = c.stallion ? { start: c.stallion.key, startName: c.stallion.name, steps: [] } : lineOf(colts, c.node!);
        const fillyLine = lineOf(fillies, fNode);
        const lineSteps = [...coltLine.steps, ...fillyLine.steps];
        const strengths = lineSteps.map((s) => lineStrength(s.judgement));
        const merge: SearchStep = {
          sire: colt.key, sireName: colt.name, dam: filly.key, damName: filly.name, cost: colt.price, foalName: '最終産駒', judgement: summarize(j),
          constraints: [...(c.stallion?.constraints ?? []), ...(fNode.depth === 0 ? fNode.start.constraints : [])],
        };
        const result: DesignResult = {
          colt: coltLine, filly: fillyLine, merge,
          generations: Math.max(coltLine.steps.length, fillyLine.steps.length) + 1,
          cost: lineSteps.reduce((sum, s) => sum + s.cost, 0) + merge.cost,
          strength: strengths.length ? { weakest: Math.min(...strengths), mean: strengths.reduce((a, b) => a + b, 0) / strengths.length } : null,
          goals: verdicts,
        };
        if (accept(result)) {
          report.results.push(result);
          hooks.onFound?.(result);
        } else report.folded++;
      } else if (verdicts.every((v) => v.verdict !== '不成立')) report.dataIssues++;
      await tick();
    }
  };
  /** この節から先（世代数 fMin〜fMax）で、合わせられる牡が残るか */
  const alive = (node: Node) => {
    for (let g = Math.max(node.depth, fMin); g <= fMax; g++) if (compatible(project(node.om, g - node.depth)).length) return true;
    return false;
  };
  /** 系統の配合を後から判定して条件を満たさなかった馬。その先は調べない */
  const failed = (node: Node) => node.step?.ok === false;
  const visit = async (node: Node): Promise<void> => {
    if (stopped) return;
    if (req.strongLines && node.depth > 0) {
      const ok = fillies.valid(node);
      await tick();
      if (!ok) { report.pruned++; return; }
    }
    if (node.depth >= fMin && (!fillyRequired || node.usedRequired)) await join(node);
    if (node.depth >= fMax || failed(node)) return;
    for (const s of candidates(node, fMax, fillyRequired)) {
      if (stopped || failed(node)) return;
      const child = fillies.child(node, s, fillyRequired);
      if ((req.maxCost != null && child.cost + minColtCost > req.maxCost) || !alive(child)) { report.pruned++; await tick(); continue; }
      await visit(child);
    }
  };
  if (coltList.length) for (const start of fillyStarts) { if (stopped) break; await visit(fillies.root(start)); }
  report.elapsedMs = Date.now() - t0;
  return report;
}

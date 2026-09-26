// 探索結果の並べ方と、判定が同じ経路の畳み込み。
import type { JudgementSummary, SearchGoal } from './search';
import type { DesignResult } from './design-search';

/** strength は血統設計の系統の配合の強さ（lineStrength の最小と平均） */
export interface Ranked { cost: number; matings?: number; s: JudgementSummary; strength?: { weakest: number; mean: number } | null }

/** 目標で本数を指定した因子。おすすめ順ではこれらのクロスが多いほど上に置く */
export const wantedEffects = (goals: SearchGoal[]) => goals.flatMap((g) => (g.type === 'crossEffect' && g.effect ? [g.effect] : []));

const theories = (s: JudgementSummary) => [s.omoshiro, s.migoto, s.kotta].filter((v) => v === '成立').length;
/** 配合の強さ: 成立した面白・見事・凝った配合とニックスの数 */
export const lineStrength = (s: JudgementSummary) => theories(s) + (s.nicksLevel > 0 ? 1 : 0);
/** 系統の配合がない（弱い世代がない）ものを最も強いとみなす */
const strengthOf = (x: Pick<Ranked, 'strength'>) => x.strength === null ? [Infinity, Infinity] : [x.strength?.weakest ?? 0, x.strength?.mean ?? 0];

/**
 * おすすめ順: 危険な配合でない → 成立した配合理論（面白・見事・凝った）の数 → ニックスの段階 → 指定した因子のクロス本数
 * → 途中の配合の強さ（最も弱い配合、平均） → 配合回数（世代数） → 費用。
 * 完璧な配合は面白と見事、完璧／凝った配合は3つすべての成立として数える。
 */
export function recommendedCompare(a: Ranked, b: Ranked, wanted: string[]): number {
  const wantedCount = (x: Ranked) => wanted.reduce((n, e) => n + (x.s.effectCounts[e] ?? 0), 0);
  const [aw, am] = strengthOf(a), [bw, bm] = strengthOf(b);
  return Number(a.s.dangerous === '成立') - Number(b.s.dangerous === '成立')
    || theories(b.s) - theories(a.s)
    || b.s.nicksLevel - a.s.nicksLevel
    || wantedCount(b) - wantedCount(a)
    || (bw === aw ? 0 : bw > aw ? 1 : -1)
    || (bm === am ? 0 : bm > am ? 1 : -1)
    || (a.matings ?? 0) - (b.matings ?? 0)
    || a.cost - b.cost;
}

/** 最後の配合の判定のうち、画面に出して比べる値すべて。これが同じ設計は最終産駒の見込みが同じ */
const outcomeKey = (r: DesignResult) => {
  const s = r.merge.judgement;
  return JSON.stringify([r.colt.start, r.filly.start, s.omoshiro, s.migoto, s.perfect, s.perfectKotta, s.kotta, s.nicks, s.nicksLevel, s.dangerous, s.outbreed,
    s.hasUnknownSlots, s.omoshiroCount, s.crossCount, s.mareCrossCount, Object.entries(s.effectCounts).sort(), s.nitro.speed, s.nitro.stamina, s.nitro.power]);
};

/** a が b 以上で、どれかで上回る（費用・世代数は小さいほど、系統の強さは大きいほど良い） */
const dominates = (a: DesignResult, b: DesignResult) => {
  const [aw, am] = strengthOf(a), [bw, bm] = strengthOf(b);
  return a.cost <= b.cost && a.generations <= b.generations && aw >= bw && am >= bm
    && (a.cost < b.cost || a.generations < b.generations || aw > bw || am > bm);
};

/** 良い順（費用 → 世代数 → 系統の強さ）。この順に見れば、上回る設計は必ず先に来る */
const frontOrder = (a: DesignResult, b: DesignResult) => {
  const [aw, am] = strengthOf(a), [bw, bm] = strengthOf(b);
  return a.cost - b.cost || a.generations - b.generations || (bw === aw ? 0 : bw > aw ? 1 : -1) || (bm === am ? 0 : bm > am ? 1 : -1);
};

/**
 * 牡・牝の系統の起点と最後の配合の判定がすべて同じ設計のうち、費用・世代数・系統の強さのすべてで上回られる設計を畳む。
 * 起点の違う設計は比べない（起点の馬の能力は判定に出ない）。
 */
export function foldDominated(results: DesignResult[]): { shown: DesignResult[]; folded: number } {
  const accept = designFront();
  const keep = new Set([...results].sort(frontOrder).filter(accept));
  const shown = results.filter((r) => keep.has(r));
  return { shown, folded: results.length - shown.length };
}

/** 見つかった順に畳む。それまでに残した設計に上回られる設計なら false を返す */
export function designFront(): (r: DesignResult) => boolean {
  const groups = new Map<string, DesignResult[]>();
  return (r) => {
    const key = outcomeKey(r);
    const g = groups.get(key);
    if (!g) { groups.set(key, [r]); return true; }
    if (g.some((f) => dominates(f, r))) return false;
    g.push(r);
    return true;
  };
}

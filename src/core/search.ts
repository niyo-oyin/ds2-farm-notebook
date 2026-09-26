// 配合探索の目標・判定の要約と、1世代の総当たり。
import type { HorseKey, HorseRecord, Judgement, Verdict } from './types';
import { judge, type JudgeContext } from './judge';
import type { RuleOptions } from './rules';

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

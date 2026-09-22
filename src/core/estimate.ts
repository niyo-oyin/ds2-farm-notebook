// 誕生・繁殖入りの年数と牝馬の出生確率を仮定し、計画の所要年数と生産頭数を概算する。
export const YEAR_ASSUMPTIONS = {
  birthAfterMating: 1,      // 種付けの翌年に誕生
  yearsToBreeding: 4,       // 誕生から繁殖入りして次の種付けができるまで（3歳末引退→翌年種付けの想定）
  fillyProbability: 0.5,    // 牝馬が生まれる確率
  note: '種付けの翌年に誕生、産駒は誕生から4年で繁殖入りして次の種付けができ、牝馬が生まれる確率を1/2と仮定した目安。',
};

export interface YearEstimate { minYears: number; expectedFoals: number; intermediate: number }

/** matings 回の配合（最後を含む）で最終産駒が生まれるまでの最短年数と、途中で牝馬を得るための期待生産頭数 */
export function estimateYears(matings: number): YearEstimate {
  const a = YEAR_ASSUMPTIONS;
  const intermediate = Math.max(0, matings - 1);
  const minYears = a.birthAfterMating + intermediate * (a.birthAfterMating + a.yearsToBreeding);
  const expectedFoals = intermediate / a.fillyProbability + 1;
  return { minYears, expectedFoals, intermediate };
}

// 誕生・繁殖入りの年数と牝馬の出生確率を仮定し、計画の所要年数と生産頭数を概算する。
export const YEAR_ASSUMPTIONS = {
  birthAfterMating: 1,      // 種付けの翌年に誕生
  yearsToBreeding: 3,       // 余裕を持ち、3歳から次の種付けができる想定
  fillyProbability: 0.5,    // 牝馬が生まれる確率
  note: '種付けの翌年に誕生し、余裕を持って3歳から次の種付けができると仮定した目安。希望する性別の産駒が初回で生まれる場合の年数で、生産のやり直しや現役期間の延長は含まない。期待生産頭数は牝馬が生まれる確率を1/2として計算。',
};

export interface YearEstimate { estimatedYears: number; expectedFoals: number; intermediate: number }

/** matings 回の配合（最後を含む）で最終産駒が生まれるまでの年数の目安と、途中で牝馬を得るための期待生産頭数 */
export function estimateYears(matings: number): YearEstimate {
  const a = YEAR_ASSUMPTIONS;
  const intermediate = Math.max(0, matings - 1);
  const estimatedYears = a.birthAfterMating + intermediate * (a.birthAfterMating + a.yearsToBreeding);
  const expectedFoals = intermediate / a.fillyProbability + 1;
  return { estimatedYears, expectedFoals, intermediate };
}

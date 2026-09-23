import { describe, expect, it } from 'vitest';
import { assignWithinBudget } from '../src/core/season';

/** すべての選び方を調べた、予算内で順位の合計が最小（同じなら安い）の組み合わせ */
function bruteForce(candidates: { cost: number }[][], budget: number) {
  let best: { rank: number; cost: number } | null = null;
  const rec = (i: number, rank: number, cost: number) => {
    if (cost > budget) return;
    if (i === candidates.length) { if (!best || rank < best.rank || (rank === best.rank && cost < best.cost)) best = { rank, cost }; return; }
    if (!candidates[i].length) return rec(i + 1, rank, cost);
    candidates[i].forEach((o, k) => rec(i + 1, rank + k, cost + o.cost));
  };
  rec(0, 0, 0);
  return best as { rank: number; cost: number } | null;
}

describe('今年の種付けの割り当て', () => {
  it('予算内で順位の合計が最小になる組み合わせを選ぶ（総当たりと一致）', () => {
    let seed = 7;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
    for (let t = 0; t < 200; t++) {
      const candidates = Array.from({ length: 1 + rand(5) }, () => Array.from({ length: rand(4) }, () => ({ cost: (1 + rand(8)) * 50 })));
      const budget = rand(1500);
      const picks = assignWithinBudget(candidates, budget);
      const expected = bruteForce(candidates, budget);
      if (!expected) { expect(picks).toBeNull(); continue; }
      expect(picks).not.toBeNull();
      const cost = picks!.reduce<number>((c, p, i) => c + (p == null ? 0 : candidates[i][p].cost), 0);
      const rank = picks!.reduce<number>((r, p) => r + (p ?? 0), 0);
      expect({ rank, cost }).toEqual(expected);
      picks!.forEach((p, i) => expect(p == null).toBe(candidates[i].length === 0));
    }
  });
  it('予算がなければ各牝馬の1番目の候補を選ぶ', () => {
    expect(assignWithinBudget([[{ cost: 900 }, { cost: 10 }], [], [{ cost: 5 }]], null)).toEqual([0, null, 0]);
  });
});

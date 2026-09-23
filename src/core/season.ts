// 今年の種付け: 繁殖牝馬ごとに並べた候補から1頭ずつ選び、種付料の合計を予算内に収める。

/**
 * 各繁殖牝馬の候補（良い順）から1つずつ選ぶ。予算内で、選んだ順位の合計が最も小さい組み合わせを返す。
 * 同じ順位の合計なら種付料の合計が安い方を採る。予算がなければ各牝馬の1番目。候補のない牝馬は null。
 * 予算内に収まる組み合わせがなければ null を返す。
 */
export function assignWithinBudget(candidates: { cost: number }[][], budget: number | null): (number | null)[] | null {
  if (budget == null) return candidates.map((c) => (c.length ? 0 : null));
  // 種付料の合計 → その合計で最も小さい順位の合計と選び方。費用が増えても順位が良くならない状態は捨てる
  type State = { cost: number; rank: number; picks: (number | null)[] };
  let states: State[] = [{ cost: 0, rank: 0, picks: [] }];
  for (const options of candidates) {
    const next: State[] = [];
    for (const st of states) {
      if (!options.length) { next.push({ ...st, picks: [...st.picks, null] }); continue; }
      options.forEach((o, i) => {
        const cost = st.cost + o.cost;
        if (cost <= budget) next.push({ cost, rank: st.rank + i, picks: [...st.picks, i] });
      });
    }
    next.sort((a, b) => a.cost - b.cost || a.rank - b.rank);
    states = [];
    for (const st of next) if (!states.length || st.rank < states[states.length - 1].rank) states.push(st);
    if (!states.length) return null;
  }
  return states.reduce((best, st) => (st.rank < best.rank ? st : best)).picks;
}

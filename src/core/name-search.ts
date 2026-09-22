/** 検索専用の表記。馬名や血統を識別するキーには使わない。 */
export function normalizeSearchText(text: string): string {
  return text.normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC')
    .toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\p{P}\p{Z}\s]/gu, '');
}

/** 長音・小書き・ヴ/ブの違いは、通常の一致より低い優先度で扱う。 */
function looseKana(text: string): string {
  return text.replace(/ゔぁ/g, 'ば').replace(/ゔぃ/g, 'び').replace(/ゔぇ/g, 'べ').replace(/ゔぉ/g, 'ぼ').replace(/ゔ/g, 'ぶ')
    .replace(/[ぁぃぅぇぉゃゅょっゕゖ]/g, (c) => 'あいうえおやゆよつかけ'['ぁぃぅぇぉゃゅょっゕゖ'.indexOf(c)]).replace(/ー/g, '');
}

const matchRank = (text: string, query: string): number => text === query ? 0 : text.startsWith(query) ? 1 : text.includes(query) ? 2 : Infinity;
type SearchFields = readonly (string | null | undefined)[];

/** 別名は双方向・推移的に検索するが、検索結果の個体や名前は統合しない。 */
export function createNameSearch(aliases: readonly (readonly string[])[]) {
  const groupsByName = new Map<string, Set<string>>();
  for (const names of aliases) {
    const keys = names.map(normalizeSearchText).filter(Boolean);
    const group = new Set(keys.flatMap((key) => [...(groupsByName.get(key) ?? [key])]));
    for (const key of group) groupsByName.set(key, group);
  }
  const groups = [...new Set(groupsByName.values())].map((group) => [...group]);

  return (query: string) => {
    const key = normalizeSearchText(query);
    const loose = looseKana(key);
    // 短い語で長音などを落とすと候補が広がりすぎるため、3文字以上で使う。
    const useLoose = loose.length >= 3 && /[ぁ-ゖ]/.test(key);
    const alternatives = new Map<string, number>();
    if (key) for (const group of groups) {
      const normal = Math.min(...group.map((name) => matchRank(name, key)));
      const relaxed = useLoose ? Math.min(...group.map((name) => matchRank(looseKana(name), loose))) : Infinity;
      const rank = Math.min(3 + normal, 9 + relaxed);
      if (Number.isFinite(rank)) for (const name of group) alternatives.set(name, Math.min(alternatives.get(name) ?? Infinity, rank));
    }
    const score = (values: SearchFields): number => {
      if (!key) return 0;
      let best = Infinity;
      for (const value of values) {
        if (!value) continue;
        const text = normalizeSearchText(value);
        best = Math.min(best, matchRank(text, key), useLoose ? 6 + matchRank(looseKana(text), loose) : Infinity);
        if (best === 0) return 0;
        // 計画名など、馬名を含む文章にも別名でヒットさせる。
        for (const [name, rank] of alternatives) if (rank < best && text.includes(name)) best = rank;
      }
      return best;
    };
    return {
      matches: (...values: SearchFields) => Number.isFinite(score(values)),
      filter<T>(items: readonly T[], fields: (item: T) => SearchFields): T[] {
        return items.map((item) => ({ item, rank: score(fields(item)) }))
          .filter(({ rank }) => Number.isFinite(rank)).sort((a, b) => a.rank - b.rank).map(({ item }) => item);
      },
    };
  };
}

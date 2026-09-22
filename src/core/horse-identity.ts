import type { MasterData, Sex } from './types';

export interface HorseIdentity { id: string; name: string; sex: Sex | null }

/** 種牡馬・繁殖牝馬と血統上の祖先で共有する個体ID。名前は表示・検索にだけ使う。 */
export function horseIdentities(master: MasterData): Map<string, HorseIdentity> {
  return new Map([...master.ancestors, ...master.stallions, ...master.broodmares].map(h => [h.id, h]));
}

export const isMasterKey = (key: string): boolean => /^(a|st|bm):/.test(key);
export const newAncestorId = (): string => `a:u-${crypto.randomUUID()}`;

/** 名前だけで特定できる場合に限って読み取り結果を結び付ける。 */
export function uniqueHorseNamed<T extends HorseIdentity>(horses: Iterable<T>, name: string): T | undefined {
  const matches = [...horses].filter(h => h.name.normalize('NFKC').trim() === name.normalize('NFKC').trim());
  return matches.length === 1 ? matches[0] : undefined;
}

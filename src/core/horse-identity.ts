import type { MasterData, Sex } from './types';

export interface HorseIdentity { id: string; name: string; sex: Sex | null }

/** 種牡馬・繁殖牝馬と血統上の祖先で共有する個体ID。名前は表示・検索にだけ使う。 */
export function horseIdentities(master: MasterData): Map<string, HorseIdentity> {
  return new Map([...master.ancestors, ...master.stallions, ...master.broodmares].map(h => [h.id, h]));
}

export const isMasterKey = (key: string): boolean => /^(a|st|bm):/.test(key);
export const newAncestorId = (): string => `a:u-${crypto.randomUUID()}`;

/** 読み取り表記の全半角・空白・英字の大小を揃える。個体の区別はIDで行う。 */
export const horseNameKey = (name: string): string => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** 名前だけで特定できる場合に限って読み取り結果を結び付ける。 */
export function uniqueHorseNamed<T extends HorseIdentity>(horses: Iterable<T>, name: string): T | undefined {
  const matches = [...horses].filter(h => horseNameKey(h.name) === horseNameKey(name));
  return matches.length === 1 ? matches[0] : undefined;
}

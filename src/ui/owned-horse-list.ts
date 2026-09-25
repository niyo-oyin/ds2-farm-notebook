import type { OwnedHorse } from '../core/types';
import { HORSE_CATEGORIES, horseAge } from '../core/owned-horse';

export const OWNED_SORTS = [
  { key: 'updated', label: '更新順' }, { key: 'created', label: '登録順' },
  { key: 'name', label: '馬名' }, { key: 'category', label: '区分' }, { key: 'sex', label: '性別' }, { key: 'age', label: '年齢' }, { key: 'earnings', label: '総賞金' },
  { key: 'speed', label: 'スピード' }, { key: 'stamina', label: 'スタミナ' }, { key: 'power', label: 'パワー' },
] as const;
export type OwnedSortKey = typeof OWNED_SORTS[number]['key'];
export interface OwnedSort { key: OwnedSortKey; desc: boolean }
export interface OwnedDetailFilter { sire: string; dam: string; growth: string; distance: string; surface: string; linked: string }
export const EMPTY_OWNED_FILTER: OwnedDetailFilter = { sire: '', dam: '', growth: '', distance: '', surface: '', linked: '' };
export interface OwnedBasicFilter { categories: string[]; sexes: string[]; ages: string[] }
/** 非表示にする値。新しく登録された区分・年齢は既定で表示する。 */
export const EMPTY_OWNED_BASIC_FILTER: OwnedBasicFilter = { categories: [], sexes: [], ages: [] };
export function matchesOwnedBasic(h: OwnedHorse, excluded: OwnedBasicFilter, gameYear?: number) {
  const age = horseAge(h.profile?.birthYear, gameYear);
  return !excluded.categories.includes(h.category) && !excluded.sexes.includes(h.sex ?? 'unknown') && !excluded.ages.includes(age === undefined ? 'unknown' : String(age));
}
const MARKS: Record<string, number> = { '×': 0, '△': 1, '○': 2, '◯': 2, '◎': 3, '◉': 4 };

export function matchesOwnedHorse(h: OwnedHorse, filter: OwnedDetailFilter, parents: { sire: string; dam: string }, linked: boolean) {
  if (filter.sire && filter.sire !== parents.sire || filter.dam && filter.dam !== parents.dam) return false;
  if (filter.linked && (filter.linked === 'linked') !== linked) return false;
  const race = h.abilities?.race;
  if (filter.growth && race?.growth !== filter.growth) return false;
  if (filter.surface && (MARKS[race?.[filter.surface as 'turf' | 'dirt'] ?? ''] ?? -1) < MARKS['○']) return false;
  if (filter.distance) {
    const bounds = race?.distance?.normalize('NFKC').replace(/,/g, '').match(/\d+/g)?.map(Number);
    const distance = Number(filter.distance);
    if (!bounds || !bounds.length || distance < bounds[0] || distance > (bounds[1] ?? bounds[0])) return false;
  }
  return true;
}

export function compareOwnedHorses(sort: OwnedSort, gameYear?: number) {
  const value = (h: OwnedHorse): string | number | undefined => {
    switch (sort.key) {
      case 'name': return h.name;
      case 'category': return h.category === '未分類' ? undefined : HORSE_CATEGORIES.indexOf(h.category);
      case 'sex': return h.sex === 'M' ? 0 : h.sex === 'F' ? 1 : undefined;
      case 'created': return h.createdAt;
      case 'updated': return h.updatedAt;
      case 'age': return horseAge(h.profile?.birthYear, gameYear);
      case 'earnings': return h.profile?.earnings;
      default: return MARKS[h.abilities?.race?.[sort.key] ?? ''];
    }
  };
  return (a: OwnedHorse, b: OwnedHorse) => {
    const x = value(a), y = value(b);
    const tie = a.name.localeCompare(b.name, 'ja') || a.id.localeCompare(b.id);
    if (x == null && y == null) return tie;
    if (x == null) return 1;
    if (y == null) return -1;
    const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ja');
    return (sort.desc ? -order : order) || tie;
  };
}

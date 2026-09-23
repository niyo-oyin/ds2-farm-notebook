import type { HorseRecord, MasterHorse, UserHorse } from '../core/types';
import type { JudgementSummary } from '../core/search';
import { compareHorseFields, type HorseValues } from './master-horse-catalog';
import { sortCompare, type SortKey } from './search-order';

export interface OneGenSort { column: string; direction: 'asc' | 'desc'; judgement: SortKey }
export const DEFAULT_ONEGEN_SORT: OneGenSort = { column: 'judgement', direction: 'desc', judgement: 'recommended' };

export function stallionValues(record: HorseRecord, master?: MasterHorse, user?: UserHorse): HorseValues {
  if (master) return master;
  const a = user?.abilities?.stallion;
  return { name: record.name, kind: 'stallion', price: record.price, priceUnknown: record.priceUnknown, attrs: {
    dist: a?.distanceMin != null && a.distanceMax != null ? [a.distanceMin, a.distanceMax] : undefined,
    grown: a?.growth, dirt: a?.dirt, kenko: a?.health, kisyo: a?.temperament,
    jisseki: a?.achievement, konjo: a?.guts, antei: a?.stability,
  } };
}

interface OneGenSortRow { sireName: string; damName: string; stallion: HorseValues; s: JudgementSummary }
export function compareOneGenResults(a: OneGenSortRow, b: OneGenSortRow, sort: OneGenSort, wanted: string[]): number {
  const direction = sort.direction === 'asc' ? 1 : -1;
  const names = a.sireName.localeCompare(b.sireName, 'ja') || a.damName.localeCompare(b.damName, 'ja');
  if (sort.column === 'sire' || sort.column === 'dam') {
    const key = sort.column === 'sire' ? 'sireName' : 'damName';
    return a[key].localeCompare(b[key], 'ja') * direction || names;
  }
  if (sort.column === 'judgement') {
    const item = (r: OneGenSortRow) => ({ cost: r.stallion.price, s: r.s, attrs: r.stallion.attrs });
    return sortCompare(sort.judgement, item(a), item(b), wanted) * -direction || names;
  }
  return compareHorseFields(a.stallion, b.stallion, sort.column, sort.direction) || names;
}

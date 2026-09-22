/** レースの登録・編集項目。 */
export interface RaceFields {
  name: string;
  month: number | null;
  week: number | null;
  venue: string;
  surface: '' | '芝' | 'ダート';
  distance: number | null;
  grade: string;
  conditions: string;
  memo: string;
}
export interface Race extends RaceFields { id: string }
export interface RaceEdit { id: string; added: boolean; data: Partial<RaceFields>; updatedAt: string }
export const EMPTY_RACE_FIELDS: RaceFields = { name: '', month: null, week: null, venue: '', surface: '', distance: null, grade: '', conditions: '', memo: '' };

export function applyRaceEdits(base: Race[], edits: RaceEdit[]): Race[] {
  const byId = new Map(edits.map((e) => [e.id, e]));
  const known = new Set(base.map((r) => r.id));
  return [
    ...base.map((race) => ({ ...race, ...byId.get(race.id)?.data, id: race.id })),
    ...edits.filter((e) => e.added && !known.has(e.id)).map((e) => ({ ...EMPTY_RACE_FIELDS, ...e.data, id: e.id })),
  ];
}

export function validateRace(race: RaceFields): void {
  if (!race.name.trim()) throw new Error('レース名を入力してください');
  for (const [label, value, min, max] of [
    ['月', race.month, 1, 12], ['週', race.week, 1, 5], ['距離', race.distance, 1, 100_000],
  ] as const) {
    if (value !== null && (!Number.isInteger(value) || value < min || value > max)) throw new Error(`${label}の値を確認してください`);
  }
  if (!['', '芝', 'ダート'].includes(race.surface)) throw new Error('馬場を確認してください');
}

/** マスターデータから変更した項目だけを保存する。 */
export function raceDiff(base: RaceFields, edited: RaceFields): Partial<RaceFields> {
  return Object.fromEntries((Object.keys(EMPTY_RACE_FIELDS) as (keyof RaceFields)[]).filter((key) => base[key] !== edited[key]).map((key) => [key, edited[key]]));
}

export type RaceSort = 'name' | 'schedule' | 'venue' | 'surface' | 'distance' | 'grade';
export function sortRaces(races: Race[], key: RaceSort, direction: 'asc' | 'desc'): Race[] {
  const value = (r: Race): string | number | null => key === 'schedule' ? r.month === null ? null : r.month * 10 + (r.week ?? 9) : r[key] === '' ? null : r[key];
  return [...races].sort((a, b) => {
    const av = value(a), bv = value(b);
    // 未入力はどちらの並び順でも後ろに置く。
    if (av === null && bv !== null) return 1;
    if (bv === null && av !== null) return -1;
    const order = av === null || bv === null ? 0 : typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'ja', { numeric: true });
    return order * (direction === 'asc' ? 1 : -1) || a.name.localeCompare(b.name, 'ja') || a.id.localeCompare(b.id);
  });
}
export const raceSchedule = (r: Pick<RaceFields, 'month' | 'week'>) => r.month === null ? (r.week === null ? '—' : `第${r.week}週`) : `${r.month}月${r.week === null ? '' : ` ${r.week}週`}`;

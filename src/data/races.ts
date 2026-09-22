import { getCatalog } from './catalog';
import { EMPTY_RACE_FIELDS, type Race } from '../core/races';

export const baseRaces: Race[] = getCatalog().data.races.map((race) => {
  const surface = race.surface;
  if (surface !== '芝' && surface !== 'ダート') throw new Error(`レースの馬場が不正です: ${race.name}`);
  return { ...EMPTY_RACE_FIELDS, ...race, surface };
});

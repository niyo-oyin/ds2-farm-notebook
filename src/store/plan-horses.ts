import { breedingKey } from '../core/owned-horse';
import type { OwnedHorse } from '../core/types';
import type { Plan, UserData } from './model';

/** 元の計画は残し、実馬の選択をその先の仮想産駒の血統にも反映する。 */
export function resolvePlanHorses(plan: Plan, data: UserData) {
  const choices = new Map(data.plannedHorses.map((foal) => {
    const sex = foal.role === 'broodmare' ? 'F' : foal.role === 'stallion' ? 'M' : foal.desiredSex;
    const candidates = data.horses.filter((h) => foal.realizedIds.includes(h.id) && (!sex || h.sex === sex));
    const selected = candidates.find((h) => h.id === plan.realizedSelections?.[foal.id]) ?? (candidates.length === 1 ? candidates[0] : undefined);
    return [foal.id, { candidates, selected }] as const;
  }));
  const choice = (id: string): { candidates: OwnedHorse[]; selected?: OwnedHorse } => choices.get(id) ?? { candidates: [] };
  const key = (id: string) => { const h = choice(id).selected; return h ? breedingKey(h) : id; };
  const plannedHorses = data.plannedHorses.map((h) => ({ ...h, sireKey: key(h.sireKey), damKey: key(h.damKey) }));
  return { choice, key, plannedHorses };
}

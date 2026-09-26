import type { Plan, UserData } from '../store/model';
import { planProgress } from '../store/plan-progress';
import { resolvePlanHorses } from '../store/plan-horses';

/** 一覧では現在の配合と実馬を示し、未生産の計画馬は長い仮名の代わりに手順で示す。 */
export function planListSummary(plan: Plan, data: UserData, label: (id: string) => string) {
  const progress = planProgress(plan, data);
  const resolved = resolvePlanHorses(plan, data);
  const horseName = (id: string): string => {
    const { selected, candidates } = resolved.choice(id);
    if (selected) return selected.name;
    if (candidates.length) return candidates.map((h) => h.name).join('・');
    const index = plan.steps.findIndex((s) => s.foalId === id);
    return index >= 0 ? `${index + 1}回目の産駒（予定）` : label(id);
  };
  const index = progress.complete ? progress.steps.length - 1 : progress.nextIndex;
  const current = progress.steps[index];
  const choice = current ? resolved.choice(current.foalId) : null;
  const linked = current?.foal ? data.horses.filter((h) => current.foal!.realizedIds.includes(h.id)) : [];
  const horses = choice?.selected ? [choice.selected] : choice?.candidates.length ? choice.candidates : linked;
  const searchNames = plan.steps.flatMap((step) => {
    const foal = data.plannedHorses.find((h) => h.id === step.foalId);
    return [label(step.sire), label(step.dam), horseName(step.sire), horseName(step.dam),
      ...data.horses.filter((h) => foal?.realizedIds.includes(h.id)).map((h) => h.name)];
  });
  return {
    progress, current, index,
    sire: current ? horseName(current.sire) : '',
    dam: current ? horseName(current.dam) : '',
    horses,
    searchNames,
  };
}

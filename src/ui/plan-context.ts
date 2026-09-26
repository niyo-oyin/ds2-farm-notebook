import { HorseResolver } from '../core/pedigree';
import { makeContext } from '../core/judge';
import { resolvePlanHorses } from '../store/plan-horses';
import type { Plan } from '../store/model';
import type { AppCtx } from './app-context';

export function planContext(app: AppCtx, plan: Plan) {
  const resolved = resolvePlanHorses(plan, app.data);
  const data = { ...app.data, plannedHorses: resolved.plannedHorses };
  const horses = [...data.horses, ...data.plannedHorses];
  const resolver = new HorseResolver(app.master, horses, app.rules);
  const label = (id: string) => {
    const { candidates, selected } = resolved.choice(id);
    return selected?.name ?? (candidates.length > 1 ? candidates.map((h) => h.name).join('・') : resolver.label(id));
  };
  return { ...app, data, resolver, ctx: makeContext(app.master, app.rules, horses), ...resolved, label };
}

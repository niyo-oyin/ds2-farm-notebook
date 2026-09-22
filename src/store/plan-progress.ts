import { plannedProgress, type Plan, type UserData } from './model';

/** 生産だけで次へ進まず、希望する性別と繁殖入りまで含めて次に取り組む手順を選ぶ。 */
export function planProgress(plan: Plan, data: UserData) {
  const steps = plan.steps.map((step) => {
    const foal = data.plannedHorses.find((h) => h.id === step.foalId);
    const progress = foal ? plannedProgress(foal, data.horses) : null;
    const complete = !!progress?.born && progress.sexOk && (!foal?.role || progress.bred);
    const status = !foal ? '計画馬なし' : !progress?.born ? '未生産' : !progress.sexOk ? '希望の性別待ち' : !complete ? '繁殖入り待ち' : '完了';
    return { ...step, foal, progress, complete, status };
  });
  const completed = steps.filter((s) => s.complete).length;
  return { steps, completed, complete: steps.length > 0 && completed === steps.length, nextIndex: steps.findIndex((s) => !s.complete) };
}

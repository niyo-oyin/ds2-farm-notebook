export const PLAN_SORTS = [
  { key: 'updatedAt', label: '更新日', asc: '古い順', desc: '新しい順' },
  { key: 'createdAt', label: '作成日', asc: '古い順', desc: '新しい順' },
  { key: 'name', label: '名前', asc: '昇順', desc: '降順' },
  { key: 'origin', label: '起点の馬名', asc: '昇順', desc: '降順' },
  { key: 'progress', label: '進捗率', asc: '低い順', desc: '高い順' },
  { key: 'matings', label: '配合回数', asc: '少ない順', desc: '多い順' },
] as const;
export type PlanSortKey = typeof PLAN_SORTS[number]['key'];
export interface PlanListOrder { key: PlanSortKey; direction: 'asc' | 'desc' }
export interface PlanListEntry {
  id: string; name: string; createdAt: string; updatedAt: string;
  origin: string; completed: number; matings: number;
  pendingProgress: { born: boolean; sexOk: boolean } | null;
}

export function comparePlanEntries(a: PlanListEntry, b: PlanListEntry, sort: PlanListOrder): number {
  const value = (entry: PlanListEntry) => sort.key === 'progress'
    ? (entry.matings ? entry.completed / entry.matings : 0) : entry[sort.key];
  const x = value(a), y = value(b);
  const difference = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ja', { numeric: true });
  // 完了率が同じでも、生産済み・希望の性別まで到達した計画を先へ進んだものとして扱う。
  const stage = (entry: PlanListEntry) => entry.pendingProgress?.born ? entry.pendingProgress.sexOk ? 2 : 1 : 0;
  const progressDifference = sort.key === 'progress' ? stage(a) - stage(b) : 0;
  return (difference || progressDifference) * (sort.direction === 'asc' ? 1 : -1)
    || a.name.localeCompare(b.name, 'ja', { numeric: true }) || a.id.localeCompare(b.id);
}

import { expect, it } from 'vitest';
import { planListSummary } from '../src/ui/plan-list-summary';
import { emptyUserData } from '../src/store/model';
import { owned, planned, plan } from './horse-fixtures';

it('繁殖入り待ちの実馬を表示し、繁殖入り後はその馬を母とする次の配合を表示する', () => {
  const p = plan('plan:1', ['p:1', 'p:2']);
  const data = { ...emptyUserData(), horses: [owned('u:1', { name: '娘' })], plannedHorses: [planned('p:1', { realizedIds: ['u:1'] }), planned('p:2')] };
  const label = (id: string) => ({ 's:1': '種牡馬', 'u:start': '起点牝馬' })[id] ?? id;
  let summary = planListSummary(p, data, label);
  expect(summary.current?.status).toBe('繁殖入り待ち');
  expect(summary.horses.map((h) => h.name)).toEqual(['娘']);
  expect([summary.sire, summary.dam]).toEqual(['種牡馬', '起点牝馬']);
  data.horses[0].category = '繁殖牝馬';
  summary = planListSummary(p, data, label);
  expect(summary.index).toBe(1);
  expect(summary.current?.status).toBe('未生産');
  expect([summary.sire, summary.dam]).toEqual(['種牡馬', '娘']);
  expect(summary.searchNames).toContain('娘');
  data.plannedHorses[1].realizedIds = ['u:2'];
  data.horses.push(owned('u:2', { name: '孫', category: '繁殖牝馬' }));
  summary = planListSummary(p, data, label);
  expect(summary.progress.complete).toBe(true);
  expect(summary.horses.map((h) => h.name)).toEqual(['孫']);
});

it('複数実馬の選択と改名を反映し、希望の性別がまだいない場合も生産済みの馬を示す', () => {
  const p = plan('plan:1', ['p:1', 'p:2']);
  const data = { ...emptyUserData(), horses: [owned('u:a', { name: '姉' }), owned('u:b', { name: '妹' })], plannedHorses: [planned('p:1', { realizedIds: ['u:a', 'u:b'] }), planned('p:2')] };
  expect(planListSummary(p, data, (id) => id).horses.map((h) => h.name)).toEqual(['姉', '妹']);
  p.realizedSelections = { 'p:1': 'u:b' };
  data.horses[1].name = '改名した妹';
  let summary = planListSummary(p, data, (id) => id);
  expect(summary.horses.map((h) => h.name)).toEqual(['改名した妹']);
  expect(summary.searchNames).toEqual(expect.arrayContaining(['姉', '改名した妹']));
  data.horses.forEach((h) => { h.sex = 'M'; });
  summary = planListSummary(p, data, (id) => id);
  expect(summary.current?.status).toBe('希望の性別待ち');
  expect(summary.horses).toHaveLength(2);
  expect(planListSummary(plan('plan:empty', []), emptyUserData(), (id) => id).current).toBeUndefined();
});

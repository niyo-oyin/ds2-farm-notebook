import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolvePlanHorses } from '../src/store/plan-horses';
import { emptyUserData, normalizeUserData } from '../src/store/model';
import { planContext } from '../src/ui/plan-context';
import { PlanHorseName } from '../src/ui/PlanHorseName';
import { HorseResolver } from '../src/core/pedigree';
import { makeContext } from '../src/core/judge';
import { DEFAULT_RULES } from '../src/core/rules';
import { baseMaster } from '../src/data/base-master';
import { owned, planned, plan } from './horse-fixtures';

it('適した実馬が1頭なら自動で使い、複数なら計画ごとの選択を保存して使う', () => {
  const p = plan('plan:1', ['p:1']);
  const data = { ...emptyUserData(), plans: [p], horses: [owned('u:a', { name: '姉' }), owned('u:b', { name: '妹' }), owned('u:colt', { sex: 'M' })], plannedHorses: [planned('p:1', { realizedIds: ['u:a', 'u:colt'] })] };
  expect(resolvePlanHorses(p, data).key('p:1')).toBe('u:a');
  data.plannedHorses[0].realizedIds.push('u:b');
  expect(resolvePlanHorses(p, data).key('p:1')).toBe('p:1');
  p.realizedSelections = { 'p:1': 'u:b' };
  const restored = normalizeUserData(JSON.parse(JSON.stringify(data)));
  expect(resolvePlanHorses(restored.plans[0], restored).key('p:1')).toBe('u:b');
  expect(resolvePlanHorses(plan('plan:2', ['p:1']), data).key('p:1')).toBe('p:1');
  data.plannedHorses[0].realizedIds = ['u:a'];
  expect(resolvePlanHorses(p, data).key('p:1')).toBe('u:a');
  data.horses = [];
  expect(resolvePlanHorses(p, data).key('p:1')).toBe('p:1');
});

it('実馬の血統を未生産の次世代にも使い、元の計画・所有馬の親は書き換えない', () => {
  const master = baseMaster, sire = master.stallions[0].id, dam = master.broodmares[0].id;
  const p = plan('plan:1', ['p:1', 'p:2', 'p:3']);
  const data = { ...emptyUserData(), horses: [owned('u:a', { name: '実馬', sireKey: sire, damKey: dam })], plannedHorses: [
    planned('p:1', { realizedIds: ['u:a'] }), planned('p:2', { sireKey: sire, damKey: 'p:1' }), planned('p:3', { sireKey: sire, damKey: 'p:2' }),
  ] };
  const app = { master, rules: DEFAULT_RULES, data, resolver: new HorseResolver(master, [], DEFAULT_RULES), ctx: makeContext(master) };
  const resolved = planContext(app, p);
  expect(resolved.label('p:1')).toBe('実馬');
  expect(resolved.resolver.get('p:2')!.nodes[3]).toBe('u:a');
  expect(resolved.resolver.get('p:3')!.nodes[7]).toBe('u:a');
  expect(data.plannedHorses[1].damKey).toBe('p:1');
  expect(data.horses[0].damKey).toBe(dam);
  data.horses[0].name = '改名後';
  expect(planContext(app, p).label('p:1')).toBe('改名後');
  data.horses[0].masterKey = dam;
  expect(resolvePlanHorses(p, data).key('p:1')).toBe(dam);
});

it('紐付け前は計画名、1頭は所有馬へのリンク、複数頭は選択欄を表示する', () => {
  const a = owned('u:a', { name: '姉' }), b = owned('u:b', { name: '妹' });
  const render = (candidates: typeof a[], selected?: typeof a) => renderToStaticMarkup(<PlanHorseName name="計画1代目" candidates={candidates} selected={selected} label="母として使う所有馬" onChange={() => {}} />);
  expect(render([])).toContain('計画1代目');
  expect(render([a], a)).toContain('#/horses?id=u%3Aa');
  expect(render([a], a)).not.toContain('計画1代目');
  const html = render([a, b], b);
  expect(html).toContain('<select');
  expect(html).toContain('value="u:b" selected=""');
  expect(html).toContain('姉');
  expect(html).toContain('妹');
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignResult } from '../src/core/design-search';
import { emptyUserData, horsePlanLinks, setHorsePlanLinks, validateOwnedParents } from '../src/store/model';
import { memoryStorage, owned, planned, plan, timestamp } from './horse-fixtures';
import { testCatalog } from './setup-catalog';

/** 保存処理が使う部分だけの血統設計の結果 */
const design = (colt: string, coltSires: string[], filly: string, fillySires: string[]) => ({
  colt: { start: colt, steps: coltSires.map((sire) => ({ sire })) }, filly: { start: filly, steps: fillySires.map((sire) => ({ sire })) },
}) as unknown as DesignResult;

vi.mock('../src/store/sync', () => ({ pushDiff: vi.fn(), pushAll: vi.fn(), pull: vi.fn().mockResolvedValue(null) }));

describe('所有馬と計画馬のデータ分離', () => {
  it('複数対複数の紐付けを保ち、1件の解除が他の馬や計画に影響しない', () => {
    const data = { ...emptyUserData(), horses: [owned('u:1'), owned('u:2')], plannedHorses: [planned('p:1'), planned('p:2')], plans: [plan('plan:1', ['p:1']), plan('plan:2', ['p:2'])] };
    const both = setHorsePlanLinks(data, 'u:1', ['p:1', 'p:2', 'p:2'], '2025-02-01');
    const siblings = setHorsePlanLinks(both, 'u:2', ['p:1'], '2025-02-02');
    expect(siblings.plannedHorses[0].realizedIds).toEqual(['u:1', 'u:2']);
    expect(horsePlanLinks(siblings, 'u:1').map((l) => l.plan?.id)).toEqual(['plan:1', 'plan:2']);
    expect(horsePlanLinks(siblings, 'u:2').map((l) => l.foal.id)).toEqual(['p:1']);
    const unlinked = setHorsePlanLinks(siblings, 'u:1', ['p:2'], '2025-02-03');
    expect(unlinked.plannedHorses[0].realizedIds).toEqual(['u:2']);
    expect(unlinked.plannedHorses[1]).toBe(siblings.plannedHorses[1]);
    expect(unlinked.horses).toEqual(data.horses);
    expect(() => setHorsePlanLinks(data, 'u:missing', ['p:1'], timestamp)).toThrow();
    expect(() => setHorsePlanLinks(data, 'u:1', ['p:missing'], timestamp)).toThrow();
  });

  it('実個体の親に計画馬や循環する血統を指定できない', () => {
    const data = { ...emptyUserData(), horses: [owned('u:parent', { damKey: 'u:child' })], plannedHorses: [planned('p:1')] };
    expect(() => validateOwnedParents(data, owned('u:child', { damKey: 'p:1' }))).toThrow('計画馬');
    expect(() => validateOwnedParents(data, owned('u:child', { damKey: 'u:parent' }))).toThrow('循環');
    expect(() => validateOwnedParents(data, owned('u:child', { damKey: 'u:child' }))).toThrow('循環');
    expect(() => validateOwnedParents(data, owned('u:child', { sireKey: 's:1', damKey: 'b:1' }))).not.toThrow();
  });

});

describe('保存操作の境界', () => {
  beforeEach(async () => {
    vi.resetModules(); vi.stubGlobal('localStorage', memoryStorage());
    (await import('../src/data/catalog')).initializeCatalog(testCatalog);
  });

  it('種牡馬株の購入・解除を保存し、バックアップとセーブ切替で購入状況を復元する', async () => {
    const { store, getUserData } = await import('../src/store/userdata');
    store.setStallionShare('s:one', true);
    store.setStallionShare('s:two', true);
    store.setStallionShare('s:one', true);
    const backup = store.exportJson();
    expect(getUserData().settings.purchasedStallionShares).toEqual(['s:one', 's:two']);
    expect(getUserData().masterEdits).toEqual([]);
    store.setStallionShare('s:one', false);
    expect(getUserData().settings.purchasedStallionShares).toEqual(['s:two']);
    store.importJson(JSON.stringify(emptyUserData()));
    expect(getUserData().settings.purchasedStallionShares ?? []).toEqual([]);
    store.importJson(backup);
    expect(getUserData().settings.purchasedStallionShares).toEqual(['s:one', 's:two']);
  });

  it('既存戦績の読み込み・新規登録・更新でグレードを統一し、戦績の順序と件数は維持する', async () => {
    const { store, getUserData } = await import('../src/store/userdata');
    const entry = { date: '5.4', place: '東京', race: '優駿', finish: '1', grade: 'G I' };
    const entries = [entry, { ...entry, grade: 'Jpn II' }, { ...entry, grade: 'G3' }];
    store.importJson(JSON.stringify({ ...emptyUserData(), horses: [owned('u:old', { profile: { races: entries } })] }));
    expect(getUserData().horses[0].profile?.races).toEqual(entries.map((r, i) => ({ ...r, grade: ['GⅠ', 'JpnⅡ', 'GⅢ'][i] })));
    const horse = store.addHorse(owned('u:new', { profile: { races: [entry] } }));
    expect(horse.profile?.races?.[0].grade).toBe('GⅠ');
    store.updateHorse(horse.id, { profile: { races: [{ ...entry, grade: 'ＧⅡ' }] } });
    expect(getUserData().horses.find(h => h.id === horse.id)?.profile?.races?.[0].grade).toBe('GⅡ');
  });

  it('レースをバックアップから復元し、一覧から削除しても馬の戦績と並べ替えた順序を残す', async () => {
    const { store, getUserData } = await import('../src/store/userdata');
    const entry = { date: '4.1', place: '東京', race: '一般レース', finish: '1', surface: '芝' as const, distance: 1600, going: '良' as const, grade: '1勝クラス', runners: 18, popularity: 1, jockey: 'ルメール', carriedWeight: 55, bodyWeight: 426, strategy: '追' as const };
    const horse = store.addHorse(owned('u:race', { profile: { races: [entry] } }));
    store.saveRaceEdit({ id: 'rc:u:1', added: true, data: { name: '一般レース', distance: 1600 } });
    const nextRace = { ...entry, date: '5.1', race: '次のレース', finish: '2' };
    store.updateHorse(horse.id, { profile: { races: [entry, nextRace] } });
    store.updateHorse(horse.id, { profile: { races: [nextRace, entry] } });
    const backup = store.exportJson();
    store.deleteRaceEdit('rc:u:1');
    expect(getUserData().raceEdits).toEqual([]);
    expect(getUserData().horses.find((h) => h.id === horse.id)?.profile?.races).toEqual([nextRace, entry]);
    store.importJson(backup);
    expect(getUserData().raceEdits[0]).toMatchObject({ id: 'rc:u:1', data: { name: '一般レース', distance: 1600 } });
    expect(getUserData().horses.find((h) => h.id === horse.id)?.profile?.races).toEqual([nextRace, entry]);
  });

  it('計画保存・達成チェックで所有馬が増えず、実産駒を別のIDで登録できる', async () => {
    const { store, savePlan, getUserData } = await import('../src/store/userdata');
    const saved = savePlan('新計画', 'b:1', ['s:1', 's:2'], [], '1', '1', 'none');
    const [first, last] = getUserData().plannedHorses;
    expect(getUserData().horses).toEqual([]);
    expect(last.damKey).toBe(first.id);
    expect(saved.steps[1].foalId).toBe(last.id);
    store.updatePlannedHorse(first.id, { achieved: { born: true, sexOk: true, bred: true } });
    expect(getUserData().horses).toEqual([]);
    const actual = store.addHorse(owned('u:1'), [first.id]);
    expect(actual.id).not.toBe(first.id);
    expect(getUserData().plannedHorses).toHaveLength(2);
    expect(getUserData().plannedHorses[0].kind).toBe('planned');
    expect(horsePlanLinks(getUserData(), actual.id)[0].plan?.id).toBe(saved.id);
  });

  it('区分変更と存在しない紐付けを拒否し、失敗した登録は保存しない', async () => {
    const { store, getUserData } = await import('../src/store/userdata');
    const foal = store.addPlannedHorse(planned('p:1'));
    expect(() => store.addHorse(foal as never)).toThrow();
    expect(() => store.updateHorse(foal.id, { name: '変換' })).toThrow();
    expect(() => store.addHorse(owned('u:1'), ['p:missing'])).toThrow();
    expect(getUserData().horses).toEqual([]);
    const actual = store.addHorse(owned('u:1'));
    expect(() => store.updateHorse(actual.id, { kind: 'planned' } as never)).toThrow();
    expect(() => store.updatePlannedHorse(foal.id, { kind: 'owned' } as never)).toThrow();
    expect(() => store.updateHorse(actual.id, { damKey: foal.id })).toThrow();
  });

  it('計画削除で所有馬や紐付いた計画馬とその祖先を失わない', async () => {
    const { store, getUserData } = await import('../src/store/userdata');
    store.importJson(JSON.stringify({ ...emptyUserData(), horses: [owned('u:1')], plannedHorses: [planned('p:1', { planId: 'plan:1' }), planned('p:2', { damKey: 'p:1', planId: 'plan:1', realizedIds: ['u:1'] }), planned('p:unused', { planId: 'plan:1' })], plans: [plan('plan:1', ['p:1', 'p:2', 'p:unused'])] }));
    store.deletePlan('plan:1');
    expect(getUserData().horses.map((h) => h.id)).toEqual(['u:1']);
    expect(getUserData().plannedHorses.map((h) => h.id)).toEqual(['p:1', 'p:2']);
    expect(getUserData().plannedHorses.every((h) => !h.planId)).toBe(true);
    expect(horsePlanLinks(getUserData(), 'u:1')[0].foal?.id).toBe('p:2');
  });

  it('血統設計を保存すると、牡の系統を種牡馬にする計画を別に作り、その牡を牝の系統の最後の配合の父にする', async () => {
    const { saveDesign, getUserData } = await import('../src/store/userdata');
    const { plan, coltPlan } = saveDesign('設計', design('b:c', ['s:1', 's:2'], 'b:f', ['s:3']), [{ type: 'perfect' }], '1', '1', 'broodmare');
    expect(coltPlan).toMatchObject({ name: '設計（牡）', startKey: 'b:c', goals: [] });
    expect(coltPlan!.steps.map((s) => s.sire)).toEqual(['s:1', 's:2']);
    const colt = coltPlan!.steps[1].foalId;
    expect(getUserData().plannedHorses.find((h) => h.id === colt)).toMatchObject({ role: 'stallion', desiredSex: 'M', planId: coltPlan!.id });
    expect(plan).toMatchObject({ name: '設計', startKey: 'b:f', goals: [{ type: 'perfect' }] });
    expect(plan.steps.map((s) => s.sire)).toEqual(['s:3', colt]);
    expect(plan.steps[1].dam).toBe(plan.steps[0].foalId);
    expect(getUserData().plannedHorses.find((h) => h.id === plan.steps[1].foalId)).toMatchObject({ role: 'broodmare', desiredSex: 'F', sireKey: colt });
    // 牡の系統がなければ、既存の種牡馬を父にした計画だけを作る
    const single = saveDesign('単独', design('s:9', [], 'b:f', []), [], '1', '1', 'none');
    expect(single.coltPlan).toBeNull();
    expect(single.plan.steps.map((s) => [s.sire, s.dam])).toEqual([['s:9', 'b:f']]);
  });

  it('計画の途中から探し直した設計で置き換えると、前の手順を保ち、外した計画馬は所有馬の紐付けがあるものだけ残す', async () => {
    const { store, savePlan, saveDesign, getUserData } = await import('../src/store/userdata');
    const saved = savePlan('計画', 'b:1', ['s:1', 's:2', 's:3'], [], '1', '1', 'broodmare');
    const [first, second, third] = saved.steps.map((s) => s.foalId);
    store.addHorse(owned('u:2'), [second]);
    const { plan: replaced, coltPlan } = saveDesign('無視される名前', design('b:c', ['s:6'], first, ['s:4']), [{ type: 'kotta' }], '1', '1', 'stallion', { planId: saved.id, from: 1 });
    expect(coltPlan?.name).toBe('計画（牡）');
    expect(replaced.name).toBe('計画');
    expect(replaced.steps.map((s) => s.sire)).toEqual(['s:1', 's:4', coltPlan!.steps[0].foalId]);
    expect(replaced.steps[0].foalId).toBe(first);
    expect(replaced.steps[1].dam).toBe(first);
    expect(replaced.steps[2].dam).toBe(replaced.steps[1].foalId);
    expect(replaced.goals).toEqual([{ type: 'kotta' }]);
    const ids = getUserData().plannedHorses.map((h) => h.id);
    expect(ids).toContain(second);
    expect(ids).not.toContain(third);
    expect(getUserData().plannedHorses.find((h) => h.id === second)?.planId).toBeUndefined();
    expect(getUserData().plannedHorses.find((h) => h.id === replaced.steps[2].foalId)).toMatchObject({ role: 'stallion', desiredSex: 'M', planId: saved.id });
    expect(getUserData().plans).toHaveLength(2);
    expect(() => saveDesign('x', design('s:9', [], 'b:other', []), [], '1', '1', 'none', { planId: saved.id, from: 1 })).toThrow();
  });

  it('所有馬を削除すると紐付けだけを除き、計画は維持する', async () => {
    const { store, getUserData } = await import('../src/store/userdata');
    store.addHorse(owned('u:1'));
    store.addPlannedHorse(planned('p:1', { realizedIds: ['u:1'] }));
    expect(store.deleteHorse('u:1')).toBeNull();
    expect(getUserData().plannedHorses[0].realizedIds).toEqual([]);
    expect(getUserData().horses).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '../src/core/search';
import { emptyUserData, horsePlanLinks, setHorsePlanLinks, validateOwnedParents } from '../src/store/model';
import { memoryStorage, owned, planned, plan, timestamp } from './horse-fixtures';
import { testCatalog } from './setup-catalog';

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

  it('レースをバックアップから復元し、一覧から削除しても馬の戦績を残す', async () => {
    const { store, getUserData } = await import('../src/store/userdata');
    const entry = { date: '4.1', place: '東京', race: '一般レース', finish: '1', surface: '芝' as const, distance: 1600, going: '良' as const, grade: '1勝クラス' };
    const horse = store.addHorse(owned('u:race', { profile: { races: [entry] } }));
    store.saveRaceEdit({ id: 'rc:u:1', added: true, data: { name: '一般レース', distance: 1600 } });
    const backup = store.exportJson();
    store.deleteRaceEdit('rc:u:1');
    expect(getUserData().raceEdits).toEqual([]);
    expect(getUserData().horses.find((h) => h.id === horse.id)?.profile?.races?.[0]).toEqual(entry);
    store.importJson(backup);
    expect(getUserData().raceEdits[0]).toMatchObject({ id: 'rc:u:1', data: { name: '一般レース', distance: 1600 } });
    expect(getUserData().horses.find((h) => h.id === horse.id)?.profile?.races?.[0]).toEqual(entry);
  });

  it('計画保存・達成チェックで所有馬が増えず、実産駒を別のIDで登録できる', async () => {
    const { store, savePlanFromResult, getUserData } = await import('../src/store/userdata');
    // 保存処理が使う部分だけの探索結果。
    const result = { steps: [{ sire: 's:1' }, { sire: 's:2' }] } as SearchResult;
    const saved = savePlanFromResult('新計画', 'b:1', result, [], undefined, '1', '1', 'none');
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

  it('所有馬を削除すると紐付けだけを除き、計画は維持する', async () => {
    const { store, getUserData } = await import('../src/store/userdata');
    store.addHorse(owned('u:1'));
    store.addPlannedHorse(planned('p:1', { realizedIds: ['u:1'] }));
    expect(store.deleteHorse('u:1')).toBeNull();
    expect(getUserData().plannedHorses[0].realizedIds).toEqual([]);
    expect(getUserData().horses).toEqual([]);
  });
});

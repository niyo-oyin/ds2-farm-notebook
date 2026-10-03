import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ownedHorseAge, pedigreeEffectCounts, validateOwnedDetails } from '../src/core/owned-horse';
import type { AncestorInfo } from '../src/core/types';
import { normalizeUserData } from '../src/store/model';
import { memoryStorage, owned, planned } from './horse-fixtures';
import { testCatalog } from './setup-catalog';

vi.mock('../src/store/sync', () => ({ pushDiff: vi.fn(), pushAll: vi.fn(), pull: vi.fn().mockResolvedValue(null) }));

describe('所有馬の能力・プロフィール', () => {
  beforeEach(async () => {
    vi.resetModules(); vi.stubGlobal('localStorage', memoryStorage());
    (await import('../src/data/catalog')).initializeCatalog(testCatalog);
  });


  it('負数・非数・不正な生年を保存せず、0は入力値として許可する', async () => {
    const { store, getUserData } = await import('../src/store/userdata');
    store.addHorse(owned('u:1', { sex: 'F', category: '繁殖牝馬' }));
    for (const value of [-1, NaN, Infinity]) {
      expect(() => store.updateHorse('u:1', { abilities: { broodmare: { speed: value } } })).toThrow('スピード');
    }
    expect(getUserData().horses[0].abilities).toBeUndefined();
    expect(() => validateOwnedDetails({ profile: { birthYear: 2025.5 } })).toThrow('生年');
    expect(() => validateOwnedDetails({ profile: { earnings: -1 } })).toThrow('総賞金');
    expect(() => validateOwnedDetails({ profile: { earningsCurrent: -1 } })).toThrow('収得賞金');
    expect(() => validateOwnedDetails({ abilities: { broodmare: { speed: 0 } }, profile: { earnings: 0, birthYear: 1 } })).not.toThrow();
  });

  it('繁殖入り・引退後も現役の能力、プロフィール、因子、計画の紐付けを保存・復元する', async () => {
    const { store, getUserData } = await import('../src/store/userdata');
    const horse = store.addHorse(owned('u:phases', { category: '現役', effects: ['速力'], abilities: { race: { speed: '○', stamina: '◎', legs: '△' } } }));
    store.addPlannedHorse(planned('p:1', { realizedIds: [horse.id] }));
    store.updateHorse(horse.id, { profile: { color: '鹿毛', birthYear: 2025, earnings: 0, wins: 'G1勝利' } });
    store.updateHorse(horse.id, { category: '繁殖牝馬', abilities: { ...horse.abilities, broodmare: { speed: 7035, stamina: 0, power: 5750, health: 'B', temperament: 'A', dirt: '○' } } });
    store.updateHorse(horse.id, { category: '引退' });
    const backup = normalizeUserData(JSON.parse(store.exportJson()));
    const restored = backup.horses[0];
    expect(restored.category).toBe('引退');
    expect(restored.profile).toEqual({ color: '鹿毛', birthYear: 2025, earnings: 0, wins: 'G1勝利' });
    expect(restored.effects).toEqual(['速力']);
    expect(backup.plannedHorses[0].realizedIds).toEqual([horse.id]);
    expect(restored.abilities?.broodmare).toEqual({ speed: 7035, stamina: 0, power: 5750, health: 'B', temperament: 'A', dirt: '○' });
    expect(restored.abilities?.race).toEqual({ speed: '○', stamina: '◎', legs: '△' });
    store.addHorse(owned('u:sire', { sex: 'M', category: '種牡馬', abilities: { stallion: { dirt: '△', growth: '晩成', guts: 'A', achievement: 'B', stability: 'C', distanceMin: 1800, distanceMax: 3000 } } }));
    expect(getUserData().horses[1].abilities?.stallion?.growth).toBe('晩成');
  });

  it('実在馬の入手年と年齢を保存し、現在年に応じた年齢を一覧の絞り込み・並べ替えに使う', async () => {
    const { store, getUserData } = await import('../src/store/userdata');
    const { compareOwnedHorses, matchesOwnedBasic, EMPTY_OWNED_BASIC_FILTER } = await import('../src/ui/owned-horse-list');
    const mare = store.addHorse(owned('u:real', { sex: 'F', category: '繁殖牝馬', masterKey: testCatalog.data.master.broodmares[0].id, profile: { acquiredYear: 40, acquiredAge: 7 } }));
    const homebred = owned('u:homebred', { profile: { birthYear: 38 } });
    expect(ownedHorseAge(mare, 43)).toBe(10);
    expect(ownedHorseAge(mare, 44)).toBe(11);
    expect(ownedHorseAge(homebred, 43)).toBe(5);
    expect(matchesOwnedBasic(mare, { ...EMPTY_OWNED_BASIC_FILTER, ages: ['10'] }, 43)).toBe(false);
    expect(matchesOwnedBasic(mare, { ...EMPTY_OWNED_BASIC_FILTER, ages: ['10'] }, 44)).toBe(true);
    expect([mare, homebred].sort(compareOwnedHorses({ key: 'age', desc: false }, 43)).map(h => h.id)).toEqual([homebred.id, mare.id]);
    store.importJson(store.exportJson());
    expect(ownedHorseAge(getUserData().horses[0], 44)).toBe(11);
    // 初年度に成馬を入手する場合も、生年を負数にする必要がない。
    store.updateHorse(mare.id, { profile: { acquiredYear: 1, acquiredAge: 8 } });
    expect(ownedHorseAge(getUserData().horses[0], 2)).toBe(9);
    expect(ownedHorseAge(mare, 39)).toBeUndefined();
    expect(ownedHorseAge(mare, undefined)).toBeUndefined();
    expect(ownedHorseAge({ ...mare, profile: { acquiredYear: 40 } }, 43)).toBeUndefined();
    for (const value of [-1, 1.5, NaN, Infinity]) {
      expect(() => store.updateHorse(mare.id, { profile: { acquiredAge: value } })).toThrow('入手時の年齢');
      expect(() => store.updateHorse(mare.id, { profile: { acquiredYear: value } })).toThrow('入手年');
    }
  });

  it('区分と性別・評価の選択肢・距離範囲の不整合を保存しない', () => {
    expect(() => validateOwnedDetails({ category: '種牡馬', sex: 'F' })).toThrow('区分と性別');
    expect(() => validateOwnedDetails({ abilities: { broodmare: { health: 'D' as never } } })).toThrow('評価');
    expect(() => validateOwnedDetails({ abilities: { stallion: { dirt: '×' as never } } })).toThrow('ダート');
    expect(() => validateOwnedDetails({ abilities: { stallion: { distanceMin: 2400, distanceMax: 1600 } } })).toThrow('距離');
  });
});

describe('所有馬の血統内の因子数', () => {
  it('4代内の同祖先の再出現を数え、5代目を除外し、未確認と因子なしを区別する', () => {
    const nodes = Array<string>(64).fill('');
    nodes[1] = 'u:self'; nodes[2] = 'a:1'; nodes[4] = 'a:1'; nodes[3] = 'u:mother';
    nodes[5] = 'a:2'; nodes[32] = 'a:1';
    const ancestor = (name: string, effects: string[]): AncestorInfo => ({ id: name, name, effects, sex: null, system: null });
    const context = { ancestors: new Map([['a:1', ancestor('祖先A', ['速力', '底力'])], ['a:2', ancestor('因子なし', [])]]), userAncestors: new Map([['u:mother', ancestor('母', ['長距離'])]]) };
    expect(pedigreeEffectCounts(nodes, context)).toEqual({ counts: { 速力: 2, 底力: 2, 長距離: 1 }, unknown: 26 });
    context.userAncestors.delete('u:mother');
    expect(pedigreeEffectCounts(nodes, context).unknown).toBe(27);
  });
});

describe('データの繁殖牝馬を所有馬にする', () => {
  it('引退を保存・復元でき、血統の参照を保ったまま探索候補から外し、繁殖に戻すと候補に復帰する', async () => {
    vi.resetModules(); vi.stubGlobal('localStorage', memoryStorage());
    (await import('../src/data/catalog')).initializeCatalog(testCatalog);
    const { store, getUserData } = await import('../src/store/userdata');
    const { damOptions } = await import('../src/ui/app-context');
    const { HorseResolver } = await import('../src/core/pedigree');
    const { DEFAULT_RULES } = await import('../src/core/rules');
    const master = testCatalog.data.master;
    const mare = master.broodmares[0];
    const mother = store.addHorse(owned('u:mare', { name: mare.name, category: '繁殖牝馬', masterKey: mare.id, goodMotherComment: true }));
    const child = store.addHorse(owned('u:foal', { damKey: mare.id, sireKey: master.stallions[0].id }));
    const options = (onlyAvailable: boolean) => damOptions({ master, data: getUserData() }, { onlyAvailable }).map(o => o.key);
    const pedigree = () => new HorseResolver(master, getUserData().horses, DEFAULT_RULES).get(child.id)!.nodes;
    const before = pedigree();
    expect(options(true)).toContain(mare.id);
    store.updateHorse(mother.id, { category: '引退' });
    store.importJson(store.exportJson());
    expect(getUserData().horses.find(h => h.id === mother.id)).toMatchObject({ category: '引退', masterKey: mare.id, goodMotherComment: true });
    expect(options(true)).not.toContain(mare.id);
    expect(options(false)).toContain(mare.id);
    expect(pedigree()).toEqual(before);
    store.updateHorse(mother.id, { category: '繁殖牝馬' });
    expect(options(true)).toContain(mare.id);
  });

  it('所有馬として引いてもデータの馬そのものとして判定し、購入の制約を付けない', async () => {
    const { baseMaster: M } = await import('../src/data/base-master');
    const { HorseResolver } = await import('../src/core/pedigree');
    const { DEFAULT_RULES } = await import('../src/core/rules');
    const mare = M.broodmares.find((b) => b.purchasePrice)!;
    const plain = new HorseResolver(M, [], DEFAULT_RULES).get(mare.id)!;
    const resolver = new HorseResolver(M, [owned('u:mare', { name: mare.name, category: '繁殖牝馬', masterKey: mare.id })], DEFAULT_RULES);
    const viaOwned = resolver.get('u:mare')!;
    expect(viaOwned.key).toBe(mare.id);
    expect(viaOwned.nodes).toEqual(plain.nodes);
    expect(viaOwned.omoshiro).toBe(plain.omoshiro);
    expect(plain.constraints.some((c) => c.startsWith('購入が必要'))).toBe(true);
    expect(resolver.get(mare.id)!.constraints.some((c) => c.startsWith('購入'))).toBe(false);
  });

  it('同じ繁殖牝馬を二重に登録できず、牡としては登録できない', async () => {
    vi.resetModules(); vi.stubGlobal('localStorage', memoryStorage());
    (await import('../src/data/catalog')).initializeCatalog(testCatalog);
    const { store } = await import('../src/store/userdata');
    store.addHorse(owned('u:a', { category: '繁殖牝馬', masterKey: 'bm:1' }));
    expect(() => store.addHorse(owned('u:b', { category: '繁殖牝馬', masterKey: 'bm:1' }))).toThrow();
    expect(() => store.addHorse(owned('u:c', { sex: 'M', category: '現役', masterKey: 'bm:2' }))).toThrow();
    expect(() => store.updateHorse('u:a', { masterKey: 'bm:3' })).toThrow();
  });
});

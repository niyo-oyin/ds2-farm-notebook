import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pedigreeEffectCounts, validateOwnedDetails } from '../src/core/owned-horse';
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

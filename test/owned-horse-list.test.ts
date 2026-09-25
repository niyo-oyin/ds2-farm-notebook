import { describe, expect, it } from 'vitest';
import { owned } from './horse-fixtures';
import { compareOwnedHorses, EMPTY_OWNED_FILTER, matchesOwnedHorse, matchesOwnedBasic, EMPTY_OWNED_BASIC_FILTER } from '../src/ui/owned-horse-list';

describe('所有馬の並び替え・絞り込み', () => {
  it('賞金0と未確認を区別し、未確認は昇降順どちらでも末尾に置く', () => {
    const horses = [owned('unknown'), owned('zero', { profile: { earnings: 0 } }), owned('winner', { profile: { earnings: 3000 } })];
    expect([...horses].sort(compareOwnedHorses({ key: 'earnings', desc: true })).map(h => h.id)).toEqual(['winner', 'zero', 'unknown']);
    expect([...horses].sort(compareOwnedHorses({ key: 'earnings', desc: false })).map(h => h.id)).toEqual(['zero', 'winner', 'unknown']);
  });
  it('年齢はゲーム内の年から、能力は印の強さで比較する', () => {
    const horses = [owned('older', { profile: { birthYear: 27 }, abilities: { race: { speed: '○' } } }), owned('younger', { profile: { birthYear: 29 }, abilities: { race: { speed: '◉' } } }), owned('unknown')];
    expect([...horses].sort(compareOwnedHorses({ key: 'age', desc: false }, 32)).map(h => h.id)).toEqual(['younger', 'older', 'unknown']);
    expect([...horses].sort(compareOwnedHorses({ key: 'speed', desc: true })).map(h => h.id)).toEqual(['younger', 'older', 'unknown']);
  });
  it('引退だけを除き、複数の性別・年齢を組み合わせて表示する', () => {
    const horses = [
      owned('filly2', { sex: 'F', category: '現役', profile: { birthYear: 30 } }),
      owned('colt3', { sex: 'M', category: '現役', profile: { birthYear: 29 } }),
      owned('retired3', { sex: 'F', category: '引退', profile: { birthYear: 29 } }),
      owned('mare4', { category: '繁殖牝馬', profile: { birthYear: 28 } }),
      owned('unknown', { sex: null }),
    ];
    const filter = { categories: ['引退'], sexes: ['unknown'], ages: ['4', 'unknown'] };
    expect(horses.filter(h => matchesOwnedBasic(h, filter, 32)).map(h => h.id)).toEqual(['filly2', 'colt3']);
    expect(horses.filter(h => matchesOwnedBasic(h, EMPTY_OWNED_BASIC_FILTER, 32))).toHaveLength(5);
    expect(horses.filter(h => matchesOwnedBasic(h, { ...filter, sexes: ['M', 'F', 'unknown'] }, 32))).toHaveLength(0);
  });
  it('区分・性別をまとめて並べ、未分類・未確認は逆順でも末尾に置く', () => {
    const horses = [owned('unknown', { sex: null, category: '未分類' }), owned('mare', { sex: 'F', category: '繁殖牝馬' }), owned('colt', { sex: 'M', category: '現役' }), owned('retired', { sex: 'M', category: '引退' })];
    expect([...horses].sort(compareOwnedHorses({ key: 'category', desc: false })).map(h => h.id)).toEqual(['mare', 'colt', 'retired', 'unknown']);
    expect([...horses].sort(compareOwnedHorses({ key: 'category', desc: true })).map(h => h.id)).toEqual(['retired', 'colt', 'mare', 'unknown']);
    expect([...horses].sort(compareOwnedHorses({ key: 'sex', desc: false })).map(h => h.sex)).toEqual(['M', 'M', 'F', null]);
    expect([...horses].sort(compareOwnedHorses({ key: 'sex', desc: true })).map(h => h.sex)).toEqual(['F', 'M', 'M', null]);
  });
  it('父母・成長・距離・馬場・計画の条件を同時に満たす馬を探し、条件のある未確認項目は含めない', () => {
    const h = owned('mare', { abilities: { race: { growth: '持続', distance: '１,２００〜１,６００ｍ', turf: '◎', dirt: '×' } } });
    const parents = { sire: 's1', dam: 'd1' };
    const filter = { ...EMPTY_OWNED_FILTER, sire: 's1', dam: 'd1', growth: '持続', distance: '1600', surface: 'turf', linked: 'linked' };
    expect(matchesOwnedHorse(h, filter, parents, true)).toBe(true);
    for (const patch of [{ sire: 's2' }, { dam: 'd2' }, { growth: '早熟' }, { distance: '1700' }, { surface: 'dirt' }, { linked: 'unlinked' }]) expect(matchesOwnedHorse(h, { ...filter, ...patch }, parents, true)).toBe(false);
    expect(matchesOwnedHorse(owned('unknown'), filter, parents, true)).toBe(false);
    expect(matchesOwnedHorse(owned('unknown'), EMPTY_OWNED_FILTER, parents, false)).toBe(true);
  });
});

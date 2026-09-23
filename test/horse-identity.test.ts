import { describe, expect, it } from 'vitest';
import type { MasterData, MasterHorse } from '../src/core/types';
import { HorseResolver } from '../src/core/pedigree';
import { judge, makeContext } from '../src/core/judge';
import { DEFAULT_RULES } from '../src/core/rules';
import { goalVerdict } from '../src/core/search';
import { applyMasterEdits, compareAncestorFactors, prepareReadingAncestors } from '../src/core/master-edits';
import { uniqueHorseNamed } from '../src/core/horse-identity';

function fixture() {
  const horse = (id: string, sex: 'M' | 'F'): MasterHorse => ({
    id, name: '同じ馬名', sex, kind: sex === 'M' ? 'stallion' : 'broodmare', price: 0, color: null, bigSystem: null, smallSystem: null,
    omoshiro: 'aaaa', migoto: 'aaaa', ancestors: Array.from({ length: 30 }, (_, i) => `a:${id}-${i}`), attrs: {},
  });
  const sire = horse('st:1', 'M'), dam = horse('bm:1', 'F');
  const master: MasterData = {
    meta: { dataVersion: 'test', createdAt: '', bigSystems: ['A'], crossEffects: ['速力'] }, stallions: [sire], broodmares: [dam], kotta: [], nicks: [],
    ancestors: [sire, dam].flatMap(h => [{ id: h.id, name: h.name, system: null, sex: h.sex, effects: ['速力'] }, ...h.ancestors.map(id => ({ id, name: '同名の祖先', sex: null, system: null, effects: ['速力'] }))]),
  };
  const result = (m: MasterData) => { const r = new HorseResolver(m, [], DEFAULT_RULES); return judge(r.get(sire.id)!, r.get(dam.id)!, makeContext(m)); };
  return { master, sire, dam, result };
}

describe('馬の個体ID', () => {
  it('画像の英字表記が違っても確認済みの因子なしを照合し、同名の別個体は選択を待つ', () => {
    const { master } = fixture();
    const ancestor = { id: 'a:english', name: 'Example Mare', sex: 'F' as const, system: null, effects: [], effectsKnown: true };
    master.ancestors.push(ancestor);
    const reading = [{ name: 'example   mare', factors: [] }, { name: 'ＥＸＡＭＰＬＥ ＭＡＲＥ', factors: [] }];
    expect(compareAncestorFactors(reading, master)).toEqual([{ id: ancestor.id, name: reading[0].name, factors: [], known: [], status: '一致' }]);
    const parents = prepareReadingAncestors(master, { sire: '', dam: 'example mare', dam_sire: '' });
    expect(parents.parentIds.dam).toBe(ancestor.id);
    expect(parents.additions).toEqual([]);
    expect(uniqueHorseNamed(master.ancestors, 'EXAMPLE MARE')?.id).toBe(ancestor.id);

    master.ancestors.push({ ...ancestor, id: 'a:other', name: 'example mare', effects: ['底力'] });
    expect(compareAncestorFactors(reading, master)[0].status).toBe('要選択');
    expect(uniqueHorseNamed(master.ancestors, 'EXAMPLE MARE')).toBeUndefined();
    expect(compareAncestorFactors(reading, master, { [reading[0].name]: ancestor.id })[0]).toMatchObject({ id: ancestor.id, status: '一致' });
  });

  it('同名の別馬はクロスにせず、同じIDが本馬と祖先に現れた場合はクロスと危険判定に使う', () => {
    const { master, sire, dam, result } = fixture();
    expect(result(master).outbreed.verdict).toBe('成立');
    dam.ancestors[0] = sire.id;
    const j = result(master);
    expect(j.crosses).toHaveLength(1);
    expect(j.crosses[0]).toMatchObject({ key: sire.id, name: sire.name, effects: ['速力'] });
    expect(j.dangerous.verdict).toBe('成立');
    expect(goalVerdict(j, { type: 'cross', ancestorId: sire.id, name: sire.name })).toBe('成立');
    expect(goalVerdict(j, { type: 'cross', ancestorId: dam.id, name: dam.name })).toBe('不成立');
  });

  it('馬名や祖先名の編集で参照が切れず、因子と凝ったペアはその個体だけに適用する', () => {
    const { master, sire, dam, result } = fixture();
    const shared = sire.ancestors[6], partner = dam.ancestors[6];
    dam.ancestors[10] = shared;
    master.kotta = [[shared, partner]];
    const before = result(master);
    const changed = applyMasterEdits(master, [{ id: sire.id, kind: 'stallion', added: false, data: { name: '父の新しい表示名' }, updatedAt: '1' }], [
      { id: shared, name: '祖先の新しい表示名', system: null, sex: 'M', effects: ['底力'], updatedAt: '1' },
    ]);
    const after = result(changed);
    expect(after.kotta.verdict).toBe(before.kotta.verdict);
    expect(after.kotta.pairs).toEqual([[shared, partner]]);
    expect(after.crosses.find(c => c.key === shared)).toMatchObject({ name: '祖先の新しい表示名', effects: ['底力'] });
    expect(after.labels[sire.id]).toBe('父の新しい表示名');
    expect(changed.ancestors.find(a => a.id === partner)?.effects).toEqual(['速力']);
  });

  it('画像の馬名が複数の個体に一致する場合は選択を待ち、未登録の祖先は因子未確認で追加する', () => {
    const { master, sire } = fixture();
    const reading = { sire: '同じ馬名', dam: '新しい母', dam_sire: '' };
    const pending = prepareReadingAncestors(master, reading);
    expect(pending.ambiguous).toEqual(['sire']);
    expect(pending.parentIds.sire).toBeUndefined();
    expect(pending.additions).toHaveLength(1);
    expect(pending.additions[0]).toMatchObject({ name: '新しい母', effectsKnown: false });
    const selected = prepareReadingAncestors(pending.master, reading, { sire: sire.id });
    expect(selected.ambiguous).toEqual([]);
    expect(selected.parentIds).toEqual({ sire: sire.id, dam: pending.additions[0].id });
    expect(selected.additions).toEqual([]);
    const saved = applyMasterEdits(master, [], pending.additions.map(a => ({ ...a, updatedAt: '1' })));
    expect(saved.ancestors.find(a => a.id === pending.additions[0].id)).toMatchObject({ name: '新しい母', effectsKnown: false });
    expect(compareAncestorFactors([{ name: '同じ馬名', factors: ['底力'] }], master)[0]).toMatchObject({ id: null, status: '要選択' });
  });
});

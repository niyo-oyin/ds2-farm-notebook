import { describe, it, expect } from 'vitest';
import { baseMaster } from '../src/data/base-master';
import { HorseResolver } from '../src/core/pedigree';
import { judge, makeContext } from '../src/core/judge';
import { DEFAULT_RULES } from '../src/core/rules';
import { owned } from './horse-fixtures';
import { applyMasterEdits } from '../src/core/master-edits';

const M = baseMaster;
const ctx = makeContext(M);
const resolver = new HorseResolver(M, [], DEFAULT_RULES);

describe('自家製馬と不明枠', () => {
  it('産駒は父母の系統と血統を引き継ぎ、父との配合は危険と判定される', () => {
    const st = { ...M.stallions[0], bigSystem: 'Ec', ancestors: [...M.stallions[0].ancestors] }, bm = { ...M.broodmares[0], bigSystem: 'Ne', ancestors: [...M.broodmares[0].ancestors] };
    const ancestors = [...M.ancestors];
    for (const [horse, systems] of [[st, [2, 3, 4]], [bm, [6, 7, 8]]] as const) {
      [8, 4, 12].forEach((slot, i) => {
        const id = `a:test-${horse.id}-${slot}`;
        horse.ancestors[slot] = id;
        ancestors.push({ id, name: id, sex: 'M', system: systems[i], effects: [] });
      });
    }
    const r = new HorseResolver({ ...M, stallions: [st], broodmares: [bm], ancestors }, [
      owned('u:1', { name: 'テスト牝馬', sireKey: st.id, damKey: bm.id, category: '繁殖牝馬' }),
    ], DEFAULT_RULES);
    const rec = r.get('u:1')!;
    expect(rec.omoshiro).toBe('aceg');
    expect(rec.migoto).toBe('bdfh');
    expect(rec.nodes[2]).toBe(st.id);
    expect(rec.nodes[3]).toBe(bm.id);
    expect(rec.nodes[4]).toBe(st.ancestors[0]);
    expect(rec.nodes[6]).toBe(bm.ancestors[0]);
    expect(rec.nodes[31]).toBe(bm.ancestors[13]);
    expect(rec.smallSystem).toBe(st.smallSystem);
    expect(rec.smallSystemSource).toBe('父から推定');
    // 父 × 娘 は 1×N で危険
    const j = judge(r.get(st.id)!, rec, ctx);
    expect(j.dangerous.verdict).toBe('成立');
    expect(j.dangerous.causes.some((c) => c.startsWith('1×N'))).toBe(true);
    expect(j.kotta.verdict).not.toBe('成立');
  });
  it('祖先の系統や母の大系統の編集が見事判定に反映される', () => {
    const ancestor = { id: 'a:shared-system', name: '共通の父系', sex: 'M' as const, system: 5, effects: [] };
    const sire = { ...M.stallions[0], ancestors: [...M.stallions[0].ancestors] };
    const dam = { ...M.broodmares[0], bigSystem: 'Ne', ancestors: [...M.broodmares[0].ancestors] };
    for (const slot of [16, 20, 24, 28]) sire.ancestors[slot] = ancestor.id;
    for (const slot of [8, 4, 12]) dam.ancestors[slot] = ancestor.id;
    const master = { ...M, stallions: [sire], broodmares: [dam], ancestors: [...M.ancestors, ancestor] };
    const verdict = (m: typeof master) => {
      const r = new HorseResolver(m, [], DEFAULT_RULES);
      return judge(r.get(sire.id)!, r.get(dam.id)!, makeContext(m)).migoto.verdict;
    };
    expect(verdict(master)).toBe('成立');
    const updated = applyMasterEdits(master, [], [{ ...ancestor, system: 3, updatedAt: '2026-09-24T00:00:00Z' }]);
    expect(verdict(updated)).toBe('不成立');
    const matched = applyMasterEdits(updated, [{ id: dam.id, kind: 'broodmare', added: false, data: { bigSystem: 'Ns' }, updatedAt: '2026-09-24T00:00:00Z' }]);
    expect(verdict(matched)).toBe('成立');
  });
  it('親が未登録なら未確定になる', () => {
    const r = new HorseResolver(M, [owned('u:2', { name: '親不明', damKey: M.broodmares[0].id })], DEFAULT_RULES);
    const j = judge(r.get(M.stallions[0].id)!, r.get('u:2')!, ctx);
    expect(j.hasUnknownSlots).toBe(true);
    expect(['未確定', '成立']).toContain(j.omoshiro.verdict);
    expect(j.dangerous.verdict).not.toBe('不成立');
    expect(j.nicks.verdict).toBe('未確定');
  });
  it('循環する親子関係はエラー', () => {
    const r = new HorseResolver(M, [
      owned('u:a', { sireKey: 'u:b' }),
      owned('u:b', { sex: 'M', sireKey: 'u:a' }),
    ], DEFAULT_RULES);
    expect(() => r.get('u:a')).toThrow();
  });
});

describe('自家製馬の因子と運用上の制約', () => {
  it('登録した因子がクロスの効果に使われ、性別が牝馬クロスに数えられる', () => {
    const horses = [
      owned('u:f', { sireKey: M.stallions[10].id, damKey: M.broodmares[5].id, effects: ['速力', '底力'] }),
      owned('u:d1', { sireKey: M.stallions[20].id, damKey: 'u:f' }),
      owned('u:s1', { sex: 'M', sireKey: M.stallions[30].id, damKey: 'u:f' }),
    ];
    const r = new HorseResolver(M, horses, DEFAULT_RULES);
    const c = makeContext(M, {}, horses);
    const j = judge(r.get('u:s1')!, r.get('u:d1')!, c); // 自家製牝馬の 2×2
    const cross = j.crosses.find((x) => x.key === 'u:f')!;
    expect(cross).toBeTruthy();
    expect(cross.effectsKnown).toBe(true);
    expect(cross.effects).toEqual(['速力', '底力']);
    expect(cross.sex).toBe('F');
    expect(j.mareCrossCount).toBe(1);
    expect(j.dangerous.causes.some((x) => x.startsWith('2×2'))).toBe(true);
  });
  it('解禁条件と購入価格が制約として付く', () => {
    const locked = M.stallions.find((s) => s.unlock)!;
    const buy = M.broodmares.find((b) => b.purchasePrice)!;
    const j = judge(resolver.get(locked.id)!, resolver.get(buy.id)!, ctx);
    expect(j.constraints).toContain(`父: 解禁条件: ${locked.unlock}`);
    expect(j.constraints).toContain(`母: 購入が必要: ${buy.purchasePrice!.toLocaleString()}万`);
  });
});

import { describe, expect, it } from 'vitest';
import { baseMaster } from '../src/data/base-master';
import type { MasterHorse } from '../src/core/types';
import { applyMasterEdits, diffAgainstBase, type MasterEdit } from '../src/core/master-edits';
import { catalogHorses, horseCell, sortHorses } from '../src/ui/master-horse-catalog';

const horse = (name: string, attrs: MasterHorse['attrs'], extra: Partial<MasterHorse> = {}): MasterHorse => ({ ...baseMaster.stallions[0], id: name, name, attrs, ...extra });
const names = (list: MasterHorse[]) => list.map(h => h.name);
describe('馬の比較表', () => {
  it('数値を数値順に並べ、0と未確認を区別し、どちらの順でも未確認を末尾にする', () => {
    const list = [horse('小', { speed: 900 }), horse('未確認', { speed: null }), horse('大', { speed: 4000 }), horse('ゼロ', { speed: 0 })];
    expect(names(sortHorses(list, 'speed', 'desc'))).toEqual(['大', '小', 'ゼロ', '未確認']);
    expect(names(sortHorses(list, 'speed', 'asc'))).toEqual(['ゼロ', '小', '大', '未確認']);
    expect(names(list)).toEqual(['小', '未確認', '大', 'ゼロ']);
  });
  it('ABC評価とダート適性を評価順に並べる', () => {
    const list = [horse('中', { kenko: 'B', dirt: '○' }), horse('未確認', {}), horse('低', { kenko: 'C', dirt: '△' }), horse('高', { kenko: 'A', dirt: '◎' })];
    for (const key of ['kenko', 'dirt']) {
      expect(names(sortHorses(list, key, 'desc'))).toEqual(['高', '中', '低', '未確認']);
      expect(names(sortHorses(list, key, 'asc'))).toEqual(['低', '中', '高', '未確認']);
    }
  });
  it('距離は上限で並べ、未確認は末尾にする', () => {
    const list = [horse('長', { dist: [1800, 3000] }), horse('未確認', { dist: [0, 0] }), horse('短', { dist: [2000, 2400] })];
    expect(names(sortHorses(list, 'dist', 'desc'))).toEqual(['長', '短', '未確認']);
    expect(names(sortHorses(list, 'dist', 'asc'))).toEqual(['短', '長', '未確認']);
  });
  it('成長は早熟・持続・普通・晩成の区分順に並べ、未確認は末尾にする', () => {
    const list = [horse('晩成', { grown: '晩成' }), horse('普通', { grown: '普通' }), horse('未確認', {}), horse('早熟', { grown: '早熟' }), horse('持続', { grown: '持続' })];
    expect(names(sortHorses(list, 'grown', 'asc'))).toEqual(['早熟', '持続', '普通', '晩成', '未確認']);
    expect(names(sortHorses(list, 'grown', 'desc'))).toEqual(['晩成', '普通', '持続', '早熟', '未確認']);
  });
  it('種付料の無料と未確認、繁殖牝馬の初期利用と購入を区別する', () => {
    const free = horse('無料', {}, { price: 0, priceUnknown: false });
    const unknown = horse('不明', {}, { price: 0, priceUnknown: true });
    const starter = horse('初期', {}, { kind: 'broodmare', purchasePrice: null, priceUnknown: false });
    const bought = horse('購入', {}, { kind: 'broodmare', purchasePrice: 900, priceUnknown: false });
    expect(horseCell(free, 'price')).toBe('0');
    expect(horseCell(unknown, 'price')).toBe('—');
    expect(horseCell(starter, 'price')).toBe('初期から利用可');
    expect(names(sortHorses([bought, unknown, starter], 'price', 'asc'))).toEqual(['初期', '購入', '不明']);
  });
  it('非表示の馬も修正内容を保持して開き、再表示でその内容を復元する', () => {
    const base = baseMaster.stallions[0];
    const edit: MasterEdit = { id: base.id, kind: base.kind, added: false, hidden: true, data: { name: '修正した名前', price: 777 }, updatedAt: '2026-09-20' };
    const hidden = applyMasterEdits(baseMaster, [edit]);
    expect(hidden.stallions.some(h => h.id === base.id)).toBe(false);
    expect(catalogHorses(hidden, baseMaster, [edit], 'stallion').find(h => h.id === base.id)).toMatchObject({ name: '修正した名前', price: 777 });
    expect(applyMasterEdits(baseMaster, [{ ...edit, hidden: false }]).stallions.find(h => h.id === base.id)).toMatchObject({ name: '修正した名前', price: 777 });
  });
  it('未確認価格を編集した差分が保存・再読込後にも反映される', () => {
    const base = { ...baseMaster.stallions[0], price: 0, priceUnknown: true };
    const edited = { ...base, price: 1200, priceUnknown: false };
    const data = diffAgainstBase(base, edited);
    const master = { ...baseMaster, stallions: [base] };
    expect(applyMasterEdits(master, [{ id: base.id, kind: base.kind, added: false, data, updatedAt: '2026-09-20' }]).stallions[0]).toMatchObject({ price: 1200, priceUnknown: false });
    expect(diffAgainstBase({ ...base, priceUnknown: undefined }, { ...base, priceUnknown: false })).toEqual({});
  });
});

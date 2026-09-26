import { describe, expect, it } from 'vitest';
import { comparePlanEntries, type PlanListEntry, type PlanListOrder } from '../src/ui/plan-list-order';

const entry = (id: string, patch: Partial<PlanListEntry> = {}): PlanListEntry => ({
  id, name: id, origin: '母', createdAt: '2026-09-24', updatedAt: '2026-09-25', completed: 0, matings: 1, pendingProgress: null, ...patch,
});
const order = (entries: PlanListEntry[], key: PlanListOrder['key'], direction: PlanListOrder['direction']) =>
  [...entries].sort((a, b) => comparePlanEntries(a, b, { key, direction })).map((p) => p.id);

describe('配合計画一覧の並べ替え', () => {
  it('更新日と作成日を個別に並べ、馬名や配合回数でも昇降順を切り替える', () => {
    const entries = [entry('a', { name: '計画10', origin: 'アオ', createdAt: '2026-09-23', updatedAt: '2026-09-26', matings: 3 }), entry('b', { name: '計画2', origin: 'シロ', matings: 2 })];
    for (const key of ['updatedAt', 'name', 'matings'] as const) {
      expect(order(entries, key, 'desc')).toEqual(['a', 'b']);
      expect(order(entries, key, 'asc')).toEqual(['b', 'a']);
    }
    for (const key of ['createdAt', 'origin'] as const) {
      expect(order(entries, key, 'asc')).toEqual(['a', 'b']);
      expect(order(entries, key, 'desc')).toEqual(['b', 'a']);
    }
  });
  it('進捗は完了数でなく割合で比較し、空の計画を未着手として扱う', () => {
    const entries = [entry('半分', { completed: 2, matings: 4 }), entry('完了', { completed: 1 }), entry('空', { matings: 0 })];
    expect(order(entries, 'progress', 'desc')).toEqual(['完了', '半分', '空']);
    expect(order(entries, 'progress', 'asc')).toEqual(['空', '半分', '完了']);
  });
  it('同じ値では名前順、同名ならID順になり、入力順に左右されない', () => {
    const entries = [entry('b', { name: '同名' }), entry('c', { name: 'アオ' }), entry('a', { name: '同名' })];
    expect(order(entries, 'updatedAt', 'desc')).toEqual(['c', 'a', 'b']);
    expect(order([...entries].reverse(), 'updatedAt', 'desc')).toEqual(['c', 'a', 'b']);
  });
  it('同じ完了率では繁殖入り待ち、希望の性別待ち、未生産の順に並ぶ', () => {
    const entries = [
      entry('ア未生産', { matings: 2, pendingProgress: { born: false, sexOk: false } }),
      entry('イ性別待ち', { matings: 3, pendingProgress: { born: true, sexOk: false } }),
      entry('ウ繁殖入り待ち', { matings: 3, pendingProgress: { born: true, sexOk: true } }),
      entry('エ次の手順', { completed: 1, matings: 3, pendingProgress: { born: false, sexOk: false } }),
    ];
    const expected = ['エ次の手順', 'ウ繁殖入り待ち', 'イ性別待ち', 'ア未生産'];
    expect(order(entries, 'progress', 'desc')).toEqual(expected);
    expect(order(entries, 'progress', 'asc')).toEqual([...expected].reverse());
    expect(order(entries, 'name', 'asc')).toEqual(entries.map((p) => p.id));
  });
});

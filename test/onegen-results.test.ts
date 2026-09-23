import { expect, it } from 'vitest';
import { baseMaster } from '../src/data/base-master';
import { judge, makeContext } from '../src/core/judge';
import { HorseResolver } from '../src/core/pedigree';
import { DEFAULT_RULES } from '../src/core/rules';
import { summarize } from '../src/core/search';
import { compareOneGenResults, DEFAULT_ONEGEN_SORT, stallionValues } from '../src/ui/onegen-results';
import { horseCell } from '../src/ui/master-horse-catalog';
import { owned } from './horse-fixtures';

const resolver = new HorseResolver(baseMaster, [], DEFAULT_RULES);
const sire = resolver.get(baseMaster.stallions[0].id)!;
const summary = summarize(judge(sire, resolver.get(baseMaster.broodmares[0].id)!, makeContext(baseMaster)));
const row = (sireName: string, damName: string, attrs: Record<string, unknown> = {}) => ({
  sireName, damName, s: summary, stallion: { ...baseMaster.stallions[0], name: sireName, attrs },
});

it('父と母を別々に並べ替え、同じ種牡馬の複数の組み合わせも残す', () => {
  const a = row('アオ', 'カゼ'), b = row('アオ', 'アサ'), c = row('カゲ', 'アサ');
  const rows = [c, a, b];
  const sorted = (column: string, direction: 'asc' | 'desc') => [...rows].sort((x, y) => compareOneGenResults(x, y, { ...DEFAULT_ONEGEN_SORT, column, direction }, []));
  expect(sorted('sire', 'asc')).toEqual([b, a, c]);
  expect(sorted('sire', 'desc')).toEqual([c, b, a]);
  expect(sorted('dam', 'desc')).toEqual([a, b, c]);
  expect(rows).toEqual([c, a, b]);
});

it('能力列は評価順、判定列はおすすめ順で比較し、未確認は両方向で末尾になる', () => {
  const high = row('アオ', '母', { jisseki: 'A' }), low = row('カゲ', '母', { jisseki: 'C' }), unknown = row('サクラ', '母');
  high.s = { ...summary, dangerous: '成立' };
  low.s = { ...summary, dangerous: '不成立' };
  const rows = [unknown, low, high];
  const sorted = (direction: 'asc' | 'desc') => [...rows].sort((a, b) => compareOneGenResults(a, b, { ...DEFAULT_ONEGEN_SORT, column: 'jisseki', direction }, []));
  expect(sorted('desc')).toEqual([high, low, unknown]);
  expect(sorted('asc')).toEqual([low, high, unknown]);
  expect(compareOneGenResults(high, low, DEFAULT_ONEGEN_SORT, [])).toBeGreaterThan(0);
});

it('自家製種牡馬は自身の登録能力を表示・比較し、未入力を父の能力で埋めない', () => {
  const user = owned('u:sire', { sex: 'M', category: '種牡馬', abilities: { stallion: { distanceMin: 1600, distanceMax: 2400, growth: '普通', health: 'A', achievement: 'C' } } });
  const values = stallionValues({ ...sire, key: user.id, name: user.name, price: 0 }, undefined, user);
  expect(horseCell(values, 'dist')).toBe('1600–2400');
  expect(horseCell(values, 'kenko')).toBe('A');
  expect(horseCell(values, 'jisseki')).toBe('C');
  expect(horseCell(values, 'antei')).toBe('—');
  expect(horseCell(values, 'price')).toBe('0');
});

import { describe, expect, it } from 'vitest';
import { baseMaster as master } from '../src/data/base-master';
import { kottaParents, kottaProfile, compareKottaProfiles, type KottaParents } from '../src/core/kotta';
import { judge, makeContext } from '../src/core/judge';
import { masterToRecord } from '../src/core/pedigree';
import { horseIdentities } from '../src/core/horse-identity';
import { kottaHints } from '../src/core/master-edits';
import { owned } from './horse-fixtures';

const identities = horseIdentities(master);
const id = (name: string) => [...identities.values()].find(h => h.name === name)!.id;
const record = (horse: Parameters<typeof masterToRecord>[0]) => masterToRecord(horse, identities);
const parents = kottaParents(master);
const infos = new Map(master.ancestors.map(a => [a.id, a.effects]));
const compare = (sire: string, dam: string, pedigree = parents) => compareKottaProfiles(kottaProfile(id(sire), pedigree), kottaProfile(id(dam), pedigree), key => infos.get(key));
const horse = (name: string) => [...master.stallions, ...master.broodmares].find(h => h.name === name)!;

describe('凝ったペアの3代血統の比較', () => {
  it('同じ父系の重複をまとめ、父母を逆にしたときの本数を区別する', () => {
    expect(compare('エルコンドルパサー', 'Kingmambo')).toMatchObject({ pair: true, crosses: [id('Mr. Prospector'), id('Nureyev'), id('Northern Dancer')] });
    expect(compare('Kingmambo', 'エルコンドルパサー')).toMatchObject({ pair: false, crosses: [id('Mr. Prospector'), id('Nureyev')] });
  });
  it('別の枝にある同じ祖先を2本と数え、2種類の祖先でも成立する', () => {
    const pedigree = kottaParents({ ...master, stallions: [horse('ビッグアーサー')], broodmares: [horse('ライラックスアンドレース')] });
    expect(compare('Flower Alley', 'ビッグアーサー', pedigree)).toMatchObject({ pair: true, complete: true, crosses: [id('Mr. Prospector'), id('Mr. Prospector'), id("Sadler's Wells")] });
    expect(compare('ビッグアーサー', 'Flower Alley', pedigree)).toMatchObject({ pair: false, complete: true, crosses: [id('Mr. Prospector'), id("Sadler's Wells")] });
  });
  it('自身や牝馬の因子は数えず、因子のない共通祖先は父系の先を比較する', () => {
    expect(compare('ディープインパクト', 'ブラックタイド')).toMatchObject({ pair: true, crosses: [id('サンデーサイレンス'), id('Lyphard'), id('Busted')] });
    expect(compare('サンデーサイレンス', 'Halo')).toMatchObject({ pair: false, crosses: [id('Hail to Reason')] });
  });
  it('必要な血統や因子が不明なら、確定した不成立と区別する', () => {
    const sire = kottaProfile(id('ディープインパクト'), parents), dam = kottaProfile(id('ブラックタイド'), parents);
    expect(compareKottaProfiles(sire, dam, () => undefined)).toMatchObject({ pair: false, complete: false });
    expect(compareKottaProfiles(sire, dam, () => [])).toMatchObject({ pair: false, complete: true });
    expect(compareKottaProfiles(kottaProfile('unknown', parents), dam, key => infos.get(key))).toMatchObject({ pair: false, complete: false });
  });
  it('同じIDで親情報が食い違う祖先からは血統を推測しない', () => {
    const h = horse('ディープインパクト');
    const p = kottaParents({ ...master, stallions: [h, { ...h, ancestors: ['別の父', ...h.ancestors.slice(1)] }], broodmares: [] });
    expect(kottaProfile(h.id, p).complete).toBe(false);
  });
});

describe('方向・対象世代・自家生産馬を含む配合判定', () => {
  it('同じ牝馬に対する正方向のペアは成立し、逆方向は成立しない', () => {
    const ctx = makeContext(master), dam = record(horse('ダンスアミーガ'));
    expect(judge(record(horse('クリソベリル')), dam, ctx).kotta.verdict).toBe('成立');
    expect(judge(record(horse('サンダースノー')), dam, ctx).kotta.verdict).toBe('不成立');
    const hints = kottaHints(horse('サンダースノー'), [[id('エルコンドルパサー'), id('Kingmambo')]]);
    expect(hints).toEqual([]);
  });

  const blank = (name: string) => {
    const h = record({ ...horse('クリソベリル'), id: `st:${name}`, name, ancestors: Array.from({ length: 30 }, (_, i) => `a:${name}-${i}`) });
    return h;
  };
  it('産駒の4代目までは対象にし、5代目と牝馬の位置は対象にしない', () => {
    const sire = blank('父'), dam = blank('母');
    const ctx = makeContext({ ...master, kotta: [['a:A', 'a:B']] });
    sire.nodes[8] = 'a:A'; dam.nodes[8] = 'a:B';
    expect(judge(sire, dam, ctx).kotta.verdict).toBe('成立');
    sire.nodes[8] = 'a:無関係'; sire.nodes[16] = 'a:A';
    expect(judge(sire, dam, ctx).kotta.verdict).toBe('不成立');
    sire.nodes[16] = 'a:無関係2'; sire.nodes[9] = 'a:A';
    expect(judge(sire, dam, ctx).kotta.verdict).toBe('不成立');
  });
  it('自家生産馬の完全な血統は成立・不成立を判定し、不足する場合だけ未確定にする', () => {
    const sire = blank('父'), dam = blank('母');
    sire.nodes[1] = 'u:sire'; sire.labels['u:sire'] = '自家生産馬'; dam.nodes[8] = 'a:比較相手';
    const ctx = makeContext({ ...master, kotta: [] }, {}, [owned('u:sire', { sex: 'M' })]);
    // 既存ペアに頼らず、独立した3本の枝で共通祖先を作る。
    const addTree = (key: string, prefix: string) => {
      const nodes = ['', key, ...Array.from({ length: 14 }, (_, i) => `a:${prefix}-${i}`)];
      for (const [n, shared] of [[2, '共通1'], [10, '共通2'], [14, '共通3']] as const) nodes[n] = `a:${shared}`;
      for (let n = 1; n < 8; n++) ctx.parents.set(nodes[n], [nodes[n * 2], nodes[n * 2 + 1]]);
    };
    addTree('u:sire', 's'); addTree('a:比較相手', 'd');
    for (const name of ['共通1', '共通2', '共通3']) ctx.ancestors.set(`a:${name}`, { id: `a:${name}`, name, sex: 'M', system: null, effects: ['速力'] });
    // 他の比較相手も3代分揃え、無関係な欠損による未確定を除く。
    for (const rec of [sire, dam]) for (let n = 1; n < 16; n++) {
      if (n !== 1 && n % 2 !== 0) continue;
      if (ctx.parents.has(rec.nodes[n])) continue;
      const p: KottaParents = new Map();
      const nodes = ['', rec.nodes[n], ...Array.from({ length: 14 }, (_, i) => `a:${rec.nodes[n]}-${i}`)];
      for (let k = 1; k < 8; k++) p.set(nodes[k], [nodes[k * 2], nodes[k * 2 + 1]]);
      for (const [key, value] of p) ctx.parents.set(key, value);
    }
    expect(judge(sire, dam, ctx).kotta).toMatchObject({ verdict: '成立', estimated: true });
    const disabled = { ...ctx, rules: { ...ctx.rules, kottaEstimateHomebred: false } };
    expect(judge(sire, dam, disabled).kotta).toMatchObject({ verdict: '未確定', estimatedPairs: [] });
    const registered = { ...ctx, kottaPairs: new Set([`${sire.nodes[2]}|${dam.nodes[2]}`]) };
    expect(judge(sire, dam, registered).kotta).toMatchObject({ verdict: '成立', estimated: undefined, pairs: [[sire.nodes[2], dam.nodes[2]]] });
    ctx.ancestors.get('a:共通3')!.effects = [];
    expect(judge(sire, dam, ctx).kotta.verdict).toBe('不成立');
    ctx.ancestors.delete('a:共通3');
    expect(judge(sire, dam, ctx).kotta.verdict).toBe('未確定');
    dam.nodes[2] = 'u:sire';
    expect(judge(sire, dam, ctx).kotta.verdict).toBe('不成立');
  });
});

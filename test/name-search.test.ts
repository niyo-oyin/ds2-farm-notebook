import { describe, expect, it } from 'vitest';
import { createNameSearch } from '../src/core/name-search';
import { nameSearch } from '../src/ui/name-search';

const names = (query: string, candidates: string[]) => nameSearch(query).filter(candidates, (name) => [name]);

describe('馬名・読みの検索', () => {
  it('ひらがな、半角カナ、分離した濁点を同じ名前として探す', () => {
    for (const query of ['でぃーぷ', 'ﾃﾞｨｰﾌﾟ', 'テ\u3099ィープ']) {
      expect(names(query, ['キズナ', 'ディープインパクト'])).toEqual(['ディープインパクト']);
    }
    expect(names('ＭＲ　ＰＲＯＳＰＥＣＴＯＲ', ['Mr. Prospector', 'Northern Dancer'])).toEqual(['Mr. Prospector']);
    expect(names('konigsstuhl', ['Königsstuhl'])).toEqual(['Königsstuhl']);
    expect(names('クリエイターⅡ', ['クリエイターII'])).toEqual(['クリエイターII']);
  });

  it('英語名・日本語の読みを双方向の部分一致で探す', () => {
    expect(names('のーざん', ['Northern Dancer', 'Halo'])).toEqual(['Northern Dancer']);
    expect(names('みすたーぷろすぺくたー', ['Mr. Prospector'])).toEqual(['Mr. Prospector']);
    expect(names('deep impact', ['ディープインパクト', 'キズナ'])).toEqual(['ディープインパクト']);
    expect(names('だんじぐ', ['Danzig', 'ダンチヒ'])).toEqual(['Danzig', 'ダンチヒ']);
    expect(names('Danehill', ['デインヒル'])).toEqual(['デインヒル']);
    expect(names('Royal Academy', ['ロイヤルアカデミーII'])).toEqual(['ロイヤルアカデミーII']);
    expect(names('まっくすふぃーるど', ['Maxfield'])).toEqual(['Maxfield']);
    expect(names('The Axe II', ['The Axe'])).toEqual(['The Axe']);
    expect(names('Bold Lad (USA)', ['ボールドラッド'])).toEqual(['ボールドラッド']);
  });

  it('既存の別名と読みをつなぎ、複数段の別名でも行き来できる', () => {
    const search = createNameSearch([['A', 'B'], ['C', 'D'], ['B', 'C']]);
    expect(search('A').matches('D')).toBe(true);
    expect(search('D').matches('A')).toBe(true);
  });

  it('完全一致・前方一致・部分一致、読み、表記揺れの順に並べる', () => {
    const search = createNameSearch([['Northern Dancer', 'ノーザンダンサー']]);
    const candidates = ['ノーザンダンサ', 'Northern Dancer', 'マイノーザンダンサー', 'ノーザンダンサー産駒', 'ノーザンダンサー'];
    expect(search('のーざんだんさー').filter(candidates, (name) => [name])).toEqual([
      'ノーザンダンサー', 'ノーザンダンサー産駒', 'マイノーザンダンサー', 'Northern Dancer', 'ノーザンダンサ',
    ]);
    expect(names('ねいてぃぶだんさー', ['Native Dancer'])).toEqual(['Native Dancer']);
    expect(names('ふあいあ', ['ファイアフラワー'])).toEqual(['ファイアフラワー']);
  });

  it('父母・計画名などの複数欄にも同じ検索を適用する', () => {
    const horses = [
      { name: '所有馬A', sire: 'Northern Dancer', plan: '計画A' },
      { name: '所有馬B', sire: 'Halo', plan: 'Northern Dancerの配合計画' },
      { name: '所有馬C', sire: 'Halo', plan: '計画C' },
    ];
    expect(nameSearch('のーざん').filter(horses, (h) => [h.name, h.sire, h.plan])).toEqual(horses.slice(0, 2));
    expect(nameSearch('けいかく').matches('計画')).toBe(false); // 漢字の読みを推測しない。
  });

  it('一致しない候補を除外し、同順位・空の検索では元の順序と個体を保つ', () => {
    const horses = [{ id: 'u:2', name: '同名の馬' }, { id: 'u:1', name: '同名の馬' }];
    const original = [...horses];
    expect(nameSearch('同名').filter(horses, (h) => [h.name])).toEqual(original);
    expect(nameSearch(' \u3000 ').filter(horses, (h) => [h.name])).toEqual(original);
    expect(nameSearch('存在しない名前').filter(horses, (h) => [h.name])).toEqual([]);
    expect(horses).toEqual(original);
    expect(nameSearch('存在しない名前').matches(null, undefined, '')).toBe(false);
    expect(nameSearch('り').matches('リード')).toBe(true);
    expect(nameSearch('ば').matches('ヴァ')).toBe(false);
  });
});

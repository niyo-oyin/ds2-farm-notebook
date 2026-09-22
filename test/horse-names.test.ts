import { expect, it } from 'vitest';
import { assembleHorseNames, horseNameMessages, horseNameRoutes } from '../server/horse-names';
import { namingParent, namingPedigree } from '../src/core/horse-names';
import { HorseResolver } from '../src/core/pedigree';
import { DEFAULT_RULES } from '../src/core/rules';
import { baseMaster } from '../src/data/base-master';
import { HorseNameRequestSchema } from '../src/shared/horse-names';
import { owned } from './horse-fixtures';
import type { HorseNameRequest } from '../src/shared/horse-names';

const resolver = new HorseResolver(baseMaster, [], DEFAULT_RULES);
const request: HorseNameRequest = {
  sire: namingParent(baseMaster.stallions[0].id, resolver, baseMaster, 'M'), dam: namingParent(baseMaster.broodmares[0].id, resolver, baseMaster, 'F'),
  pedigree: namingPedigree(baseMaster.stallions[0].id, baseMaster.broodmares[0].id, resolver, baseMaster),
  sex: 'F', color: '鹿毛', farm: 'あおい牧場', affix: { text: 'アオイ', position: 'prefix' }, previous: [],
};
const ideas = (names: string[]) => names.map(name => ({ name, meaning: '未来への願い。' }));
const raw = { withAffix: ideas(['キセキ', 'ツバサ', 'ヒカリ']), withoutAffix: ideas(['アカツキ', 'ハヤテ']) };
const post = (body: unknown) => new Request('http://localhost/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

it('父母の参照先で実在馬と自家生産馬を区別し、同名の実在馬の記録を混ぜない', () => {
  const mare = baseMaster.broodmares[0];
  const homebred = owned('u:dam', { name: mare.name, profile: { record: '18戦5勝', wins: '京都記念', earnings: 12000 }, memo: '京都で初重賞。' });
  const parents = new HorseResolver(baseMaster, [homebred], DEFAULT_RULES);
  expect(namingParent(mare.id, parents, baseMaster, 'F')).toMatchObject({ origin: 'real', name: mare.name, pedigree: { sire: mare.ancestors[0], dam: mare.ancestors[1] } });
  expect(namingParent(homebred.id, parents, baseMaster, 'F')).toMatchObject({ origin: 'homebred', name: mare.name, career: { record: '18戦5勝', wins: '京都記念' } });
  expect(namingParent('', resolver, baseMaster, 'F', mare.name)).toMatchObject({ origin: 'real', name: mare.name });
  expect(namingParent('', parents, baseMaster, 'F', mare.name)).toEqual({ origin: 'unknown', name: mare.name });
  expect(namingParent('', parents, baseMaster, 'F', '登録のない母')).toEqual({ origin: 'unknown', name: '登録のない母' });
});

it('自家生産の父母の現役時の記録を命名資料へ渡し、他の馬や画像は含めない', async () => {
  const mother = owned('u:dam', { name: 'アオイキセキ', category: '繁殖牝馬', sireKey: baseMaster.stallions[0].id, damKey: baseMaster.broodmares[0].id,
    imageId: 'private-image', profile: { record: '20戦3勝', wins: '七夕賞', earnings: 8500, races: [{ date: '30年7月2週', race: '七夕賞', place: '福島', finish: '1', grade: 'GⅢ', surface: '芝', distance: 2000 }] },
    abilities: { race: { stamina: '◎', temperament: '○', speed: '-' } }, effects: ['底力'], memo: '福島の夏が得意。' });
  const unrelated = owned('u:other', { memo: '無関係の馬のメモ' });
  const parents = new HorseResolver(baseMaster, [mother, unrelated], DEFAULT_RULES);
  const pedigree = namingPedigree(baseMaster.stallions[0].id, mother.id, parents, baseMaster);
  const input = HorseNameRequestSchema.parse({ ...request, dam: namingParent(mother.id, parents, baseMaster, 'F'), pedigree });
  let sent: unknown;
  const app = horseNameRoutes(async r => { sent = JSON.parse(horseNameMessages(r)[1].content); return assembleHorseNames(raw, r); }, () => true);
  expect((await app.fetch(post(input))).status).toBe(200);
  expect(sent).toMatchObject({ parents: { sire: { origin: 'real' }, dam: {
    origin: 'homebred', career: { record: '20戦3勝', wins: '七夕賞', earnings: 8500, races: [{ race: '七夕賞', finish: '1', distance: 2000 }] },
    abilities: { stamina: '◎', temperament: '○' }, factors: ['底力'], memo: '福島の夏が得意。',
  } } });
  expect(JSON.stringify(sent)).not.toMatch(/private-image|無関係の馬のメモ|"speed"/);
  expect(sent).toMatchObject({ pedigree });
  expect(namingParent('u:other', parents, baseMaster, 'F')).toMatchObject({ origin: 'homebred', career: { record: '', wins: '', earnings: null, races: [] } });
});

it('産駒を起点に3代14枠を展開し、自家生産の祖先と同じ馬の複数の位置を保つ', () => {
  const sire = baseMaster.stallions[0], dam = baseMaster.broodmares[0];
  const mother = owned('u:mother', { name: 'テストノハハ', sireKey: sire.id, damKey: dam.id });
  const parents = new HorseResolver(baseMaster, [mother], DEFAULT_RULES);
  const pedigree = namingPedigree(sire.id, mother.id, parents, baseMaster);
  expect(pedigree).toHaveLength(14);
  expect(pedigree).toEqual(expect.arrayContaining([
    { position: '父', name: sire.name, origin: 'real' },
    { position: '母', name: mother.name, origin: 'homebred' },
    { position: '母父', name: sire.name, origin: 'real' },
    { position: '父母父', name: sire.ancestors[4], origin: 'real' },
    { position: '母母母', name: dam.ancestors[1], origin: 'real' },
  ]));
  expect(pedigree.every(p => p.position.length <= 3)).toBe(true);
  expect(namingPedigree('', '', parents, baseMaster)).toEqual([]);
  expect(namingPedigree('', '', parents, baseMaster, '登録のない母')).toEqual([{ position: '母', name: '登録のない母', origin: 'unknown' }]);
  const inferred = namingPedigree('', '', parents, baseMaster, dam.name);
  expect(inferred).toHaveLength(7);
  expect(inferred).toContainEqual({ position: '母母父', name: dam.ancestors[4], origin: 'real' });
});

it('3候補だけに指定位置の冠名を付け、残り2候補は独立した名前にする', () => {
  expect(assembleHorseNames(raw, request).candidates.map(c => c.name)).toEqual(['アオイキセキ', 'アオイツバサ', 'アオイヒカリ', 'アカツキ', 'ハヤテ']);
  expect(assembleHorseNames(raw, { ...request, affix: { text: 'ヒメ', position: 'suffix' } }).candidates.map(c => c.name)).toEqual(['キセキヒメ', 'ツバサヒメ', 'ヒカリヒメ', 'アカツキ', 'ハヤテ']);
  expect(assembleHorseNames(raw, { ...request, affix: { text: '', position: 'prefix' } }).candidates.map(c => c.name)).toEqual(['キセキ', 'ツバサ', 'ヒカリ', 'アカツキ', 'ハヤテ']);
});

it('冠名の有無ごとに文字種・長さを検証し、候補全体で重複を防ぐ', () => {
  for (const name of ['ABC', '奇跡', 'キセキ1', 'キセキキセキキセキ', 'ツバサ']) {
    expect(() => assembleHorseNames({ ...raw, withAffix: [{ name, meaning: '候補' }, ...raw.withAffix.slice(1)] }, request)).toThrow();
  }
  for (const name of ['ABC', '光', 'ア', 'アイウエオカキクケコ', 'アオイキセキ']) expect(() => assembleHorseNames({ ...raw, withoutAffix: ideas([name, 'ハヤテ']) }, request)).toThrow();
  expect(() => assembleHorseNames(raw, { ...request, previous: ['アオイキセキ'] })).toThrow();
  expect(() => assembleHorseNames(raw, { ...request, previous: ['アカツキ'] })).toThrow();
  const longAffix = assembleHorseNames({ withAffix: ideas(['ア', 'イ', 'ウ']), withoutAffix: ideas(['アイウエオカキクケ', 'ハヤテ']) }, { ...request, affix: { text: 'アイウエオカキク', position: 'prefix' } });
  expect(longAffix.candidates[0].name).toHaveLength(9);
  expect(longAffix.candidates[3].name).toBe('アイウエオカキクケ');
});

it('不正な入力では生成せず、正常なリクエストは候補を返す', async () => {
  let called = 0;
  const app = horseNameRoutes(async input => { called++; return assembleHorseNames(raw, input); }, () => true);
  for (const text of ['ABC', '牧場', '１２３', 'アイウエオカキクケ']) {
    expect((await app.fetch(post({ ...request, affix: { text, position: 'prefix' } }))).status).toBe(400);
  }
  expect(called).toBe(0);
  const response = await app.fetch(post(request));
  expect(response.status).toBe(200);
  expect((await response.json()).candidates).toHaveLength(5);
  expect(called).toBe(1);
});

it('キー未設定・生成失敗を通知し、失敗後にも再試行できる', async () => {
  expect((await horseNameRoutes(async input => assembleHorseNames(raw, input), () => false).fetch(post(request))).status).toBe(503);
  let fail = true;
  const app = horseNameRoutes(async input => { if (fail) throw new Error('private upstream detail'); return assembleHorseNames(raw, input); }, () => true);
  const response = await app.fetch(post(request));
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('private upstream detail');
  fail = false;
  expect((await app.fetch(post(request))).status).toBe(200);
});

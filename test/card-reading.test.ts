import { describe, expect, it, vi } from 'vitest';
import { readScreenAs } from '../server/llm';
import * as llmClient from '../server/llm-client';
import { applyCardReading, cardMatchCandidates, cardPatchDiff, horseAge, inferredGameYear, mergeRaces, parseFoalName, parseManYen, pedigreeMatchCandidates, sexAgeLabel, type CardReading, type PedigreeReading } from '../src/core/owned-horse';
import { owned } from './horse-fixtures';

const dash = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, '-']));
const ABILITIES = ['speed', 'stamina', 'power', 'guts', 'temperament', 'turf', 'dirt'];
const TRAITS = ['growth', 'start', 'corner', 'heavy_track', 'rough_track', 'fast_track', 'constitution', 'legs', 'concentration', 'timid', 'sound_reaction', 'reaction'];
const card = (patch: Partial<CardReading> = {}): CardReading => ({
  screen_type: '育成馬', name: 'アディクティドの27', class: '', sex: '牝', age: 2, color: '芦毛', distance: '-', weight: '', stable: '',
  abilities: dash(ABILITIES), traits: dash(TRAITS), record: '', earnings_current: '', earnings_total: '', races: [], ...patch,
});
const stabled = (): CardReading => card({
  screen_type: '入厩馬', name: 'アディクトドリーム', class: 'OP', age: 6, distance: '2000-2400m', weight: '444kg (+6kg)', stable: '美浦 / 勝田厩舎',
  abilities: { speed: '○', stamina: '-', power: '○', guts: '◎', temperament: '○', turf: '◎', dirt: '-' },
  traits: { ...dash(TRAITS), start: '○', corner: '両○', heavy_track: '○', rough_track: '○', fast_track: '○', constitution: '○', legs: '△' },
  record: '28戦6勝', earnings_current: '5800万円', earnings_total: '1億6330万円',
  races: [{ date: '12.2', place: '中京', race: '中日新', finish: '' }, { date: '10.3', place: '新潟', race: '新潟牝', finish: '' }],
});

describe('カード読み取りの解釈', () => {
  it('写真の評価を登録・表示用の差分まで保ち、項目にない印は拒否する', async () => {
    const response = { ...stabled(), abilities: { ...stabled().abilities, speed: '◉', dirt: '×' }, traits: { ...stabled().traits, growth: '晩成', legs: '×', constitution: '×', heavy_track: '×', rough_track: '×', fast_track: '×', concentration: '△' }, races: [], notes: '' };
    const completion = vi.spyOn(llmClient, 'chatCompletion');
    try {
      completion.mockResolvedValue({ text: JSON.stringify(response) });
      const { result } = await readScreenAs('入厩馬', 'image', 'image/png');
      expect(result).toMatchObject({ card: { abilities: { speed: '◉', dirt: '×', stamina: '-' }, traits: { growth: '晩成', corner: '両○', legs: '×', constitution: '×', heavy_track: '×', rough_track: '×', fast_track: '×', concentration: '△' } } });
      if (result.screen_type !== '入厩馬' && result.screen_type !== '育成馬') throw new Error('カード以外');
      const patch = applyCardReading(undefined, { ...result.card, screen_type: result.screen_type }, '2026-09-24T00:00:00Z');
      expect(patch.abilities?.race).toMatchObject({ speed: '◉', dirt: '×', legs: '×', health: '×', heavyTrack: '×', roughTrack: '×', fastTrack: '×', concentration: '△' });
      expect(patch.abilities?.race).not.toHaveProperty('stamina');
      expect(cardPatchDiff(undefined, patch)).toEqual(expect.arrayContaining([
        { label: '脚元', before: '未登録', after: '×' },
        { label: '重馬場', before: '未登録', after: '×' },
        { label: 'スピード', before: '未登録', after: '◉' },
      ]));
      for (const [group, key, mark] of [['abilities', 'speed', '×'], ['abilities', 'speed', '△'], ['abilities', 'turf', '◉'], ['traits', 'concentration', '×'], ['traits', 'corner', '○']] as const) {
        completion.mockResolvedValue({ text: JSON.stringify({ ...response, [group]: { ...response[group], [key]: mark } }) });
        await expect(readScreenAs('入厩馬', 'image', 'image/png')).rejects.toThrow('読み取り結果の形式が不正');
      }
    } finally { completion.mockRestore(); }
  });

  it('戦績の全列を取り込み、誕生・購入・入厩・出走予定は含めない', async () => {
    const blank = { date: '', place: '', race: '', finish: '', grade: '', surface: null, distance: null, going: null, runners: null, popularity: null, jockey: '', jockey_candidates: [], carriedWeight: null, bodyWeight: null, strategy: null };
    const race = { ...blank, date: '8.5', place: '中京', race: '中京２歳ステークス', finish: '1', grade: 'GⅢ', surface: '芝', distance: 1400, going: '良', runners: 18, popularity: 1, jockey: 'ルメール', carriedWeight: 55, bodyWeight: 426, strategy: '追' };
    const completion = vi.spyOn(llmClient, 'chatCompletion').mockResolvedValue({ text: JSON.stringify({ ...stabled(), races: [
      race,
      { ...blank, date: '7.3', place: '福島', race: 'メイクデビュー福島', finish: '1', grade: '新馬', surface: 'ダート', distance: 1150, going: '稍重' },
      { ...blank, date: '10.1', place: '東京', race: 'サウジアラビアRC', jockey: '出走予定' },
      { ...blank, race: 'ミッキーアイル ドナブルーハ 誕生' },
      { ...blank, date: '5.1', race: '早乙女厩舎 入厩' },
      { ...blank, date: '30年', race: '２歳セール 購入（4800万円）' },
    ], notes: '' }) });
    try {
      const { result } = await readScreenAs('入厩馬', 'image', 'image/jpeg');
      if (result.screen_type !== '入厩馬') throw new Error('入厩馬以外');
      expect(result.card.races).toHaveLength(2);
      const { jockey_candidates: _candidates, ...expectedRace } = race;
      expect(result.card.races[0]).toEqual(expectedRace);
      expect(result.card.races[1]).not.toHaveProperty('bodyWeight');
      const patch = applyCardReading(undefined, { ...result.card, screen_type: result.screen_type }, '2026-09-24T00:00:00Z');
      expect(patch.profile?.races).toEqual(result.card.races);
    } finally { completion.mockRestore(); }
  });

  it('3文字の騎手名を一意の前方一致候補だけで補完し、曖昧・不一致・未省略の表記は保つ', async () => {
    const cases = [
      { displayed: 'ルメー', candidates: ['ルメール'], expected: 'ルメール' },
      { displayed: '横山武', candidates: ['横山 武史', '横山武史'], expected: '横山武史' },
      { displayed: 'デムー', candidates: ['デムーロ', 'デムーロ弟'], expected: 'デムー' },
      { displayed: 'ルメー', candidates: ['川田将雅'], expected: 'ルメー' },
      { displayed: 'ルメー', candidates: [], expected: 'ルメー' },
      { displayed: '武豊', candidates: ['武豊彦'], expected: '武豊' },
      { displayed: '', candidates: ['ルメール'], expected: undefined },
    ];
    const races = cases.map(({ displayed, candidates }, i) => ({
      date: `8.${i + 1}`, place: '新潟', race: '未勝利', finish: '1', grade: '', surface: null, distance: null, going: null,
      runners: null, popularity: null, jockey: displayed, jockey_candidates: candidates, carriedWeight: null, bodyWeight: null, strategy: null,
    }));
    const completion = vi.spyOn(llmClient, 'chatCompletion').mockResolvedValue({ text: JSON.stringify({ ...stabled(), races, notes: '' }) });
    try {
      const { result } = await readScreenAs('入厩馬', 'image', 'image/jpeg');
      if (result.screen_type !== '入厩馬') throw new Error('入厩馬以外');
      expect(result.card.races.map((r) => r.jockey)).toEqual(cases.map((c) => c.expected));
      const patch = applyCardReading(undefined, { ...result.card, screen_type: result.screen_type }, '2026-09-24T00:00:00Z');
      expect(patch.profile?.races?.[0].jockey).toBe('ルメール');
      expect(result.card.races[0]).not.toHaveProperty('jockey_candidates');
      expect(completion).toHaveBeenCalledTimes(1);
    } finally { completion.mockRestore(); }
  });

  it('賞金と仮名を解釈する', () => {
    expect(parseManYen('1億6330万円')).toBe(16330);
    expect(parseManYen('5800万円')).toBe(5800);
    expect(parseManYen('2億円')).toBe(20000);
    expect(parseManYen('')).toBeUndefined();
    expect(parseManYen('-')).toBeUndefined();
    expect(parseManYen('たくさん')).toBeUndefined();
    expect(parseFoalName('アディクティドの27')).toEqual({ damName: 'アディクティド', birthYear: 27 });
    expect(parseFoalName('アディクトドリーム')).toBeNull();
  });

  it('馬名一致を確定とし、それ以外は母名と生年・毛色・印の一致で候補を並べる', () => {
    const horses = [
      owned('u:named', { name: 'アディクトドリーム' }),
      owned('u:foal', { name: '無名の子', profile: { birthYear: 27, color: '芦毛' }, abilities: { race: { speed: '○', guts: '◎' } } }),
      owned('u:other', { name: '別の子', sex: 'F', profile: { birthYear: 26, color: '鹿毛' } }),
      owned('u:male', { name: '牡の子', sex: 'M', profile: { birthYear: 27, color: '芦毛' } }),
    ];
    const damNameOf = (h: typeof horses[number]) => h.id === 'u:foal' ? 'アディクティド' : '';
    expect(cardMatchCandidates(card({ name: 'アディクト ドリーム' }), horses, damNameOf)[0]).toMatchObject({ horse: { id: 'u:named' }, exact: true });
    const byFoal = cardMatchCandidates(card(), horses, damNameOf);
    expect(byFoal[0]).toMatchObject({ horse: { id: 'u:foal' }, exact: false });
    expect(byFoal[0].reasons).toContain('母名と生年が一致');
    expect(byFoal.map((c) => c.horse.id)).not.toContain('u:male');
    const renamed = cardMatchCandidates({ ...stabled(), name: '命名後の新しい名前' }, horses, damNameOf);
    expect(renamed[0].horse.id).toBe('u:foal');
    expect(renamed[0].reasons).toEqual(expect.arrayContaining(['性別が一致', '毛色が一致', '印が2件一致']));
    expect(cardMatchCandidates(card({ name: '', sex: '不明', color: '' }), horses, damNameOf)).toEqual([]);
  });

  it('競走成績は日付・場所・レース名で重複を除き、新しい行を先頭に足す', () => {
    const existing = [{ date: '10.3', place: '新潟', race: '新潟牝', finish: '', surface: '芝' as const, distance: 1800, going: '稍重' as const, grade: 'GⅢ', carriedWeight: 55, bodyWeight: 426, jockey: 'ルメール' }, { date: '8.5', place: '札幌', race: '丹頂ス', finish: '3' }];
    const merged = mergeRaces(existing, [{ date: '12.2', place: '中京', race: '中日新', finish: '' }, { date: '10.3', place: '新潟', race: '新潟牝', finish: '5', going: '良', popularity: 2, jockey: '', bodyWeight: undefined }]);
    expect(merged.map((r) => r.race)).toEqual(['中日新', '新潟牝', '丹頂ス']);
    expect(merged[1].finish).toBe('5');
    expect(merged[1]).toMatchObject({ surface: '芝', distance: 1800, going: '良', grade: 'GⅢ', carriedWeight: 55, bodyWeight: 426, jockey: 'ルメール', popularity: 2 });
    const update = applyCardReading(owned('u:race', { profile: { races: existing } }), card({ races: merged.slice(1) }), '2026-09-24T00:00:00Z');
    expect(cardPatchDiff(owned('u:race', { profile: { races: existing } }), update)).toContainEqual({ label: '競走成績', before: '2行', after: '2行（内容更新）' });
    expect(merged[2].finish).toBe('3');
    expect(mergeRaces(undefined, [{ date: '', place: '', race: '', finish: '' }])).toEqual([]);
  });
});

describe('カード読み取りの統合', () => {
  it('新規の育成馬は仮名の生年と現役区分で登録し、「-」の項目を持たない', () => {
    const patch = applyCardReading(undefined, card(), '2026-09-19T00:00:00.000Z');
    expect(patch).toMatchObject({ name: 'アディクティドの27', sex: 'F', category: '現役', profile: { color: '芦毛', birthYear: 27 } });
    expect(patch.abilities?.race).toEqual({});
    expect(patch.profile).not.toHaveProperty('races');
    expect(patch.observations).toEqual([{ at: '2026-09-19T00:00:00.000Z', screen: '育成馬', age: 2, source: 'photo' }]);
  });

  it('入厩後の読み取りで判明した印だけを上書きし、既存の値と観測履歴を残す', () => {
    const horse = owned('u:1', { name: 'アディクティドの27', category: '現役', profile: { birthYear: 27, color: '芦毛', wins: '' },
      abilities: { race: { stamina: '◎', speed: '◎', distance: '1600-2000m' } }, observations: [{ at: '2026-01-01T00:00:00.000Z', screen: '育成馬', source: 'photo' }] });
    const patch = applyCardReading(horse, stabled(), '2026-09-19T00:00:00.000Z');
    expect(patch.name).toBe('アディクトドリーム');
    expect(patch.abilities?.race).toEqual({ stamina: '◎', speed: '○', power: '○', guts: '◎', temperament: '○', turf: '◎', distance: '2000-2400m',
      start: '○', corner: '両○', heavyTrack: '○', roughTrack: '○', fastTrack: '○', health: '○', legs: '△' });
    expect(patch.profile).toEqual({ birthYear: 27, color: '芦毛', wins: '', rank: 'OP', stable: '美浦 / 勝田厩舎', weight: '444kg (+6kg)', record: '28戦6勝', earnings: 16330, earningsCurrent: 5800,
      races: [{ date: '12.2', place: '中京', race: '中日新', finish: '' }, { date: '10.3', place: '新潟', race: '新潟牝', finish: '' }] });
    expect(patch.observations).toHaveLength(2);
    expect(patch.observations?.[1]).toMatchObject({ screen: '入厩馬', age: 6 });
    const diff = cardPatchDiff(horse, patch);
    expect(diff.find((d) => d.label === '馬名')).toEqual({ label: '馬名', before: 'アディクティドの27', after: 'アディクトドリーム' });
    expect(diff.find((d) => d.label === 'スタミナ')).toBeUndefined();
    expect(diff.find((d) => d.label === 'スピード')).toEqual({ label: 'スピード', before: '◎', after: '○' });
    expect(diff.find((d) => d.label === '競走成績')).toEqual({ label: '競走成績', before: '未登録', after: '2行' });
  });

  it('年齢と生年からゲーム内の年を推定し、生年が不明なら年と年齢から生年を埋める', () => {
    const fromName = applyCardReading(undefined, card(), '2026-09-19T00:00:00.000Z');
    expect(inferredGameYear(card(), fromName)).toBe(29);
    const noName = applyCardReading(undefined, card({ name: 'アディクトドリーム', age: 6 }), '2026-09-19T00:00:00.000Z', 31);
    expect(noName.profile?.birthYear).toBe(25);
    // 0歳は有効（「0歳のxxの27」なら今は27年）。読めなかった -1 は不明
    expect(inferredGameYear(card({ age: 0 }), fromName)).toBe(27);
    expect(applyCardReading(undefined, card({ name: 'アディクトドリーム', age: 0 }), '2026-09-19T00:00:00.000Z', 31).profile?.birthYear).toBe(31);
    expect(applyCardReading(undefined, card({ name: 'アディクトドリーム', age: -1 }), '2026-09-19T00:00:00.000Z', 31).profile?.birthYear).toBeUndefined();
    expect(inferredGameYear(card({ age: -1 }), fromName)).toBeUndefined();
    expect(applyCardReading(undefined, card({ age: -1 }), '2026-09-19T00:00:00.000Z').observations?.[0]).not.toHaveProperty('age');
    expect(horseAge(27, 29)).toBe(2);
    expect(horseAge(undefined, 29)).toBeUndefined();
    expect(sexAgeLabel('F', 2)).toBe('牝2');
    expect(sexAgeLabel('M', undefined)).toBe('牡');
    expect(sexAgeLabel(null, 3)).toBe('性別未確認');
  });

  it('繁殖牝馬の区分と性別不明の読み取りは既存の値を保つ', () => {
    const mare = owned('u:mare', { category: '繁殖牝馬', sex: 'F' });
    const patch = applyCardReading(mare, card({ sex: '不明', name: 'u:mare' }), '2026-09-19T00:00:00.000Z');
    expect(patch.category).toBe('繁殖牝馬');
    expect(patch.sex).toBe('F');
  });
});

describe('血統画面の反映先候補', () => {
  const reading: PedigreeReading = { sire: 'ゴールドシップ', dam: 'メイショウツバクロ', sire_sire: 'ステイゴールド', sire_dam: 'ポイントフラッグ', dam_sire: 'フレンチデピュティ', dam_dam: 'ダンシングハピネス', crosses: [] };
  const labels: Record<string, string> = { 'bm:1': 'メイショウツバクロ', 'st:1': 'ゴールドシップ', 'st:2': 'キタサンブラック' };
  const labelOf = (key: string) => labels[key] ?? '';
  it('父母が登録済みの馬を除き、仮名の母名・登録済みの母・父の一致で並べる', () => {
    const horses = [
      owned('u:done', { name: '登録済み', sireKey: 'st:1', damKey: 'bm:1' }),
      owned('u:foal', { name: 'メイショウツバクロの27' }),
      owned('u:dam', { name: '命名済み', damKey: 'bm:1' }),
      owned('u:sire', { name: '父だけ', sireKey: 'st:1' }),
      owned('u:other', { name: '無関係', sireKey: 'st:2' }),
    ];
    const c = pedigreeMatchCandidates(reading, horses, labelOf);
    expect(c.map((x) => x.horse.id)).toEqual(['u:foal', 'u:dam', 'u:sire']);
    expect(c[0].reasons).toEqual(['仮名の母名が一致']);
    expect(c[1].reasons).toEqual(['母が一致']);
    expect(c[2].reasons).toEqual(['父が一致']);
    expect(pedigreeMatchCandidates({ ...reading, sire: '', dam: '' }, horses, labelOf)).toEqual([]);
  });
});

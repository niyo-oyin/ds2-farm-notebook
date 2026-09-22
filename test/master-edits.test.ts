import { describe, expect, it, vi } from 'vitest';
import { readScreenAs } from '../server/llm';
import * as llmClient from '../server/llm-client';
import { baseMaster } from '../src/data/base-master';
import type { MasterHorse } from '../src/core/types';
import { horseIdentities } from '../src/core/horse-identity';
import { prepareReadingAncestors, applyMasterEdits, applyMasterFields, masterDiffRows, masterFromBreedingCard, breedingCardRows, diffAgainstBase, fillFromParents, nicksProposals, type BreedingReading, type MasterEdit } from '../src/core/master-edits';

const M = baseMaster;
const identities = horseIdentities(M);
const label = (id: string) => identities.get(id)?.name ?? '（未登録）';
const at = '2026-09-19T00:00:00.000Z';

describe('マスターデータへの追加・修正・非表示', () => {
  it('修正は変えた項目だけを重ね、追加は末尾に足し、非表示は一覧から外す', () => {
    const base = M.stallions.find((s) => s.id === 'st:1')!;
    expect(diffAgainstBase(base, { ...base })).toEqual({});
    const data = diffAgainstBase(base, { ...base, price: 9999, unlock: '皐月賞に勝利', attrs: { ...base.attrs, grown: '晩成' } });
    const edits: MasterEdit[] = [
      { id: base.id, kind: 'stallion', added: false, data, updatedAt: at },
      { id: 'st:2', kind: 'stallion', added: false, hidden: true, data: {}, updatedAt: at },
      { id: 'bm:u-1', kind: 'broodmare', added: true, data: { name: '追加の牝馬', ancestors: Array(30).fill(''), attrs: {} }, updatedAt: at },
    ];
    const m = applyMasterEdits(M, edits);
    const s1 = m.stallions.find((s) => s.id === 'st:1')!;
    expect(s1.price).toBe(9999); expect(s1.unlock).toBe('皐月賞に勝利'); expect(s1.name).toBe(M.stallions[0].name); expect(s1.ancestors).toEqual(M.stallions[0].ancestors);
    expect(s1.attrs).toEqual({ ...base.attrs, grown: '晩成' });
    expect(m.stallions.some((s) => s.id === 'st:2')).toBe(false);
    const added = m.broodmares.at(-1)!;
    expect(added).toMatchObject({ id: 'bm:u-1', kind: 'broodmare', sex: 'F', name: '追加の牝馬' });
    expect(M.stallions.find((s) => s.id === 'st:1')!.price).not.toBe(9999);
  });
  it('凝ったペアはマスターデータの行を無効化・追加でき、ニックスは段階の訂正と段階0の行を持てる', () => {
    const [ks, kd] = M.kotta[0];
    const m = applyMasterEdits(M, [], [], [
      { sire: ks, dam: kd, active: false, source: '実機確認', note: '', updatedAt: at },
      { sire: 'テスト父', dam: 'テスト母', active: true, source: '推定', note: '', updatedAt: at },
    ], [
      { sire: M.nicks[0].sire, dam: M.nicks[0].dam, level: 3, source: '実機確認', note: '', updatedAt: at },
      { sire: '追加した父系統', dam: '追加した母系統', level: 0, source: '実機確認', note: '', updatedAt: at },
    ]);
    expect(m.kotta.some(([a, b]) => a === ks && b === kd)).toBe(false);
    expect(m.kotta.at(-1)).toEqual(['テスト父', 'テスト母']);
    expect(m.kotta.length).toBe(M.kotta.length);
    expect(m.nicks.find((n) => n.sire === M.nicks[0].sire && n.dam === M.nicks[0].dam)!.level).toBe(3);
    expect(m.nicks.find((n) => n.sire === '追加した父系統' && n.dam === '追加した母系統')).toEqual({ sire: '追加した父系統', dam: '追加した母系統', level: 0 });
    expect(m.nicks.length).toBe(M.nicks.length + 1);
  });

  it('父母のIDから2代目以降を補完し、手入力済みの欄は上書きしない', () => {
    const byId = new Map<string, MasterHorse>([...M.stallions, ...M.broodmares].map((h) => [h.id, h]));
    const sire = M.stallions[0], dam = M.broodmares[0];
    const filled = fillFromParents([sire.id, dam.id, ...Array(28).fill('')], byId);
    expect(filled[2]).toBe(sire.ancestors[0]); expect(filled[3]).toBe(sire.ancestors[1]);
    expect(filled[4]).toBe(dam.ancestors[0]); expect(filled[5]).toBe(dam.ancestors[1]);
    expect(filled[6]).toBe(sire.ancestors[2]); expect(filled[14]).toBe(sire.ancestors[6]);
    expect(filled[29]).toBe(dam.ancestors[13]);
    const kept = fillFromParents([sire.id, dam.id, '手入力', ...Array(27).fill('')], byId);
    expect(kept[2]).toBe('手入力');
  });

});

describe('種牡馬・繁殖牝馬の画面からの登録', async () => {
  const { homebredBlockReason, masterFromReading, parseFee } = await import('../src/core/master-edits');
  const { owned, planned } = await import('./horse-fixtures');
  const ancestors = new Map(M.ancestors.map((a) => [a.id, a]));
  const reading = { name: 'マチカネイワシミズ', sex: '牡' as const, age: -1, color: '鹿毛', sire: 'ファバージ', dam: 'ロッチ', dam_sire: 'ダイハード', big_system: 'Ns', small_system: 'プリンスリーギフト', fee: '無料', price: '', distance: '1800-2000m', growth: '普通', dirt: '○', kenko: 'B', kisyo: 'B', jisseki: 'C', konjo: 'C', antei: 'C', offspring: '0頭', wins: '0勝', graded: '0勝', g1: '0勝' };

  it('自家生産馬は拒否する（所有馬・計画馬と同名、仮名、父母が所有馬）', () => {
    expect(homebredBlockReason(reading, [], [])).toBeNull();
    expect(homebredBlockReason(reading, [owned('u:1', { name: 'マチカネイワシミズ' })], [])).toMatch(/所有馬/);
    expect(homebredBlockReason(reading, [], [planned('p:1', { name: 'マチカネ イワシミズ' })])).toMatch(/計画馬/);
    expect(homebredBlockReason({ ...reading, name: 'ロッチの27' }, [], [])).toMatch(/仮名/);
    expect(homebredBlockReason(reading, [owned('u:2', { name: 'ロッチ' })], [])).toMatch(/母「ロッチ」/);
    expect(homebredBlockReason({ ...reading, name: '' }, [], [])).toMatch(/馬名/);
  });

  it('種牡馬の読み取りを新規のマスターの馬にし、種付料「無料」は0、繁殖能力は attrs に入る', () => {
    const prepared = prepareReadingAncestors(M, reading);
    const h = masterFromReading('stallion', reading, null, prepared.master, ancestors, prepared.parentIds);
    const names = horseIdentities(prepared.master);
    expect(h).toMatchObject({ kind: 'stallion', sex: 'M', name: 'マチカネイワシミズ', price: 0, color: '鹿毛', bigSystem: 'Ns', smallSystem: 'プリンスリーギフト' });
    expect(h.ancestors.slice(0, 2).map(id => names.get(id)?.name)).toEqual(['ファバージ', 'ロッチ']); expect(names.get(h.ancestors[4])?.name).toBe('ダイハード');
    expect(h.attrs).toMatchObject({ dist: [1800, 2000], grown: '普通', dirt: '○', kenko: 'B', kisyo: 'B', jisseki: 'C', konjo: 'C', antei: 'C' });
    const unknown = masterFromReading('stallion', { ...reading, sire: '', dam: '', dam_sire: '', big_system: '' }, null, M, ancestors);
    expect(unknown).toMatchObject({ omoshiro: '????', migoto: '????' });
    expect(parseFee('500万円')).toBe(500); expect(parseFee('')).toBeUndefined();
  });

  it('既存のマスターの馬には読めた項目だけを重ね、父母がマスターの馬なら血統を補完する', () => {
    const base = M.broodmares.find((b) => b.name === 'アーモンドアイ') ?? M.broodmares[0];
    const r = { ...reading, name: base.name, sex: '牝' as const, age: 8, sire: M.stallions[0].name, dam: '', dam_sire: '', big_system: '', small_system: '', fee: '', price: '3億7000万円', distance: '', growth: '', dirt: '', kenko: '', kisyo: '', jisseki: '', konjo: '', antei: '' };
    const h = masterFromReading('broodmare', r, base, M, ancestors);
    expect(h.id).toBe(base.id); expect(h.purchasePrice).toBe(37000); expect(h.smallSystem).toBe(base.smallSystem);
    // 父が別のマスターの馬に変わったので父側の祖先は新しい父の血統で埋まり、母側は元のまま
    expect(h.ancestors[0]).toBe(M.stallions[0].id); expect(h.ancestors[2]).toBe(M.stallions[0].ancestors[0]); expect(h.ancestors[6]).toBe(M.stallions[0].ancestors[2]);
    expect(h.ancestors[1]).toBe(base.ancestors[1]); expect(h.ancestors[5]).toBe(base.ancestors[5]);
    const changed = { ...r, sire: '', dam: '別の母' };
    const prepared = prepareReadingAncestors(M, changed);
    const fixed = masterFromReading('broodmare', changed, base, prepared.master, ancestors, prepared.parentIds);
    expect(fixed.ancestors[1]).toBe(prepared.additions[0].id);
    expect(fixed.ancestors[5]).toBe('');
    const partial = applyMasterFields(base, h, ['purchasePrice']);
    expect(partial.purchasePrice).toBe(37000);
    expect(partial.ancestors).toEqual(base.ancestors);
    expect(applyMasterFields(base, h, ['ancestors']).ancestors).toEqual(h.ancestors);
  });
});

describe('祖先マスターの追加・修正と因子の突き合わせ', async () => {
  const { compareAncestorFactors } = await import('../src/core/master-edits');
  it('読み取った因子を新規・一致・相違に分け、重複した名前は1回にする', () => {
    const known = M.ancestors.find((a) => a.effects.length)!;
    const other = M.ancestors.find((a) => a !== known && a.effects.length)!;
    const rows = compareAncestorFactors([{ name: known.name, factors: [...known.effects] }, { name: known.name, factors: [] }, { name: '未知の馬', factors: ['底力'] }, { name: other.name, factors: ['速力', ...other.effects] }, { name: '', factors: [] }], M);
    expect(rows.map((r) => r.status)).toEqual(['一致', '新規', '相違']);
    expect(rows[1]).toMatchObject({ name: '未知の馬', known: null });
  });
});

describe('種付け画面からのニックスの提案', () => {
  it('右上の★を段階にし、父小系統ごとにまとめ、表と比べた状態を付ける。同じ小系統で★が揃わなければ不整合', () => {
    const bySmall = (small: string, n: number) => M.stallions.filter((h) => h.smallSystem === small).slice(0, n);
    const [ss1, ss2] = bySmall('サンデーサイレンス', 2), [mp1] = bySmall('ミスタープロスペクター', 1), [rb1, rb2] = bySmall('ロベルト', 2);
    const reading: BreedingReading = { sort: 'ニックス', selected_name: '', selected_small_system: '', cards: [
      { name: ss1.name, theory: '面白い', fee: '', stars: 3, abilities: null }, { name: ss2.name, theory: '', fee: '', stars: 3, abilities: null },
      { name: mp1.name, theory: '凝った', fee: '', stars: 0, abilities: null },
      { name: rb1.name, theory: '', fee: '', stars: 1, abilities: null }, { name: rb2.name, theory: '', fee: '', stars: 2, abilities: null },
      { name: '知らない馬', theory: '', fee: '', stars: 1, abilities: null },
    ] };
    const rows = breedingCardRows(reading, M.stallions);
    expect(rows.map((r) => r.level)).toEqual([3, 3, 0, 1, 2, 1]);
    expect(rows[5].stallion).toBeNull();
    const nicks = [
      { sire: 'サンデーサイレンス', dam: 'ボールドルーラー', level: 3 },
      { sire: 'ミスタープロスペクター', dam: 'ボールドルーラー', level: 0 },
      { sire: 'ロベルト', dam: 'ボールドルーラー', level: 1 },
    ];
    const p = nicksProposals(rows, 'ボールドルーラー', nicks, true);
    expect(p.map((x) => [x.sire, x.level, x.status])).toEqual([['サンデーサイレンス', 3, '一致'], ['ミスタープロスペクター', 0, '一致'], ['ロベルト', 1, '不整合']]);
    expect(nicksProposals(rows, 'ヘイロー', nicks, true).map((x) => x.status)).toEqual(['新規', '新規', '不整合']);
    expect(nicksProposals(rows, 'ボールドルーラー', nicks, false).some((x) => x.sire === 'ミスタープロスペクター')).toBe(false);
  });
});


describe('種牡馬一覧の能力取り込み', () => {
  const abilities = { distance: '1600-2000', growth: '早熟', dirt: '○', kenko: 'C', kisyo: 'B', jisseki: 'C', konjo: 'A', antei: 'B' };
  it('一覧のAPI結果から各馬の能力を対応づけ、選んだ差分だけを反映する', async () => {
    const original = M.stallions.find((h) => h.name === 'エスケンデレヤ')!;
    const base = { ...original, attrs: { ...original.attrs, kenko: 'A', kisyo: 'A', jisseki: 'A', konjo: 'B' } };
    const other = M.stallions.find((h) => h.id !== base.id)!;
    const response = { sort: '種付料', selected_name: '', selected_small_system: '', notes: '', cards: [
      { name: '', fee: '', theory: '', stars: null, abilities: null },
      { name: base.name, fee: '20万', theory: '-', stars: 0, abilities },
      { name: other.name, fee: '', theory: '', stars: null, abilities: null },
      { name: '未登録の種牡馬', fee: '', theory: '', stars: null, abilities },
    ] };
    const completion = vi.spyOn(llmClient, 'chatCompletion').mockResolvedValue({ text: JSON.stringify(response) });
    try {
      const { result } = await readScreenAs('種付け', 'image', 'image/png');
      if (result.screen_type !== '種付け') throw new Error('一覧ではありません');
      const rows = breedingCardRows(result.breeding, [base, other]);
      expect(rows).toHaveLength(3);
      expect(rows[0].reading.abilities).toEqual(abilities);
      expect(rows[2].stallion).toBeNull();
      const next = masterFromBreedingCard(base, rows[0].reading);
      expect(next.attrs).toMatchObject({ dist: [1600, 2000], grown: '早熟', dirt: '○', kenko: 'C', kisyo: 'B', jisseki: 'C', konjo: 'A', antei: 'B' });
      expect(next.price).toBe(20);
      expect(next.ancestors).toEqual(base.ancestors);
      const changes = masterDiffRows(base, next, M.meta.bigSystems, label);
      expect(changes.find((d) => d.key === 'attr:kenko')).toMatchObject({ before: 'A', after: 'C' });
      const selected = applyMasterFields(base, next, ['attr:kenko', 'attr:jisseki']);
      expect(selected.attrs).toMatchObject({ kenko: 'C', jisseki: 'C', kisyo: 'A', konjo: 'B' });
      const merged = applyMasterEdits(M, [{ id: base.id, kind: 'stallion', added: false, data: diffAgainstBase(original, selected), updatedAt: at }]);
      expect(merged.stallions.find((h) => h.id === base.id)?.attrs).toEqual(selected.attrs);
      expect(masterFromBreedingCard(other, rows[1].reading)).toEqual(other);
      expect(nicksProposals([rows[1]], 'ヘイロー', M.nicks, true)).toEqual([]);
    } finally { completion.mockRestore(); }
  });

  it('隠れた能力や未判明の印は既存値を消さず、読めた項目だけを更新する', () => {
    const base = { ...M.stallions[0], attrs: { dirt: '◎', kenko: 'A', kisyo: 'C', dist: [1000, 1600] } };
    const next = masterFromBreedingCard(base, { name: base.name, fee: '', theory: '', stars: null, abilities: { ...abilities, distance: '', dirt: '-', kenko: '', kisyo: 'B' } });
    expect(next.attrs).toMatchObject({ dirt: '◎', kenko: 'A', kisyo: 'B', dist: [1000, 1600] });
    expect(next.price).toBe(base.price);
    expect(base.attrs.kisyo).toBe('C');
  });
});

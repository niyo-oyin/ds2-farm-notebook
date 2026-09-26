import { describe, it, expect, vi } from 'vitest';
import { memoryStorage } from './horse-fixtures';
import { testCatalog } from './setup-catalog';

vi.mock('../src/store/sync', () => ({ pushDiff: vi.fn(), pushAll: vi.fn(), pull: vi.fn().mockResolvedValue(null) }));
import { breedingSince, breedingYears } from '../src/core/owned-horse';
import type { OwnedHorse } from '../src/core/types';

const mare = (id: string, extra: Partial<OwnedHorse> = {}): OwnedHorse => ({ id, kind: 'owned', name: id, sex: 'F', category: '繁殖牝馬', sireKey: '', damKey: '', createdAt: '', updatedAt: '', ...extra });
const foal = (id: string, damKey: string, birthYear?: number): OwnedHorse => ({ id, kind: 'owned', name: id, sex: 'M', category: '現役', sireKey: 'st:1', damKey, profile: { birthYear }, createdAt: '', updatedAt: '' });

describe('繁殖入りした年', () => {
  it('登録値を優先し、なければ最初の産駒の生年の前年を推定にする', () => {
    const m = mare('u:m');
    const horses = [m, foal('u:f1', 'u:m', 40), foal('u:f2', 'u:m', 38), foal('u:f3', 'u:m')];
    expect(breedingSince(m, horses)).toEqual({ year: 37, inferred: true });
    expect(breedingSince(mare('u:m', { profile: { breedingSinceYear: 35 } }), horses)).toEqual({ year: 35, inferred: false });
    expect(breedingSince(mare('u:x'), horses)).toBeUndefined();
  });
  it('実在の繁殖牝馬は masterKey で産駒を辿る', () => {
    const m = mare('u:m', { masterKey: 'bm:3' });
    expect(breedingSince(m, [m, foal('u:f', 'bm:3', 41)])).toEqual({ year: 40, inferred: true });
  });
  it('年数は繁殖入りの年を1年目と数える', () => {
    expect(breedingYears(40, 43)).toBe(4);
    expect(breedingYears(40, 40)).toBe(1);
    expect(breedingYears(44, 43)).toBeUndefined();
    expect(breedingYears(undefined, 43)).toBeUndefined();
  });
});

describe('繁殖入りの年の自動記録（保存処理）', () => {
  it('区分が繁殖牝馬・種牡馬になった時にゲーム年を入れ、登録済みなら触らない', async () => {
    vi.resetModules(); vi.stubGlobal('localStorage', memoryStorage());
    (await import('../src/data/catalog')).initializeCatalog(testCatalog);
    const { store, getUserData } = await import('../src/store/userdata');
    store.setSettings({ gameYear: 43 });
    const f = store.addHorse({ kind: 'owned', name: '自動記録テスト', sex: 'F', category: '現役', sireKey: '', damKey: '', memo: '' });
    expect(f.profile?.breedingSinceYear).toBeUndefined();
    store.updateHorse(f.id, { category: '繁殖牝馬' });
    expect(getUserData().horses.find((h) => h.id === f.id)?.profile?.breedingSinceYear).toBe(43);
    store.setSettings({ gameYear: 45 });
    store.updateHorse(f.id, { category: '引退' });
    store.updateHorse(f.id, { category: '繁殖牝馬' });
    expect(getUserData().horses.find((h) => h.id === f.id)?.profile?.breedingSinceYear).toBe(43);
    const m = store.addHorse({ kind: 'owned', name: '購入した繁殖牝馬', sex: 'F', category: '繁殖牝馬', sireKey: '', damKey: '', memo: '' });
    expect(m.profile?.breedingSinceYear).toBe(45);
    store.deleteHorse(f.id); store.deleteHorse(m.id);
  });
});

describe('戦績のグレード表記', async () => {
  const { normalizeRaceGrade, isG1, isGraded } = await import('../src/core/races');
  it('GI / G I / G1 / JpnI などを GⅠ・JpnⅠ にそろえ、他はそのまま', () => {
    for (const g of ['GI', 'G I', 'G1', 'GⅠ', 'G-I', 'ｇ１']) expect(normalizeRaceGrade(g)).toBe('GⅠ');
    for (const g of ['JpnI', 'Jpn I', 'JpnⅠ', 'Jpn1']) expect(normalizeRaceGrade(g)).toBe('JpnⅠ');
    expect(normalizeRaceGrade('G III')).toBe('GⅢ');
    for (const g of ['OP', 'L', '3勝', '新馬', '']) expect(normalizeRaceGrade(g)).toBe(g);
    expect(isG1('G I')).toBe(true); expect(isG1('GⅡ')).toBe(false); expect(isGraded('GIII')).toBe(true); expect(isGraded('L')).toBe(false);
  });
});

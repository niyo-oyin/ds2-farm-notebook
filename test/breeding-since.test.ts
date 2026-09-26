import { describe, it, expect } from 'vitest';
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

import { describe, expect, it } from 'vitest';
import { baseMaster } from '../src/data/base-master';
import { applyMasterEdits, diffAgainstBase, validateMasterHorse, masterFromReading, masterDiffRows, applyMasterFields, type MasterReading } from '../src/core/master-edits';
import { HorseResolver } from '../src/core/pedigree';
import { DEFAULT_RULES } from '../src/core/rules';
import { makeContext, judge } from '../src/core/judge';
import { searchLineage, searchLineageForward, type SearchRequest } from '../src/core/search';
import { horseUnlockConditions } from '../src/core/master-horse';
import { horseCell } from '../src/ui/master-horse-catalog';
import { sireOptions } from '../src/ui/app-context';
import { emptyUserData } from '../src/store/model';
import { owned } from './horse-fixtures';

const horse = { ...baseMaster.stallions[0], price: 100, breedingRightPrice: 180000, unlock: null };
const master = { ...baseMaster, stallions: [horse] };
const resolver = new HorseResolver(master, [], DEFAULT_RULES);
const ctx = makeContext(master);
const env = { resolve: (key: string) => resolver.get(key), rules: DEFAULT_RULES, ctx };

describe('種付け権と種付料の分離', () => {
  it('海外区分で探索候補を切り替え、馬名・所有馬・血統参照には影響しない', async () => {
    const domestic = { ...horse, name: 'Domestic Horse', overseas: false, breedingRightPrice: null };
    const foreign = { ...baseMaster.stallions[1], name: 'カタカナの海外馬', overseas: true, breedingRightPrice: null, unlock: null };
    const m = { ...baseMaster, stallions: [domestic, foreign] };
    const data = emptyUserData();
    data.horses.push(owned('u:own', { sex: 'M', name: 'My Horse', category: '種牡馬' }));
    const resolver = new HorseResolver(m, data.horses, DEFAULT_RULES);
    const ctx = makeContext(m);
    const app = { master: m, data, resolver, ctx, rules: DEFAULT_RULES };
    for (const includeOverseas of [false, true]) {
      const options = sireOptions(app, { onlyAvailable: true, includeOverseas });
      expect(options.map(h => h.key)).toEqual(includeOverseas ? ['u:own', domestic.id, foreign.id] : ['u:own', domestic.id]);
      const req: SearchRequest = { startMares: [m.broodmares[0].id], finalStallion: null, intermediateStallion: null, finalPool: null, stallionPool: options.filter(h => h.group === '種牡馬').map(h => h.key), minMatings: 2, maxMatings: 2, goals: [], maxCost: null, maxEvaluations: 100, allowRepeatStallion: true };
      const report = await searchLineage({ ctx, rules: DEFAULT_RULES, resolve: key => resolver.get(key) }, req);
      expect(report.results.length).toBeGreaterThan(0);
      for (const index of [0, 1]) expect(report.results.some(r => r.steps[index].sire === foreign.id)).toBe(includeOverseas);
    }
    expect(sireOptions(app).some(h => h.key === foreign.id)).toBe(true);
    expect(resolver.get(foreign.id)).not.toBeNull();
    const edit = diffAgainstBase(foreign, { ...foreign, overseas: false });
    const changed = applyMasterEdits(m, [{ id: foreign.id, kind: 'stallion', added: false, updatedAt: '', data: edit }]);
    expect(sireOptions({ ...app, master: changed }, { includeOverseas: false }).some(h => h.key === foreign.id)).toBe(true);
  });
  it('権利代を各世代の種付料に加算せず、解禁条件として伝える', async () => {
    const req: SearchRequest = { startMares: [master.broodmares[0].id], stallionPool: [horse.id], intermediateStallion: null, finalStallion: horse.id, minMatings: 2, maxMatings: 2, goals: [], maxCost: 200, maxEvaluations: 1000, allowRepeatStallion: true };
    for (const run of [searchLineage, searchLineageForward]) {
      const report = await run(env, req);
      expect(report.results.length).toBeGreaterThan(0);
      expect(report.results[0].cost).toBe(200);
      expect(report.results[0].steps.map(s => s.cost)).toEqual([100, 100]);
      expect(report.results[0].steps.every(s => s.constraints?.includes('解禁条件: 種付け権の購入：18億円'))).toBe(true);
    }
    expect(horseCell(horse, 'price')).toBe('100');
    const data = emptyUserData(); data.settings.hideLocked = true;
    expect(sireOptions({ master, resolver, ctx, rules: DEFAULT_RULES, data }, { onlyAvailable: true })).toEqual([]);
  });
  it('権利購入額だけの修正・削除を保存でき、毎回の種付料は変えない', () => {
    for (const breedingRightPrice of [12345, null]) {
      const next = { ...horse, breedingRightPrice };
      const data = diffAgainstBase(horse, next);
      const edited = applyMasterEdits(master, [{ id: horse.id, kind: 'stallion', added: false, updatedAt: '', data }]).stallions[0];
      expect(edited.breedingRightPrice).toBe(breedingRightPrice);
      expect(edited.price).toBe(100);
      expect(horseUnlockConditions(edited)).toEqual(breedingRightPrice === null ? [] : ['種付け権の購入：1億2,345万円']);
    }
    expect(() => validateMasterHorse({ ...horse, breedingRightPrice: -1 })).toThrow('種付け権購入額');
  });
  it('購入後の種付料未確認を無料と表示せず、写真から無料を確認しても権利代を保持する', () => {
    const base = { ...horse, price: 0, priceUnknown: true };
    expect(horseCell(base, 'price')).toBe('—');
    const r = new HorseResolver({ ...master, stallions: [base] }, [], DEFAULT_RULES);
    expect(judge(r.get(base.id)!, r.get(master.broodmares[0].id)!, ctx).costUnknown).toBe(true);
    const reading = { fee: '無料', age: -1, sex: '牡' } as MasterReading;
    for (const key of ['name', 'color', 'sire', 'dam', 'dam_sire', 'big_system', 'small_system', 'price', 'distance', 'growth', 'dirt', 'kenko', 'kisyo', 'jisseki', 'konjo', 'antei'] as const) reading[key] = '';
    const next = masterFromReading('stallion', reading, base, master);
    expect(next.breedingRightPrice).toBe(180000);
    expect(masterDiffRows(base, next, id => r.label(id))).toContainEqual({ key: 'price', label: '種付料（万円）', before: '未確認', after: '0' });
    const applied = applyMasterFields(base, next, ['price']);
    expect(applied.priceUnknown).toBe(false);
    expect(applied.breedingRightPrice).toBe(180000);
    expect(horseCell(applied, 'price')).toBe('0');
  });
});

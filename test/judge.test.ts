import { describe, it, expect } from 'vitest';
import { baseMaster } from '../src/data/base-master';
import fixture from './fixtures/reference_judgements_2026-09-18.json';
import { HorseResolver } from '../src/core/pedigree';
import { judge, makeContext } from '../src/core/judge';
import { DEFAULT_RULES } from '../src/core/rules';
import { owned } from './horse-fixtures';

const M = baseMaster;
const ctx = makeContext(M);
const resolver = new HorseResolver(M, [], DEFAULT_RULES);
const byName = new Map([...M.stallions, ...M.broodmares].map((h) => [h.name, h.id]));
// 参考ツールは埋め込みの祖先マスター（因子のある215頭）の性別しか持たないため、牝馬クロスの本数はその範囲で比べる
const referenceAncestors = new Set(fixture.ancestorNames);

type Fx = { s: string; m: string; om: boolean; mg: boolean; cnt: number | null; kotta: boolean;
  kp: [string, string][]; dng: boolean; nicks: number; mare: number;
  cross: [string, number[], number[]][]; nitro: { speed: number; stamina: number; power: number } };

describe('祖先の別名と同名馬の区別', () => {
  it('表記を統一した祖先も、産駒を経由してクロスする', () => {
    const mare = owned('u:royal', { sireKey: byName.get('Fastnet Rock')!, damKey: M.broodmares[0].id });
    const r = new HorseResolver(M, [mare], DEFAULT_RULES);
    const result = judge(r.get(byName.get('ポエティックフレア')!)!, r.get(mare.id)!, makeContext(M, {}, [mare]));
    expect(result.crosses.filter(c => c.name === 'ロイヤルアカデミーII')).toMatchObject([
      { sireGens: [4], damGens: [4], sex: 'M', effectsKnown: true },
    ]);
  });

  it('愛国産Bold Ladのクロスは認識し、米国産ボールドラッドとはクロスさせない', () => {
    const sire = resolver.get(byName.get('Blue Point')!)!;
    const same = judge(sire, resolver.get(byName.get('チリエージェ')!)!, ctx);
    expect(same.crosses.find(c => c.name === 'Bold Lad (IRE)')).toMatchObject({ sireGens: [5], damGens: [5], effects: [] });
    const different = judge(sire, resolver.get(byName.get('リッスン')!)!, ctx);
    expect(different.crosses.some(c => c.name === 'Bold Lad (IRE)' || c.name === 'ボールドラッド')).toBe(false);
  });
});

describe('参考ツールの判定結果との一致（全種牡馬×全繁殖牝馬）', () => {
  // 補完・訂正した馬と、表記を統一した祖先・系統を含む馬、補完したニックスの組は参考判定との比較対象から除く。
  const supplemented = new Set(fixture.excludedHorseNames);
  const supplementedNicks = new Set(fixture.excludedNicks);
  const horseOf = (id: string) => [...M.stallions, ...M.broodmares].find((x) => x.id === id)!;
  const touched = (id: string) => supplemented.has(horseOf(id).name);
  const nicksTouched = (sid: string, did: string) => supplementedNicks.has(`${horseOf(sid).smallSystem}|${horseOf(did).smallSystem}`);
  const rows = (fixture.judgements as Fx[]).filter((r) => byName.has(r.s) && byName.has(r.m) && !touched(byName.get(r.s)!) && !touched(byName.get(r.m)!) && !nicksTouched(byName.get(r.s)!, byName.get(r.m)!));
  it('比較可能な全ペアで理論・クロス・因子が一致し、判定が未確定にならない', () => {
    expect(rows.length, '比較対象が空では照合できない').toBeGreaterThan(0);
    const mismatches: string[] = [];
    for (const fx of rows) {
      const s = resolver.get(byName.get(fx.s)!)!, d = resolver.get(byName.get(fx.m)!)!;
      const j = judge(s, d, ctx);
      const got = {
        hasUnknownSlots: j.hasUnknownSlots,
        verdicts: [j.omoshiro, j.migoto, j.perfect, j.perfectKotta, j.dangerous, j.outbreed].map((t) => t.verdict),
        cnt: j.omoshiro.count, kotta: j.kotta.verdict === '成立',
        kp: j.kotta.pairs, nicks: j.nicks.level,
        mare: j.crosses.filter((c) => c.sex === 'F' && referenceAncestors.has(c.name)).length,
        cross: j.crosses.map((c) => [c.name, c.sireGens, c.damGens]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        nitro: { speed: j.nitroReference.speed, stamina: j.nitroReference.stamina, power: j.nitroReference.power },
      };
      const exp = {
        hasUnknownSlots: false,
        verdicts: [fx.om, fx.mg, fx.om && fx.mg, fx.om && fx.mg && fx.kotta, fx.dng, fx.cross.length === 0].map((matches) => matches ? '成立' : '不成立'),
        cnt: fx.cnt, kotta: fx.kotta, kp: fx.kp, nicks: fx.nicks, mare: fx.mare,
        cross: fx.cross.slice().sort((a, b) => a[0].localeCompare(b[0])), nitro: fx.nitro };
      if (JSON.stringify(got) !== JSON.stringify(exp)) mismatches.push(`${fx.s} × ${fx.m}\n got ${JSON.stringify(got)}\n exp ${JSON.stringify(exp)}`);
    }
    expect(mismatches.slice(0, 3).join('\n'), `${mismatches.length} mismatches`).toBe('');
  });
});

describe('自家製馬と不明枠', () => {
  it('自家製牝馬の面白用系統は 父[0]父[2]母[0]母[2] から導出される', () => {
    const st = M.stallions[0], bm = M.broodmares[0];
    const r = new HorseResolver(M, [{
      id: 'u:1', kind: 'owned', name: 'テスト牝馬', sex: 'F', sireKey: st.id, damKey: bm.id, status: '繁殖利用可',
      createdAt: '', updatedAt: '',
    }], DEFAULT_RULES);
    const rec = r.get('u:1')!;
    expect(rec.omoshiro).toBe(st.omoshiro![0] + st.omoshiro![2] + bm.omoshiro![0] + bm.omoshiro![2]);
    expect(rec.migoto).toBe(st.omoshiro![1] + st.omoshiro![3] + bm.omoshiro![1] + bm.omoshiro![3]);
    expect(rec.nodes[2]).toBe('n:' + st.name);
    expect(rec.nodes[3]).toBe('n:' + bm.name);
    expect(rec.nodes[4]).toBe('n:' + st.ancestors[0]);
    expect(rec.nodes[6]).toBe('n:' + bm.ancestors[0]);
    expect(rec.nodes[31]).toBe('n:' + bm.ancestors[13]);
    expect(rec.smallSystem).toBe(st.smallSystem);
    expect(rec.smallSystemSource).toBe('父から推定');
    // 父 × 娘 は 1×N で危険
    const j = judge(r.get(st.id)!, rec, ctx);
    expect(j.dangerous.verdict).toBe('成立');
    expect(j.dangerous.causes.some((c) => c.startsWith('1×N'))).toBe(true);
    expect(j.kotta.verdict).not.toBe('成立');
  });
  it('親が未登録なら未確定になる', () => {
    const r = new HorseResolver(M, [{
      id: 'u:2', kind: 'owned', name: '親不明', sex: 'F', sireKey: '', damKey: M.broodmares[0].id, status: '繁殖利用可', createdAt: '', updatedAt: '',
    }], DEFAULT_RULES);
    const j = judge(r.get(M.stallions[0].id)!, r.get('u:2')!, ctx);
    expect(j.hasUnknownSlots).toBe(true);
    expect(['未確定', '成立']).toContain(j.omoshiro.verdict);
    expect(j.dangerous.verdict).not.toBe('不成立');
    expect(j.nicks.verdict).toBe('未確定');
  });
  it('循環する親子関係はエラー', () => {
    const r = new HorseResolver(M, [
      { id: 'u:a', kind: 'owned', name: 'A', sex: 'F', sireKey: 'u:b', damKey: '', status: '現役', createdAt: '', updatedAt: '' },
      { id: 'u:b', kind: 'owned', name: 'B', sex: 'M', sireKey: 'u:a', damKey: '', status: '現役', createdAt: '', updatedAt: '' },
    ], DEFAULT_RULES);
    expect(() => r.get('u:a')).toThrow();
  });
});

describe('自家製馬の因子と運用上の制約', () => {
  it('登録した因子がクロスの効果に使われ、性別が牝馬クロスに数えられる', () => {
    const horses = [
      { id: 'u:f', kind: 'owned' as const, name: '自家製牝馬', sex: 'F' as const, sireKey: M.stallions[10].id, damKey: M.broodmares[5].id, status: '繁殖利用可' as const, effects: ['速力', '底力'], createdAt: '', updatedAt: '' },
      { id: 'u:d1', kind: 'owned' as const, name: '娘', sex: 'F' as const, sireKey: M.stallions[20].id, damKey: 'u:f', status: '繁殖利用可' as const, createdAt: '', updatedAt: '' },
      { id: 'u:s1', kind: 'owned' as const, name: '息子', sex: 'M' as const, sireKey: M.stallions[30].id, damKey: 'u:f', status: '繁殖利用可' as const, createdAt: '', updatedAt: '' },
    ];
    const r = new HorseResolver(M, horses, DEFAULT_RULES);
    const c = makeContext(M, {}, horses);
    const j = judge(r.get('u:s1')!, r.get('u:d1')!, c); // 自家製牝馬の 2×2
    const cross = j.crosses.find((x) => x.key === 'u:f')!;
    expect(cross).toBeTruthy();
    expect(cross.effectsKnown).toBe(true);
    expect(cross.effects).toEqual(['速力', '底力']);
    expect(cross.sex).toBe('F');
    expect(j.mareCrossCount).toBe(1);
    expect(j.dangerous.causes.some((x) => x.startsWith('2×2'))).toBe(true);
  });
  it('解禁条件と購入価格が制約として付く', () => {
    const locked = M.stallions.find((s) => s.unlock)!;
    const buy = M.broodmares.find((b) => b.purchasePrice)!;
    const j = judge(resolver.get(locked.id)!, resolver.get(buy.id)!, ctx);
    expect(j.constraints).toContain(`父: 解禁条件: ${locked.unlock}`);
    expect(j.constraints).toContain(`母: 購入が必要: ${buy.purchasePrice!.toLocaleString()}万`);
  });
});

describe('自家製馬が関わる凝ったペアの推定', () => {
  it('ブラックタイド産駒の自家製種牡馬 × ディープインパクト産駒の牝馬で推定ペアが立つ', () => {
    const bt = M.stallions.find((s) => s.name === 'ブラックタイド')!;
    const deep = M.stallions.find((s) => s.name === 'ディープインパクト')!;
    // 血統が離れた繁殖牝馬を母にして、クロスが増えすぎないようにする
    const far = M.broodmares.filter((b) => !b.ancestors.includes('サンデーサイレンス') && !b.ancestors.includes('Halo'));
    const horses = [
      { id: 'u:h', kind: 'owned' as const, name: '自家製種牡馬', sex: 'M' as const, sireKey: bt.id, damKey: far[0].id, status: '繁殖利用可' as const, createdAt: '', updatedAt: '' },
      { id: 'u:m', kind: 'owned' as const, name: 'ディープ産駒の牝馬', sex: 'F' as const, sireKey: deep.id, damKey: far[1].id, status: '繁殖利用可' as const, createdAt: '', updatedAt: '' },
    ];
    const r = new HorseResolver(M, horses, DEFAULT_RULES);
    const c = makeContext(M, {}, horses);
    const j = judge(r.get('u:h')!, r.get('u:m')!, c);
    expect(j.kotta.estimatedPairs.some(([a, b]) => a === '自家製種牡馬' && b === 'ディープインパクト')).toBe(true);
    // 凝ったペア表のペア（ブラックタイド×ディープインパクト）が同時に見つかるので、表のペアが優先され「推定」印は付かない
    expect(j.kotta.pairs.some(([a, b]) => a === 'ブラックタイド' && b === 'ディープインパクト')).toBe(true);
    if (j.dangerous.verdict === '不成立') { expect(j.kotta.verdict).toBe('成立'); expect(j.kotta.estimated).toBeUndefined(); }
    // 推定を無効にすると推定ペアは出ない
    const c2 = makeContext(M, { kottaEstimateHomebred: false }, horses);
    expect(judge(r.get('u:h')!, r.get('u:m')!, c2).kotta.estimatedPairs).toEqual([]);
  });
});

// 配合判定。配合確認・所有馬比較・探索で同じ処理を使う。
import type { AncestorInfo, CrossInfo, HorseRecord, Judgement, MasterData, TheoryResult, UserHorse, Verdict } from './types';
import { DEFAULT_RULES, RULES_VERSION, type RuleOptions } from './rules';
import { SYS_CHARS, foalNodes, gen, nameOfKey, sideOf, nodePath } from './pedigree';

export interface JudgeContext {
  rules: RuleOptions;
  rulesVersion: string;
  dataVersion: string;
  bigSystems: string[];
  ancestors: Map<string, AncestorInfo>;
  /** 自家製馬（ユーザー登録）の因子・性別。キーは馬ID */
  userAncestors: Map<string, AncestorInfo>;
  kottaPairs: Set<string>;      // "父側名|母側名"
  /** 全血統表から復元した親リンク（ノードキー → [父キー, 母キー]）。自家製馬の凝ったペア推定に使う */
  parents: Map<string, [string, string]>;
  nicks: Map<string, number>;   // "父小系統|母小系統" → 段階
}

export function makeContext(master: MasterData, rules: Partial<RuleOptions> = {}, userHorses: UserHorse[] = []): JudgeContext {
  const r = { ...DEFAULT_RULES, ...rules };
  const kottaPairs = new Set<string>();
  for (const [a, b] of master.kotta) {
    kottaPairs.add(a + '|' + b);
    if (r.kottaSymmetric) kottaPairs.add(b + '|' + a);
  }
  const parents = new Map<string, [string, string]>();
  for (const h of [...master.stallions, ...master.broodmares]) {
    const n = ['', h.name, ...h.ancestors];
    for (let k = 1; k < 16; k++) if (n[k] && n[2 * k] && n[2 * k + 1]) parents.set('n:' + n[k], ['n:' + n[2 * k], 'n:' + n[2 * k + 1]]);
  }
  for (const u of userHorses) if (u.sireKey && u.damKey) parents.set(u.id, [resolveKey(master, u.sireKey), resolveKey(master, u.damKey)]);
  return {
    parents,
    rules: r, rulesVersion: RULES_VERSION, dataVersion: master.meta.dataVersion,
    bigSystems: master.meta.bigSystems,
    ancestors: new Map(master.ancestors.map((a) => [a.name, a])),
    userAncestors: new Map(userHorses.filter((h) => h.effects || h.sex).map((h) => [h.id, { name: h.name, system: null, sex: h.sex ?? null, effects: h.effects ?? [] }])),
    kottaPairs,
    nicks: new Map(master.nicks.map((n) => [n.sire + '|' + n.dam, n.level])),
  };
}

const res = (verdict: Verdict, reasons: string[] = [], missing: string[] = []): TheoryResult => ({ verdict, reasons, missing });

/** マスターの馬のIDは名前キーに、ユーザー馬のIDはそのまま */
function resolveKey(master: MasterData, key: string): string {
  const m = [...master.stallions, ...master.broodmares].find((h) => h.id === key);
  return m ? 'n:' + m.name : key;
}

/** 名前キーから3代までの祖先キー（自身を含む）。親リンクがない所で途切れる */
function ancestorKeys(ctx: JudgeContext, key: string, gens: number): { keys: string[]; complete: boolean } {
  const keys = [key]; let cur = [key]; let complete = true;
  for (let g = 0; g < gens; g++) {
    const next: string[] = [];
    for (const k of cur) { const p = ctx.parents.get(k); if (p) next.push(...p); else complete = false; }
    keys.push(...next); cur = next;
  }
  return { keys, complete };
}
const effectsOf = (ctx: JudgeContext, key: string) => { const nm = nameOfKey(key); return (nm ? ctx.ancestors.get(nm) : ctx.userAncestors.get(key))?.effects; };

/** 前作解説の規則: ペア同士の3代以内に効果のあるクロスが3本。自家製馬が関わる場合の推定に使う */
function estimateKottaPair(ctx: JudgeContext, a: string, b: string): { pair: boolean; complete: boolean } {
  const A = ancestorKeys(ctx, a, 3), B = ancestorKeys(ctx, b, 3);
  const shared = new Set(A.keys.filter((k) => B.keys.includes(k)));
  let eff = 0;
  for (const k of shared) if ((effectsOf(ctx, k) ?? []).length) eff++;
  return { pair: eff >= 3, complete: A.complete && B.complete };
}

function sysName(ctx: JudgeContext, c: string): string {
  const i = SYS_CHARS.indexOf(c);
  return i >= 0 ? ctx.bigSystems[i] : '?';
}

function nitroOf(info: AncestorInfo | undefined) {
  if (!info) return null;
  const e = new Set(info.effects);
  const short = e.has('短距離') ? 1 : 0;
  return {
    speed: 2 * short + (e.has('速力') ? 1 : 0),
    stamina: (e.has('長距離') ? 1 : 0) + (e.has('底力') ? 1 : 0) - short,
    power: e.has('パワー') ? 1 : 0,
  };
}

export function judge(sire: HorseRecord, dam: HorseRecord, ctx: JudgeContext): Judgement {
  const { rules } = ctx;
  const nodes = foalNodes(sire, dam);
  const labels = { ...sire.labels, ...dam.labels };
  const warnings: string[] = [];

  // ---- 血統の完全性 ----
  let unknownSlotCount = 0;
  const unknownBySide = { 2: 0, 3: 0 };
  const occ = new Map<string, { s: number[]; d: number[] }>();
  for (let n = 2; n < 64; n++) {
    const k = nodes[n];
    if (!k) { unknownSlotCount++; unknownBySide[sideOf(n)]++; continue; }
    let o = occ.get(k);
    if (!o) { o = { s: [], d: [] }; occ.set(k, o); }
    (sideOf(n) === 2 ? o.s : o.d).push(n);
  }
  const hasUnknownSlots = unknownSlotCount > 0;
  const crossStatus: TheoryResult = hasUnknownSlots
    ? res('未確定', [`血統表に不明な欄が${unknownSlotCount}箇所あります`], ['血統（不明な祖先）'])
    : res('成立', ['5代血統が揃っています']);

  // ---- クロス ----
  const crosses: CrossInfo[] = [];
  const causes = new Set<string>();
  let mareCrossCount = 0;
  let unknownSex = 0;
  for (const [k, o] of occ) {
    if (!o.s.length || !o.d.length) continue;
    const sNodes = new Set<number>(), dNodes = new Set<number>();
    for (const a of o.s) for (const b of o.d) {
      const ga = gen(a), gb = gen(b);
      if (ga === 1 || gb === 1) causes.add(`1×N（${labels[k] ?? k} が父母自身と血統内に重複）`);
      if (ga === 2 && gb === 2) causes.add(`2×2（${labels[k] ?? k}）`);
      // 同じ共通祖先から同じ父母経路で派生した組（親のクロスに従属する組）は除く
      let x = a, y = b, inherited = false;
      while (x > 3 && y > 3 && (x & 1) === (y & 1)) {
        x >>= 1; y >>= 1;
        if (nodes[x] && nodes[x] === nodes[y]) { inherited = true; break; }
      }
      if (!inherited) { sNodes.add(a); dNodes.add(b); }
    }
    if (!sNodes.size) continue;
    const name = nameOfKey(k);
    const info = name ? ctx.ancestors.get(name) : ctx.userAncestors.get(k);
    if (info?.sex === 'F') mareCrossCount++;
    if (!info) unknownSex++;
    crosses.push({
      key: k, name: labels[k] ?? name ?? k,
      sireGens: [...sNodes].map(gen).sort((p, q) => p - q), damGens: [...dNodes].map(gen).sort((p, q) => p - q),
      sireNodes: [...sNodes].sort((p, q) => p - q), damNodes: [...dNodes].sort((p, q) => p - q),
      effects: info?.effects ?? [], effectsKnown: !!info, sex: info?.sex ?? null,
    });
  }
  crosses.sort((a, b) => Math.min(...a.sireGens, ...a.damGens) - Math.min(...b.sireGens, ...b.damGens));
  if (crosses.length >= rules.dangerousCrossCount) causes.add(`クロス${crosses.length}本（${rules.dangerousCrossCount}本以上）`);
  const dangerous: Judgement['dangerous'] = causes.size
    ? { ...res('成立', [...causes]), causes: [...causes] }
    : hasUnknownSlots
      ? { ...res('未確定', ['判明している範囲では危険条件に該当しません'], ['血統（不明な祖先）']), causes: [] }
      : { ...res('不成立', [`クロス${crosses.length}本、1×N・2×2なし`]), causes: [] };
  if (unknownSex) warnings.push(`祖先マスター未登録の共通祖先が${unknownSex}頭あり、効果と性別が不明です`);

  const outbreed: TheoryResult = crosses.length
    ? res('不成立', [`クロスが${crosses.length}本あります`])
    : hasUnknownSlots ? res('未確定', ['判明している範囲ではクロスなし'], ['血統（不明な祖先）'])
      : res('成立', ['5代以内にクロスがありません']);

  // ---- 面白い配合 ----
  const chars = (sire.omoshiro + dam.omoshiro).split('');
  const known = chars.filter((c) => c !== '?');
  const unknownChars = chars.length - known.length;
  const distinct = new Set(known);
  const systems = [...distinct].map((c) => sysName(ctx, c));
  const th = rules.omoshiroThreshold;
  let omoV: Verdict, omoR: string[], omoM: string[] = [];
  if (distinct.size >= th) { omoV = '成立'; omoR = [`8枠中の大系統が${distinct.size}種類（${th}種類以上）`]; }
  else if (distinct.size + unknownChars >= th) { omoV = '未確定'; omoR = [`判明分${distinct.size}種類、不明${unknownChars}枠`]; omoM = ['面白用系統（不明枠）']; }
  else { omoV = '不成立'; omoR = [`大系統が${distinct.size}種類${unknownChars ? `（不明${unknownChars}枠を含めても${th}種類未満）` : ''}`]; }
  const omoshiro: Judgement['omoshiro'] = {
    ...res(omoV, [
      `父の面白用4枠: ${sire.omoshiro.split('').map((c) => sysName(ctx, c)).join(' ')}`,
      `母の面白用4枠: ${dam.omoshiro.split('').map((c) => sysName(ctx, c)).join(' ')}`,
      ...omoR,
    ], omoM),
    systems, count: unknownChars ? null : distinct.size, unknownSlots: unknownChars,
  };

  // ---- 見事な配合 ----
  const A = sire.migoto, B = dam.omoshiro;
  const aKnown = A.split('').filter((c) => c !== '?'), bKnown = B.split('').filter((c) => c !== '?');
  const aUnk = 4 - aKnown.length, bUnk = 4 - bKnown.length;
  let migV: Verdict, migR: string;
  if (rules.migotoMode === 'set') {
    const aSet = new Set(aKnown), bSet = new Set(bKnown);
    const aOk = [...aSet].every((c) => bSet.has(c)) || bUnk > 0;
    const bOk = [...bSet].every((c) => aSet.has(c)) || aUnk > 0;
    if (!aUnk && !bUnk) {
      const eq = aSet.size === bSet.size && [...aSet].every((c) => bSet.has(c));
      migV = eq ? '成立' : '不成立';
      migR = eq ? '父の見事用系統と母の面白用系統が種類として一致' : '系統の種類が一致しません';
    } else if (aOk && bOk) { migV = '未確定'; migR = '不明枠があるため判定できません'; }
    else { migV = '不成立'; migR = '判明分だけで種類が一致しません'; }
  } else {
    if (!aUnk && !bUnk) {
      const eq = [...A].sort().join('') === [...B].sort().join('');
      migV = eq ? '成立' : '不成立';
      migR = eq ? '個数を含めて一致' : '個数を含めて一致しません';
    } else { migV = '未確定'; migR = '不明枠があるため判定できません'; }
  }
  // 公知の情報の一部にある「一致する大系統が3種類以上」の条件。既定は不問（設定 migotoMinSystems）
  if (migV === '成立' && rules.migotoMinSystems > 0 && new Set(A.split('')).size < rules.migotoMinSystems) {
    migV = '不成立'; migR = `一致する大系統が${new Set(A.split('')).size}種類で、設定の${rules.migotoMinSystems}種類に満たない`;
  }
  const migoto: Judgement['migoto'] = {
    ...res(migV, [
      `父の見事用4枠: ${A.split('').map((c) => sysName(ctx, c)).join(' ')}`,
      `母の面白用4枠: ${B.split('').map((c) => sysName(ctx, c)).join(' ')}`,
      migR,
    ], migV === '未確定' ? ['見事用・面白用系統（不明枠）'] : []),
    sireMigoto: A, damOmoshiro: B,
  };

  // ---- 完璧な配合 ----
  const perfect: TheoryResult = omoV === '成立' && migV === '成立' ? res('成立', ['面白い配合と見事な配合が同時成立'])
    : omoV === '不成立' || migV === '不成立' ? res('不成立', ['面白い配合または見事な配合が不成立'])
      : res('未確定', ['面白い配合か見事な配合が未確定'], [...omoM, ...(migV === '未確定' ? ['見事用系統'] : [])]);

  // ---- 凝った配合 ----
  const kg = rules.kottaGenerations;
  const sideNames = (side: 2 | 3) => {
    const names = new Set<string>(); const homebred: string[] = []; let unknown = 0;
    for (let n = 2; n < 64; n++) {
      if (sideOf(n) !== side || gen(n) > kg) continue;
      const k = nodes[n];
      if (!k) { unknown++; continue; }
      const nm = nameOfKey(k);
      if (nm) names.add(nm); else homebred.push(labels[k] ?? k);
    }
    return { names, homebred, unknown };
  };
  const sk = sideNames(2), dk = sideNames(3);
  const pairs: [string, string][] = [];
  for (const a of sk.names) for (const b of dk.names) if (ctx.kottaPairs.has(a + '|' + b)) pairs.push([a, b]);
  const homebredInRange = [...new Set([...sk.homebred, ...dk.homebred])];
  // 自家製馬（牡）が関わるペアを前作規則で推定。相手は各側の4代以内の牡馬
  const estimatedPairs: [string, string][] = [];
  let estimateIncomplete = false;
  if (rules.kottaEstimateHomebred && homebredInRange.length) {
    const sideKeys = (side: 2 | 3) => { const ks: number[] = []; for (let n = 2; n < 64; n++) if (sideOf(n) === side && gen(n) <= kg && nodes[n] && (n === side || n % 2 === 0)) ks.push(n); return ks; };
    for (const na of sideKeys(2)) for (const nb of sideKeys(3)) {
      const a = nodes[na], b = nodes[nb];
      const aHome = !nameOfKey(a), bHome = !nameOfKey(b);
      if (!aHome && !bHome) continue;
      if (a === b) continue;
      const r = estimateKottaPair(ctx, a, b);
      if (r.pair) estimatedPairs.push([labels[a] ?? a, labels[b] ?? b]);
      else if (!r.complete) estimateIncomplete = true;
    }
  }
  let kotV: Verdict, kotR: string[] = [], kotM: string[] = [];
  let kotEst = false;
  if (!pairs.length && estimatedPairs.length) {
    kotEst = true;
    kotR.push(...estimatedPairs.map(([a, b]) => `推定ペア: ${a}（父側）× ${b}（母側）。前作規則（3代以内に効果ありクロス3本）による`));
    if (dangerous.verdict === '成立') { kotV = '不成立'; kotR.push('危険な配合のため無効'); }
    else if (dangerous.verdict === '未確定') { kotV = '未確定'; kotM.push('血統（不明な祖先）'); }
    else kotV = '成立';
  } else if (pairs.length) {
    kotR.push(...pairs.map(([a, b]) => `ペア: ${a}（父側）× ${b}（母側）`));
    if (dangerous.verdict === '成立') { kotV = '不成立'; kotR.push('危険な配合のため無効'); }
    else if (dangerous.verdict === '未確定') { kotV = '未確定'; kotR.push('危険な配合になる可能性が残っています'); kotM.push('血統（不明な祖先）'); }
    else kotV = '成立';
  } else if (sk.unknown + dk.unknown > 0) { kotV = '未確定'; kotR.push('4代以内に不明な欄があります'); kotM.push('血統（不明な祖先）'); }
  else if (homebredInRange.length) {
    kotV = '未確定';
    kotR.push(rules.kottaEstimateHomebred
      ? `自家製馬（${homebredInRange.join('、')}）が関わるペアは前作規則で推定しましたが該当なし${estimateIncomplete ? '（祖先の親リンクや因子が欠けており数え漏れの可能性あり）' : ''}`
      : `自家製馬（${homebredInRange.join('、')}）がペア対象になる可能性がありますが判定できません`);
    kotM.push('自家製馬のペア情報');
  }
  else { kotV = '不成立'; kotR.push('成立ペアが見つかりません'); }
  const kotta: Judgement['kotta'] = { ...res(kotV, kotR, kotM), estimated: kotEst || undefined, pairs, homebredInRange, estimatedPairs };
  // ---- 完璧／凝った配合（公式資料の最上位複合配合） ----
  const perfectKotta: TheoryResult = perfect.verdict === '成立' && kotta.verdict === '成立' ? { ...res('成立', ['完璧な配合と凝った配合が同時成立']), estimated: kotta.estimated }
    : perfect.verdict === '不成立' || kotta.verdict === '不成立' ? res('不成立', ['完璧な配合または凝った配合が不成立'])
      : res('未確定', ['完璧な配合か凝った配合が未確定'], [...perfect.missing, ...kotta.missing]);

  // ---- ニックス ----
  let nicksV: Verdict, nicksR: string[] = [], nicksM: string[] = [], level = 0;
  if (sire.smallSystem && dam.smallSystem) {
    const known = ctx.nicks.get(sire.smallSystem + '|' + dam.smallSystem);
    level = known ?? 0;
    nicksV = level > 0 ? '成立' : '不成立';
    nicksR.push(`父: ${sire.smallSystem}系（${sire.smallSystemSource}） × 母: ${dam.smallSystem}系（${dam.smallSystemSource}）`);
    // 相性表は未完成なので、表にない（未確認）と、段階0（ニックスなし）を確認した行は分けて示す
    nicksR.push(known === undefined ? '相性表に該当なし（未確認）' : known > 0 ? `相性表に段階${known}で登録` : '相性表に段階0（ニックスなし）で登録');
    if (sire.smallSystemSource === '父から推定' || dam.smallSystemSource === '父から推定') nicksR.push('自家製馬の小系統は父からの推定値です');
  } else {
    nicksV = '未確定';
    nicksR.push('小系統が不明な馬があります');
    if (!sire.smallSystem) nicksM.push(`父（${sire.name}）の小系統`);
    if (!dam.smallSystem) nicksM.push(`母（${dam.name}）の小系統`);
  }
  const nicks: Judgement['nicks'] = { ...res(nicksV, nicksR, nicksM), level, sireSmall: sire.smallSystem, damSmall: dam.smallSystem };

  // ---- ニトロ参考値（前作由来） ----
  const ng = rules.nitroGenerations;
  const nitroNames = (side: 2 | 3) => {
    const set = new Set<string>();
    for (let n = 2; n < 64; n++) if (sideOf(n) === side && gen(n) <= ng && nodes[n]) set.add(nodes[n]);
    return set;
  };
  const sN = nitroNames(2), dN = nitroNames(3);
  const nitro = { speed: 0, stamina: 0, power: 0, unknownNames: [] as string[] };
  const seen = new Set<string>();
  for (const k of [...sN, ...dN]) {
    if (seen.has(k)) continue; seen.add(k);
    const nm = nameOfKey(k);
    const v = nitroOf(nm ? ctx.ancestors.get(nm) : ctx.userAncestors.get(k));
    if (v) { nitro.speed += v.speed; nitro.stamina += v.stamina; nitro.power += v.power; }
    else nitro.unknownNames.push(labels[k] ?? k);
  }

  if (sire.missingSlots || dam.missingSlots) warnings.push('父または母の血統に空欄があります');

  // 父似・母似（前作由来）: アウトブリードなら各側4代内（親自身を含む）の因子から1つ発動する
  const sideEffects = (side: 2 | 3) => {
    const set = new Set<string>();
    for (let n = 2; n < 64; n++) if (sideOf(n) === side && gen(n) <= 4 && nodes[n]) for (const e of effectsOf(ctx, nodes[n]) ?? []) set.add(e);
    return [...set];
  };
  const inheritance: Judgement['inheritance'] = crosses.length
    ? { mode: 'temperament', sireEffects: [], damEffects: [] }
    : { mode: hasUnknownSlots ? 'unknown' : 'outbreedEffect', sireEffects: sideEffects(2), damEffects: sideEffects(3) };

  // 判定に使った系統枠（親の 父／父母父／母父／母母父 と、父の 父父母父／父母母父／母父母父／母母母父）
  const sysOf = (c: string) => (c && c !== '?' ? sysName(ctx, c) : null);
  const slotSystems: Judgement['slotSystems'] = {};
  // 親ツリーのノード k は産駒ツリーの side*2^gen(k) + (k - 2^gen(k))。父の 2,10,6,14 → 4,18,10,22 / 母 → 6,26,14,30 / 父の 18,22,26,30 → 34,38,42,46
  [4, 18, 10, 22].forEach((n, i) => { slotSystems[n] = { role: '面白', system: sysOf(sire.omoshiro[i]), side: '父' }; });
  [6, 26, 14, 30].forEach((n, i) => { slotSystems[n] = { role: '面白', system: sysOf(dam.omoshiro[i]), side: '母' }; });
  [34, 38, 42, 46].forEach((n, i) => { slotSystems[n] = { role: '見事', system: sysOf(sire.migoto[i]), side: '父' }; });

  return {
    rulesVersion: ctx.rulesVersion, dataVersion: ctx.dataVersion,
    sire: sire.key, dam: dam.key, nodes, labels,
    omoshiro, migoto, perfect, perfectKotta, kotta, crosses, crossStatus, mareCrossCount, outbreed, dangerous, nicks, inheritance,
    nitroReference: nitro, slotSystems, cost: sire.price, costUnknown: sire.priceUnknown, hasUnknownSlots, unknownSlotCount, warnings,
    constraints: [...sire.constraints.map((c) => `父: ${c}`), ...dam.constraints.map((c) => `母: ${c}`)],
  };
}

export { nodePath };

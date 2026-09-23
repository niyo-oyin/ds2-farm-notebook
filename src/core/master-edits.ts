// データ（種牡馬・繁殖牝馬）への利用者の追加・修正・非表示。
import type { AncestorInfo, MasterData, MasterHorse, OwnedHorse, PlannedHorse } from './types';
import { parseFoalName, parseManYen } from './owned-horse';
import { horseIdentities, horseNameKey, newAncestorId, uniqueHorseNamed } from './horse-identity';
import { nodePath } from './pedigree';

export interface MasterEdit {
  /** 対象の馬ID。追加した馬は "st:u-…" / "bm:u-…" */
  id: string;
  kind: 'stallion' | 'broodmare';
  /** 利用者が追加した馬なら true（data は馬の全項目）。既存の馬の修正なら false（data は変えた項目だけ） */
  added: boolean;
  /** 一覧・選択候補から非表示にする。 */
  hidden?: boolean;
  data: Partial<Omit<MasterHorse, 'id' | 'kind'>>;
  updatedAt: string;
}

/** 祖先の個体IDごとの名前・大系統・性別・因子への追加・修正 */
export interface AncestorEdit { id: string; name: string; system: number | null; sex: 'M' | 'F' | null; effects: string[]; effectsKnown?: boolean; updatedAt: string }

/** 凝ったペア表・ニックス相性表の利用者の行の出典。 */
export type PairSource = '実機確認' | '推定';
export const PAIR_SOURCES: PairSource[] = ['実機確認', '推定'];
/** 凝ったペア表への追加・確認・無効化。父側IDと母側IDが識別子。マスターデータの行に対して active=false なら無効化、true なら確認の記録 */
export interface KottaEdit { sire: string; dam: string; active: boolean; source: PairSource; note: string; updatedAt: string }
/** ニックス相性表への追加・訂正。父小系統と母小系統が識別子。level 0 は「ニックスなしを確認した」行で、表にない（未確認）と区別する */
export interface NicksEdit { sire: string; dam: string; level: number; source: PairSource; note: string; updatedAt: string }
export const pairKey = (sire: string, dam: string) => `${sire}|${dam}`;

/** 本馬を1代目とする対象世代内の牡馬から、凝ったペアを引く（種牡馬は父側、繁殖牝馬は母側）。 */
export function kottaHints(horse: Pick<MasterHorse, 'id' | 'ancestors' | 'kind'>, kotta: [string, string][], generations = 4): { name: string; path: string; partners: string[] }[] {
  const own = horse.kind === 'stallion' ? [{ name: horse.id, path: '本馬' }] : [];
  for (let i = 0; i < horse.ancestors.length; i++) {
    const node = i + 2;
    if (Math.floor(Math.log2(node)) > generations - 1) break;
    if (node % 2 === 0 && horse.ancestors[i]) own.push({ name: horse.ancestors[i], path: nodePath(node) });
  }
  const sireSide = horse.kind === 'stallion';
  return own.map((o) => {
    const partners = new Set<string>();
    for (const [a, b] of kotta) {
      if ((sireSide ? a : b) === o.name) partners.add(sireSide ? b : a);
    }
    return { ...o, partners: [...partners].sort((x, y) => x.localeCompare(y, 'ja')) };
  }).filter((o) => o.partners.length);
}
/** 本馬の小系統に対するニックス相性表の行（種牡馬は父側、繁殖牝馬は母側として引く） */
export function nicksHints(smallSystem: string | null, kind: MasterHorse['kind'], nicks: MasterData['nicks']): { partner: string; level: number }[] {
  if (!smallSystem) return [];
  return nicks.filter((n) => (kind === 'stallion' ? n.sire : n.dam) === smallSystem).map((n) => ({ partner: kind === 'stallion' ? n.dam : n.sire, level: n.level })).sort((a, b) => b.level - a.level || a.partner.localeCompare(b.partner, 'ja'));
}

/** 種牡馬一覧の読み取り。能力欄が写っていない馬の abilities は null */
export interface BreedingReading {
  sort: '種付料' | '配合理論' | 'ニックス' | '馬名' | '不明';
  selected_name: string; selected_small_system: string;
  cards: { name: string; theory: string; fee: string; stars: number | null; abilities: StallionAbilityReading | null }[];
}
export type StallionAbilityReading = Pick<MasterReading, 'distance' | 'growth' | 'dirt' | 'kenko' | 'kisyo' | 'jisseki' | 'konjo' | 'antei'>;
export interface BreedingCardRow { name: string; stallion: MasterHorse | null; level: number | null; reading: BreedingReading['cards'][number] }
/** ニックス表への提案。同じ父小系統の種牡馬をまとめ、現在の表と比べた状態を付ける */
export interface NicksProposal {
  sire: string; dam: string; level: number; stallions: string[];
  /** 新規＝表にない、一致＝表と同じ段階、食い違い＝表と違う段階、不整合＝同じ小系統の種牡馬で★が揃わない（反映しない） */
  status: '新規' | '一致' | '食い違い' | '不整合';
  /** 現在の表の段階（未確認なら undefined） */
  current?: number;
}
/** カード右上の★の数を段階にし、種牡馬名をマスターデータに照合する。★がなければ段階0 */
export function breedingCardRows(reading: BreedingReading, stallions: MasterHorse[]): BreedingCardRow[] {
  // 画面のローマ数字（Ⅱ）はマスターデータの ASCII（II）に合わせ、小さいカナ（ヴァ／ヴア）の揺れは大きいカナに揃えて照合する
  const SMALL = 'ァィゥェォャュョッ', LARGE = 'アイウエオヤユヨツ';
  const key = (s: string) => normName(s).replace(/Ⅱ/g, 'II').replace(/Ⅲ/g, 'III').replace(/[ァィゥェォャュョッ]/g, (c) => LARGE[SMALL.indexOf(c)]).toLowerCase();
  const byName = new Map<string, MasterHorse[]>();
  for (const h of stallions) byName.set(key(h.name), [...(byName.get(key(h.name)) ?? []), h]);
  return reading.cards.filter((c) => c.name.trim()).map((c) => ({ name: c.name, stallion: byName.get(key(c.name))?.length === 1 ? byName.get(key(c.name))![0] : null, reading: c, level: c.stars === null ? null : Math.max(0, Math.min(3, Math.round(c.stars))) }));
}
/** 種牡馬ごとの段階を父小系統ごとにまとめ、母小系統との組としてニックス表への提案にする */
export function nicksProposals(rows: BreedingCardRow[], mareSmall: string, current: MasterData['nicks'], includeZero: boolean): NicksProposal[] {
  const groups = new Map<string, { levels: Set<number>; level: number; stallions: string[] }>();
  for (const r of rows) {
    if (!r.stallion?.smallSystem || r.level === null) continue;
    if (!includeZero && r.level === 0) continue;
    const g = groups.get(r.stallion.smallSystem) ?? { levels: new Set<number>(), level: r.level, stallions: [] };
    g.levels.add(r.level); g.stallions.push(r.stallion.name); groups.set(r.stallion.smallSystem, g);
  }
  const table = new Map(current.map((n) => [pairKey(n.sire, n.dam), n.level]));
  return [...groups.entries()].map(([sire, g]) => {
    const cur = table.get(pairKey(sire, mareSmall));
    const status: NicksProposal['status'] = g.levels.size > 1 ? '不整合' : cur === undefined ? '新規' : cur === g.level ? '一致' : '食い違い';
    return { sire, dam: mareSmall, level: g.level, stallions: g.stallions, status, ...(cur !== undefined ? { current: cur } : {}) };
  }).sort((a, b) => a.sire.localeCompare(b.sire, 'ja'));
}

export const SYS_CHARS = 'abcdefghijklmno';
/** 追加した馬のID。初期データと衝突しないよう "st:u-…" / "bm:u-…" にする。 */
export const newMasterId = (kind: 'stallion' | 'broodmare') => `${kind === 'stallion' ? 'st' : 'bm'}:u-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** 馬・祖先・凝ったペア・ニックスの編集を元データを変更せずに重ねる。編集がなければ元の参照を返す。 */
export function applyMasterEdits(base: MasterData, edits: MasterEdit[], ancestorEdits: AncestorEdit[] = [], kottaEdits: KottaEdit[] = [], nicksEdits: NicksEdit[] = []): MasterData {
  if (!edits.length && !ancestorEdits.length && !kottaEdits.length && !nicksEdits.length) return base;
  const ancestors = ancestorEdits.length ? (() => {
    const byId = new Map(ancestorEdits.map((e) => [e.id, e]));
    const merged = base.ancestors.map((a) => { const e = byId.get(a.id); return e ? { ...a, name: e.name, system: e.system, sex: e.sex, effects: [...e.effects], effectsKnown: e.effectsKnown !== false } : a; });
    const known = new Set(base.ancestors.map((a) => a.id));
    return [...merged, ...ancestorEdits.filter((e) => !known.has(e.id)).map((e) => ({ id: e.id, name: e.name, system: e.system, sex: e.sex, effects: [...e.effects], ...(e.effectsKnown === false ? { effectsKnown: false } : {}) }))];
  })() : base.ancestors;
  const kotta = kottaEdits.length ? (() => {
    const byKey = new Map(kottaEdits.map((e) => [pairKey(e.sire, e.dam), e]));
    const known = new Set(base.kotta.map(([a, b]) => pairKey(a, b)));
    return [...base.kotta.filter(([a, b]) => byKey.get(pairKey(a, b))?.active !== false),
      ...kottaEdits.filter((e) => e.active && !known.has(pairKey(e.sire, e.dam))).map((e): [string, string] => [e.sire, e.dam])];
  })() : base.kotta;
  const nicks = nicksEdits.length ? (() => {
    const byKey = new Map(nicksEdits.map((e) => [pairKey(e.sire, e.dam), e]));
    const known = new Set(base.nicks.map((n) => pairKey(n.sire, n.dam)));
    return [...base.nicks.map((n) => { const e = byKey.get(pairKey(n.sire, n.dam)); return e ? { ...n, level: e.level } : n; }),
      ...nicksEdits.filter((e) => !known.has(pairKey(e.sire, e.dam))).map((e) => ({ sire: e.sire, dam: e.dam, level: e.level }))];
  })() : base.nicks;
  const byId = new Map(edits.map((e) => [e.id, e]));
  const merge = (list: MasterHorse[]) => list.flatMap((h) => {
    const e = byId.get(h.id);
    if (!e) return [h];
    if (e.hidden) return [];
    return [{ ...h, ...e.data, id: h.id, kind: h.kind }];
  });
  const addedOf = (kind: MasterHorse['kind']) => edits.filter((e) => e.added && e.kind === kind && !e.hidden).map((e) => ({
    kind, id: e.id, sex: kind === 'stallion' ? 'M' : 'F', name: '', price: 0, color: null, bigSystem: null, smallSystem: null, omoshiro: null, migoto: null,
    ancestors: Array<string>(30).fill(''), unlock: null, purchasePrice: null, attrs: {}, ...e.data,
  } as MasterHorse));
  const names = new Map<string, { name: string; at: string }>();
  for (const e of edits) if (e.data.name !== undefined) names.set(e.id, { name: e.data.name, at: e.updatedAt });
  for (const e of ancestorEdits) if (!names.has(e.id) || e.updatedAt >= names.get(e.id)!.at) names.set(e.id, { name: e.name, at: e.updatedAt });
  const rename = <T extends { id: string; name: string }>(h: T): T => names.has(h.id) ? { ...h, name: names.get(h.id)!.name } : h;
  const stallions = [...merge(base.stallions), ...addedOf('stallion')].map(rename);
  const broodmares = [...merge(base.broodmares), ...addedOf('broodmare')].map(rename);
  const known = new Set(ancestors.map(a => a.id));
  const identities = [...base.stallions, ...base.broodmares, ...stallions, ...broodmares].filter(h => {
    if (known.has(h.id)) return false;
    known.add(h.id); return true;
  }).map((h): AncestorInfo => ({ id: h.id, name: h.name, sex: h.sex, system: h.bigSystem ? base.meta.bigSystems.indexOf(h.bigSystem) + 1 || null : null, effects: [], effectsKnown: false }));
  return { ...base, ancestors: [...ancestors, ...identities].map(rename), kotta, nicks, stallions, broodmares };
}

/** 血統表の位置（祖先配列の添字）。面白用は 自身・父母父・母父・母母父、見事用は 父父母父・父母母父・母父母父・母母母父 */
export const OMOSHIRO_SLOTS: (number | 'self')[] = ['self', 8, 4, 12];
export const MIGOTO_SLOTS: number[] = [16, 20, 24, 28];
export const SLOT_LABELS: Record<string, string> = { self: '本馬', 8: '父母父', 4: '母父', 12: '母母父', 16: '父父母父', 20: '父母母父', 24: '母父母父', 28: '母母母父' };

/** 大系統の略号から系統コードの1文字へ。不明は '?' */
export const sysChar = (bigSystem: string | null | undefined, bigSystems: string[]) => {
  const i = bigSystem ? bigSystems.indexOf(bigSystem) : -1;
  return i >= 0 ? SYS_CHARS[i] : '?';
};
export const charSys = (c: string, bigSystems: string[]) => { const i = SYS_CHARS.indexOf(c); return i >= 0 ? bigSystems[i] : null; };

/** 系統コードを祖先マスターから導出する。大系統が不明な位置は '?'。 */
export function deriveCodes(bigSystem: string | null, ancestors: string[], ancestorMaster: Map<string, AncestorInfo>, bigSystems: string[]): { omoshiro: string; migoto: string } {
  const at = (slot: number | 'self') => {
    if (slot === 'self') return sysChar(bigSystem, bigSystems);
    const info = ancestorMaster.get(ancestors[slot] ?? '');
    return info?.system ? SYS_CHARS[info.system - 1] : '?';
  };
  return { omoshiro: OMOSHIRO_SLOTS.map(at).join(''), migoto: MIGOTO_SLOTS.map(at).join('') };
}

/** 父母のIDが登録済みの馬に一致すれば、その血統で2代目以降を埋める。手入力済みの欄は上書きしない */
export function fillFromParents(ancestors: string[], horsesById: Map<string, MasterHorse>): string[] {
  const out = [...ancestors];
  for (const [side, name] of [[2, ancestors[0]], [3, ancestors[1]]] as const) {
    const parent = name ? horsesById.get(name) : undefined;
    if (!parent) continue;
    // 親ツリーのノード k（1 = 親自身、世代 g）は本馬ツリーの side*2^g + (k - 2^g) に対応する
    for (let k = 2; k < 32; k++) {
      const g = Math.floor(Math.log2(k));
      const node = side * (1 << g) + (k - (1 << g));
      if (node - 2 >= 30) continue;
      if (!out[node - 2]) out[node - 2] = parent.ancestors[k - 2] ?? '';
    }
  }
  return out;
}

/** 変更した項目だけを保存用の差分として返す。 */
export function diffAgainstBase(base: MasterHorse, next: MasterHorse): MasterEdit['data'] {
  const data: Record<string, unknown> = {};
  for (const key of ['name', 'price', 'priceUnknown', 'overseas', 'color', 'bigSystem', 'smallSystem', 'omoshiro', 'migoto', 'ancestors', 'unlock', 'breedingRightPrice', 'purchasePrice', 'attrs'] as const) {
    if (key === 'priceUnknown' && !!base[key] === !!next[key]) continue;
    if (key === 'overseas' && !!base[key] === !!next[key]) continue;
    if (JSON.stringify(base[key] ?? null) !== JSON.stringify(next[key] ?? null)) data[key] = next[key];
  }
  return data as MasterEdit['data'];
}

export function validateMasterHorse(h: Pick<MasterHorse, 'name' | 'price' | 'purchasePrice' | 'breedingRightPrice' | 'ancestors' | 'omoshiro' | 'migoto'>) {
  if (!h.name.trim()) throw new Error('馬名を入力してください');
  if (!Number.isFinite(h.price) || h.price < 0) throw new Error('種付料は0以上の数値で入力してください');
  if (h.purchasePrice != null && (!Number.isFinite(h.purchasePrice) || h.purchasePrice < 0)) throw new Error('購入価格は0以上の数値で入力してください');
  if (h.breedingRightPrice != null && (!Number.isFinite(h.breedingRightPrice) || h.breedingRightPrice < 0)) throw new Error('種付け権購入額は0以上の数値で入力してください');
  if (h.ancestors.length !== 30) throw new Error('血統は30頭分の欄が必要です');
  for (const code of [h.omoshiro, h.migoto]) if (code != null && !/^[a-o?]{4}$/.test(code)) throw new Error('系統コードが不正です');
}

// ---- 種牡馬・繁殖牝馬の画面の読み取りをマスターデータに変換する ----

/** 読み取り API が返す種牡馬・繁殖牝馬の画面の内容。該当しない欄は空文字、年齢は -1 */
export interface MasterReading {
  name: string; sex: '牡' | '牝' | '不明'; age: number; color: string;
  sire: string; dam: string; dam_sire: string; big_system: string; small_system: string;
  fee: string; price: string; distance: string; growth: string; dirt: string;
  kenko: string; kisyo: string; jisseki: string; konjo: string; antei: string;
  offspring: string; wins: string; graded: string; g1: string;
}
const normName = (s: string) => s.replace(/[\s・()（）]/g, '').replace(/Ⅱ/g, 'II').replace(/Ⅲ/g, 'III');

/**
 * マスターデータに自家生産馬を持ち込まないための拒否判定。理由を返す（null なら登録可）。
 * 所有馬・計画馬と同名、仮名「母名の27」、父か母が所有馬、のいずれかで拒否する。
 */
export function homebredBlockReason(reading: Pick<MasterReading, 'name' | 'sire' | 'dam'>, horses: OwnedHorse[], planned: PlannedHorse[]): string | null {
  const name = normName(reading.name);
  if (!name) return '馬名が読み取れていません';
  if (parseFoalName(reading.name)) return '仮名（母名＋生年）の馬は自家生産馬なので種牡馬・繁殖牝馬データには登録しません';
  if (horses.some((h) => normName(h.name) === name)) return '同名の所有馬があります。自家生産馬は種牡馬・繁殖牝馬データには登録しません';
  if (planned.some((h) => normName(h.name) === name)) return '同名の計画馬があります。自家生産馬は種牡馬・繁殖牝馬データには登録しません';
  for (const [label, parent] of [['父', reading.sire], ['母', reading.dam]] as const) {
    const p = normName(parent);
    if (p && horses.some((h) => normName(h.name) === p)) return `${label}「${parent}」が所有馬です。自家生産馬は種牡馬・繁殖牝馬データには登録しません`;
  }
  return null;
}

/** 種付料・販売価格の欄を万円の数値にする。「無料」は 0、読めなければ undefined */
export const parseFee = (text: string): number | undefined => (text.trim() === '無料' ? 0 : parseManYen(text));

function stallionAttrsFromReading(r: StallionAbilityReading, base: MasterHorse['attrs'] = {}): MasterHorse['attrs'] {
  const attrs = { ...base };
  const dist = r.distance.match(/(\d+)\s*[-−–〜～]\s*(\d+)/);
  if (dist) attrs.dist = [Number(dist[1]), Number(dist[2])];
  for (const key of ['growth', 'dirt', 'kenko', 'kisyo', 'jisseki', 'konjo', 'antei'] as const) {
    const value = r[key].trim();
    if (value && value !== '-') attrs[key === 'growth' ? 'grown' : key] = value;
  }
  return attrs;
}

/** 一覧で読めた種付料・能力だけを更新し、血統などはそのまま残す */
export function masterFromBreedingCard(base: MasterHorse, card: BreedingReading['cards'][number]): MasterHorse {
  const price = parseFee(card.fee);
  return { ...base, ...(price === undefined ? {} : { price, priceUnknown: false }), attrs: card.abilities ? stallionAttrsFromReading(card.abilities, base.attrs) : { ...base.attrs } };
}

/**
 * 読み取りを種牡馬・繁殖牝馬のレコードにする。base があれば読めた項目だけを上書きし、なければ新規。
 * 父・母・母父は血統の該当欄に入れ、父母が登録済みなら残りを補完する。系統コードは祖先マスターから導出する
 */
export function masterFromReading(kind: 'stallion' | 'broodmare', r: MasterReading, base: MasterHorse | null, master: MasterData, ancestorMaster: Map<string, AncestorInfo>, parentIds: Partial<Record<'sire' | 'dam' | 'dam_sire', string>> = {}): MasterHorse {
  const known = (v: string) => (v.trim() ? v.trim() : undefined);
  const set = <T,>(v: T | undefined, fallback: T): T => (v === undefined ? fallback : v);
  const ancestors = [...(base?.ancestors ?? Array<string>(30).fill(''))];
  const byId = new Map([...master.stallions, ...master.broodmares].map((h) => [h.id, h]));
  const identities = horseIdentities(master);
  // 別の個体に変わった側の祖先は消して補完し直す。
  const clearSide = (side: 2 | 3) => { for (let n = side * 2; n < 32; n++) { let k = n; while (k > 3) k >>= 1; if (k === side) ancestors[n - 2] = ''; } };
  for (const [idx, side, name] of [[0, 2, r.sire.trim()], [1, 3, r.dam.trim()]] as const) {
    if (!name) continue;
    const explicit = parentIds[idx === 0 ? 'sire' : 'dam'];
    const match = explicit ? identities.get(explicit) : uniqueHorseNamed(identities.values(), name);
    if (!match) continue;
    if (ancestors[idx] && ancestors[idx] !== match.id) clearSide(side);
    ancestors[idx] = match.id;
  }
  const damSire = parentIds.dam_sire ? identities.get(parentIds.dam_sire) : uniqueHorseNamed(identities.values(), r.dam_sire);
  if (damSire) ancestors[4] = damSire.id;
  const filled = fillFromParents(ancestors, byId);
  const bigSystem = master.meta.bigSystems.includes(r.big_system.trim()) ? r.big_system.trim() : base?.bigSystem ?? null;
  const attrs = kind === 'stallion' ? stallionAttrsFromReading(r, base?.attrs) : { ...base?.attrs };
  const next: MasterHorse = {
    id: base?.id ?? uniqueHorseNamed(master.ancestors, r.name)?.id ?? newMasterId(kind), kind, sex: kind === 'stallion' ? 'M' : 'F',
    name: set(known(r.name), base?.name ?? ''), price: kind === 'stallion' ? set(parseFee(r.fee), base?.price ?? 0) : base?.price ?? 0,
    color: set(known(r.color), base?.color ?? null), bigSystem, smallSystem: set(known(r.small_system), base?.smallSystem ?? null),
    omoshiro: base?.omoshiro ?? null, migoto: base?.migoto ?? null,
    overseas: base?.overseas,
    ancestors: filled, unlock: base?.unlock ?? null, breedingRightPrice: base?.breedingRightPrice ?? null,
    priceUnknown: kind === 'stallion' ? parseFee(r.fee) == null && !!base?.priceUnknown : parseManYen(r.price) == null && !!base?.priceUnknown,
    purchasePrice: kind === 'broodmare' ? set(parseManYen(r.price), base?.purchasePrice ?? null) : null,
    attrs,
  };
  const derived = deriveCodes(next.bigSystem, next.ancestors, ancestorMaster, master.meta.bigSystems);
  // 導出できた位置だけ更新し、既存の値が導出値と矛盾しない限り残す
  const mergeCode = (cur: string | null, d: string) => d.split('').map((c, i) => (c !== '?' ? c : cur?.[i] ?? '?')).join('');
  next.omoshiro = mergeCode(next.omoshiro, derived.omoshiro);
  next.migoto = kind === 'stallion' ? mergeCode(next.migoto, derived.migoto) : null;
  return next;
}

/** 読み取りにだけ現れた祖先にもIDを発行する。同名候補が複数ある欄は選択を待つ。 */
export function prepareReadingAncestors(master: MasterData, reading: Pick<MasterReading, 'sire' | 'dam' | 'dam_sire'>, selected: Partial<Record<'sire' | 'dam' | 'dam_sire', string>> = {}) {
  const identities = horseIdentities(master);
  const additions: AncestorInfo[] = [];
  const ambiguous: ('sire' | 'dam' | 'dam_sire')[] = [];
  const parentIds: typeof selected = {};
  for (const field of ['sire', 'dam', 'dam_sire'] as const) {
    const name = reading[field].trim();
    if (!name) continue;
    if (selected[field] && identities.has(selected[field]!)) { parentIds[field] = selected[field]; continue; }
    const matches = [...identities.values()].filter(h => horseNameKey(h.name) === horseNameKey(name));
    if (matches.length > 1) { ambiguous.push(field); continue; }
    if (matches.length === 1) { parentIds[field] = matches[0].id; continue; }
    const ancestor: AncestorInfo = { id: newAncestorId(), name, sex: field === 'dam' ? 'F' : 'M', system: null, effects: [], effectsKnown: false };
    additions.push(ancestor); identities.set(ancestor.id, ancestor); parentIds[field] = ancestor.id;
  }
  return { additions, ambiguous, parentIds, master: { ...master, ancestors: [...master.ancestors, ...additions] } };
}

/** 反映する項目の単位。血統は父母・母父・補完をまとめて1つ、能力は項目ごと */
export type MasterFieldKey = 'name' | 'color' | 'bigSystem' | 'smallSystem' | 'price' | 'purchasePrice' | 'ancestors' | 'omoshiro' | 'migoto' | `attr:${string}`;
export interface MasterDiffRow { key: MasterFieldKey; label: string; before: string; after: string }
const ATTR_LABEL: Record<string, string> = { dist: '距離', grown: '成長', dirt: 'ダート', kenko: '体質', kisyo: '気性', jisseki: '実績', konjo: '底力', antei: '安定' };
const text = (v: unknown) => (v == null || v === '' ? '' : Array.isArray(v) ? v.join('-') : String(v));

/** 読み取りの反映で変わる項目。項目ごとに選んで反映できるよう key を付ける */
export function masterDiffRows(base: MasterHorse | null, next: MasterHorse, bigSystems: string[], label: (id: string) => string): MasterDiffRow[] {
  const rows: MasterDiffRow[] = [];
  const push = (key: MasterFieldKey, label: string, b: unknown, a: unknown) => { const bs = text(b), as = text(a); if (bs !== as) rows.push({ key, label, before: bs || '未登録', after: as || '未登録' }); };
  push('name', '馬名', base?.name, next.name); push('color', '毛色', base?.color, next.color); push('bigSystem', '大系統', base?.bigSystem, next.bigSystem); push('smallSystem', '小系統', base?.smallSystem, next.smallSystem);
  if (next.kind === 'stallion') push('price', '種付料（万円）', base?.priceUnknown ? '未確認' : base?.price, next.priceUnknown ? '未確認' : next.price); else push('purchasePrice', '購入価格（万円）', base?.priceUnknown ? '未確認' : base?.purchasePrice, next.priceUnknown ? '未確認' : next.purchasePrice);
  if (JSON.stringify(base?.ancestors ?? []) !== JSON.stringify(next.ancestors)) {
    const parts = ([[0, '父'], [1, '母'], [4, '母父']] as const).filter(([i]) => (base?.ancestors[i] ?? '') !== next.ancestors[i]).map(([i, l]) => `${l} ${base?.ancestors[i] ? label(base.ancestors[i]) : '未登録'}→${next.ancestors[i] ? label(next.ancestors[i]) : '未登録'}`);
    const filled = next.ancestors.filter(Boolean).length, was = base?.ancestors.filter(Boolean).length ?? 0;
    if (filled !== was) parts.push(`登録済みの祖先 ${was}頭→${filled}頭`);
    rows.push({ key: 'ancestors', label: '血統', before: '', after: parts.join('、') || '祖先の表記を更新' });
  }
  for (const [k, label] of Object.entries(ATTR_LABEL)) push(`attr:${k}`, label, base?.attrs[k], next.attrs[k]);
  const codeText = (c: string | null) => (c ? c.split('').map((x) => charSys(x, bigSystems) ?? '?').join(' ') : '');
  push('omoshiro', '面白用系統', codeText(base?.omoshiro ?? null), codeText(next.omoshiro)); push('migoto', '見事用系統', codeText(base?.migoto ?? null), codeText(next.migoto));
  return rows;
}

/** 選んだ項目だけを next から既存の馬に反映する。 */
export function applyMasterFields(existing: MasterHorse, next: MasterHorse, keys: MasterFieldKey[]): MasterHorse {
  const out: MasterHorse = { ...existing, attrs: { ...existing.attrs } };
  for (const key of keys) {
    if (key.startsWith('attr:')) { const k = key.slice(5); out.attrs[k] = next.attrs[k]; continue; }
    switch (key) {
      case 'name': out.name = next.name; break; case 'color': out.color = next.color; break;
      case 'bigSystem': out.bigSystem = next.bigSystem; break; case 'smallSystem': out.smallSystem = next.smallSystem; break;
      case 'price': out.price = next.price; out.priceUnknown = next.priceUnknown; break; case 'purchasePrice': out.purchasePrice = next.purchasePrice; out.priceUnknown = next.priceUnknown; break;
      case 'ancestors': out.ancestors = [...next.ancestors]; break;
      case 'omoshiro': out.omoshiro = next.omoshiro; break; case 'migoto': out.migoto = next.migoto; break;
    }
  }
  return out;
}

/** 血統画面で読んだ祖先の因子と、祖先マスターの登録を突き合わせる */
export interface AncestorFactorRow { id: string | null; name: string; factors: string[]; known: string[] | null; status: '新規' | '一致' | '相違' | '要選択' }
export function compareAncestorFactors(read: { name: string; factors: string[] }[], master: MasterData, selected: Record<string, string> = {}): AncestorFactorRow[] {
  const rows: AncestorFactorRow[] = [];
  const identities = horseIdentities(master);
  const ancestorMaster = new Map(master.ancestors.map(a => [a.id, a]));
  const seen = new Set<string>();
  for (const a of read) {
    const name = a.name.trim();
    const nameKey = horseNameKey(name);
    if (!nameKey || seen.has(nameKey)) continue;
    seen.add(nameKey);
    const factors = [...new Set(a.factors)];
    const matches = [...identities.values()].filter(a => horseNameKey(a.name) === nameKey);
    if (matches.length > 1 && !matches.some(a => a.id === selected[name])) { rows.push({ id: null, name, factors, known: null, status: '要選択' }); continue; }
    const identity = matches.find(a => a.id === selected[name]) ?? matches[0];
    const info = identity ? ancestorMaster.get(identity.id) : undefined;
    if (!info || info.effectsKnown === false) { rows.push({ id: identity?.id ?? null, name, factors, known: null, status: '新規' }); continue; }
    const same = info.effects.length === factors.length && info.effects.every((e) => factors.includes(e));
    rows.push({ id: info.id, name, factors, known: info.effects, status: same ? '一致' : '相違' });
  }
  return rows;
}

import type { AncestorInfo, HorseCategory, Observation, OwnedHorse, RaceAbilities, RaceAbilityKey, RaceEntry, RaceTraitKey } from './types';
import { nameOfKey } from './pedigree';

export const HORSE_CATEGORIES: HorseCategory[] = ['繁殖牝馬', '種牡馬', '現役', '引退', '未分類'];
export const ABILITY_RANKS = ['A', 'B', 'C'] as const;
export const DIRT_APTITUDES = ['◎', '○', '△'] as const;
export const GROWTH_TYPES = ['持続', '普通', '早熟', '晩成'] as const;
/** 現役馬のカードに表示される評価印。 */
export const CARD_MARKS = ['◎', '○', '△'] as const;
export interface CardField<K extends string> { key: K; label: string; marks: readonly string[] }
export const RACE_ABILITY_FIELDS: CardField<RaceAbilityKey>[] = [
  { key: 'speed', label: 'スピード', marks: CARD_MARKS }, { key: 'stamina', label: 'スタミナ', marks: CARD_MARKS }, { key: 'power', label: 'パワー', marks: CARD_MARKS },
  { key: 'guts', label: '根性', marks: CARD_MARKS }, { key: 'temperament', label: '気性', marks: CARD_MARKS }, { key: 'turf', label: '芝', marks: CARD_MARKS }, { key: 'dirt', label: 'ダート', marks: CARD_MARKS },
];
/** 成長は区分、コーナーは 右○／左○／両○ の文字で表す */
export const RACE_TRAIT_FIELDS: CardField<RaceTraitKey>[] = [
  { key: 'growth', label: '成長', marks: GROWTH_TYPES }, { key: 'start', label: 'スタート', marks: CARD_MARKS }, { key: 'corner', label: 'コーナー', marks: ['両○', '右○', '左○'] },
  { key: 'heavyTrack', label: '重馬場', marks: CARD_MARKS }, { key: 'roughTrack', label: '荒れ馬場', marks: CARD_MARKS }, { key: 'fastTrack', label: '高速馬場', marks: CARD_MARKS },
  { key: 'health', label: '体質', marks: CARD_MARKS }, { key: 'legs', label: '脚元', marks: CARD_MARKS }, { key: 'concentration', label: '集中力', marks: CARD_MARKS },
  { key: 'timid', label: 'こわがり', marks: CARD_MARKS }, { key: 'soundReaction', label: '音反応', marks: CARD_MARKS }, { key: 'reaction', label: '反応', marks: CARD_MARKS },
];
/** 血統（父母）が登録されていない所有馬は配合確認・探索の候補にしない。理由の文言も返す */
export function pedigreeIssue(horse: Pick<OwnedHorse, 'sireKey' | 'damKey'>): string | null {
  if (!horse.sireKey && !horse.damKey) return '血統未登録です';
  if (!horse.sireKey) return '父が未登録です';
  if (!horse.damKey) return '母が未登録です';
  return null;
}
export function isBreedingHorse(horse: OwnedHorse) {
  return (horse.category === '繁殖牝馬' && horse.sex === 'F') || (horse.category === '種牡馬' && horse.sex === 'M');
}

export function validateOwnedDetails(horse: Pick<OwnedHorse, 'profile' | 'abilities'> & Partial<Pick<OwnedHorse, 'category' | 'sex'>>) {
  if (horse.category !== undefined && !HORSE_CATEGORIES.includes(horse.category)) throw new Error('区分が不正です');
  if ((horse.category === '繁殖牝馬' && horse.sex !== 'F') || (horse.category === '種牡馬' && horse.sex !== 'M')) throw new Error('区分と性別が一致していません');
  const a = horse.abilities;
  const number = (value: number | undefined, label: string) => {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`${label}は0以上の数値で入力してください`);
  };
  for (const [key, label] of [['speed', 'スピード'], ['stamina', 'スタミナ'], ['power', 'パワー']] as const) number(a?.broodmare?.[key], label);
  for (const group of [a?.broodmare, a?.stallion]) {
    if (!group) continue;
    for (const key of ['health', 'temperament', 'guts', 'achievement', 'stability'] as const) {
      const value = (group as Record<string, unknown>)[key];
      if (value !== undefined && !ABILITY_RANKS.includes(value as typeof ABILITY_RANKS[number])) throw new Error('評価はA・B・Cから選択してください');
    }
    if (group.dirt !== undefined && !DIRT_APTITUDES.includes(group.dirt)) throw new Error('ダートは◎・○・△から選択してください');
  }
  if (a?.stallion?.growth !== undefined && !GROWTH_TYPES.includes(a.stallion.growth)) throw new Error('成長型が不正です');
  number(a?.stallion?.distanceMin, '距離下限'); number(a?.stallion?.distanceMax, '距離上限');
  if (a?.stallion?.distanceMin !== undefined && a.stallion.distanceMax !== undefined && a.stallion.distanceMin > a.stallion.distanceMax) throw new Error('距離下限は上限以下にしてください');
  const year = horse.profile?.birthYear;
  if (year !== undefined && (!Number.isInteger(year) || year < 1)) throw new Error('生年は1以上の整数で入力してください');
  const earnings = horse.profile?.earnings;
  if (earnings !== undefined && (!Number.isFinite(earnings) || earnings < 0)) throw new Error('総賞金は0以上の数値で入力してください');
  const current = horse.profile?.earningsCurrent;
  if (current !== undefined && (!Number.isFinite(current) || current < 0)) throw new Error('収得賞金は0以上の数値で入力してください');
}

// ---- ゲーム画面（育成馬・入厩馬カード）の読み取り結果を所有馬に統合する ----

/** 読み取り API が返すカードの内容。印は画面の表記そのまま（「-」は未判明）。 */
export interface CardReading {
  screen_type: string; name: string; class: string; sex: '牡' | '牝' | 'せん' | '不明'; age: number; color: string;
  distance: string; weight: string; stable: string;
  abilities: Record<string, string>; traits: Record<string, string>;
  record: string; earnings_current: string; earnings_total: string; races: RaceEntry[];
}
const CARD_ABILITY_KEYS: Record<string, RaceAbilityKey> = { speed: 'speed', stamina: 'stamina', power: 'power', guts: 'guts', temperament: 'temperament', turf: 'turf', dirt: 'dirt' };
const CARD_TRAIT_KEYS: Record<string, RaceTraitKey> = {
  growth: 'growth', start: 'start', corner: 'corner', heavy_track: 'heavyTrack', rough_track: 'roughTrack', fast_track: 'fastTrack',
  constitution: 'health', legs: 'legs', concentration: 'concentration', timid: 'timid', sound_reaction: 'soundReaction', reaction: 'reaction',
};
const known = (value: string | undefined) => { const v = (value ?? '').trim(); return v && v !== '-' && v !== '−' && v !== '—' ? v : undefined; };

/** 「1億6330万円」「5800万円」を万円の数値にする。読めなければ undefined */
export function parseManYen(text: string): number | undefined {
  const t = known(text)?.replace(/[,\s円]/g, '');
  if (!t) return undefined;
  const m = t.match(/^(?:(\d+)億)?(?:(\d+)万)?$/);
  if (!m || (!m[1] && !m[2])) return undefined;
  return Number(m[1] ?? 0) * 10000 + Number(m[2] ?? 0);
}

/** 未命名馬の仮名「母名の27」から母名と生年を取り出す */
export function parseFoalName(name: string): { damName: string; birthYear: number } | null {
  const m = name.trim().match(/^(.+?)の(\d{2,4})$/);
  return m ? { damName: m[1], birthYear: Number(m[2]) } : null;
}

export const isUnnamedHorse = (name: string) => !name.trim() || parseFoalName(name.normalize('NFKC')) !== null;

/** 反映先の候補。点数の高い順。理由は画面にそのまま出す */
export interface MatchCandidate { horse: OwnedHorse; score: number; reasons: string[]; exact: boolean }
const normName = (s: string) => s.replace(/[\s・()（）]/g, '');
/**
 * 読み取ったカードに対応する所有馬の候補を探す。
 * 馬名一致は確定。それ以外は仮名の母名＋生年、性別、毛色、印の一致で点数を付ける。
 */
export function cardMatchCandidates(card: CardReading, horses: OwnedHorse[], damNameOf: (horse: OwnedHorse) => string): MatchCandidate[] {
  const name = normName(card.name);
  const foal = parseFoalName(card.name);
  const marks = Object.entries({ ...Object.fromEntries(Object.entries(CARD_ABILITY_KEYS).map(([from, to]) => [to, known(card.abilities?.[from])])), ...Object.fromEntries(Object.entries(CARD_TRAIT_KEYS).map(([from, to]) => [to, known(card.traits?.[from])])) })
    .filter((e): e is [string, string] => !!e[1]);
  const sex = card.sex === '牡' ? 'M' : card.sex === '牝' ? 'F' : null;
  const out: MatchCandidate[] = [];
  for (const horse of horses) {
    if (name && normName(horse.name) === name) { out.push({ horse, score: 100, reasons: ['馬名が一致'], exact: true }); continue; }
    if (sex && horse.sex && horse.sex !== sex) continue;
    let score = 0; const reasons: string[] = [];
    if (foal && horse.profile?.birthYear === foal.birthYear && normName(damNameOf(horse)) === normName(foal.damName)) { score += 60; reasons.push('母名と生年が一致'); }
    if (sex && horse.sex === sex) { score += 5; reasons.push('性別が一致'); }
    const color = known(card.color);
    if (color && horse.profile?.color === color) { score += 10; reasons.push('毛色が一致'); }
    const race = horse.abilities?.race ?? {};
    const same = marks.filter(([key, v]) => race[key as keyof RaceAbilities] === v).length;
    const differ = marks.filter(([key, v]) => { const cur = race[key as keyof RaceAbilities]; return cur !== undefined && cur !== v; }).length;
    if (same) { score += same * 3; reasons.push(`印が${same}件一致`); }
    if (differ) { score -= differ * 2; reasons.push(`印が${differ}件相違`); }
    const distance = known(card.distance);
    if (distance && race.distance === distance) { score += 8; reasons.push('距離適性が一致'); }
    if (score > 5) out.push({ horse, score, reasons, exact: false });
  }
  return out.sort((a, b) => b.score - a.score || a.horse.name.localeCompare(b.horse.name, 'ja'));
}

/** 血統・クロス画面の読み取り結果。馬名は写らないので、父母の名前から反映先を探す */
export interface PedigreeReading { sire: string; dam: string; sire_sire: string; sire_dam: string; dam_sire: string; dam_dam: string; crosses: { name: string; generations: string; percent: string }[]; ancestors: { name: string; factors: string[] }[] }
export const PEDIGREE_SLOTS: { key: keyof PedigreeReading & string; label: string }[] = [
  { key: 'sire', label: '父' }, { key: 'dam', label: '母' }, { key: 'sire_sire', label: '父父' }, { key: 'sire_dam', label: '父母' }, { key: 'dam_sire', label: '母父' }, { key: 'dam_dam', label: '母母' },
];
/**
 * 血統画面の反映先候補。父母が登録済みの馬は除く。
 * 仮名「母名の27」の母名、登録済みの母、登録済みの父の一致で点数を付ける。
 */
export function pedigreeMatchCandidates(reading: PedigreeReading, horses: OwnedHorse[], labelOf: (key: string) => string): MatchCandidate[] {
  const dam = normName(reading.dam), sire = normName(reading.sire);
  const out: MatchCandidate[] = [];
  for (const horse of horses) {
    if (horse.sireKey && horse.damKey) continue;
    let score = 0; const reasons: string[] = [];
    const foal = parseFoalName(horse.name);
    if (dam && foal && normName(foal.damName) === dam) { score += 60; reasons.push('仮名の母名が一致'); }
    if (dam && horse.damKey && normName(labelOf(horse.damKey)) === dam) { score += 50; reasons.push('母が一致'); }
    if (sire && horse.sireKey && normName(labelOf(horse.sireKey)) === sire) { score += 30; reasons.push('父が一致'); }
    if (score > 0) out.push({ horse, score, reasons, exact: false });
  }
  return out.sort((a, b) => b.score - a.score || a.horse.name.localeCompare(b.horse.name, 'ja'));
}

const sameRace = (a: RaceEntry, b: RaceEntry) => a.date === b.date && a.place === b.place && a.race === b.race;
/** 競走成績を統合する。新しい行を先頭に足し、既存行は見えている列だけ埋める。 */
export function mergeRaces(existing: RaceEntry[] = [], incoming: RaceEntry[] = []): RaceEntry[] {
  const kept = existing.map((e) => { const hit = incoming.find((r) => sameRace(r, e)); return hit ? { ...e, finish: hit.finish || e.finish } : e; });
  const added = incoming.filter((r) => (r.date || r.race) && !existing.some((e) => sameRace(r, e)));
  return [...added, ...kept];
}

export type CardPatch = Pick<OwnedHorse, 'name' | 'sex' | 'category' | 'profile' | 'abilities' | 'observations'>;
/** ゲーム内の年と生年から年齢を出す。どちらかが不明なら undefined */
export const horseAge = (birthYear: number | undefined, gameYear: number | undefined) => birthYear !== undefined && gameYear !== undefined ? gameYear - birthYear : undefined;
/** ゲームと同じ「牝2」の形式。年齢が不明なら性別だけ */
export const sexAgeLabel = (sex: OwnedHorse['sex'], age: number | undefined) => `${sex === 'F' ? '牝' : sex === 'M' ? '牡' : '性別未確認'}${sex && age !== undefined && age >= 0 ? age : ''}`;
/** カードの年齢。0歳は有効、読めなかった −1 は不明 */
const knownAge = (age: number) => (Number.isInteger(age) && age >= 0 ? age : undefined);
/** カードの年齢と生年からゲーム内の年を推定する。どちらかが不明なら undefined */
export const inferredGameYear = (card: Pick<CardReading, 'age'>, patch: Pick<CardPatch, 'profile'>) => {
  const age = knownAge(card.age);
  return age !== undefined && patch.profile?.birthYear !== undefined ? patch.profile.birthYear + age : undefined;
};

/**
 * カードの読み取りを既存の所有馬（なければ新規）に重ねる。
 * 「-」の項目は既存の値を消さない。印・クラス・賞金・体重などは最新の観測で上書きする。
 */
export function applyCardReading(horse: OwnedHorse | undefined, card: CardReading, at: string, gameYear?: number): CardPatch {
  const race: RaceAbilities = { ...horse?.abilities?.race };
  for (const [from, to] of Object.entries(CARD_ABILITY_KEYS)) { const v = known(card.abilities?.[from]); if (v) race[to] = v; }
  for (const [from, to] of Object.entries(CARD_TRAIT_KEYS)) { const v = known(card.traits?.[from]); if (v) race[to] = v; }
  const distance = known(card.distance); if (distance) race.distance = distance;
  const foal = parseFoalName(card.name);
  const profile: NonNullable<OwnedHorse['profile']> = { ...horse?.profile };
  const set = <K extends keyof typeof profile>(key: K, value: (typeof profile)[K] | undefined) => { if (value !== undefined) profile[key] = value; };
  set('color', known(card.color)); set('rank', known(card.class)); set('stable', known(card.stable)); set('weight', known(card.weight));
  set('record', known(card.record)); set('earnings', parseManYen(card.earnings_total)); set('earningsCurrent', parseManYen(card.earnings_current));
  if (profile.birthYear === undefined && foal) profile.birthYear = foal.birthYear;
  const age = knownAge(card.age);
  if (profile.birthYear === undefined && age !== undefined && gameYear !== undefined) profile.birthYear = gameYear - age;
  const races = mergeRaces(profile.races, card.races);
  if (races.length) profile.races = races;
  const sex = card.sex === '牡' ? 'M' : card.sex === '牝' ? 'F' : horse?.sex ?? null;
  const category: HorseCategory = horse && horse.category !== '未分類' ? horse.category : '現役';
  const observation: Observation = { at, screen: card.screen_type || 'カード', ...(age !== undefined ? { age } : {}), source: 'photo' };
  return {
    name: known(card.name) ?? horse?.name ?? '', sex, category, profile,
    abilities: { ...horse?.abilities, race },
    observations: [...(horse?.observations ?? []), observation],
  };
}

/** 統合で変わる項目の一覧（表示用） */
export function cardPatchDiff(horse: OwnedHorse | undefined, patch: CardPatch): { label: string; before: string; after: string }[] {
  const out: { label: string; before: string; after: string }[] = [];
  const push = (label: string, before: unknown, after: unknown) => { const b = before === undefined || before === null ? '' : String(before), a = after === undefined || after === null ? '' : String(after); if (a !== b) out.push({ label, before: b || '未登録', after: a || '未登録' }); };
  push('馬名', horse?.name, patch.name);
  push('性別', horse?.sex === 'F' ? '牝' : horse?.sex === 'M' ? '牡' : '', patch.sex === 'F' ? '牝' : patch.sex === 'M' ? '牡' : '');
  if (horse) push('区分', horse.category, patch.category);
  const p = horse?.profile ?? {}, q = patch.profile ?? {};
  push('毛色', p.color, q.color); push('生年', p.birthYear, q.birthYear); push('クラス', p.rank, q.rank); push('所属', p.stable, q.stable); push('馬体重', p.weight, q.weight);
  push('戦績', p.record, q.record); push('収得賞金（万円）', p.earningsCurrent, q.earningsCurrent); push('総賞金（万円）', p.earnings, q.earnings);
  push('競走成績', (p.races ?? []).length ? `${p.races!.length}行` : '', (q.races ?? []).length ? `${q.races!.length}行` : '');
  const r = horse?.abilities?.race ?? {}, n = patch.abilities?.race ?? {};
  push('距離適性', r.distance, n.distance);
  for (const { key, label } of [...RACE_ABILITY_FIELDS, ...RACE_TRAIT_FIELDS]) push(label, r[key], n[key]);
  return out;
}

/** 4代内の延べ因子数。同じ祖先が複数の枠に現れる場合は枠ごとに数える。 */
export function pedigreeEffectCounts(nodes: string[], context: { ancestors: Map<string, AncestorInfo>; userAncestors: Map<string, AncestorInfo> }) {
  const counts: Record<string, number> = {};
  let unknown = 0;
  for (let n = 2; n < 32; n++) {
    const key = nodes[n];
    const name = nameOfKey(key ?? '');
    const info = key ? (name ? context.ancestors.get(name) : context.userAncestors.get(key)) : undefined;
    if (!info) { unknown++; continue; }
    for (const effect of new Set(info.effects)) counts[effect] = (counts[effect] ?? 0) + 1;
  }
  return { counts, unknown };
}

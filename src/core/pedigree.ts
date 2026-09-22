// 血統処理: マスターの馬・ユーザー馬を共通の HorseRecord に展開する。
import type { HorseKey, HorseRecord, MasterData, MasterHorse, UserHorse, Sex } from './types';
import { horseIdentities, type HorseIdentity } from './horse-identity';
import { horseUnlockConditions } from './master-horse';
import type { RuleOptions } from './rules';

export const UNKNOWN = '';
export const SYS_CHARS = 'abcdefghijklmno';

/** ノード番号から世代（1 = 父母）を求める */
export const gen = (node: number): number => 31 - Math.clz32(node);

/** 何も分かっていない馬（探索の枝刈りで将来の父を表す） */
export function unknownRecord(key = '?:unknown', name = '（未定）'): HorseRecord {
  return {
    key, name, sex: null, kind: 'planned', price: 0, smallSystem: null, smallSystemSource: '不明',
    omoshiro: '????', migoto: '????', nodes: Array(32).fill(UNKNOWN), labels: {}, isHomebred: true, missingSlots: 31, constraints: [],
  };
}

export function masterToRecord(h: MasterHorse, identities: Map<string, HorseIdentity>): HorseRecord {
  const nodes: string[] = Array(32).fill(UNKNOWN);
  const labels: Record<string, string> = {};
  nodes[1] = h.id;
  labels[nodes[1]] = h.name;
  let missing = 0;
  h.ancestors.forEach((n, i) => {
    if (!n) { missing++; return; }
    nodes[i + 2] = n;
    labels[n] = identities.get(n)?.name ?? '（未登録）';
  });
  return {
    key: h.id, name: h.name, sex: h.sex, kind: h.kind, price: h.kind === 'stallion' && !h.priceUnknown ? h.price : 0, priceUnknown: h.kind === 'stallion' && h.priceUnknown,
    smallSystem: h.smallSystem, smallSystemSource: h.smallSystem ? 'マスターデータ' : '不明',
    omoshiro: h.omoshiro ?? '????', migoto: h.migoto ?? '????',
    nodes, labels, isHomebred: false, missingSlots: missing,
    constraints: [
      ...horseUnlockConditions(h).map(c => `解禁条件: ${c}`),
      ...(h.priceUnknown ? [h.kind === 'stallion' ? '種付料は未確認（合計費用に含まれません）' : '購入価格は未確認'] : []),
      ...(h.purchasePrice ? [`購入が必要: ${h.purchasePrice.toLocaleString()}万`] : []),
    ],
  };
}

/**
 * 父母から産駒レコード（4代血統）を作る。
 * 面白用4枠は父・父母父・母父・母母父、見事用4枠は父父母父・父母母父・母父母父・母母母父に対応する。
 * 各枠の系統は父母の4文字コードから導出する。
 */
export function makeFoalRecord(
  sire: HorseRecord | null, dam: HorseRecord | null,
  self: { key: string; name: string; sex: Sex | null; kind: HorseRecord['kind']; smallSystemOverride?: string | null },
  rules: Pick<RuleOptions, 'homebredSmallSystem'>,
): HorseRecord {
  const s = sire ?? unknownRecord();
  const d = dam ?? unknownRecord();
  const nodes: string[] = Array(32).fill(UNKNOWN);
  nodes[1] = self.key;
  // 親ツリーのノード k（世代 g）は産駒ツリーの side*2^g + (k - 2^g) に対応する
  for (const [side, rec] of [[2, s], [3, d]] as const) {
    for (let k = 1; k < 16; k++) {
      const g = gen(k);
      nodes[side * (1 << g) + (k - (1 << g))] = rec.nodes[k];
    }
  }
  const labels = { ...s.labels, ...d.labels, [self.key]: self.name };
  let missing = 0;
  for (let n = 2; n < 32; n++) if (!nodes[n]) missing++;
  const so = s.omoshiro, dO = d.omoshiro;
  let smallSystem: string | null = null;
  let smallSystemSource: HorseRecord['smallSystemSource'] = '不明';
  if (self.smallSystemOverride) { smallSystem = self.smallSystemOverride; smallSystemSource = '手動指定'; }
  else if (rules.homebredSmallSystem === 'sire' && s.smallSystem) { smallSystem = s.smallSystem; smallSystemSource = '父から推定'; }
  return {
    key: self.key, name: self.name, sex: self.sex, kind: self.kind, price: 0,
    smallSystem, smallSystemSource,
    omoshiro: so[0] + so[2] + dO[0] + dO[2],
    migoto: so[1] + so[3] + dO[1] + dO[3],
    nodes, labels, isHomebred: true, missingSlots: missing, constraints: [],
  };
}

/** マスターの馬・ユーザー馬のキーから HorseRecord を解決する（結果はキャッシュ） */
export class HorseResolver {
  private masterById = new Map<string, MasterHorse>();
  private identities: Map<string, HorseIdentity>;
  private users = new Map<string, UserHorse>();
  private cache = new Map<string, HorseRecord | null>();
  private rules: RuleOptions;

  constructor(master: MasterData, userHorses: UserHorse[], rules: RuleOptions) {
    this.rules = rules;
    this.identities = horseIdentities(master);
    for (const h of [...master.stallions, ...master.broodmares]) {
      this.masterById.set(h.id, h);
    }
    for (const u of userHorses) this.users.set(u.id, u);
  }

  has(key: HorseKey): boolean { return this.masterById.has(key) || this.users.has(key); }
  user(key: HorseKey): UserHorse | undefined { return this.users.get(key); }
  master(key: HorseKey): MasterHorse | undefined { return this.masterById.get(key); }
  allUsers(): UserHorse[] { return [...this.users.values()]; }

  get(key: HorseKey, stack: Set<string> = new Set()): HorseRecord | null {
    if (!key) return null;
    if (this.cache.has(key)) return this.cache.get(key)!;
    let rec: HorseRecord | null = null;
    const m = this.masterById.get(key);
    if (m) rec = masterToRecord(m, this.identities);
    else {
      const u = this.users.get(key);
      if (u) {
        if (stack.has(key)) throw new Error('親子関係が循環しています: ' + u.name);
        stack.add(key);
        const sire = u.sireKey ? this.get(u.sireKey, stack) : null;
        const dam = u.damKey ? this.get(u.damKey, stack) : null;
        stack.delete(key);
        rec = makeFoalRecord(sire, dam, {
          key: u.id, name: u.name, sex: u.sex ?? (u.kind === 'planned' ? u.desiredSex : null) ?? null, kind: u.kind,
          smallSystemOverride: u.smallSystemOverride ?? null,
        }, this.rules);
      }
    }
    this.cache.set(key, rec);
    return rec;
  }

  /** 表示用: キーから名前 */
  label(key: HorseKey): string {
    const r = this.get(key);
    if (r) return r.name;
    return this.identities.get(key)?.name ?? (key ? '（未登録）' : '');
  }
}

/** 産駒の5代血統ノード配列（1 = 産駒, 2 = 父, 3 = 母, ..., 63） */
export function foalNodes(sire: HorseRecord, dam: HorseRecord): string[] {
  const nodes: string[] = Array(64).fill(UNKNOWN);
  for (const [side, rec] of [[2, sire], [3, dam]] as const) {
    for (let k = 1; k < 32; k++) {
      const g = gen(k);
      nodes[side * (1 << g) + (k - (1 << g))] = rec.nodes[k];
    }
  }
  return nodes;
}

/** ノードの側（2 = 父側, 3 = 母側） */
export const sideOf = (node: number): 2 | 3 => ((node >> (gen(node) - 1)) as 2 | 3);

/** ノードの位置を「父母父」のような表記にする */
export function nodePath(node: number): string {
  if (node <= 1) return '本馬';
  const g = gen(node);
  let s = '';
  for (let i = g - 1; i >= 0; i--) s += ((node >> i) & 1) ? '母' : '父';
  return s;
}

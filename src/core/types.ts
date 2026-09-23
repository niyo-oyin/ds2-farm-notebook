import type { HorseStory } from '../shared/horse-story';

// 共通の型定義
export type Sex = 'M' | 'F';

/** 種牡馬・繁殖牝馬のマスターレコード。 */
export interface MasterHorse {
  id: string;            // "st:1" / "bm:1"
  kind: 'stallion' | 'broodmare';
  name: string;
  sex: Sex;
  price: number;         // 1回の種付料（万円）。種付け権の購入額は含めない
  color: string | null;
  bigSystem: string | null;
  smallSystem: string | null;
  omoshiro: string | null; // 面白用4系統 (a-o)
  migoto: string | null;   // 見事用4系統 (a-o) 種牡馬のみ
  ancestors: string[];     // 祖先ID 30頭（空文字は不明）: 父,母,父父,父母,母父,母母,(3代8頭),(4代16頭)
  unlock?: string | null;        // 解禁条件（例: 皐月賞に勝利）
  breedingRightPrice?: number | null; // 種牡馬の種付け権購入額（万円）。未設定なら権利条件なし
  overseas?: boolean; // ゲーム内の海外種牡馬。産地とは区別する
  purchasePrice?: number | null; // 繁殖牝馬の購入価格（万）。null は初期から利用可
  /** 種付料（種牡馬）または購入価格（繁殖牝馬）が未確認。price は 0、purchasePrice は null のまま */
  priceUnknown?: boolean;
  attrs: Record<string, unknown>;
}

export interface AncestorInfo {
  id: string;
  name: string;
  /** 収録馬の血統表より先の世代も辿るための親ID。 */
  sireId?: string;
  damId?: string;
  system: number | null;   // 1..15
  sex: Sex | null;
  effects: string[];       // クロス効果名
  effectsKnown?: boolean; // false は因子未確認。true または省略時は確認済み
}

export interface MasterData {
  meta: {
    dataVersion: string; createdAt: string;
    bigSystems: string[]; crossEffects: string[];
  };
  stallions: MasterHorse[];
  broodmares: MasterHorse[];
  ancestors: AncestorInfo[];
  kotta: [string, string][]; // [父側の馬ID, 母側の馬ID]
  nicks: { sire: string; dam: string; level: number }[];
}

/** 計画馬の状態 */
export type OwnStatus = '繁殖入り予定' | '探索対象外';
export type HorseCategory = '繁殖牝馬' | '種牡馬' | '現役' | '引退' | '未分類';
export type AbilityRank = 'A' | 'B' | 'C';
export type DirtAptitude = '◎' | '○' | '△';
export type GrowthType = '持続' | '普通' | '早熟' | '晩成';
export interface BroodmareAbilities {
  speed?: number; stamina?: number; power?: number;
  health?: AbilityRank; temperament?: AbilityRank; dirt?: DirtAptitude;
}
export interface StallionAbilities {
  dirt?: DirtAptitude; growth?: GrowthType;
  temperament?: AbilityRank; guts?: AbilityRank; health?: AbilityRank; achievement?: AbilityRank; stability?: AbilityRank;
  distanceMin?: number; distanceMax?: number;
}
/** 現役馬のカードの印。「-」（未判明）はキーを持たない。 */
export type CardMark = '◎' | '○' | '△';
export type RaceAbilityKey = 'speed' | 'stamina' | 'power' | 'guts' | 'temperament' | 'turf' | 'dirt';
export type RaceTraitKey = 'growth' | 'start' | 'corner' | 'heavyTrack' | 'roughTrack' | 'fastTrack' | 'health' | 'legs' | 'concentration' | 'timid' | 'soundReaction' | 'reaction';
/** 現役馬のカードに表示された印・文字をそのまま記録する。評価尺度を推測して変換しない。 */
export type RaceAbilities = Partial<Record<RaceAbilityKey | RaceTraitKey | 'distance', string>>;
/** 競走成績の1行。レース条件は出走時の記録として保持する。 */
export interface RaceEntry {
  date: string; place: string; race: string; finish: string;
  grade?: string;
  surface?: '芝' | 'ダート';
  distance?: number;
  going?: '良' | '稍重' | '重' | '不良';
}
/** ゲーム画面からの読み取り履歴 */
export interface Observation { at: string; screen: string; age?: number; source: 'photo' | 'manual'; importJobId?: string }
/** 区分ごとの能力記録。未入力の項目はキーを持たない。区分を変えても他の記録は消さない。 */
export interface HorseAbilities {
  broodmare?: BroodmareAbilities;
  stallion?: StallionAbilities;
  race?: RaceAbilities;
}

interface UserHorseBase {
  id: string;
  name: string;
  sex: Sex | null;
  sireKey: string;
  damKey: string;
  smallSystemOverride?: string | null;
  abilities?: HorseAbilities;
  /** 本馬の因子。未選択なら undefined（未確認） */
  effects?: string[];
  memo?: string;
  createdAt: string;
  updatedAt: string;
}

/** 実際に登録した個体。計画馬から種類を書き換えて作らない。 */
export interface OwnedHorse extends UserHorseBase {
  kind: 'owned';
  /**
   * データの繁殖牝馬（実在馬）を所有している場合、その馬のキー（bm:…）。
   * 名前・性別・血統・系統・能力はデータの値を使い、配合・探索・計画でもこのキーで扱う。父母は持たない。
   */
  masterKey?: HorseKey;
  category: HorseCategory;
  excludeFromSearch?: boolean;
  profile?: {
    color?: string; birthYear?: number; wins?: string;
    /** 総賞金（万円） */ earnings?: number; /** 収得賞金（万円） */ earningsCurrent?: number;
    /** クラス表示（OP、1勝 など） */ rank?: string; stable?: string; weight?: string; /** 戦績（28戦6勝） */ record?: string;
    races?: RaceEntry[];
  };
  /** サーバに保存した馬の画像ID（/api/images/:id） */
  imageId?: string;
  observations?: Observation[];
  story?: HorseStory;
}

/** 仮想の産駒。実産駒とは別のID・別のコレクションで保持する。 */
export interface PlannedHorse extends UserHorseBase {
  kind: 'planned';
  status: OwnStatus;
  desiredSex?: Sex;
  role?: 'stallion' | 'broodmare';
  planId?: string;
  /** 対応する実個体のID。同じ所有馬を複数の計画馬に紐付けられる。 */
  realizedIds: string[];
  achieved?: { born: boolean; sexOk: boolean; bred: boolean };
}

/** 血統の計算だけは実個体と仮想の産駒を共通に扱う。 */
export type UserHorse = OwnedHorse | PlannedHorse;

/**
 * 馬を一意に参照するキー。
 * マスターの馬は "st:ID" / "bm:ID"、ユーザー馬は "u:..." / "p:..." を使う。
 * 血統表にだけ現れる祖先は "a:ID"。本馬としてのIDと祖先としてのIDは共通。
 */
export type HorseKey = string;

/** 判定に使う馬レコード（マスターの馬とユーザー馬を共通化） */
export interface HorseRecord {
  key: HorseKey;
  name: string;
  sex: Sex | null;
  kind: 'stallion' | 'broodmare' | 'owned' | 'planned';
  price: number;                 // 種付料（種牡馬）。自家製は 0
  priceUnknown?: boolean;
  smallSystem: string | null;
  smallSystemSource: 'マスターデータ' | '手動指定' | '父から推定' | '不明';
  omoshiro: string;              // 4文字。不明箇所は '?'
  migoto: string;                // 4文字。不明箇所は '?'
  /** 血統表のノードキー。index 1 = 自身, 2 = 父, 3 = 母, ... 31 まで（4代）。'' は不明 */
  nodes: string[];
  /** 表示名（ノードキー → 名前） */
  labels: Record<string, string>;
  isHomebred: boolean;
  missingSlots: number;
  /** 運用上の制約（解禁条件、購入が必要など）。候補からは外さず補足として表示する */
  constraints: string[];
}

export type Verdict = '成立' | '不成立' | '未確定' | '対象外';

export interface TheoryResult {
  verdict: Verdict;
  estimated?: boolean; // 前作由来の規則などからの推定
  reasons: string[];   // 判定根拠
  missing: string[];   // 不足している情報
}

export interface CrossInfo {
  key: string; name: string;
  sireGens: number[]; damGens: number[];
  effects: string[]; effectsKnown: boolean;
  sex: Sex | null;
  sireNodes: number[]; damNodes: number[];
}

export interface Judgement {
  rulesVersion: string;
  dataVersion: string;
  sire: HorseKey; dam: HorseKey;
  /** 産駒の血統表ノード（1 = 産駒, 2 = 父, 3 = 母, ..., 63 まで = 5代） */
  nodes: string[];
  labels: Record<string, string>;
  omoshiro: TheoryResult & { systems: string[]; count: number | null; unknownSlots: number };
  migoto: TheoryResult & { sireMigoto: string; damOmoshiro: string };
  perfect: TheoryResult;
  /** 完璧／凝った配合: 完璧な配合と凝った配合の同時成立（公式資料の上位複合配合） */
  perfectKotta: TheoryResult;
  kotta: TheoryResult & { pairs: [string, string][]; homebredInRange: string[]; estimatedPairs: [string, string][] };
  /** 父似・母似: アウトブリードなら両側4代内の因子候補 */
  inheritance: { mode: 'temperament' | 'outbreedEffect' | 'unknown'; sireEffects: string[]; damEffects: string[] };
  crosses: CrossInfo[];
  crossStatus: TheoryResult;        // 血統の完全性（クロス判定の信頼度）
  mareCrossCount: number;
  outbreed: TheoryResult;
  dangerous: TheoryResult & { causes: string[] };
  nicks: TheoryResult & { level: number; sireSmall: string | null; damSmall: string | null };
  nitroReference: { speed: number; stamina: number; power: number; unknownNames: string[] }; // 前作由来の参考値
  /** 判定に使った系統枠: ノード番号 → { role: 面白/見事, system: 大系統略号 or null } */
  slotSystems: Record<number, { role: '面白' | '見事'; system: string | null; side: '父' | '母' }>;
  costUnknown?: boolean;
  cost: number;
  hasUnknownSlots: boolean;
  unknownSlotCount: number;
  warnings: string[];
  constraints: string[];  // 父母の運用上の制約
}

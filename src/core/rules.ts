// 配合ルール台帳。成立条件と、その確認状態・出典を分けて記録する。
export type RuleStatus = '実機確認' | '公開資料' | '前作由来' | '推定' | '未確認';

export interface RuleEntry {
  id: string;
  title: string;
  condition: string;
  /** 公式資料に記された効果（能力への影響）。条件と分けて記録する */
  effect?: string;
  status: RuleStatus;
  /** 判定ルールの根拠。 */
  source: string;
  /** 画面に出す備考。根拠が弱い点や設定で切り替えられる点を書く */
  note?: string;
}

export interface RuleOptions {
  omoshiroThreshold: number;       // 面白い配合に必要な大系統の種類数
  migotoMode: 'set' | 'multiset';  // 見事な配合の一致判定（種類のみ / 個数も比較）
  migotoMinSystems: number;        // 見事な配合で一致する大系統に必要な種類数（0 で不問）
  kottaGenerations: number;        // 産駒から数えた対象世代（父母 = 1、父母の曾祖父母 = 4）
  dangerousCrossCount: number;     // この本数以上のクロスで危険な配合
  homebredSmallSystem: 'sire' | 'unknown'; // 自家製馬の小系統を父から推定するか
  kottaEstimateHomebred: boolean;  // 自家製馬が関わる凝ったペアを前作ルール（3代以内に効果ありクロス3本）で推定する
  nitroGenerations: number;        // ニトロ参考値の参照世代
}

export const DEFAULT_RULES: RuleOptions = Object.freeze({
  omoshiroThreshold: 7,
  migotoMode: 'set',
  migotoMinSystems: 0,
  kottaGenerations: 4,
  dangerousCrossCount: 7,
  homebredSmallSystem: 'sire',
  kottaEstimateHomebred: true,
  nitroGenerations: 5,
});

export const RULES_VERSION = 'ds2-rules-2026-09-24-r1';

/**
 * 出典の略記。
 * 公式資料: 本作の公式配布資料（配合理論の解説、能力・適性の解説）。理論の存在・効果・新要素の根拠
 * 公知: 前作（Switch 版）やシリーズ各作について複数の攻略サイト等で公開されている仕様。成立条件の根拠
 */
const OFFICIAL = '公式配布資料（配合理論の解説）';
const PUBLIC = '公知';
const SAME_AS_PREV = '公式配布資料の補足に「成立条件は従来作品と同様」とあるため、条件は前作の公知仕様を採用。';

export const RULE_LEDGER: RuleEntry[] = [
  {
    id: 'omoshiro', title: '面白い配合',
    condition: '父側の4頭（父・父母父・母父・母母父）と母側の同じ4頭、計8頭の大系統に7種類以上の違いがある。',
    effect: 'スピード・スタミナ・パワーに効果。根性が低い馬が生まれにくくなる。',
    status: '公開資料',
    source: `${OFFICIAL}、${PUBLIC}`,
    note: `${SAME_AS_PREV} `,
  },
  {
    id: 'migoto', title: '見事な配合',
    condition: '父側の4頭（父父母父・父母母父・母父母父・母母母父）の大系統の種類が、母側の4頭（父・父母父・母父・母母父）の大系統の種類と一致する。',
    effect: 'スピード・スタミナ・パワーに効果。発生しているクロスの効果を高め、クロスのデメリット（虚弱・気性難など）を打ち消す。',
    status: '公開資料',
    source: `${OFFICIAL}、${PUBLIC}`,
    note: `${SAME_AS_PREV} 公知の情報には「一致する系統が3種類以上」を条件に加えるものと加えないものがある。既定では種類数を問わず、設定（migotoMinSystems）で下限を指定できる。同じ系統が複数含まれる場合の個数比較も未確認（設定 migotoMode）。`,
  },
  {
    id: 'perfect', title: '完璧な配合',
    condition: '面白い配合と見事な配合が同時に成立する。',
    effect: '面白い配合と見事な配合の効果を併せ持つ上位の複合配合。',
    status: '公開資料',
    source: `${OFFICIAL}、${PUBLIC}`,
  },
  {
    id: 'kotta', title: '凝った配合',
    condition: '父馬・母馬それぞれの4代血統（本馬を1代目とする）に、似た血統構成を持つ牡馬のペアがある。その2頭を起点に、さらに3代前までの血統を比較し、父側に効果のあるクロスが3本以上発生すること。実際の父馬と母馬の配合が危険な配合でないこと。',
    effect: '繁殖牝馬のスピード・スタミナ・パワーをより強く引き出す。',
    status: '公開資料',
    source: `${OFFICIAL}、${PUBLIC}`,
    note: `${SAME_AS_PREV} 比較する2頭からは、それぞれの父を1代前として3代前まで辿るため、画面の4代血統より先の情報も必要になる。同じ馬が父側・母側にいる場合も比較する。同じ父系で連続するクロスは1本、別の枝のクロスは別々に数える。父側の本数で判定するため、ペアの方向を区別する。`,
  },
  {
    id: 'perfectKotta', title: '完璧／凝った配合',
    condition: '完璧な配合と凝った配合が同時に成立する。',
    effect: '完璧な配合に凝った配合を重ねた、最上位の複合配合。',
    status: '公開資料', source: OFFICIAL,
  },
  {
    id: 'cross', title: 'クロス（インブリード）',
    condition: '産駒から5代以内の父側と母側に同じ祖先がいる。',
    effect: '血に秘められた能力（祖先の因子）を引き出す。血が濃くなりすぎると体質・脚元・気性に悪影響。',
    status: '公開資料',
    source: `${OFFICIAL}（5代前まで）、${PUBLIC}`,
    note: '祖先のクロスに伴って現れる組（例: サンデーサイレンスのクロスに伴う Halo）は本数に数えない。この数え方は本ツールの推定。効果は祖先マスターに登録がある馬のみ表示。',
  },
  {
    id: 'mareCross', title: '牝馬クロス',
    condition: '共通祖先が牝馬であるクロス。祖先マスターの性別で判定する。',
    effect: '本作では牝馬のクロスも有効（前作は種牡馬のクロスのみ）。自家製馬を重ねて世代を進める配合（代重ね）や、自家製種牡馬・牝馬の作成の幅が広がる。',
    status: '公開資料', source: OFFICIAL,
    note: 'クロスの判定・効果は性別に関わらず同じ扱い。牝馬クロスの本数を別に表示する。',
  },
  {
    id: 'outbreed', title: 'アウトブリード',
    condition: '5代以内にクロスが1本もない。',
    effect: 'インブリードのデメリットを避け、体質・脚元・気性・反応・集中力・音反応・こわがりに好影響。',
    status: '公開資料', source: `${OFFICIAL}、${PUBLIC}`,
  },
  {
    id: 'inheritance', title: '父似・母似',
    condition: '産駒は父似か母似のどちらかになる。アウトブリードでも、似た側の血統内の因子が発動することがある。',
    status: '推定', source: '公知（アウトブリード時の「サイアーエフェクト」として複数の攻略サイトに記載）',
    note: '公式資料に記載なし。発動する因子の範囲（本ツールは似た側の4代以内を候補として表示）は公知の情報で確認できず推定。産駒の能力決定ロジックは本作で刷新されたと公式資料にある。',
  },
  {
    id: 'dangerous', title: '危険な配合',
    condition: '父か母自身が相手側の血統にいる（1×N）、または祖父母同士が同じ（2×2）など、血量50%以上の近い近親。本ツールはこれに加えてクロス本数の上限（既定7本）を設ける。',
    effect: '体質・脚元・気性への悪影響。公式資料はクロスのデメリットとして記載。',
    status: '前作由来',
    source: `${PUBLIC}、ニコニコ大百科「危険な配合」 https://dic.nicovideo.jp/a/%E5%8D%B1%E9%99%BA%E3%81%AA%E9%85%8D%E5%90%88`,
    note: '公式資料に「危険な配合」の語はない。クロス本数による条件は公知の情報で確認できず、本ツールの設定（dangerousCrossCount）として置く。',
  },
  {
    id: 'nicks', title: 'ニックス',
    condition: '父の小系統と母の小系統の組み合わせが相性表にある。段階1〜3（ゲーム内の★〜★★★に対応）。',
    effect: '体質や気性に好影響。スピードやスタミナにも一定の効果。',
    status: '公開資料',
    source: `${OFFICIAL}（存在・効果・3段階表示）`,
    note: '自家製馬の小系統は父から推定する（設定で無効化可）。',
  },
  {
    id: 'nitro', title: 'ニトロ（七光り理論）',
    condition: '5代以内にいる、スピード系（速力・短距離）とスタミナ系（長距離・底力）の因子を持つ祖先の種類数を数え、能力の上限の目安にする。同じ祖先が複数回現れても1回と数える。',
    status: '前作由来',
    source: 'ダビスタ97以降のシリーズで知られる理論',
    note: '作品ごとに数え方や対象の因子が異なり、本作での有無は公式資料に記載がない。参考値としてのみ表示し、探索の目標には使わない。',
  },
];

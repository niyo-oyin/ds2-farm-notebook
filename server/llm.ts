// 写真読み取り: OpenAI 互換 Chat Completions に画像を渡し、JSON Schema で構造化した結果を受け取る。
// 画面の種類を判別してから、種類ごとのプロンプトで読み取る。
// 読み取り対象の項目を絞り、異なる画面の項目が混ざるのを防ぐ。
import { z } from 'zod';
import type { RaceEntry } from '../src/core/types.js';
import { CARD_ABILITY_KEYS as ABILITY_KEYS, CARD_TRAIT_KEYS as TRAIT_KEYS, DIRT_APTITUDES, mergeRaces, RACE_ABILITY_FIELDS, RACE_TRAIT_FIELDS } from '../src/core/owned-horse.js';

import { LLM, llmReady, chatCompletion, extractJson } from './llm-client.js';
export { LLM, llmReady };

export const SCREEN_TYPES = ['育成馬', '入厩馬', '血統', '種牡馬', '繁殖牝馬', '種付け'] as const;
export type ScreenType = (typeof SCREEN_TYPES)[number];
export const isScreenType = (v: unknown): v is ScreenType => SCREEN_TYPES.includes(v as ScreenType);

const READ_TASK = '競走馬育成ゲーム『ダービースタリオン2』の画面から、表示されている文字と印を正確に書き写してください。';
const COPY_RULES = '表示されている通りに写します。「-」は "-" のまま、印や文字は項目ごとの選択肢に従ってそのまま。見えない・隠れている項目は推測せず、notes に書きます。';
const OUTPUT_RULE = '出力は次の JSON Schema に従う JSON だけを返してください（説明文やコードフェンスは不要）。';

/** 画面の種類ごとの見分け方。判別と書き写しの両方のプロンプトで使う */
const TYPE_DESC: Record<ScreenType, string> = {
  育成馬: '左上の見出しが「育成馬」。左上に馬の基本情報パネル（馬名、性別と年齢、毛色、距離適性、7つの能力欄、12の特性欄）、下に競走成績表',
  入厩馬: '左上の見出しが「入厩馬」。育成馬と同じ構成で、見出し行に所属厩舎、戦績・賞金の欄がある',
  血統: '血統・クロスの画面。馬名は写らない。左に「父」「母」のラベル付きの馬名、その上下に祖父母、右へ3代の祖先が並び、馬名の右に因子のチップ（1文字の略号）が付く。下部にクロスの一覧（馬名、n×m、%）',
  種牡馬: '種牡馬の画面。馬名、性別、毛色、父・母・母父、大系統（略号）、小系統、種付料、ニックス、配合理論、繁殖能力（距離適性、成長、ダート、体質、気性、実績、底力、安定）、産駒・勝利・重賞・GI の数、右に代表産駒の表',
  繁殖牝馬: '左上の見出しが「繁殖牝馬」。馬名、性別と年齢、毛色、父・母・母父、大系統（略号）、小系統、販売価格',
  種付け: '種牡馬が複数並ぶ一覧（表形式も含む）。種付け画面では、上部にソートのタブ（種付料／配合理論／ニックス／馬名）、左に種牡馬のカードが3列の格子に並び（馬名、馬の絵、左下の帯に配合理論、種付料、右上にニックスの★）、右に選択中の種牡馬の絵と詳細（大系統、小系統、毛色、距離適性、繁殖能力）',
};

// ---- スキーマ（zod は受信結果の検証、JSON Schema は API への指示） ----
const CARD_ABILITY_KEYS = Object.keys(ABILITY_KEYS);
const CARD_TRAIT_KEYS = Object.keys(TRAIT_KEYS);
const fieldMarks = Object.fromEntries([...RACE_ABILITY_FIELDS, ...RACE_TRAIT_FIELDS].map(({ key, marks }) => [key, marks]));
const markValues = (key: string): readonly [string, ...string[]] => ['-', '', ...fieldMarks[ABILITY_KEYS[key] ?? TRAIT_KEYS[key]]];
const markSchema = (key: string) => z.enum(markValues(key));
const marks = <K extends string>(keys: readonly K[]) => z.object(Object.fromEntries(keys.map((k) => [k, markSchema(k)])) as Record<K, ReturnType<typeof markSchema>>);
const RaceReadingSchema = z.object({
  date: z.string().describe('月.週。例8.5'), place: z.string().describe('場所・競馬場'), race: z.string().describe('レース名'), finish: z.string().describe('着順。中止・取消・除外もそのまま。見えなければ空'),
  grade: z.string().describe('クラス。GⅢ・OP・新馬など'),
  surface: z.enum(['芝', 'ダート']).nullable().describe('コースの芝/ダ。ダはダート'),
  distance: z.number().int().positive().nullable().describe('コースの距離（m）。芝1400なら1400'),
  going: z.enum(['良', '稍重', '重', '不良']).nullable().describe('馬場。稍は稍重、不は不良'),
  runners: z.number().int().positive().nullable().describe('頭数'),
  popularity: z.number().int().positive().nullable().describe('人気の順位'),
  jockey: z.string().describe('騎手。先頭3文字で切れていても、ここには見えた文字だけを写す'),
  jockey_candidates: z.array(z.string()).describe('騎手欄が先頭3文字で切れている場合の補完候補。実在する騎手の既知の表記で、表示文字から始まる名前を挙げる。外国人は姓、日本人は姓名を補完し、表示にないイニシャルを先頭に足さない。複数考えられるならすべて挙げる。未省略・不明なら空配列'),
  carriedWeight: z.number().positive().nullable().describe('負担重量（kg）'),
  bodyWeight: z.number().int().positive().nullable().describe('そのレース時の馬体重（kg）。上部の現在の馬体重とは異なる'),
  strategy: z.enum(['逃', '先', '差', '追']).nullable().describe('作戦'),
});
const RACE_JSON_SCHEMA = z.toJSONSchema(RaceReadingSchema);
const normalizeJockeyName = (name: string) => name.normalize('NFKC').replace(/\s/g, '');
const parsedRace = RaceReadingSchema.transform(({ date, place, race, finish, jockey, jockey_candidates, ...details }) => {
  const displayed = normalizeJockeyName(jockey);
  const candidates = [...new Set(jockey_candidates.map(normalizeJockeyName).filter(Boolean))];
  const completed = [...displayed].length === 3 && candidates.length === 1 && candidates[0].startsWith(displayed)
    ? candidates[0] : jockey;
  return {
    date, place, race, finish,
    ...Object.fromEntries(Object.entries({ ...details, jockey: completed }).filter(([, v]) => v !== null && v !== '')) as Partial<Omit<RaceEntry, 'date' | 'place' | 'race' | 'finish'>>,
  };
});
const CardSchema = z.object({
  name: z.string(), class: z.string(), sex: z.enum(['牡', '牝', 'せん', '不明']), age: z.number(), color: z.string(),
  distance: z.string(), weight: z.string(), stable: z.string(),
  abilities: marks(CARD_ABILITY_KEYS), traits: marks(CARD_TRAIT_KEYS),
  record: z.string(), earnings_current: z.string(), earnings_total: z.string(),
  races: z.array(parsedRace),
  notes: z.string(),
});
const EFFECT_NAMES = ['短距離', '速力', 'パワー', '底力', '長距離', 'ダート', '丈夫さ', '早熟型', '晩成型', '堅実さ', '気性難'] as const;
const PedigreeSchema = z.object({
  sire: z.string(), dam: z.string(), sire_sire: z.string(), sire_dam: z.string(), dam_sire: z.string(), dam_dam: z.string(),
  crosses: z.array(z.object({ name: z.string(), generations: z.string(), percent: z.string() })),
  ancestors: z.array(z.object({ name: z.string(), factors: z.array(z.enum(EFFECT_NAMES)) })),
  notes: z.string(),
});
const MasterSchema = z.object({
  name: z.string(), sex: z.enum(['牡', '牝', '不明']), age: z.number(), color: z.string(),
  sire: z.string(), dam: z.string(), dam_sire: z.string(), big_system: z.string(), small_system: z.string(),
  fee: z.string(), price: z.string(), distance: z.string(), growth: z.string(), dirt: z.enum([...DIRT_APTITUDES, '-', '']),
  kenko: z.string(), kisyo: z.string(), jisseki: z.string(), konjo: z.string(), antei: z.string(),
  offspring: z.string(), wins: z.string(), graded: z.string(), g1: z.string(),
  notes: z.string(),
});
// 読み取りメモ（notes）は種類によらず結果の最上位に置く
const BreedingSchema = z.object({
  sort: z.enum(['種付料', '配合理論', 'ニックス', '馬名', '不明']),
  selected_name: z.string(), selected_small_system: z.string(),
  cards: z.array(z.object({ name: z.string(), theory: z.string(), fee: z.string(), stars: z.number().int().min(0).max(3).nullable(), abilities: MasterSchema.pick({ distance: true, growth: true, dirt: true, kenko: true, kisyo: true, jisseki: true, konjo: true, antei: true }).nullable() })),
  notes: z.string(),
});
export type BreedingReading = Omit<z.infer<typeof BreedingSchema>, 'notes'>;
export type CardReading = Omit<z.infer<typeof CardSchema>, 'notes'>;
export type PedigreeReading = Omit<z.infer<typeof PedigreeSchema>, 'notes'>;
export type MasterReading = Omit<z.infer<typeof MasterSchema>, 'notes'>;

const NOTES = { type: 'string', description: '読み取りで迷った点、隠れて読めなかった項目' };
const markProps = (keys: readonly string[]) => ({
  type: 'object', additionalProperties: false,
  properties: Object.fromEntries(keys.map((k) => [k, {
    type: 'string', enum: markValues(k),
    description: k === 'growth' ? '成長型。未判明は "-"、読めなければ空' : k === 'corner' ? 'コーナーの適性。両○・右○・左○を文字ごと写す。未判明は "-"、読めなければ空' : '項目の選択肢に従って印を写す。基本能力欄のピンク色の最上位印は◉、赤の二重丸は◎、青の丸は○。表示が「-」なら "-"、読めなければ空',
  }])), required: [...keys],
});
const CARD_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    name: { type: 'string', description: '馬名欄の文字。未命名なら「〇〇の27」のような仮名をそのまま' },
    class: { type: 'string', description: '馬名横のクラス表示（OP、1勝 など）。なければ空' },
    sex: { type: 'string', enum: ['牡', '牝', 'せん', '不明'] },
    age: { type: 'integer', description: '性別の横の数字（0歳もあり得る）。読めなければ -1' },
    color: { type: 'string', description: '毛色（芦毛、鹿毛 など）' },
    distance: { type: 'string', description: '距離適性欄の文字。例 "2000-2400m"。"-" なら "-"' },
    weight: { type: 'string', description: '馬体重欄の文字（例 "444kg (+6kg)"）。なければ空' },
    stable: { type: 'string', description: '見出し行の所属（例 "美浦 / 勝田厩舎"）。なければ空' },
    abilities: markProps(CARD_ABILITY_KEYS),
    traits: { ...markProps(CARD_TRAIT_KEYS), description: '下段12項目。印の前に「両」「右」「左」などの文字があればそのまま含める（例 "両○"）' },
    record: { type: 'string', description: '戦績欄（例 "28戦6勝"）。なければ空' },
    earnings_current: { type: 'string', description: '収得賞金欄の文字。なければ空' },
    earnings_total: { type: 'string', description: '総賞金欄の文字。なければ空' },
    races: {
      type: 'array', description: '実際に出走したレースの行だけ。出走予定、誕生、購入、入厩、放牧などの履歴は含めない。隠れた数値はnull、文字は空文字',
      items: RACE_JSON_SCHEMA,
    },
    notes: NOTES,
  },
  required: ['name', 'class', 'sex', 'age', 'color', 'distance', 'weight', 'stable', 'abilities', 'traits', 'record', 'earnings_current', 'earnings_total', 'races', 'notes'],
};
const PEDIGREE_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    sire: { type: 'string', description: '「父」ラベルの付いた馬名' }, dam: { type: 'string', description: '「母」ラベルの付いた馬名' },
    sire_sire: { type: 'string', description: '父の父（父の枠の上に隣接する馬名）' }, sire_dam: { type: 'string', description: '父の母' },
    dam_sire: { type: 'string', description: '母の父' }, dam_dam: { type: 'string', description: '母の母' },
    crosses: { type: 'array', description: '下部のクロス一覧。見えている行だけ', items: { type: 'object', additionalProperties: false,
      properties: { name: { type: 'string' }, generations: { type: 'string', description: '例 "3×4"' }, percent: { type: 'string', description: '例 "18.75%"' } }, required: ['name', 'generations', 'percent'] } },
    ancestors: { type: 'array', description: '血統表に写る祖先（父・母を含む全員、最大14頭）と、その馬名の右に付く因子のチップ。チップは1文字の略号で、短=短距離、速=速力、パ=パワー、底=底力、長=長距離、ダ=ダート、丈=丈夫さ、早=早熟型、晩=晩成型、堅=堅実さ、気=気性難。チップがなければ空配列', items: { type: 'object', additionalProperties: false,
      properties: { name: { type: 'string' }, factors: { type: 'array', items: { type: 'string', enum: [...EFFECT_NAMES] } } }, required: ['name', 'factors'] } },
    notes: NOTES,
  },
  required: ['sire', 'dam', 'sire_sire', 'sire_dam', 'dam_sire', 'dam_dam', 'crosses', 'ancestors', 'notes'],
};
const MASTER_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    name: { type: 'string', description: '馬名' }, sex: { type: 'string', enum: ['牡', '牝', '不明'] },
    age: { type: 'integer', description: '性別の横の数字（牝8 なら 8）。なければ -1' }, color: { type: 'string', description: '毛色' },
    sire: { type: 'string', description: '父' }, dam: { type: 'string', description: '母' }, dam_sire: { type: 'string', description: '母父' },
    big_system: { type: 'string', description: '大系統の略号（例 Ns、Na、Ro）' }, small_system: { type: 'string', description: '小系統（例 プリンスリーギフト）' },
    fee: { type: 'string', description: '種付料欄の文字（例 "無料"、"500万円"）。なければ空' },
    price: { type: 'string', description: '販売価格欄の文字（例 "3億7000万円"）。なければ空' },
    distance: { type: 'string', description: '距離適性（例 "1800-2000m"）。なければ空' },
    growth: { type: 'string', description: '成長（早熟・普通・持続・晩成）。なければ空' }, dirt: { type: 'string', enum: [...DIRT_APTITUDES, '-', ''], description: 'ダートの印（◎ ○ △）。なければ空' },
    kenko: { type: 'string', description: '体質（A/B/C）。なければ空' }, kisyo: { type: 'string', description: '気性（A/B/C）。なければ空' }, jisseki: { type: 'string', description: '実績（A/B/C）。なければ空' },
    konjo: { type: 'string', description: '底力（A/B/C）。なければ空' }, antei: { type: 'string', description: '安定（A/B/C）。なければ空' },
    offspring: { type: 'string', description: '産駒欄（例 "0頭"）。なければ空' }, wins: { type: 'string', description: '勝利欄（例 "0勝"）。なければ空' }, graded: { type: 'string', description: '重賞欄。なければ空' }, g1: { type: 'string', description: 'GI欄。なければ空' },
    notes: NOTES,
  },
  required: ['name', 'sex', 'age', 'color', 'sire', 'dam', 'dam_sire', 'big_system', 'small_system', 'fee', 'price', 'distance', 'growth', 'dirt', 'kenko', 'kisyo', 'jisseki', 'konjo', 'antei', 'offspring', 'wins', 'graded', 'g1', 'notes'],
};

const BREEDING_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    sort: { type: 'string', enum: ['種付料', '配合理論', 'ニックス', '馬名', '不明'], description: '上部のタブで選択中（強調表示）のソート。読めなければ「不明」' },
    selected_name: { type: 'string', description: '右側の詳細パネルの馬名。なければ空' },
    selected_small_system: { type: 'string', description: '右側の詳細パネルの小系統。なければ空' },
    cards: {
      type: 'array', description: '一覧の各馬。表は上から下へ、カードは左上から右へ順に。端で切れていても馬名が読めれば含める。詳細パネルの馬が一覧に見えない場合も1件追加する',
      items: { type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string', description: '行またはカードの馬名' },
          theory: { type: 'string', description: '配合理論の列、またはカード左下の帯の文字（例 「面白い」「凝った」「面白/凝」）。見えなければ空' },
          fee: { type: 'string', description: '種付料の列、またはカードの種付料（例 "20万円"）。見えなければ空' },
          stars: { type: ['integer', 'null'], minimum: 0, maximum: 3, description: 'ニックス列またはカード右上の★の数（0〜3）。欄が見えていて★がない場合は0。欄が隠れている・ない場合はnull' },
          abilities: { anyOf: [{
            type: 'object', additionalProperties: false,
            properties: Object.fromEntries(['distance', 'growth', 'dirt', 'kenko', 'kisyo', 'jisseki', 'konjo', 'antei'].map((key) => [key, MASTER_JSON_SCHEMA.properties[key as keyof typeof MASTER_JSON_SCHEMA.properties]])),
            required: ['distance', 'growth', 'dirt', 'kenko', 'kisyo', 'jisseki', 'konjo', 'antei'],
          }, { type: 'null' }], description: 'この馬の能力。表なら同じ行、カード型なら選択中の馬だけ右側の詳細から読む。能力欄がない馬はnull。部分的に読めない項目は空文字' },
        },
        required: ['name', 'theory', 'fee', 'stars', 'abilities'] },
    },
    notes: NOTES,
  },
  required: ['sort', 'selected_name', 'selected_small_system', 'cards', 'notes'],
};

// ---- API 呼び出し ----
async function ask<T>(image: string, mediaType: string, system: string, question: string, schema: { name: string; schema: unknown }, parser: z.ZodType<T>): Promise<{ result: T; model?: string; usage?: unknown }> {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mediaType};base64,${image}` } }, { type: 'text', text: question }] },
  ];
  const { text, usage, model } = await chatCompletion(messages, schema);
  const parsed = parser.safeParse(extractJson(text));
  if (!parsed.success) throw new Error('読み取り結果の形式が不正です: ' + parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; '));
  return { result: parsed.data, model, usage };
}

// ---- 第1段階: 画面の種類の判別 ----
export interface Classification { screen_type: ScreenType | 'その他'; reason: string }

/** 画面の種類を scope の中から判別する。どれでもなければ「その他」と、その理由 */
export async function classifyScreen(image: string, mediaType: string, scope: readonly ScreenType[]): Promise<{ result: Classification; model?: string; usage?: unknown }> {
  const options = [...scope, 'その他'];
  const schema = {
    type: 'object', additionalProperties: false,
    properties: {
      screen_type: { type: 'string', enum: options, description: '画面の種類。候補のどれにも当てはまらなければ「その他」' },
      reason: { type: 'string', description: 'そう判断した根拠（見出しや配置）。1〜2文' },
    },
    required: ['screen_type', 'reason'],
  };
  const system = [
    '競走馬育成ゲーム『ダービースタリオン2』の画面を、見出しと配置から分類してください。',
    '候補は次の通りです。見出しと配置で見分け、内容の書き写しはしません。',
    ...scope.map((t) => `- ${t}: ${TYPE_DESC[t]}`),
    '- その他: 上のどれにも当てはまらない画面（メニュー、レース、別の一覧など）',
    OUTPUT_RULE, JSON.stringify(schema),
  ].join('\n');
  return ask(image, mediaType, system, 'この画面はどの種類ですか。', { name: 'ds2_screen_type', schema }, z.object({ screen_type: z.enum(options as [string, ...string[]]), reason: z.string() }) as z.ZodType<Classification>);
}

// ---- 第2段階: 種類ごとの書き写し ----
export type ScreenReading =
  | { screen_type: '育成馬' | '入厩馬'; card: CardReading; notes: string }
  | { screen_type: '血統'; pedigree: PedigreeReading; notes: string }
  | { screen_type: '種牡馬' | '繁殖牝馬'; master: MasterReading; notes: string }
  | { screen_type: '種付け'; breeding: BreedingReading; notes: string }
  | { screen_type: 'その他'; notes: string };

const READ_QUESTION = 'この画面の内容を JSON で書き写してください。';
const readSystem = (type: ScreenType, extra: string[], schema: unknown) => [READ_TASK, `画面は「${type}」です。${TYPE_DESC[type]}。`, ...extra, COPY_RULES, OUTPUT_RULE, JSON.stringify(schema)].join('\n');

/** 判別済みの種類として画面を書き写す */
export async function readScreenAs(type: ScreenType, image: string, mediaType: string): Promise<{ result: ScreenReading; model?: string; usage?: unknown }> {
  if (type === '育成馬' || type === '入厩馬') {
    const system = readSystem(type, ['スピード・スタミナ・パワー・根性は○＜◎＜◉（ピンク色の最上位印）、気性・芝は△＜○＜◎、ダートは×＜△＜○＜◎＜◉です。重馬場・荒れ馬場・高速馬場・体質・脚元では×も受け付けます。その他の評価印で表す特性は△・○・◎です。成長型・コーナーの文字もそのまま写し、未判明の「-」と評価の「×」を区別してください。', '騎手欄は先頭3文字で切れることがあります。jockeyには表示を写し、jockey_candidatesに実在騎手の名前の補完候補を別途挙げてください。これは騎手名だけの補完です。候補が曖昧なら複数挙げ、不明なら空配列とし、レースや勝敗から特定しないでください。', '競走成績の列は左から月.週、場所、レース名、クラス、コース、馬場、頭数、人気、着順、騎手、負担重量、馬体重、作戦です。見出しを優先し、見える結果行だけを上から順に写してください。出走予定の行は含めません。父母名と「誕生」が並ぶ行や、セール購入・入厩・放牧などの履歴行はレースではないのでracesに含めません。隠れた数値はnull、文字は空文字にし、上部の馬体重を各レースに転記しないでください。'], CARD_JSON_SCHEMA);
    const { result: { notes, ...card }, ...r } = await ask(image, mediaType, system, READ_QUESTION, { name: 'ds2_card', schema: CARD_JSON_SCHEMA }, CardSchema);
    return { ...r, result: { screen_type: type, card: { ...card, races: mergeRaces([], card.races) }, notes } };
  }
  if (type === '血統') {
    const system = readSystem(type, ['写っている祖先全員の名前と因子を ancestors に列挙します（チップのない馬は factors を空に）。', '父・母・祖父母4頭は、ラベルと枠の位置で特定します。'], PEDIGREE_JSON_SCHEMA);
    const { result: { notes, ...pedigree }, ...r } = await ask(image, mediaType, system, READ_QUESTION, { name: 'ds2_pedigree', schema: PEDIGREE_JSON_SCHEMA }, PedigreeSchema);
    return { ...r, result: { screen_type: type, pedigree, notes } };
  }
  if (type === '種付け') {
    const system = readSystem(type, [
      '表形式の列は左から「馬名、種付料、配合理論、ニックス、大系統／小系統、距離、成長、ダ、体、気、実、底、安」です。見出しが読める場合はその対応を優先します。',
      '「ダ・体・気・実・底・安」は「ダート(dirt)・体質(kenko)・気性(kisyo)・実績(jisseki)・底力(konjo)・安定(antei)」です。各馬の同じ行から写し、上下の行や列をずらさないでください。',
      'カード型の左下の帯は配合理論です。右側の詳細パネルの能力は、選択中の馬と同名の1件だけに入れてください。他のカードの能力はnullです。',
      'ニックスは★の個数（1〜3）です。欄が見えていて★がない場合は0、隠れている・欄がない場合はnullにします。',
      '端で切れている行やカードは読めた項目だけを書き、能力を別の馬から補わないでください。',
    ], BREEDING_JSON_SCHEMA);
    const { result: { notes, ...breeding }, ...r } = await ask(image, mediaType, system, READ_QUESTION, { name: 'ds2_breeding', schema: BREEDING_JSON_SCHEMA }, BreedingSchema);
    return { ...r, result: { screen_type: type, breeding, notes } };
  }
  const extra = type === '種牡馬'
    ? ['種付料と繁殖能力8項目、産駒成績の4つの数を写します。販売価格の欄はないので price は空にします。']
    : ['販売価格を写します。種付料・繁殖能力・産駒成績の欄はないので、それらは空にします。'];
  const system = readSystem(type, extra, MASTER_JSON_SCHEMA);
  const { result: { notes, ...master }, ...r } = await ask(image, mediaType, system, READ_QUESTION, { name: 'ds2_master', schema: MASTER_JSON_SCHEMA }, MasterSchema);
  return { ...r, result: { screen_type: type, master, notes } };
}

import { useState } from 'react';
import { RULE_LEDGER } from '../core/rules';
import { Tip } from './Tip';
import './RulesPage.css';

type GuideEntry = readonly [label: string, description: string];

const STALLION_STATS: GuideEntry[] = [
  ['距離適性', '産駒が得意としやすい距離の目安。狙うレースの距離に合わせて選ぶ。'],
  ['成長', '産駒に想定される成長タイプ。能力のピークや衰えの時期に関係する。'],
  ['ダート', '産駒のダートへの向きやすさ。評価が高いほどダート路線を狙いやすい。'],
  ['体質', '丈夫な産駒の生まれやすさ。Aほど健康で、脚元も強い産駒を期待しやすい。'],
  ['気性', '落ち着きがあり、扱いやすい産駒の生まれやすさ。Aほど良い評価。'],
  ['実績', '産駒全体の成績への期待度。Aほど結果を期待しやすい。'],
  ['底力', '勝負根性のある産駒の生まれやすさ。Aほど競り合いに強い産駒を期待しやすい。'],
  ['安定', '父の能力を産駒に伝える安定性。Aはばらつきが小さく、Cは大きい。Cは必ず弱い産駒になるという意味ではない。'],
];

const BASIC_ABILITIES: GuideEntry[] = [
  ['スピード', '走る速さに関わる能力。'],
  ['スタミナ', 'スパートを始めてから、その走りを持続する力。距離適性と合わせて見る。'],
  ['パワー', '坂、乾いたダート、重い芝、洋芝など、力を要する条件で重要な能力。'],
  ['根性', '競り合いの強さ。多頭数のレースや重い芝でも重要になる。'],
  ['気性', '落ち着いて走れるかどうか。悪いとレース前に興奮したり、レース中にかかったりしやすい。'],
  ['芝・ダート', 'それぞれのコースへの適性。得意な路線を選ぶ目安になる。'],
  ['距離適性', '力を出しやすい距離の範囲。範囲外では必ず負ける、という制限ではない。'],
];

const RACE_TRAITS: GuideEntry[] = [
  ['スタート', '発馬の上手さ。'],
  ['コーナー', '右回り・左回りの得意不得意。「両○」は両方に対応する。'],
  ['重馬場', '雨などで状態が悪くなった芝への適性。'],
  ['荒れ馬場', '開催が進み、傷んだ芝への適性。'],
  ['高速馬場', '開幕週など、状態の良い芝への適性。'],
  ['体質', '疲れにくさと回復の早さ。'],
  ['脚元', '調教やレースでのケガのしにくさ。'],
  ['集中力', 'レース中によそ見せず、走りに集中できるか。'],
  ['こわがり', '周囲の馬を怖がりにくいか。評価が良いほど、ひるまず走りやすい。'],
  ['音反応', '周囲の音で興奮しにくいか。音によく反応するほど良い、という意味ではない。'],
  ['反応', '騎手の指示に応じる早さ。評価が悪いとスパート開始にもたつくことがある。'],
];

function StatSection({ title, introduction, entries }: { title: string; introduction?: string; entries: GuideEntry[] }) {
  return <section className="panel stat-guide-section">
    <h3>{title}</h3>
    {introduction && <p className="small muted">{introduction}</p>}
    <dl>{entries.map(([label, description]) => <div key={label}><dt>{label}</dt><dd>{description}</dd></div>)}</dl>
  </section>;
}

const GUIDES = [
  { id: 'theories', label: '配合理論' },
  { id: 'breeding', label: '種牡馬・繁殖牝馬の能力' },
  { id: 'racing', label: '競走馬の能力・適性' },
] as const;
type Guide = typeof GUIDES[number]['id'];

export function RulesPage({ initialGuide }: { initialGuide: string | null }) {
  const [guide, setGuide] = useState<Guide>(initialGuide === 'breeding' || initialGuide === 'racing' ? initialGuide : 'theories');
  return <div className="rules-page">
    <div className="rules-navigation" role="group" aria-label="ルール・能力の説明">
      {GUIDES.map(({ id, label }) => <button key={id} type="button" aria-pressed={guide === id} className={guide === id ? 'primary' : ''} onClick={() => setGuide(id)}>{label}</button>)}
    </div>
    {guide === 'theories' ? <div className="panel">
      <div className="tip-heading"><h3>ルール台帳（成立条件と確認状態）</h3><Tip label="確認状態">確認状態: 実機確認＝ゲーム画面で確認、公開資料＝公式配布資料に記載あり、前作由来＝前作・シリーズの公知の仕様、推定＝本ツールの解釈、未確認＝根拠なし。</Tip></div>
      <div className="table-wrap"><table className="small">
        <thead><tr><th>理論</th><th className="wrap">成立条件</th><th className="wrap">効果</th><th>確認状態</th><th className="wrap">備考</th></tr></thead>
        <tbody>{RULE_LEDGER.map(r => <tr key={r.id}><td className="name">{r.title}</td><td className="wrap">{r.condition}</td><td className="wrap">{r.effect ?? <span className="muted">記載なし</span>}</td><td><span className="tag">{r.status}</span></td><td className="wrap muted">{r.note ?? ''}</td></tr>)}</tbody>
      </table></div>
    </div> : <>
      <div className="stat-guide-grid">
        {guide === 'breeding' ? <>
          <StatSection title="種牡馬の評価" introduction="産駒にどのような特徴を期待できるかを見る。体質・気性・実績・底力はA → B → Cの順。安定は能力のばらつきを表す。" entries={STALLION_STATS} />
          <StatSection title="繁殖牝馬の能力" introduction="母の能力は産駒の土台になる。現役時代の能力がそのまま産駒にコピーされるわけではない。" entries={[
            ...BASIC_ABILITIES.slice(0, 3),
            ['ダート', 'ダートへの適性。アプリでは◎・○・△で記録する。'],
            ['体質', '身体の丈夫さ。アプリではA・B・Cで記録する。'],
            ['気性', '落ち着きや扱いやすさ。アプリではA・B・Cで記録する。'],
          ]} />
          <p className="stat-guide-note small muted">繁殖牝馬のスピード・スタミナ・パワーは、アプリでは数値で管理します。種牡馬のA〜C評価や競走馬のカードの印とは別の尺度です。空欄や「—」は未確認を表します。</p>
        </> : <>
          <StatSection title="基本能力・コース適性" introduction="カードの評価は育成や出走を通じて判明する。同じ印でも能力には幅がある。" entries={BASIC_ABILITIES} />
          <StatSection title="特性・馬場適性" entries={RACE_TRAITS} />
          <StatSection title="成長タイプ" introduction="能力のピークや衰えの時期に関わる。強さそのものを表す順位ではない。" entries={[
            ['早熟', '早い時期に力を発揮するタイプ。若いうちのレースを狙う際の目安。'],
            ['持続', '力を発揮できる時期が長く続くタイプ。'],
            ['普通', '早熟と晩成の中間にあたる、標準的な成長タイプ。'],
            ['晩成', '遅い時期に力を発揮するタイプ。若いうちに能力が目立たなくても、その後の成長を見て判断する。'],
          ]} />
        </>}
      </div>
      <p className="stat-guide-sources small muted">参考：<a href="https://www.gameaddict.co.jp/derbystallion2/guidebook.php" target="_blank" rel="noreferrer">公式小冊子（6〜12ページ）</a>・<a href="https://www.gameaddict.co.jp/derbystallion2/faq.php" target="_blank" rel="noreferrer">公式FAQ</a></p>
    </>}
  </div>;
}

import { useState } from 'react';
import { MasterHorsesPage } from './MasterHorsesPage';
import { PageHeading } from './icons';
import { MasterAncestorsPage } from './MasterAncestorsPage';
import { KottaPairsPage, NicksPage } from './MasterPairsPage';
import { useApp } from './app-context';
import { RULE_LEDGER } from '../core/rules';
import { RacesPage } from './RacesPage';
import { applyRaceEdits } from '../core/races';
import { baseRaces } from '../data/races';

const TABS = [{ id: 'stallions', label: '種牡馬' }, { id: 'broodmares', label: '繁殖牝馬' }, { id: 'ancestors', label: '祖先' }, { id: 'kotta', label: '凝ったペア' }, { id: 'nicks', label: 'ニックス' }, { id: 'races', label: 'レース' }, { id: 'sources', label: 'ルール' }] as const;
type Tab = typeof TABS[number]['id'];

/** データ: マスターデータの閲覧・修正・追加（種牡馬・繁殖牝馬・祖先・凝ったペア・ニックス・レース）と、ルール台帳 */
export function DataPage({ params }: { params: URLSearchParams }) {
  const app = useApp();
  const [tab, setTab] = useState<Tab>(() => (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') as Tab : 'stallions'));
  return (
    <div className="data-page">
      <PageHeading icon="database" title="データ" actions={<div className="data-inventory" aria-label="収録件数">
        <span>種牡馬 <b>{app.master.stallions.length.toLocaleString()}</b></span>
        <span>繁殖牝馬 <b>{app.master.broodmares.length.toLocaleString()}</b></span>
        <span>祖先 <b>{app.master.ancestors.length.toLocaleString()}</b></span>
        <span>凝ったペア <b>{app.master.kotta.length.toLocaleString()}</b></span>
        <span>ニックス <b>{app.master.nicks.length.toLocaleString()}</b></span>
        <span>レース <b>{applyRaceEdits(baseRaces, app.data.raceEdits).length.toLocaleString()}</b></span>
      </div>} />
      <div className="data-tabs segmented" role="tablist" aria-label="データの種類">{TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'primary' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>
      {tab === 'stallions' && <MasterHorsesPage key="stallions" kind="stallion" initialHorseKey={params.get('horse')} />}
      {tab === 'broodmares' && <MasterHorsesPage key="broodmares" kind="broodmare" initialHorseKey={params.get('horse')} />}
      {tab === 'ancestors' && <MasterAncestorsPage />}
      {tab === 'kotta' && <KottaPairsPage />}
      {tab === 'nicks' && <NicksPage />}
      {tab === 'races' && <RacesPage />}
      {tab === 'sources' && <div className="panel">
        <h3>ルール台帳（成立条件と確認状態）</h3>
        <p className="small muted">確認状態: 公開資料＝公式配布資料に記載あり、前作由来＝前作・シリーズの公知の仕様、推定＝本ツールの解釈、未確認＝根拠なし。</p>
        <div className="table-wrap"><table className="small">
          <thead><tr><th>理論</th><th className="wrap">成立条件</th><th className="wrap">効果</th><th>確認状態</th><th className="wrap">備考</th></tr></thead>
          <tbody>{RULE_LEDGER.map((r) => <tr key={r.id}><td className="name">{r.title}</td><td className="wrap">{r.condition}</td><td className="wrap">{r.effect ?? <span className="muted">記載なし</span>}</td><td><span className="tag">{r.status}</span></td><td className="wrap muted">{r.note ?? ''}</td></tr>)}</tbody>
        </table></div>
      </div>}
    </div>
  );
}

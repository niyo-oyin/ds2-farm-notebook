import { MasterHorsesPage } from './MasterHorsesPage';
import { PageHeading } from './icons';
import { MasterAncestorsPage } from './MasterAncestorsPage';
import { KottaPairsPage, NicksPage } from './MasterPairsPage';
import { useApp } from './app-context';
import { RacesPage } from './RacesPage';
import { applyRaceEdits } from '../core/races';
import { baseRaces } from '../data/races';
import { RulesPage } from './RulesPage';

const TABS = [{ id: 'stallions', label: '種牡馬' }, { id: 'broodmares', label: '繁殖牝馬' }, { id: 'ancestors', label: '祖先' }, { id: 'kotta', label: '凝ったペア' }, { id: 'nicks', label: 'ニックス' }, { id: 'races', label: 'レース' }, { id: 'sources', label: 'ルール' }] as const;
type Tab = typeof TABS[number]['id'];

/** データ: マスターデータの閲覧・修正・追加（種牡馬・繁殖牝馬・祖先・凝ったペア・ニックス・レース）と、ルール台帳 */
export function DataPage({ params }: { params: URLSearchParams }) {
  const app = useApp();
  const tab: Tab = TABS.some(t => t.id === params.get('tab')) ? params.get('tab') as Tab : 'stallions';
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
      <div className="data-tabs segmented" role="tablist" aria-label="データの種類">{TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'primary' : ''} onClick={() => { location.hash = `/data?tab=${t.id}`; }}>{t.label}</button>)}</div>
      {tab === 'stallions' && <MasterHorsesPage key="stallions" kind="stallion" initialHorseKey={params.get('horse')} />}
      {tab === 'broodmares' && <MasterHorsesPage key="broodmares" kind="broodmare" initialHorseKey={params.get('horse')} />}
      {tab === 'ancestors' && <MasterAncestorsPage />}
      {tab === 'kotta' && <KottaPairsPage />}
      {tab === 'nicks' && <NicksPage />}
      {tab === 'races' && <RacesPage />}
      {tab === 'sources' && <RulesPage initialGuide={params.get('guide')} />}
    </div>
  );
}

import { lazy, Suspense, useEffect, useMemo } from 'react';
import { baseMaster } from './data/base-master';
import { DEFAULT_RULES } from './core/rules';
import { HorseResolver } from './core/pedigree';
import { makeContext } from './core/judge';
import { useUserData, useWorkspaceGeneration, startSync, allUserHorses } from './store/userdata';
import { ImportTray } from './ui/ImportTray';
import { SearchTray } from './ui/SearchTray';
import { GameYear } from './ui/GameYear';
import { AppContext } from './ui/app-context';
import { useRoute } from './ui/router';
import { MatingPage } from './ui/MatingPage';
import { HorsesPage } from './ui/HorsesPage';
import { SearchPage } from './ui/SearchPage';
import { PlansPage } from './ui/PlansPage';
import { DataPage } from './ui/DataPage';
import { SettingsPage } from './ui/SettingsPage';
import { applyMasterEdits } from './core/master-edits';

const HorseStoryPage = lazy(() => import('./ui/HorseStoryPage').then(m => ({ default: m.HorseStoryPage })));

const NAV = [['/mating', '配合確認'], ['/search', '配合探索'], ['/plans', '配合計画'], ['/horses', '所有馬'], ['/data', 'データ'], ['/settings', '設定']] as const;

export default function App() {
  const data = useUserData();
  const generation = useWorkspaceGeneration();
  const route = useRoute();
  const app = useMemo(() => {
    const rules = { ...DEFAULT_RULES, ...data.settings.rules };
    const userHorses = allUserHorses(data);
    const master = applyMasterEdits(baseMaster, data.masterEdits, data.ancestorEdits, data.kottaEdits, data.nicksEdits);
    return { master, rules, ctx: makeContext(master, rules, userHorses), resolver: new HorseResolver(master, userHorses, rules), data };
  }, [data]);
  const key = route.path + '?' + route.params.toString();
  useEffect(() => startSync(), []);
  return (
    <AppContext.Provider key={generation} value={app}>
      <header>
        <h1><img className="app-icon" src="/favicon.svg" width="30" height="30" alt="" />ダビスタ2 牧場ノート</h1>
        <nav className="tabs">{NAV.map(([p, t]) => <a key={p} href={'#' + p} className={(route.path === p || (p === '/horses' && route.path === '/horses/story')) ? 'active' : ''}>{t}</a>)}</nav>
        <GameYear />
        <SearchTray />
        <ImportTray />
      </header>
      <main>
        {route.path === '/mating' && <MatingPage key={key} params={route.params} />}
        {route.path === '/horses/story' && <Suspense fallback={<div className="empty">読み込み中…</div>}><HorseStoryPage key={key} params={route.params} /></Suspense>}
        {route.path === '/horses' && <HorsesPage key={key} params={route.params} />}
        {route.path === '/search' && <SearchPage key={key} params={route.params} />}
        {route.path === '/plans' && <PlansPage key={key} params={route.params} />}
        {route.path === '/data' && <DataPage key={key} params={route.params} />}
        {route.path === '/settings' && <SettingsPage params={route.params} />}
      </main>
    </AppContext.Provider>
  );
}

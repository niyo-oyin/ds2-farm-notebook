import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, sireOptions, includePlannedInSearch } from './app-context';
import { Icon } from './icons';
import { StallionFilter, EMPTY_FILTER, matchesStallion, isFilterActive, type StallionFilterState } from './StallionFilter';
import { goalLabel, type SearchGoal } from '../core/search';
import { compareHomebred, type HomebredReport, type HomebredRequest, type HomebredResult } from '../core/homebred';
import type { WorkerIn, WorkerOut } from '../core/worker';
import { savePlanFromResult, allUserHorses, store } from '../store/userdata';
import { ConditionTags, CostUnknownTag, GoalEditor, SearchSection, Summary, useMemoState, useMobile } from './SearchPage';
import { Tip } from './Tip';
import { ownedOrigins } from './search-order';
import { ResultPagination } from './ResultPagination';
import { useResultPage } from './use-result-page';
import { SavePlanDialog } from './SavePlanDialog';

const DEFAULT_GOALS: SearchGoal[] = [{ type: 'kotta' }, { type: 'notDangerous' }];

/** 判定回数の上限。所有の繁殖牝馬どうしの組み合わせなので、ふつうは届かない */
const MAX_EVALUATIONS = 5_000_000;

/**
 * 自家製種牡馬づくり: 所有の繁殖牝馬に種牡馬を付けて牡の産駒を作り、その産駒を種牡馬として所有の繁殖牝馬に付けた時に目標が成立する頭数で比べる。
 */
export function HomebredSearch({ filter, setFilter }: { filter: StallionFilterState; setFilter: (filter: StallionFilterState) => void }) {
  const app = useApp();
  const mobile = useMobile();
  const sOpts = useMemo(() => sireOptions(app, { onlyAvailable: true, requirePedigree: true, includePlanned: includePlannedInSearch(app), includeOverseas: filter.includeOverseas }), [app, filter.includeOverseas]);
  // 産駒の母も、産駒を付ける相手も、所有の繁殖牝馬
  const mares = useMemo(() => ownedOrigins(app, 'mare'), [app]);
  const [goals, setGoals] = useMemoState<SearchGoal[]>('homebred', 'goals', DEFAULT_GOALS);
  const [report, setReport] = useMemoState<HomebredReport | null>('homebred', 'report', null);
  const [open, setOpen] = useMemoState<string | null>('homebred', 'open', null);
  const [saved, setSaved] = useMemoState<Record<string, { id: string; name: string }>>('homebred', 'saved', {});
  const [progress, setProgress] = useState<{ evaluated: number; found: number } | null>(null);
  const [savingResult, setSavingResult] = useState<HomebredResult | null>(null);
  const [savedMsg, setSavedMsg] = useState<{ id: string; name: string } | null>(null);
  const [err, setErr] = useState('');
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  const pool = useMemo(() => sOpts.map((o) => o.key).filter((key) => { const m = app.master.stallions.find((s) => s.id === key); return !isFilterActive(filter) || !m || matchesStallion(m, filter); }), [sOpts, filter, app]);
  const resultKey = (r: HomebredResult) => `${r.sire}>${r.dam}`;

  const start = () => {
    const request: HomebredRequest = { dams: mares, stallionPool: pool, targets: mares, goals, minMatches: 1, maxEvaluations: MAX_EVALUATIONS };
    setErr(''); setReport(null); setOpen(null); setSaved({}); setSavedMsg(null); setProgress({ evaluated: 0, found: 0 });
    const startedAt = Date.now();
    worker.current?.terminate();
    const w = new Worker(new URL('../core/worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === 'progress') {
        setProgress({ evaluated: m.evaluated, found: m.found });
        if (m.results.length) setReport((prev) => ({ status: '中止', results: [...(prev?.results ?? []), ...(m.results as HomebredResult[])], evaluated: m.evaluated, elapsedMs: Date.now() - startedAt, request }));
      } else if (m.type === 'homebredDone') { setReport(m.report); setProgress(null); }
      else if (m.type === 'error') { setErr(m.message); setProgress(null); }
    };
    w.postMessage({ type: 'startHomebred', master: app.master, userHorses: allUserHorses(app.data), rules: app.data.settings.rules, request } satisfies WorkerIn);
  };
  const cancel = () => worker.current?.postMessage({ type: 'cancel' } satisfies WorkerIn);

  const sorted = useMemo(() => (report ? [...report.results].sort(compareHomebred) : []), [report]);
  const resultPage = useResultPage(sorted, mobile ? 100 : 200);
  // 母自身には付けないので、相手の頭数から除く
  const targetCount = (r: HomebredResult) => (report?.request.targets ?? mares).filter((t) => t !== r.dam).length;
  const save = (r: HomebredResult, name: string) => {
    const p = savePlanFromResult(name, r.dam, { steps: [{ sire: r.sire, sireName: r.sireName, dam: r.dam, damName: r.damName, cost: r.cost, foalName: '自家製種牡馬', judgement: r.birth, constraints: r.constraints }], matings: 1, cost: r.cost, goals: [] }, [], undefined, app.ctx.rulesVersion, app.ctx.dataVersion, 'stallion');
    const goalText = (report?.request.goals ?? goals).map(goalLabel).join('・') || '条件なし';
    store.updatePlan(p.id, { memo: `種牡馬として付ける相手（${goalText}）: ${r.matches.map((m) => m.mareName).join('、')}` });
    setSaved({ ...saved, [resultKey(r)]: { id: p.id, name: p.name } });
    setSavedMsg({ id: p.id, name: p.name });
    setSavingResult(null);
  };
  /** 表（スマホではカード）の「保存」。保存するのは牡の産駒を作る配合 */
  const saveButton = (r: HomebredResult) => saved[resultKey(r)]
    ? <a href={`#/plans?id=${saved[resultKey(r)].id}`} className="small" onClick={(e) => e.stopPropagation()}>保存済み</a>
    : <button title="牡の産駒を作る配合を計画として保存" onClick={(e) => { e.stopPropagation(); setSavingResult(r); }}>保存</button>;
  const matchNames = (r: HomebredResult) => r.matches.map((m) => m.mareName).join('、');
  const detail = (r: HomebredResult) => <div className="result-expanded" onClick={(e) => e.stopPropagation()}>
    <div className="small muted">牡の産駒が生まれる配合（{r.sireName} × {r.damName}） <ConditionTags constraints={r.constraints} /></div>
    <div><Summary s={r.birth} /></div>
    <div className="small muted" style={{ marginTop: 8 }}>産駒を種牡馬として付けた時に目標が成立する相手</div>
    <ol className="steps">{r.matches.map((m) => <li key={m.mare}>産駒 × <b>{m.mareName}</b><div><Summary s={m.judgement} /></div></li>)}</ol>
  </div>;

  return (
    <div>
      <div className="search-form">
        <GoalEditor goals={goals} setGoals={setGoals} qualifier="所有の繁殖牝馬に付けた時" tip={<Tip label="必ず満たす条件">所有の繁殖牝馬に種牡馬を付けて牡の産駒を作り、その産駒を種牡馬として所有の繁殖牝馬に付けた時に満たす条件です。条件を満たす相手が多い産駒から並べます。産駒の母自身は相手に数えません。</Tip>} />
        <SearchSection title="産駒の父の属性" icon="sliders" tip={<Tip label="産駒の父の属性">牡の産駒を作るために、所有の繁殖牝馬に付ける種牡馬の候補を絞ります。</Tip>}><StallionFilter value={filter} onChange={setFilter} /></SearchSection>
        <div className="search-actions">
          <button type="button" className="search-reset" disabled={!!progress} onClick={() => { setGoals(DEFAULT_GOALS); setFilter(EMPTY_FILTER); setReport(null); setOpen(null); setErr(''); }}><Icon name="reset" />条件をリセット</button>
          {progress && <span className="search-progress-label" role="status">判定 {progress.evaluated.toLocaleString()} 回 / 発見 {progress.found} 件</span>}
          {progress ? <button className="search-submit" onClick={cancel}>探索を中止</button>
            : <button className="primary search-submit" disabled={mares.length < 2 || !pool.length} onClick={start}><Icon name="search" />探索<span className="search-submit-count">所有の繁殖牝馬 {mares.length}頭 × 種牡馬 {pool.length}頭</span></button>}
        </div>
        {mares.length < 2 && <p className="empty small">所有馬に区分「繁殖牝馬」の牝馬を2頭以上登録すると探索できます。<a href="#/horses">所有馬を開く</a></p>}
        {progress && <div className="progress"><div style={{ width: `${Math.min(100, (progress.evaluated / (mares.length * pool.length * (mares.length - 1))) * 100)}%` }} /></div>}
        {err && <div className="error" role="alert">{err}</div>}
      </div>
      {report && (
        <div className="panel">
          <div className="result-status">
            <div><b>{progress ? `探索中: 候補 ${report.results.length} 件` : report.status === '完了' ? (report.results.length ? `候補 ${report.results.length.toLocaleString()} 件` : '条件を満たす産駒なし') : `探索未完了（${report.status}）: ${report.results.length} 件`}</b></div>
            <div className="small muted">判定 {report.evaluated.toLocaleString()} 回、{(report.elapsedMs / 1000).toFixed(1)} 秒{progress && '（途中）'}。成立する相手が多い順</div>
          </div>
          <ResultPagination {...resultPage} onChange={resultPage.setPage} />
          {savedMsg && <div className="notice" style={{ marginBottom: 8 }}>計画「{savedMsg.name}」を保存しました。<a href={`#/plans?id=${savedMsg.id}`}>計画を開く</a></div>}
          {mobile ? (
            <div className="result-cards">
              {resultPage.rows.map((r) => <div key={resultKey(r)} className="result-card">
                <div className="result-head" onClick={() => setOpen(open === resultKey(r) ? null : resultKey(r))}><b>{r.sireName} × {r.damName} <CostUnknownTag steps={[r]} /></b><span className="num muted">{r.matches.length} / {targetCount(r)}頭 · {r.cost.toLocaleString()}万</span></div>
                <div className="small" onClick={() => setOpen(open === resultKey(r) ? null : resultKey(r))}>{matchNames(r)}</div>
                <div className="result-card-actions">{saveButton(r)}</div>
                {open === resultKey(r) && detail(r)}
              </div>)}
            </div>
          ) : (
            <div className="table-wrap"><table>
              <thead><tr><th className="num">#</th><th>産駒の父 × 母</th><th className="num">種付料</th><th className="num">成立</th><th className="wrap">成立する相手</th><th></th></tr></thead>
              <tbody>{resultPage.rows.map((r, i) => [
                <tr key={resultKey(r)} className={'clickable' + (open === resultKey(r) ? ' selected' : '')} onClick={() => setOpen(open === resultKey(r) ? null : resultKey(r))}>
                  <td className="num">{resultPage.offset + i + 1}</td>
                  <td className="name">{r.sireName} × {r.damName} <CostUnknownTag steps={[r]} /></td>
                  <td className="num">{r.cost.toLocaleString()}</td>
                  <td className="num">{r.matches.length}<span className="small muted"> / {targetCount(r)}</span></td>
                  <td className="wrap small">{matchNames(r)}</td>
                  <td className="action">{saveButton(r)}</td>
                </tr>,
                open === resultKey(r) && <tr key={'d' + resultKey(r)} className="result-expanded-row"><td colSpan={6} className="wrap">{detail(r)}</td></tr>,
              ])}</tbody>
            </table></div>
          )}
          <ResultPagination {...resultPage} onChange={resultPage.setPage} />
        </div>
      )}
      {savingResult && <SavePlanDialog defaultName={`${savingResult.damName} 自家製種牡馬（${savingResult.sireName}産駒）`} onSave={(name) => save(savingResult, name)} onClose={() => setSavingResult(null)} />}
    </div>
  );
}

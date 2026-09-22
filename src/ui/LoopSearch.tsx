import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, sireOptions, damOptions, includePlannedInSearch } from './app-context';
import { Icon } from './icons';
import { HorseSelect } from './HorseSelect';
import { StallionFilter, EMPTY_FILTER, matchesStallion, isFilterActive, type StallionFilterState } from './StallionFilter';
import { goalLabel, type SearchGoal } from '../core/search';
import { loopFromMare, type LoopReport, type LoopRequest, type LoopResult } from '../core/loop-search';
import type { WorkerIn, WorkerOut } from '../core/worker';
import { savePlanFromResult, allUserHorses } from '../store/userdata';
import { Constraints, GoalEditor, SearchSection, Summary, useMemoState, useMobile } from './SearchPage';
import { isSearchJobActive, type SearchJob } from '../api';
import { loopReport, stopSearchJob, submitSearchJob } from '../store/search-jobs';

import { ResultPagination } from './ResultPagination';
import { useResultPage } from './use-result-page';
import { SearchResultFilters } from './SearchResultFilters';

type LoopSort = 'cost' | 'nicks' | 'crosses' | 'perfect';
const DEFAULT_GOALS: SearchGoal[] = [{ type: 'kotta' }, { type: 'notDangerous' }];

/**
 * 種牡馬を決まった順に交配し、毎世代の産駒牝馬で目標が成立し続ける周期を探す。
 * 結果は、元の牝馬の血統が抜けた後の定常状態で判定する。
 */
export function LoopSearch({ job }: { job: (SearchJob & { kind: 'loop' }) | null }) {
  const app = useApp();
  const mobile = useMobile();
  // バックグラウンドの探索を開いた時は、その条件を入力欄に戻し、結果は取り直すたびに差し替える（この画面で新しく探索を始めたら切り離す）
  const jr = job?.request ?? null;
  const [viewingJob, setViewingJob] = useState(!!job);
  const [progress, setProgress] = useState<{ evaluated: number; pruned: number; found: number } | null>(null);
  const sOpts = useMemo(() => sireOptions(app, { onlyAvailable: true, requirePedigree: true, includePlanned: includePlannedInSearch(app) }), [app]);
  const dOpts = useMemo(() => damOptions(app, { onlyAvailable: true, requirePedigree: true, includePlanned: !app.data.settings.hidePlanned }), [app]);
  const [minL, setMinL] = useMemoState<number>('loop', 'minL', 5, jr?.minLength ?? null);
  const [maxL, setMaxL] = useMemoState<number>('loop', 'maxL', 6, jr?.maxLength ?? null);
  const [goals, setGoals] = useMemoState<SearchGoal[]>('loop', 'goals', DEFAULT_GOALS, jr?.goals ?? null);
  const [maxCost, setMaxCost] = useMemoState<string>('loop', 'maxCost', '', jr ? (jr.maxCost == null ? '' : String(jr.maxCost)) : null);
  const [maxEval, setMaxEval] = useMemoState<number>('loop', 'maxEval', 2_000_000, jr?.maxEvaluations ?? null);
  const [filter, setFilter] = useMemoState<StallionFilterState>('loop', 'filter', EMPTY_FILTER);
  const [report, setReport] = useMemoState<LoopReport | null>('loop', 'report', null, job ? loopReport(job) : null);
  const [started, setStarted] = useState<SearchJob | null>(null);
  useEffect(() => { if (job && viewingJob) setReport(loopReport(job)); }, [job, viewingJob, setReport]);
  const jobRunning = viewingJob && !!job && isSearchJobActive(job);
  const running = !!progress || jobRunning;
  const runningProgress = progress ?? (jobRunning ? job.progress : null);
  const [sort, setSort] = useMemoState<LoopSort>('loop', 'sort', 'cost');
  const [open, setOpen] = useMemoState<string | null>('loop', 'open', null);
  const [resultHorse, setResultHorse] = useState('');
  const [mare, setMare] = useMemoState<string>('loop', 'mare', '');
  const [saveName, setSaveName] = useMemoState<string>('loop', 'saveName', '');
  const [saved, setSaved] = useMemoState<Record<string, { id: string; name: string }>>('loop', 'saved', {});
  const [err, setErr] = useState('');
  const [savedMsg, setSavedMsg] = useState<{ id: string; name: string } | null>(null);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  const resultKey = (r: LoopResult) => r.steps.map((st) => st.sire).join('>');
  const env = useMemo(() => ({ ctx: app.ctx, rules: app.rules, resolve: (k: string) => app.resolver.get(k) }), [app]);

  const buildRequest = (): LoopRequest => {
    const all = sOpts.map((o) => o.key);
    const pool = isFilterActive(filter) ? all.filter((key) => { const m = app.master.stallions.find((s) => s.id === key); return !m || matchesStallion(m, filter); }) : all;
    return { stallionPool: pool, minLength: minL, maxLength: maxL, goals, maxCost: maxCost ? Number(maxCost) : null, maxEvaluations: maxEval };
  };
  const startedAt = useRef(0);
  const start = () => {
    resultPage.setPage(0); setResultHorse('');
    setErr(''); setReport(null); setSaved({}); setSavedMsg(null); setStarted(null); setOpen(null); setViewingJob(false); setProgress({ evaluated: 0, pruned: 0, found: 0 });
    const request = buildRequest();
    startedAt.current = Date.now();
    worker.current?.terminate();
    const w = new Worker(new URL('../core/worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === 'progress') {
        setProgress({ evaluated: m.evaluated, pruned: m.pruned, found: m.found });
        // 見つかった周期は終了を待たずに並べる（集計は途中の値）
        if (m.results.length) setReport((prev) => ({ status: '中止', results: [...(prev?.results ?? []), ...(m.results as LoopResult[])], evaluated: m.evaluated, pruned: m.pruned, elapsedMs: Date.now() - startedAt.current, request }));
      } else if (m.type === 'loopDone') { setReport(m.report); setProgress(null); }
      else if (m.type === 'error') { setErr(m.message); setProgress(null); }
    };
    w.postMessage({ type: 'startLoop', master: app.master, userHorses: allUserHorses(app.data), rules: app.data.settings.rules, request } satisfies WorkerIn);
  };
  const cancel = () => (progress ? worker.current?.postMessage({ type: 'cancel' } satisfies WorkerIn) : job && void stopSearchJob(job.id));
  /** サーバに任せて画面を離れても続ける。結果は右上の「探索」か、この画面の案内から開く */
  const background = async () => {
    setErr('');
    try { setStarted(await submitSearchJob('loop', buildRequest())); } catch (e) { setErr((e as Error).message); }
  };
  const sorted = useMemo(() => {
    if (!report) return [];
    const nicks = (r: LoopResult) => r.steps.reduce((n, s) => n + s.judgement.nicksLevel, 0);
    const crosses = (r: LoopResult) => r.steps.reduce((n, s) => n + s.judgement.crossCount, 0);
    const perfect = (r: LoopResult) => r.steps.filter((s) => s.judgement.perfectKotta === '成立').length;
    return report.results.filter((r) => !resultHorse || r.steps.some((step) => step.sire === resultHorse)).sort((a, b) => {
      const tie = a.length - b.length || a.cost - b.cost;
      if (sort === 'nicks') return nicks(b) - nicks(a) || tie;
      if (sort === 'crosses') return crosses(a) - crosses(b) || tie;
      if (sort === 'perfect') return perfect(b) - perfect(a) || tie;
      return tie;
    });
  }, [report, sort, resultHorse]);
  const resultPage = useResultPage(sorted, mobile ? 100 : 200);
  // 選んだ牝馬から1周した実際の経路。元の牝馬の血統が残るので、定常状態と違って崩れる世代があり得る
  const firstCycle = (r: LoopResult) => (mare ? loopFromMare(env, mare, r.steps.map((s) => s.sire), goals) : null);
  const save = (r: LoopResult) => {
    const result = firstCycle(r);
    if (!result) { setErr('起点の繁殖牝馬を選んでください'); return; }
    const name = saveName.trim() || `${app.resolver.label(mare)} ループ ${r.steps.map((s) => s.sireName).join('→')}`;
    const p = savePlanFromResult(name, mare, result, goals, undefined, app.ctx.rulesVersion, app.ctx.dataVersion, 'broodmare');
    setSaved({ ...saved, [resultKey(r)]: { id: p.id, name: p.name } });
    setSavedMsg({ id: p.id, name: p.name });
  };
  const route = (r: LoopResult) => r.steps.map((s) => s.sireName).join(' → ') + ' → …';

  return (
    <div>
      <div className="search-form">
        <SearchSection title="周期と上限" icon="horse">
          <div className="search-limits">
            <label className="field">周期の長さ（最小）<input type="number" min={2} max={10} value={minL} onChange={(e) => setMinL(Number(e.target.value))} /></label>
            <label className="field">周期の長さ（最大）<input type="number" min={2} max={10} value={maxL} onChange={(e) => setMaxL(Number(e.target.value))} /></label>
            <label className="field">1周の種付料合計の上限（万）<input type="number" value={maxCost} onChange={(e) => setMaxCost(e.target.value)} placeholder="なし" /></label>
            <label className="field">判定回数上限<input type="number" value={maxEval} onChange={(e) => setMaxEval(Number(e.target.value))} /></label>
          </div>
          <p className="small muted">同じ種牡馬を5世代以内に再び付けると1×Nの危険な配合になるため、危険な配合を避ける場合の周期は5以上になる。</p>
        </SearchSection>
        <GoalEditor goals={goals} setGoals={setGoals} qualifier="毎世代" />
        <SearchSection title="種牡馬の属性" icon="sliders"><StallionFilter value={filter} onChange={setFilter} /></SearchSection>
        <div className="search-actions">
          <button type="button" className="search-reset" disabled={running} onClick={() => { setMinL(5); setMaxL(6); setGoals(DEFAULT_GOALS); setMaxCost(''); setMaxEval(2_000_000); setFilter(EMPTY_FILTER); setReport(null); setOpen(null); setErr(''); setStarted(null); setViewingJob(false); }}><Icon name="reset" />条件をリセット</button>
          {runningProgress && <span className="search-progress-label" role="status">{jobRunning ? 'バックグラウンドで探索中 · ' : ''}判定 {runningProgress.evaluated.toLocaleString()} 回 / 発見 {runningProgress.found} 件</span>}
          {running ? <button className="search-submit" onClick={cancel}>探索を中止</button> : <span className="search-submit-group">
            <button className="search-submit" onClick={() => void background()}>バックグラウンドで探索</button>
            <button className="primary search-submit" onClick={start}><Icon name="search" />探索<span className="search-submit-count">種牡馬 {sOpts.length}頭</span></button>
          </span>}
        </div>
        {runningProgress && <div className="progress"><div style={{ width: `${Math.min(100, (runningProgress.evaluated / maxEval) * 100)}%` }} /></div>}
        {started && <div className="notice">バックグラウンドで探索を始めました。<a href={`#/search?job=${encodeURIComponent(started.id)}`}>途中経過を開く</a>　<span className="muted small">右上の「探索」からも開けます。</span></div>}
        {err && <div className="error" role="alert">{err}</div>}
      </div>
      {report && (
        <div className="panel">
          <div className="result-status">
            <div><b>{running ? `探索中: 条件を満たす周期 ${report.results.length} 件` : report.status === '完了' ? (report.results.length ? `条件を満たす周期 ${report.results.length} 件` : '指定範囲に解なし') : `探索未完了（${report.status}）: ${report.results.length} 件`}</b></div>
            <div className="small muted">判定 {report.evaluated.toLocaleString()} 回、枝刈り {report.pruned.toLocaleString()}、{(report.elapsedMs / 1000).toFixed(1)} 秒{running && '（途中）'}。判定は周期を回し続けた定常状態のもの</div>
          </div>
          <div className="toolbar">
            <label className="field">並び順<select value={sort} onChange={(e) => { setSort(e.target.value as LoopSort); resultPage.setPage(0); }}><option value="cost">1周の費用が安い順</option><option value="perfect">完璧／凝ったの世代が多い順</option><option value="nicks">ニックス段階の合計順</option><option value="crosses">クロスが少ない順</option></select></label>
            <label className="field">起点の繁殖牝馬（計画の保存用）<HorseSelect value={mare} onChange={setMare} options={dOpts} aria-label="起点の繁殖牝馬" plannedToggle /></label>
            <label className="field">保存する計画名<input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="任意" /></label>
          </div>
          <SearchResultFilters results={report.results} horse={resultHorse} count={sorted.length} onHorseChange={(key) => { setResultHorse(key); resultPage.setPage(0); }} />
          <ResultPagination {...resultPage} onChange={resultPage.setPage} />
          {savedMsg && <div className="notice" style={{ marginBottom: 8 }}>計画「{savedMsg.name}」を保存しました。<a href={`#/plans?id=${savedMsg.id}`}>計画を開く</a></div>}
          {mobile ? (
            <div className="result-cards" style={{ marginTop: 8 }}>
              {resultPage.rows.map((r) => <div key={resultKey(r)} className="result-card">
                <div className="result-head" onClick={() => setOpen(open === resultKey(r) ? null : resultKey(r))}><b>{route(r)} <Constraints steps={r.steps} /></b><span className="num muted">{r.length}頭 / {r.cost.toLocaleString()}万</span></div>
                {open === resultKey(r) && <LoopDetail r={r} first={firstCycle(r)} saved={saved[resultKey(r)]} onSave={() => save(r)} mareChosen={!!mare} />}
              </div>)}
            </div>
          ) : (
            <div className="table-wrap" style={{ marginTop: 8 }}><table>
              <thead><tr><th className="num">#</th><th className="num">周期</th><th className="num">1周の費用</th><th className="wrap">種牡馬の並び</th><th className="wrap">各世代の判定</th><th></th></tr></thead>
              <tbody>{resultPage.rows.map((r, i) => [
                <tr key={resultKey(r)} className={'clickable' + (open === resultKey(r) ? ' selected' : '')} onClick={() => setOpen(open === resultKey(r) ? null : resultKey(r))}>
                  <td className="num">{resultPage.offset + i + 1}</td><td className="num">{r.length}</td><td className="num">{r.cost.toLocaleString()}</td>
                  <td className="name wrap">{route(r)} <Constraints steps={r.steps} /></td>
                  <td className="wrap small">{r.steps.map((s, k) => <span key={k} className="loop-gen">{k + 1}: {s.judgement.perfectKotta === '成立' ? '完璧／凝った' : s.judgement.perfect === '成立' ? '完璧' : [s.judgement.omoshiro === '成立' && '面白', s.judgement.migoto === '成立' && '見事', s.judgement.kotta === '成立' && '凝った'].filter(Boolean).join('・') || '—'}{s.judgement.nicksLevel > 0 && ` ★${s.judgement.nicksLevel}`}</span>)}</td>
                  <td className="action">{saved[resultKey(r)] ? <a href={`#/plans?id=${saved[resultKey(r)].id}`} className="small" onClick={(e) => e.stopPropagation()}>保存済み</a> : <button title="選んだ繁殖牝馬から1周分を計画として保存" disabled={!mare} onClick={(e) => { e.stopPropagation(); save(r); }}>保存</button>}</td>
                </tr>,
                open === resultKey(r) && <tr key={'d' + resultKey(r)}><td colSpan={6} className="wrap"><LoopDetail r={r} first={firstCycle(r)} saved={saved[resultKey(r)]} onSave={() => save(r)} mareChosen={!!mare} /></td></tr>,
              ])}</tbody>
            </table></div>
          )}
          <ResultPagination {...resultPage} onChange={resultPage.setPage} />
          {report.results.length > 0 && sorted.length === 0 && <div className="empty">絞り込みに一致する周期はありません。</div>}
          {report.results.length === 0 && !running && <div className="empty">条件を満たす周期は見つかりませんでした。周期を長くするか、条件を減らしてください。</div>}
        </div>
      )}
    </div>
  );
}

function LoopDetail({ r, first, saved, onSave, mareChosen }: { r: LoopResult; first: ReturnType<typeof loopFromMare> | null; saved?: { id: string; name: string }; onSave: () => void; mareChosen: boolean }) {
  return <div style={{ marginTop: 6 }}>
    <div className="small muted">定常状態（周期を回し続けた時）の各世代</div>
    <ol className="steps">{r.steps.map((s, k) => <li key={k}><b>{s.sireName}</b>（{s.cost}万）× 前世代の産駒牝馬<div><Summary s={s.judgement} /></div></li>)}</ol>
    {first && <>
      <div className="small muted" style={{ marginTop: 8 }}>選んだ繁殖牝馬からの1周目（元の牝馬の血統が残るため、定常状態と判定が違う世代があり得る）</div>
      <ol className="steps">{first.steps.map((s, k) => <li key={k}><b>{s.sireName}</b> × {s.damName}<div><Summary s={s.judgement} /></div>{k === 0 && <a href={`#/mating?sire=${encodeURIComponent(s.sire)}&dam=${encodeURIComponent(s.dam)}`}>配合確認で開く</a>}</li>)}</ol>
      {first.goals.some((g) => g.verdict !== '成立') && <div className="small">1周目の目標: {first.goals.map((g, k) => <span key={k} className={'tag' + (g.verdict !== '成立' ? ' warn' : '')}>{goalLabel(g.goal)}: {g.verdict}</span>)}</div>}
    </>}
    <div className="inline-row" style={{ marginTop: 6 }}>{saved ? <a href={`#/plans?id=${saved.id}`}>保存済み（計画を開く）</a> : <button className="primary" disabled={!mareChosen} onClick={onSave}>{mareChosen ? '1周分を計画として保存' : '起点の繁殖牝馬を選ぶと計画として保存できます'}</button>}</div>
  </div>;
}

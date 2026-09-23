import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, sireOptions, damOptions, includePlannedInSearch } from './app-context';
import { Icon } from './icons';
import { HorseSelect } from './HorseSelect';
import { StallionFilter, EMPTY_FILTER, matchesStallion, isFilterActive, type StallionFilterState } from './StallionFilter';
import type { SearchGoal, SearchResult } from '../core/search';
import { type LoopEntryReport, type LoopReport, type LoopRequest, type LoopResult } from '../core/loop-search';
import type { WorkerIn, WorkerOut } from '../core/worker';
import { savePlanFromResult, allUserHorses } from '../store/userdata';
import { ConditionTags, CostUnknownTag, EvalLimitField, GoalEditor, SearchSection, Summary, useMemoState, useMobile } from './SearchPage';
import { isSearchJobActive, type SearchJob } from '../api';
import { loopReport, stopSearchJob, submitSearchJob } from '../store/search-jobs';

import { ResultPagination } from './ResultPagination';
import { useResultPage } from './use-result-page';
import { SearchResultFilters } from './SearchResultFilters';
import { SavePlanDialog } from './SavePlanDialog';
import { Tip } from './Tip';

type LoopSort = 'cost' | 'nicks' | 'crosses' | 'perfect';
const DEFAULT_GOALS: SearchGoal[] = [{ type: 'kotta' }, { type: 'notDangerous' }];
const ENTRY_MAX_BRIDGE = 2;

/**
 * 種牡馬を決まった順に交配し、毎世代の産駒牝馬で目標が成立し続ける周期を探す。
 * 結果は、元の牝馬の血統が抜けた後の定常状態で判定する。
 */
export function LoopSearch({ filter, setFilter, job }: { filter: StallionFilterState; setFilter: (filter: StallionFilterState) => void; job: (SearchJob & { kind: 'loop' }) | null }) {
  const app = useApp();
  const mobile = useMobile();
  // バックグラウンドの探索を開いた時は、その条件を入力欄に戻し、結果は取り直すたびに差し替える（この画面で新しく探索を始めたら切り離す）
  const jr = job?.request ?? null;
  const [viewingJob, setViewingJob] = useState(!!job);
  const [progress, setProgress] = useState<{ evaluated: number; pruned: number; found: number } | null>(null);
  const sOpts = useMemo(() => sireOptions(app, { onlyAvailable: true, requirePedigree: true, includePlanned: includePlannedInSearch(app), includeOverseas: filter.includeOverseas }), [app, filter.includeOverseas]);
  const dOpts = useMemo(() => damOptions(app, { onlyAvailable: true, requirePedigree: true, includePlanned: !app.data.settings.hidePlanned }), [app]);
  const [minL, setMinL] = useMemoState<number>('loop', 'minL', 5, jr?.minLength ?? null);
  const [maxL, setMaxL] = useMemoState<number>('loop', 'maxL', 6, jr?.maxLength ?? null);
  const [goals, setGoals] = useMemoState<SearchGoal[]>('loop', 'goals', DEFAULT_GOALS, jr?.goals ?? null);
  const [maxCost, setMaxCost] = useMemoState<string>('loop', 'maxCost', '', jr ? (jr.maxCost == null ? '' : String(jr.maxCost)) : null);
  const [maxEval, setMaxEval] = useMemoState<number>('loop', 'maxEval', 2_000_000, jr?.maxEvaluations ?? null);
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
  const [savingResult, setSavingResult] = useState<LoopResult | null>(null);
  // 導入と1周目がまだ出ていない周期の「保存」を押した時は、見つかり次第保存のダイアログを出す
  const pendingSave = useRef<string | null>(null);
  const [saved, setSaved] = useMemoState<Record<string, { id: string; name: string }>>('loop', 'saved', {});
  const [err, setErr] = useState('');
  const [savedMsg, setSavedMsg] = useState<{ id: string; name: string } | null>(null);
  const worker = useRef<Worker | null>(null);
  const entryWorker = useRef<Worker | null>(null);
  useEffect(() => () => { worker.current?.terminate(); entryWorker.current?.terminate(); }, []);
  // 導入の配合を挟んだ経路の探索結果。起点の牝馬と周期ごとに持つ
  const [entries, setEntries] = useState<Record<string, LoopEntryReport>>({});
  const [entrySearch, setEntrySearch] = useState<{ key: string; evaluated: number } | null>(null);
  const resultKey = (r: LoopResult) => r.steps.map((st) => st.sire).join('>');

  const buildRequest = (): LoopRequest => {
    const all = sOpts.map((o) => o.key);
    const pool = isFilterActive(filter) ? all.filter((key) => { const m = app.master.stallions.find((s) => s.id === key); return !m || matchesStallion(m, filter); }) : all;
    return { stallionPool: pool, minLength: minL, maxLength: maxL, goals, maxCost: maxCost ? Number(maxCost) : null, maxEvaluations: maxEval };
  };
  const startedAt = useRef(0);
  const start = () => {
    resultPage.setPage(0); setResultHorse('');
    setErr(''); setReport(null); setSaved({}); setSavedMsg(null); setEntries({}); setEntrySearch(null); entryWorker.current?.terminate(); setStarted(null); setOpen(null); setViewingJob(false); setProgress({ evaluated: 0, pruned: 0, found: 0 });
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
  // 選んだ牝馬から周期に入る経路。元の牝馬の血が残る世代は定常状態と判定が違うので、入り方を選び、必要なら導入の配合を挟む
  const loopGoals = report?.request.goals ?? goals;
  const entryKey = (r: LoopResult) => `${mare}|${resultKey(r)}`;
  const entryOf = (r: LoopResult): Entry | null => {
    if (!mare) return null;
    const searched = entries[entryKey(r)];
    if (searched) return searched.result ? { kind: 'found', result: searched.result, bridge: searched.bridge } : { kind: 'none', status: searched.status };
    return { kind: 'searching', evaluated: entrySearch?.key === entryKey(r) ? entrySearch.evaluated : 0 };
  };
  const searchEntry = (r: LoopResult) => {
    const key = entryKey(r);
    entryWorker.current?.terminate();
    const w = new Worker(new URL('../core/worker.ts', import.meta.url), { type: 'module' });
    entryWorker.current = w;
    setEntrySearch({ key, evaluated: 0 });
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === 'progress') setEntrySearch({ key, evaluated: m.evaluated });
      else if (m.type === 'loopEntryDone') {
        setEntries((prev) => ({ ...prev, [key]: m.report })); setEntrySearch(null); w.terminate();
        if (pendingSave.current === key && m.report.result) setSavingResult(r);
        if (pendingSave.current === key) pendingSave.current = null;
      }
      else if (m.type === 'error') { setErr(m.message); setEntrySearch(null); w.terminate(); }
    };
    const pool = report?.request.stallionPool ?? buildRequest().stallionPool;
    w.postMessage({ type: 'startLoopEntry', master: app.master, userHorses: allUserHorses(app.data), rules: app.data.settings.rules, request: { mare, cycle: r.steps.map((s) => s.sire), goals: loopGoals, bridgePool: pool, maxBridge: ENTRY_MAX_BRIDGE, maxEvaluations: maxEval } } satisfies WorkerIn);
  };
  const cancelEntry = () => entryWorker.current?.postMessage({ type: 'cancel' } satisfies WorkerIn);
  const save = (r: LoopResult, name: string) => {
    const entry = entryOf(r);
    if (entry?.kind !== 'found') throw new Error('起点の繁殖牝馬から周期に入る経路がありません');
    const p = savePlanFromResult(name, mare, entry.result, loopGoals, undefined, app.ctx.rulesVersion, app.ctx.dataVersion, 'broodmare');
    setSaved({ ...saved, [resultKey(r)]: { id: p.id, name: p.name } });
    setSavedMsg({ id: p.id, name: p.name });
    setSavingResult(null);
  };
  // 行を開いたら、選んだ牝馬から周期に入る経路を探す（見つかるまで入り方と導入の配合を試す）
  const openResult = report?.results.find((r) => resultKey(r) === open) ?? null;
  useEffect(() => {
    if (!openResult || !mare) return;
    const key = `${mare}|${resultKey(openResult)}`;
    if (!entries[key] && entrySearch?.key !== key) searchEntry(openResult);
    // searchEntry は描画ごとに作り直すので依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openResult, mare, entries, entrySearch]);
  /** 既定の計画名。周期は実際に入る順（導入の後の1周目の並び）で書く */
  const planName = (r: LoopResult) => {
    const entry = entryOf(r);
    const cycle = entry?.kind === 'found' ? entry.result.steps.slice(entry.bridge, entry.bridge + r.length) : r.steps;
    return `${app.resolver.label(mare)} ループ ${cycle.map((s) => s.sireName).join('→')} 1周目`;
  };
  /** 表（スマホではカード）の「保存」。保存するのは選んだ繁殖牝馬からの導入と1周目 */
  const saveButton = (r: LoopResult) => {
    if (saved[resultKey(r)]) return <a href={`#/plans?id=${saved[resultKey(r)].id}`} className="small" onClick={(e) => e.stopPropagation()}>保存済み</a>;
    const entry = entryOf(r);
    return <button title={!mare ? '起点の繁殖牝馬を選ぶと保存できます' : entry?.kind === 'found' ? `${entryLabel(entry, r.length)}を計画として保存` : '導入と1周目を探して計画として保存'} disabled={!mare || entry?.kind === 'none'} onClick={(e) => {
      e.stopPropagation();
      if (entry?.kind === 'found') { setSavingResult(r); return; }
      pendingSave.current = entryKey(r);
      setOpen(resultKey(r));
    }}>保存</button>;
  };
  const route = (r: LoopResult) => r.steps.map((s) => s.sireName).join(' → ') + ' → …';

  return (
    <div>
      <div className="search-form">
        <SearchSection title="周期と上限" icon="horse" tip={<Tip label="周期と上限">同じ種牡馬を5世代以内に再び付けると1×Nの危険な配合になるため、危険な配合を避ける場合の周期は5以上になります。</Tip>}>
          <div className="search-limits">
            <label className="field">周期の長さ（最小）<input type="number" min={2} max={10} value={minL} onChange={(e) => setMinL(Number(e.target.value))} /></label>
            <label className="field">周期の長さ（最大）<input type="number" min={2} max={10} value={maxL} onChange={(e) => setMaxL(Number(e.target.value))} /></label>
            <label className="field">1周の種付料合計の上限（万）<input type="number" value={maxCost} onChange={(e) => setMaxCost(e.target.value)} placeholder="なし" /></label>
            <EvalLimitField value={maxEval} onChange={setMaxEval} />
          </div>
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
          <div className="toolbar loop-result-toolbar">
            <label className="field">並び順<select value={sort} onChange={(e) => { setSort(e.target.value as LoopSort); resultPage.setPage(0); }}><option value="cost">1周の費用が安い順</option><option value="perfect">完璧／凝ったの世代が多い順</option><option value="nicks">ニックス段階の合計順</option><option value="crosses">クロスが少ない順</option></select></label>
            <label className="field">起点の繁殖牝馬<HorseSelect value={mare} onChange={setMare} options={dOpts} aria-label="起点の繁殖牝馬" plannedToggle /></label>
            <SearchResultFilters results={report.results} horse={resultHorse} count={sorted.length} onHorseChange={(key) => { setResultHorse(key); resultPage.setPage(0); }} />
          </div>
          <ResultPagination {...resultPage} onChange={resultPage.setPage} />
          {savedMsg && <div className="notice" style={{ marginBottom: 8 }}>計画「{savedMsg.name}」を保存しました。<a href={`#/plans?id=${savedMsg.id}`}>計画を開く</a></div>}
          {mobile ? (
            <div className="result-cards" style={{ marginTop: 8 }}>
              {resultPage.rows.map((r) => <div key={resultKey(r)} className="result-card">
                <div className="result-head" onClick={() => setOpen(open === resultKey(r) ? null : resultKey(r))}><b>{route(r)} <CostUnknownTag steps={r.steps} /></b><span className="num muted">{r.length}頭 / {r.cost.toLocaleString()}万</span></div>
                <div className="result-card-actions">{saveButton(r)}</div>
                {open === resultKey(r) && <LoopDetail r={r} mareName={mare ? app.resolver.label(mare) : ''} entry={entryOf(r)} onSearchEntry={() => searchEntry(r)} onCancelEntry={cancelEntry} />}
              </div>)}
            </div>
          ) : (
            <div className="table-wrap" style={{ marginTop: 8 }}><table>
              <thead><tr><th className="num">#</th><th className="num">周期</th><th className="num">1周の費用</th><th className="wrap">種牡馬の並び</th><th className="wrap">各世代の判定</th><th></th></tr></thead>
              <tbody>{resultPage.rows.map((r, i) => [
                <tr key={resultKey(r)} className={'clickable' + (open === resultKey(r) ? ' selected' : '')} onClick={() => setOpen(open === resultKey(r) ? null : resultKey(r))}>
                  <td className="num">{resultPage.offset + i + 1}</td><td className="num">{r.length}</td><td className="num">{r.cost.toLocaleString()}</td>
                  <td className="name wrap">{route(r)} <CostUnknownTag steps={r.steps} /></td>
                  <td className="wrap small">{r.steps.map((s, k) => <span key={k} className="loop-gen">{k + 1}: {s.judgement.perfectKotta === '成立' ? '完璧／凝った' : s.judgement.perfect === '成立' ? '完璧' : [s.judgement.omoshiro === '成立' && '面白', s.judgement.migoto === '成立' && '見事', s.judgement.kotta === '成立' && '凝った'].filter(Boolean).join('・') || '—'}{s.judgement.nicksLevel > 0 && ` ★${s.judgement.nicksLevel}`}</span>)}</td>
                  <td className="action">{saveButton(r)}</td>
                </tr>,
                open === resultKey(r) && <tr key={'d' + resultKey(r)}><td colSpan={6} className="wrap"><LoopDetail r={r} mareName={mare ? app.resolver.label(mare) : ''} entry={entryOf(r)} onSearchEntry={() => searchEntry(r)} onCancelEntry={cancelEntry} /></td></tr>,
              ])}</tbody>
            </table></div>
          )}
          <ResultPagination {...resultPage} onChange={resultPage.setPage} />
          {report.results.length > 0 && sorted.length === 0 && <div className="empty">絞り込みに一致する周期はありません。</div>}
          {report.results.length === 0 && !running && <div className="empty">条件を満たす周期は見つかりませんでした。周期を長くするか、条件を減らしてください。</div>}
        </div>
      )}
      {savingResult && <SavePlanDialog defaultName={planName(savingResult)} onSave={(name) => save(savingResult, name)} onClose={() => setSavingResult(null)} />}
    </div>
  );
}

/** 開いた周期: 回し続けた時の各世代と、選んだ繁殖牝馬からの導入と1周目（表の「保存」で保存するのはこの手順） */
function LoopDetail({ r, mareName, entry, onSearchEntry, onCancelEntry }: { r: LoopResult; mareName: string; entry: Entry | null; onSearchEntry: () => void; onCancelEntry: () => void }) {
  return <div className="loop-detail">
    <h4>周期（回し続けた時の各世代）</h4>
    <ol className="steps">{r.steps.map((s, k) => <li key={k}><b>{s.sireName}</b>（{s.cost}万）× 前世代の産駒牝馬 <ConditionTags constraints={s.constraints} /><div><Summary s={s.judgement} /></div></li>)}</ol>
    {!entry ? <p className="small muted">起点の繁殖牝馬を選ぶと、そこから周期に入る手順を出します。</p> : <>
      <h4>{mareName}からの{entry.kind === 'found' ? entryLabel(entry, r.length) : '手順'}</h4>
      {entry.kind === 'found' ? <>
        <ol className="steps">{entry.result.steps.map((s, k) => <li key={k}><span className="tag">{k < entry.bridge ? '導入' : `${Math.floor((k - entry.bridge) / r.length) + 1}周目`}</span> <b>{s.sireName}</b> × {s.damName} <ConditionTags constraints={s.constraints} /><div><Summary s={s.judgement} /></div>{k === 0 && <a href={`#/mating?sire=${encodeURIComponent(s.sire)}&dam=${encodeURIComponent(s.dam)}`}>配合確認で開く</a>}</li>)}</ol>
      </>
        : entry.kind === 'none' ? <div className="inline-row"><span className="small">{entry.status === '完了' ? `導入の配合を${ENTRY_MAX_BRIDGE}回まで挟んでも、目標を満たしたまま周期に入る手順はありません。` : `手順の探索は途中で止まりました（${entry.status}）。`}</span>{entry.status !== '完了' && <button onClick={onSearchEntry}>もう一度探す</button>}</div>
        : <div className="inline-row"><span className="small muted" role="status">探索中 · 判定 {entry.evaluated.toLocaleString()} 回</span><button onClick={onCancelEntry}>中止</button></div>}
    </>}
  </div>;
}

/** 経路の中身の呼び方。元の牝馬の血が抜けるまでが1周に収まらない短い周期では、2周目以降も含む */
const entryLabel = (entry: { result: SearchResult; bridge: number }, length: number) => {
  const cycles = Math.ceil((entry.result.steps.length - entry.bridge) / length);
  const cycle = cycles === 1 ? '1周目' : `${cycles}周目まで`;
  return entry.bridge ? `導入と${cycle}` : cycle;
};

/** 選んだ繁殖牝馬から周期に入る経路の状態 */
type Entry =
  | { kind: 'found'; result: SearchResult; bridge: number }
  | { kind: 'none'; status: LoopEntryReport['status'] }
  | { kind: 'searching'; evaluated: number };

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp, sireOptions, damOptions, includePlannedInSearch } from './app-context';
import { Icon } from './icons';
import { HorseSelect } from './HorseSelect';
import { goalLabel, type JudgementSummary, type SearchGoal, type SearchStep } from '../core/search';
import { designEnv, lineRecords, type DesignReport, type DesignRequest, type DesignResult } from '../core/design-search';
import type { WorkerIn, WorkerOut } from '../core/worker';
import { saveDesign, allUserHorses } from '../store/userdata';
import type { Plan } from '../store/model';
import { resolvePlanHorses } from '../store/plan-horses';
import { StallionFilter, EMPTY_FILTER, matchesStallion, isFilterActive, type StallionFilterState } from './StallionFilter';
import { judge } from '../core/judge';
import { estimateYears, YEAR_ASSUMPTIONS } from '../core/estimate';
import { foldDominated, wantedEffects } from '../core/result-order';
import { ownedOrigins, resultOptions, sortCompare, type SortItem, type SortKey } from './search-order';
import { Pedigree } from './Pedigree';
import { SummaryStrip, JudgeView } from './JudgeView';
import { SavePlanDialog } from './SavePlanDialog';
import { ActionDialog } from './ActionDialog';
import { navigate } from './router';
import { isSearchJobActive, type SearchJob } from '../api';
import { designReport, stopSearchJob, submitSearchJob } from '../store/search-jobs';
import { ResultPagination } from './ResultPagination';
import { useResultPage } from './use-result-page';
import { SearchResultFilters } from './SearchResultFilters';
import { ConditionTags, CostUnknownTag, EvalLimitField, GoalEditor, OriginPicker, SearchSection, SortSelect, Summary, useMemoState, useMobile } from './SearchPage';
import { Tip } from './Tip';

const DEFAULT_GOALS: SearchGoal[] = [{ type: 'perfect' }, { type: 'notDangerous' }];
const DEFAULT_EVALUATIONS = 50_000_000;
/** 世代数の入力の上限。牡は種牡馬にするまで競走を挟むので短くする */
const COLT_MAX = 2, FILLY_MAX = 4;

/** 計画の手順から探し直す時の、その手順の母と残りの手順の数 */
function replanTarget(app: ReturnType<typeof useApp>, params: URLSearchParams): { plan: Plan; from: number; dam: string; remaining: number } | null {
  const plan = app.data.plans.find((p) => p.id === params.get('replan'));
  const from = Number(params.get('from'));
  const step = plan?.steps[from];
  return plan && step ? { plan, from, dam: resolvePlanHorses(plan, app.data).key(step.dam), remaining: plan.steps.length - from } : null;
}

const resultKey = (r: DesignResult) => [r.colt.start, ...r.colt.steps.map((s) => s.sire), '|', r.filly.start, ...r.filly.steps.map((s) => s.sire)].join('>');

/** 配合の強さの印（成立した配合理論とニックス） */
function StrengthMarks({ s }: { s: JudgementSummary }) {
  const marks = [s.omoshiro === '成立' && '面', s.migoto === '成立' && '見', s.kotta === '成立' && '凝', s.nicksLevel > 0 && 'ニ'].filter(Boolean);
  return marks.length ? <span className="design-marks" title="成立した配合理論（面白・見事・凝った・ニックス）">{marks.join('')}</span> : <span className="design-marks weak" title="配合理論なし">—</span>;
}
/** 系統の起点と、付けていく種牡馬 */
function LineRoute({ start, steps }: { start: string; steps: SearchStep[] }) {
  return <span className="design-route">{start}{steps.map((s, i) => <span key={i}> → {s.sireName}<StrengthMarks s={s.judgement} /></span>)}</span>;
}

export function DesignSearch({ filter, setFilter, params, job }: { filter: StallionFilterState; setFilter: (filter: StallionFilterState) => void; params: URLSearchParams; job: (SearchJob & { kind: 'design' }) | null }) {
  const app = useApp();
  const mobile = useMobile();
  const env = useMemo(() => designEnv({ ctx: app.ctx, rules: app.rules, resolve: (k: string) => app.resolver.get(k) }), [app]);
  // バックグラウンドの探索を開いた時は、その条件を入力欄に戻し、結果は取り直すたびに差し替える（この画面で新しく探索を始めたら切り離す）
  const jr = job?.request ?? null;
  const [viewingJob, setViewingJob] = useState(!!job);
  // 系統の種牡馬の候補（探索に使う集合）は設定 excludePlannedFromSearch に従う。選択リストは表示設定 hidePlanned に従う（連動しない）
  const sOpts = useMemo(() => sireOptions(app, { onlyAvailable: true, requirePedigree: true, includePlanned: includePlannedInSearch(app), includeOverseas: filter.includeOverseas }), [app, filter.includeOverseas]);
  const hidePlanned = !!app.data.settings.hidePlanned;
  const damPick = useMemo(() => damOptions(app, { onlyAvailable: true, requirePedigree: true, includePlanned: !hidePlanned }), [app, hidePlanned]);
  const sirePick = useMemo(() => sireOptions(app, { onlyAvailable: true, requirePedigree: true, includePlanned: !hidePlanned, includeOverseas: filter.includeOverseas }), [app, hidePlanned, filter.includeOverseas]);
  const owned = useMemo(() => ownedOrigins(app, 'mare'), [app]);
  // 計画の途中から探し直す時は、その手順の母を牝の系統の起点に固定する。保存するとその計画の手順を置き換える
  const replan = useMemo(() => replanTarget(app, params), [app, params]);
  const urlMare = params.get('mare'), urlSire = params.get('sire');
  const [coltStarts, setColtStarts] = useMemoState<string[]>('design', 'coltStarts', [], jr?.colt.starts ?? null);
  const [coltMin, setColtMin] = useMemoState<number>('design', 'coltMin', 0, urlSire ? 0 : jr?.colt.minGenerations ?? null);
  const [coltMax, setColtMax] = useMemoState<number>('design', 'coltMax', 2, urlSire ? 0 : jr?.colt.maxGenerations ?? null);
  const [coltSire, setColtSire] = useMemoState<string>('design', 'coltSire', '', urlMare || replan ? (urlSire ?? '') : jr ? (jr.colt.sires.length === 1 ? jr.colt.sires[0] : '') : null);
  const [coltRequired, setColtRequired] = useMemoState<string>('design', 'coltRequired', '', jr ? (jr.colt.required ?? '') : null);
  const [fillyStarts, setFillyStarts] = useMemoState<string[]>('design', 'fillyStarts', [], urlMare ? [urlMare] : jr?.filly.starts ?? null);
  const [fillyMin, setFillyMin] = useMemoState<number>('design', 'fillyMin', 0, replan ? 0 : jr?.filly.minGenerations ?? null);
  const [fillyMax, setFillyMax] = useMemoState<number>('design', 'fillyMax', 2, replan ? Math.min(FILLY_MAX, replan.remaining - 1) : jr?.filly.maxGenerations ?? null);
  const [fillyRequired, setFillyRequired] = useMemoState<string>('design', 'fillyRequired', '', jr ? (jr.filly.required ?? '') : null);
  const [goals, setGoals] = useMemoState<SearchGoal[]>('design', 'goals', DEFAULT_GOALS, replan?.plan.goals.length ? replan.plan.goals : jr?.goals ?? null);
  const [strong, setStrong] = useMemoState<boolean>('design', 'strong', true, jr?.strongLines ?? null);
  const [maxCost, setMaxCost] = useMemoState<string>('design', 'maxCost', '', jr ? (jr.maxCost == null ? '' : String(jr.maxCost)) : null);
  const [maxEval, setMaxEval] = useMemoState<number>('design', 'maxEval', DEFAULT_EVALUATIONS, jr?.maxEvaluations ?? null);
  const fillyOrigins = replan ? [replan.dam] : fillyStarts;
  const [progress, setProgress] = useState<{ evaluated: number; pruned: number; found: number } | null>(null);
  const [ownReport, setReport] = useMemoState<DesignReport | null>('design', 'report', null);
  // バックグラウンドの探索を見ている間は、取り直したジョブの結果をそのまま出す
  const jobReport = useMemo(() => (job ? designReport(job) : null), [job]);
  const report = viewingJob && jobReport ? jobReport : ownReport;
  const [err, setErr] = useState('');
  const [started, setStarted] = useState<SearchJob | null>(null);
  const jobRunning = viewingJob && !!job && isSearchJobActive(job);
  const running = !!progress || jobRunning;
  const runningProgress = progress ?? (jobRunning ? job.progress : null);
  const [sort, setSort] = useMemoState<SortKey>('design', 'sort', 'recommended');
  const [open, setOpen] = useMemoState<string | null>('design', 'open', null);
  const [preview, setPreview] = useMemoState<string>('design', 'preview', 'merge');
  const [resultHorse, setResultHorse] = useState('');
  const [resultColt, setResultColt] = useState('');
  const [resultFilly, setResultFilly] = useState('');
  const [replacing, setReplacing] = useState<DesignResult | null>(null);
  const [savingResult, setSavingResult] = useState<DesignResult | null>(null);
  const [saveRole, setSaveRole] = useMemoState<'stallion' | 'broodmare' | 'none'>('design', 'saveRole', 'none');
  const [saved, setSaved] = useMemoState<Record<string, { id: string; name: string }>>('design', 'saved', {});
  const [savedMsg, setSavedMsg] = useState<{ id: string; name: string; colt: string | null } | null>(null);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);

  const buildRequest = (): DesignRequest => {
    const passes = (key: string) => { const m = app.master.stallions.find((s) => s.id === key); return !m || matchesStallion(m, filter); };
    const all = sOpts.map((o) => o.key);
    const filtered = isFilterActive(filter) ? all.filter(passes) : all;
    return {
      colt: { starts: coltStarts, minGenerations: coltMin, maxGenerations: coltMax, required: coltRequired || null, sires: coltSire ? [coltSire] : filtered },
      filly: { starts: fillyOrigins, minGenerations: fillyMin, maxGenerations: fillyMax, required: fillyRequired || null },
      stallionPool: filter.applyToIntermediate ? filtered : all, goals, strongLines: strong, maxCost: maxCost ? Number(maxCost) : null, maxEvaluations: maxEval,
    };
  };
  const validate = () => {
    const e = !fillyOrigins.length ? '牝の系統の起点の繁殖牝馬を選んでください'
      : coltMax > 0 && coltMin > 0 && !coltStarts.length ? '牡の系統の起点の繁殖牝馬を選んでください'
      : coltMin > coltMax || fillyMin > fillyMax ? '世代数の最小が最大を超えています'
      : coltRequired && coltMax < 1 ? '牡の系統で使う種牡馬を指定するときは、牡の系統の世代数の最大を1以上にしてください'
      : fillyRequired && fillyMax < 1 ? '牝の系統で使う種牡馬を指定するときは、牝の系統の世代数の最大を1以上にしてください'
      : !filter.includeOverseas && app.master.stallions.some((h) => h.overseas && [coltSire, coltRequired, fillyRequired].includes(h.id)) ? '指定した種牡馬に海外種牡馬が含まれています。「海外種牡馬を除外」のチェックを外すか、指定を解除してください'
      : '';
    setErr(e);
    return !e;
  };
  const startedAt = useRef(0);
  const resetView = () => { resultPage.setPage(0); setResultHorse(''); setResultColt(''); setResultFilly(''); setSaved({}); setSavedMsg(null); setStarted(null); setOpen(null); setViewingJob(false); };
  const start = () => {
    if (!validate()) return;
    resetView();
    setErr(''); setReport(null); setProgress({ evaluated: 0, pruned: 0, found: 0 });
    const req = buildRequest();
    startedAt.current = Date.now();
    worker.current?.terminate();
    const w = new Worker(new URL('../core/worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === 'progress') {
        setProgress({ evaluated: m.evaluated, pruned: m.pruned, found: m.found });
        // 見つかった設計は終了を待たずに並べる（集計は途中の値）
        if (m.results.length) setReport((prev) => ({ status: '中止', results: [...(prev?.results ?? []), ...(m.results as DesignResult[])], evaluated: m.evaluated, pruned: m.pruned, dataIssues: 0, folded: 0, elapsedMs: Date.now() - startedAt.current, request: req }));
      } else if (m.type === 'designDone') { setReport(m.report); setProgress(null); }
      else if (m.type === 'error') { setErr(m.message); setProgress(null); }
    };
    w.postMessage({ type: 'startDesign', master: app.master, userHorses: allUserHorses(app.data), rules: app.data.settings.rules, request: req } satisfies WorkerIn);
  };
  const cancel = () => (progress ? worker.current?.postMessage({ type: 'cancel' } satisfies WorkerIn) : job && void stopSearchJob(job.id));
  /** サーバに任せて画面を離れても続ける。結果は右上の「探索」か、この画面の案内から開く */
  const background = async () => {
    if (!validate()) return;
    setErr('');
    try { setStarted(await submitSearchJob('design', buildRequest())); } catch (e) { setErr((e as Error).message); }
  };
  const reset = () => {
    setColtStarts([]); setColtMin(0); setColtMax(2); setColtSire(''); setColtRequired('');
    if (!replan) { setFillyStarts([]); setFillyMin(0); setFillyMax(2); }
    setFillyRequired(''); setGoals(DEFAULT_GOALS); setStrong(true); setMaxCost(''); setMaxEval(DEFAULT_EVALUATIONS); setFilter(EMPTY_FILTER);
    setReport(null); setOpen(null); setErr(''); setStarted(null); setViewingJob(false);
  };

  // 判定が同じで、費用・世代数・系統の強さのすべてで上回られる設計は畳む
  const { shown, folded } = useMemo(() => (report ? foldDominated(report.results) : { shown: [], folded: 0 }), [report]);
  const filters = useMemo(() => {
    const rs = report?.results ?? [];
    return {
      horses: resultOptions(rs.flatMap((r) => [...r.colt.steps, ...r.filly.steps, ...(r.colt.steps.length ? [] : [r.merge])].map((s) => ({ key: s.sire, name: s.sireName }))), '探索結果の種牡馬'),
      colts: resultOptions(rs.map((r) => ({ key: r.colt.start, name: r.colt.startName })), '牡の系統の起点'),
      fillies: resultOptions(rs.map((r) => ({ key: r.filly.start, name: r.filly.startName })), '牝の系統の起点'),
    };
  }, [report]);
  const sorted = useMemo(() => {
    if (!report) return [];
    const rs = shown.filter((r) => (!resultHorse || [...r.colt.steps, ...r.filly.steps].some((s) => s.sire === resultHorse) || (!r.colt.steps.length && r.colt.start === resultHorse))
      && (!resultColt || r.colt.start === resultColt) && (!resultFilly || r.filly.start === resultFilly));
    const attrsOf = (r: DesignResult) => (r.colt.steps.length ? undefined : app.master.stallions.find((x) => x.id === r.colt.start)?.attrs);
    const item = (r: DesignResult): SortItem => ({ cost: r.cost, matings: r.generations, s: r.merge.judgement, strength: r.strength, attrs: attrsOf(r) });
    const wanted = wantedEffects(report.request.goals);
    return [...rs].sort((a, b) => sortCompare(sort, item(a), item(b), wanted));
  }, [report, shown, sort, app, resultHorse, resultColt, resultFilly]);
  const resultPage = useResultPage(sorted, mobile ? 100 : 200);
  const { offset: resultOffset, pageSize: resultPageSize, setPage: setResultPage } = resultPage;
  useEffect(() => {
    if (mobile) return;
    const f = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (!sorted.length) return;
      if (e.key === 'Escape') { setOpen(null); return; }
      const down = e.key === 'ArrowDown' || e.key === 'j';
      const up = e.key === 'ArrowUp' || e.key === 'k';
      if (!down && !up) return;
      const current = sorted.findIndex((r) => resultKey(r) === open);
      const next = current < 0 ? resultOffset : Math.max(0, Math.min(sorted.length - 1, current + (down ? 1 : -1)));
      setOpen(resultKey(sorted[next]));
      setResultPage(Math.floor(next / resultPageSize));
      e.preventDefault();
    };
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  }, [mobile, sorted, open, setOpen, resultOffset, resultPageSize, setResultPage]);

  const markSaved = (r: DesignResult, p: { plan: Plan; coltPlan: Plan | null }) => {
    setSaved({ ...saved, [resultKey(r)]: { id: p.plan.id, name: p.plan.name } });
    setSavedMsg({ id: p.plan.id, name: p.plan.name, colt: p.coltPlan?.name ?? null });
  };
  const save = (r: DesignResult, name: string) => {
    markSaved(r, saveDesign(name, r, report?.request.goals ?? goals, app.ctx.rulesVersion, app.ctx.dataVersion, saveRole));
    setSavingResult(null);
  };
  const replace = (r: DesignResult) => {
    markSaved(r, saveDesign(replan!.plan.name, r, report?.request.goals ?? goals, app.ctx.rulesVersion, app.ctx.dataVersion, saveRole, { planId: replan!.plan.id, from: replan!.from }));
    setReplacing(null);
  };
  /** 表（スマホではカード）の「保存」。計画から探し直している時は、計画の手順を置き換える */
  const saveButton = (r: DesignResult) => saved[resultKey(r)]
    ? <a href={`#/plans?id=${saved[resultKey(r)].id}`} className="small" onClick={(e) => e.stopPropagation()}>保存済み</a>
    : <button title={replan ? `計画の${replan.from + 1}回目以降をこの設計に置き換える` : 'この設計を計画として保存'} onClick={(e) => { e.stopPropagation(); if (replan) setReplacing(r); else setSavingResult(r); }}>{replan ? '置き換え' : '保存'}</button>;
  // 種付料未確認の札は、その配合がある系統の側に出す（世代数0の牡は最後の配合の種付料）
  const coltCell = (r: DesignResult, tag = true) => <>{r.colt.steps.length ? <LineRoute start={r.colt.startName} steps={r.colt.steps} /> : <span className="design-route">{r.colt.startName}</span>} {tag && <CostUnknownTag steps={[...r.colt.steps, r.merge]} />}</>;
  const fillyCell = (r: DesignResult, tag = true) => <><LineRoute start={r.filly.startName} steps={r.filly.steps} /> {tag && <CostUnknownTag steps={r.filly.steps} />}</>;
  const years = (r: DesignResult) => estimateYears(r.generations).estimatedYears;

  /** 展開した設計の中身: 系統ごとの手順と、選んだ配合の血統表・判定 */
  const expanded = (r: DesignResult) => {
    const colts = lineRecords(env, 'colt', r.colt), fillies = lineRecords(env, 'filly', r.filly);
    const choices = [
      ...r.colt.steps.map((s, i) => ({ key: `colt:${i}`, label: `牡の系統 ${i + 1}回目: ${s.sireName}`, sire: colts.length ? app.resolver.get(s.sire) : null, dam: colts[i] ?? null })),
      ...r.filly.steps.map((s, i) => ({ key: `filly:${i}`, label: `牝の系統 ${i + 1}回目: ${s.sireName}`, sire: fillies.length ? app.resolver.get(s.sire) : null, dam: fillies[i] ?? null })),
      { key: 'merge', label: `最後の配合: ${r.merge.sireName} × ${r.merge.damName}`, sire: colts.at(-1) ?? null, dam: fillies.at(-1) ?? null },
    ];
    const chosen = choices.find((c) => c.key === preview) ?? choices[choices.length - 1];
    const j = chosen.sire && chosen.dam ? judge(chosen.sire, chosen.dam, env.ctx) : null;
    const stepList = (steps: SearchStep[], last: string) => <ol className="steps">
      {steps.map((s, k) => <li key={k}><b>{s.sireName}</b> × {s.damName}（{s.cost}万）→ {k < steps.length - 1 ? '牝馬を残して繁殖入り' : last} <ConditionTags constraints={s.constraints} /><div><Summary s={s.judgement} /></div></li>)}
    </ol>;
    return <div className="result-expanded design-detail" onClick={(e) => e.stopPropagation()}>
      <h4>牡の系統</h4>
      {r.colt.steps.length ? stepList(r.colt.steps, '牡を残して種牡馬入り') : <p className="small">{r.colt.startName}をそのまま付けます。</p>}
      <h4>牝の系統</h4>
      {r.filly.steps.length ? stepList(r.filly.steps, '牝馬を残して繁殖入り') : <p className="small">{r.filly.startName}にそのまま付けます。</p>}
      <h4>最後の配合</h4>
      <ol className="steps"><li><b>{r.merge.sireName}</b> × {r.merge.damName}{r.merge.cost > 0 && `（${r.merge.cost}万）`} → 最終産駒 <ConditionTags constraints={r.merge.constraints} /><div><Summary s={r.merge.judgement} /></div></li></ol>
      <div className="small">目標: {r.goals.map((g, k) => <span key={k} className="tag">{goalLabel(g.goal)}: {g.verdict}</span>)}</div>
      <div className="small">所要年数の目安: 約{years(r)}年 <Tip label="所要年数の目安">{YEAR_ASSUMPTIONS.note}牡の系統と牝の系統は並行して進める想定で、長い方の系統の世代数から数えます。</Tip></div>
      <div className="inline-row">
        <select aria-label="血統表を表示する配合" value={chosen.key} onChange={(e) => setPreview(e.target.value)}>{choices.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
        {chosen.key !== 'merge' && chosen.sire && chosen.dam && !chosen.dam.key.startsWith('p:') && <a href={`#/mating?sire=${encodeURIComponent(chosen.sire.key)}&dam=${encodeURIComponent(chosen.dam.key)}`}>この配合を配合確認で開く</a>}
      </div>
      {j ? <><SummaryStrip j={j} /><Pedigree j={j} /><details><summary className="small">判定の根拠</summary><JudgeView j={j} showSummary={false} /></details></> : <div className="muted small">この配合の血統は表示できません</div>}
    </div>;
  };

  const genRange = (label: string, min: number, max: number, limit: number, setMin: (v: number) => void, setMax: (v: number) => void, extra?: ReactNode) => (
    <div className="field"><span>世代数{extra}</span><div className="design-gen-range">
      <input type="number" aria-label={`${label}の世代数（最小）`} min={0} max={limit} value={min} onChange={(e) => setMin(Number(e.target.value))} />
      <span aria-hidden="true">〜</span>
      <input type="number" aria-label={`${label}の世代数（最大）`} min={0} max={limit} value={max} onChange={(e) => setMax(Number(e.target.value))} />
    </div></div>
  );
  const fillyCount = fillyOrigins.length;
  /** 起点の選択をまとめて変える操作: 探索から外していない所有の繁殖牝馬をまとめて加える／選んだ起点をすべて外す */
  const startActions = (selected: string[], set: (keys: string[]) => void) => <>
    <button type="button" className="search-origin-add" disabled={owned.every((k) => selected.includes(k))} onClick={() => set([...selected, ...owned.filter((k) => !selected.includes(k))])}>所有の繁殖牝馬を全選択{owned.length > 0 && <span className="muted">（{owned.length}頭）</span>}</button>
    <button type="button" className="search-origin-add" disabled={!selected.length} onClick={() => set([])}>すべて外す</button>
  </>;

  return (
    <div>
      <div className="search-form">
        {replan && <div className="notice search-replan">計画「{replan.plan.name}」の{replan.from + 1}回目から探し直します。保存すると{replan.from + 1}回目以降の手順を置き換えます。<button type="button" className="text-toggle" onClick={() => navigate('/search', { mode: 'design' })}>やめる</button></div>}
        <SearchSection title="牡の系統" icon="horse" qualifier="最後の配合の父" tip={<Tip label="牡の系統">世代数0は、今いる種牡馬をそのまま最後の配合の父にします。1以上は、起点の繁殖牝馬に種牡馬を付けていき（途中は牝馬を残します）、最後に生まれる牡を種牡馬にして父にします。</Tip>}>
          <div className="search-horse-fields search-horse-fields-three">
            {genRange('牡の系統', coltMin, coltMax, COLT_MAX, setColtMin, setColtMax)}
            <div className="field"><span>系統で使う種牡馬（任意）</span><HorseSelect value={coltRequired} onChange={(key) => { setColtRequired(key); if (key && coltMax < 1) setColtMax(1); }} options={sirePick} aria-label="牡の系統で使う種牡馬（任意）" disabled={coltMax < 1} plannedToggle /></div>
            <div className="field"><span>世代数0で付ける種牡馬（任意）</span><HorseSelect value={coltSire} onChange={setColtSire} options={sirePick} aria-label="世代数0で付ける種牡馬（任意）" placeholder="指定なし（候補の種牡馬すべて）" disabled={coltMin > 0} plannedToggle /></div>
          </div>
          {coltMax > 0 && <div className="field design-starts"><span>起点の繁殖牝馬</span><OriginPicker label="繁殖牝馬" options={damPick} selected={coltStarts} onChange={setColtStarts} ariaLabel="牡の系統の起点を追加" actions={startActions(coltStarts, setColtStarts)} /></div>}
        </SearchSection>
        <SearchSection title="牝の系統" icon="horse" qualifier="最後の配合の母" tip={<Tip label="牝の系統">世代数0は、起点の繁殖牝馬をそのまま最後の配合の母にします。1以上は、起点の繁殖牝馬に種牡馬を付けて牝馬を残していき、最後に生まれる牝馬を母にします。</Tip>}>
          <div className="search-horse-fields search-horse-fields-three">
            {genRange('牝の系統', fillyMin, fillyMax, FILLY_MAX, setFillyMin, setFillyMax)}
            <div className="field"><span>系統で使う種牡馬（任意）</span><HorseSelect value={fillyRequired} onChange={(key) => { setFillyRequired(key); if (key && fillyMax < 1) setFillyMax(1); }} options={sirePick} aria-label="牝の系統で使う種牡馬（任意）" disabled={fillyMax < 1} plannedToggle /></div>
          </div>
          <div className="field design-starts"><span>起点の繁殖牝馬</span>{replan
            ? <HorseSelect value={replan.dam} onChange={() => undefined} options={[{ key: replan.dam, name: app.resolver.label(replan.dam), group: '計画' }]} aria-label="牝の系統の起点" disabled />
            : <OriginPicker label="繁殖牝馬" options={damPick} selected={fillyStarts} onChange={setFillyStarts} ariaLabel="牝の系統の起点を追加" actions={startActions(fillyStarts, setFillyStarts)} />}</div>
        </SearchSection>
        <GoalEditor goals={goals} setGoals={setGoals} qualifier="最後の配合" />
        <SearchSection title="系統と上限" icon="sliders">
          <label className="search-repeat"><input type="checkbox" checked={strong} onChange={(e) => setStrong(e.target.checked)} />系統の配合でも配合理論を成立させる<Tip label="系統の配合でも配合理論を成立させる">牡の系統・牝の系統の配合それぞれで、面白い配合・見事な配合・凝った配合・ニックスのいずれかが成立する設計だけを探します。途中の世代も強い馬にするためです。「危険な配合でない」を条件にした時は、系統の配合でも危険な配合を避けます。</Tip></label>
          <div className="search-limits">
            <label className="field">種付料合計の上限（万）<input type="number" value={maxCost} onChange={(e) => setMaxCost(e.target.value)} placeholder="なし" /></label>
            <EvalLimitField value={maxEval} onChange={setMaxEval} />
          </div>
        </SearchSection>
        <SearchSection title="種牡馬の属性" icon="sliders"><StallionFilter value={filter} onChange={setFilter} showIntermediate /></SearchSection>
        <div className="search-actions">
          <button type="button" className="search-reset" disabled={running} onClick={reset}><Icon name="reset" />条件をリセット</button>
          {runningProgress && <span className="search-progress-label" role="status">{jobRunning ? 'バックグラウンドで探索中 · ' : ''}判定 {runningProgress.evaluated.toLocaleString()} 回 / 発見 {runningProgress.found} 件</span>}
          {running ? <button className="search-submit" onClick={cancel}>探索を中止</button> : <span className="search-submit-group">
            <button className="search-submit" disabled={!fillyCount} onClick={() => void background()}>バックグラウンドで探索</button>
            <button className="primary search-submit" disabled={!fillyCount} onClick={start}><Icon name="search" />探索{fillyCount > 1 && <span className="search-submit-count">牝の起点 {fillyCount}頭</span>}</button>
          </span>}
        </div>
        {runningProgress && <div className="progress"><div style={{ width: `${Math.min(100, (runningProgress.evaluated / maxEval) * 100)}%` }} /></div>}
        {started && <div className="notice">バックグラウンドで探索を始めました。<a href={`#/search?job=${encodeURIComponent(started.id)}`}>途中経過を開く</a>　<span className="muted small">右上の「探索」からも開けます。</span></div>}
        {err && <div className="error" role="alert">{err}</div>}
      </div>
      {report && (
        <div className="panel">
          <div className="result-status">
            <div>
              <b>{running ? `探索中: 条件を満たす設計 ${shown.length} 件` : report.status === '完了' ? (shown.length ? `条件を満たす設計 ${shown.length.toLocaleString()} 件` : '指定範囲に解なし') : `探索未完了（${report.status}）`}</b>
              {!running && report.status === '完了' && <span className="muted">　指定範囲は探索済み</span>}
            </div>
            <div className="small muted">
              判定 {report.evaluated.toLocaleString()} 回、枝刈り {report.pruned.toLocaleString()}、{(report.elapsedMs / 1000).toFixed(1)} 秒{running && '（途中）'}
              {report.dataIssues > 0 && <>。不明な祖先や自家製馬のペア判定不可で「未確定」に留まった組 {report.dataIssues} 件</>}
            </div>
            {report.folded + folded > 0 && <div className="small muted">起点と最後の配合の判定が同じで、費用・世代数・系統の強さのすべてで上回られる設計 {(report.folded + folded).toLocaleString()} 件は省いています。</div>}
          </div>
          <div className="toolbar design-result-toolbar">
            <SortSelect value={sort} onChange={(value) => { setSort(value); resultPage.setPage(0); }} costLabel="費用が安い順" matings matingsLabel="世代数が少ない順" />
            <label className="field">最終産駒の役割<select value={saveRole} onChange={(e) => setSaveRole(e.target.value as typeof saveRole)}><option value="none">競走馬（指定なし）</option><option value="broodmare">繁殖牝馬にする</option><option value="stallion">種牡馬にする</option></select></label>
            <SearchResultFilters count={sorted.length} total={shown.length} filters={[
              { label: '牝の系統の起点', value: resultFilly, options: filters.fillies, onChange: (key) => { setResultFilly(key); resultPage.setPage(0); } },
              { label: '牡の系統の起点', value: resultColt, options: filters.colts, onChange: (key) => { setResultColt(key); resultPage.setPage(0); } },
              { label: '使う種牡馬', value: resultHorse, options: filters.horses, onChange: (key) => { setResultHorse(key); resultPage.setPage(0); } },
            ]} />
          </div>
          <ResultPagination {...resultPage} onChange={resultPage.setPage} />
          {savedMsg && <div className="notice" style={{ marginBottom: 8 }}>計画「{savedMsg.name}」を保存しました{savedMsg.colt && <>（牡の系統は計画「{savedMsg.colt}」）</>}。<a href={`#/plans?id=${savedMsg.id}`}>計画を開く</a>　<span className="muted small">この画面の結果はそのまま残ります。</span></div>}
          {mobile ? (
            <div className="result-cards" style={{ marginTop: 8 }}>
              {resultPage.rows.map((r) => (
                <div key={resultKey(r)} className="result-card">
                  <div className="result-head" onClick={() => setOpen(open === resultKey(r) ? null : resultKey(r))}>
                    <span className="design-card-lines"><span><span className="design-side">牡</span>{coltCell(r, false)}</span><span><span className="design-side">牝</span>{fillyCell(r, false)}</span><CostUnknownTag steps={[...r.colt.steps, ...r.filly.steps, r.merge]} /></span>
                    <span className="num muted">{r.generations}世代（{years(r)}年〜） / {r.cost.toLocaleString()}万</span>
                  </div>
                  <div onClick={() => setOpen(open === resultKey(r) ? null : resultKey(r))}><Summary s={r.merge.judgement} /></div>
                  <div className="result-card-actions">{saveButton(r)}</div>
                  {open === resultKey(r) && expanded(r)}
                </div>
              ))}
            </div>
          ) : (
            <div className="table-wrap" style={{ marginTop: 8 }}><table>
              <thead><tr><th className="num">#</th><th className="num">世代</th><th className="num">費用</th><th className="wrap">牡の系統</th><th className="wrap">牝の系統</th><th className="wrap">最後の配合の判定</th><th></th></tr></thead>
              <tbody>
                {resultPage.rows.map((r, i) => [
                  <tr key={resultKey(r)} className={'clickable' + (open === resultKey(r) ? ' selected' : '')} onClick={() => { setOpen(open === resultKey(r) ? null : resultKey(r)); setPreview('merge'); }}>
                    <td className="num">{resultPage.offset + i + 1}</td>
                    <td className="num" title={`所要年数の目安: 約${years(r)}年`}>{r.generations}<span className="small muted">（約{years(r)}年）</span></td>
                    <td className="num">{r.cost.toLocaleString()}</td>
                    <td className="name wrap">{coltCell(r)}</td>
                    <td className="name wrap">{fillyCell(r)}</td>
                    <td className="wrap"><Summary s={r.merge.judgement} /></td>
                    <td className="action">{saveButton(r)}</td>
                  </tr>,
                  open === resultKey(r) && <tr key={'d' + resultKey(r)} className="result-expanded-row"><td colSpan={7} className="wrap">{expanded(r)}</td></tr>,
                ])}
              </tbody>
            </table></div>
          )}
          <ResultPagination {...resultPage} onChange={resultPage.setPage} />
          {shown.length > 0 && sorted.length === 0 && <div className="empty">絞り込みに一致する設計はありません。</div>}
          {report.results.length === 0 && !running && <div className="empty">条件を満たす設計は見つかりませんでした。世代数を増やすか、条件を減らしてください。</div>}
        </div>
      )}
      {savingResult && <SavePlanDialog defaultName={`${savingResult.filly.startName} 血統設計 ${new Date().toLocaleDateString()}${Object.keys(saved).length ? ` (${Object.keys(saved).length + 1})` : ''}`} onSave={(name) => save(savingResult, name)} onClose={() => setSavingResult(null)} />}
      {replacing && replan && <ActionDialog title="計画の手順を置き換え" onClose={() => setReplacing(null)}>
        <p>計画「{replan.plan.name}」の{replan.from + 1}回目以降（{replan.remaining}手順）を、この設計の牝の系統と最後の配合（{replacing.filly.steps.length + 1}手順）に置き換えますか？</p>
        <p className="small muted">{replan.from > 0 ? `${replan.from}回目までの手順はそのまま残ります。` : ''}{replacing.colt.steps.length > 0 && '牡の系統は別の計画として作ります。'}外す手順の計画馬のうち、所有馬を紐付けた馬は単独の計画馬として残ります。</p>
        <div className="action-dialog-actions"><button autoFocus onClick={() => setReplacing(null)}>キャンセル</button><button className="primary" onClick={() => replace(replacing)}>置き換える</button></div>
      </ActionDialog>}
    </div>
  );
}

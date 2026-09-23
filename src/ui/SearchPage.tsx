import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useApp, sireOptions, damOptions, includePlannedInSearch, type HorseOption } from './app-context';
import { Icon, PageHeading, type IconName } from './icons';
import { HorseSelect } from './HorseSelect';
import { Badge, RuleHelp } from './JudgeView';
import { bruteForceOneGeneration, goalLabel, goalVerdict, summarize, NITRO_LABEL, type NitroStat, type SearchGoal, type SearchReport, type SearchRequest, type SearchResult, type JudgementSummary } from '../core/search';
import type { WorkerIn, WorkerOut } from '../core/worker';
import { savePlanFromResult, replacePlanSteps, allUserHorses } from '../store/userdata';
import type { Plan } from '../store/model';
import { StallionFilter, EMPTY_FILTER, matchesStallion, isFilterActive, type StallionFilterState } from './StallionFilter';
import { COST_UNKNOWN, makeFoalRecord } from '../core/pedigree';
import type { HorseRecord, Judgement } from '../core/types';
import { estimateYears, YEAR_ASSUMPTIONS } from '../core/estimate';
import { foldDominated, wantedEffects } from '../core/result-order';
import { ATTR_LABEL, ownedOrigins, sortCompare, type AttrKey, type OneGenOrigin, type SortItem, type SortKey } from './search-order';
import { horseCell, horseColumns } from './master-horse-catalog';
import { compareOneGenResults, DEFAULT_ONEGEN_SORT, stallionValues, type OneGenSort } from './onegen-results';
import { EffectCountChips, Pedigree } from './Pedigree';
import { SummaryStrip, JudgeView } from './JudgeView';
import { judge } from '../core/judge';
import { LoopSearch } from './LoopSearch';
import { SeasonPlanner } from './SeasonPlanner';
import { HomebredSearch } from './HomebredSearch';
import { HorseDialog } from './HorseDialog';
import { SavePlanDialog } from './SavePlanDialog';
import { ActionDialog } from './ActionDialog';
import { navigate } from './router';
import { isSearchJobActive, type SearchJob } from '../api';
import { lineageReport, stopSearchJob, submitSearchJob } from '../store/search-jobs';
import { useSearchJob } from '../store/search-jobs';
import { ResultPagination } from './ResultPagination';
import { useResultPage } from './use-result-page';
import { SearchResultFilters } from './SearchResultFilters';
import './SearchPage.css';
import { Tip } from './Tip';

const BOOL_GOALS: SearchGoal['type'][] = ['perfectKotta', 'perfect', 'omoshiro', 'migoto', 'kotta', 'notDangerous', 'outbreed'];
const EFFECT_TYPES: SearchGoal['type'][] = ['crossEffect', 'avoidEffect', 'inheritEffect'];

const SearchIcon = Icon;
/** help は見出しの行の右端、tip は見出しの文字の直後に置く */
export function SearchSection({ title, icon, children, qualifier, help, tip }: { title: string; icon: IconName; children: ReactNode; qualifier?: string; help?: ReactNode; tip?: ReactNode }) {
  const id = useId();
  return <section className="search-section" aria-labelledby={id}>
    <div className="search-section-heading"><SearchIcon name={icon} /><h3><span id={id}>{title}</span>{tip}{qualifier && <span className="search-section-qualifier">{qualifier}</span>}</h3>{help}</div>
    <div className="search-section-content">{children}</div>
  </section>;
}
/** 探索の判定回数の上限。数世代探索とループ探索で共用する */
export function EvalLimitField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <div className="field"><span>判定回数上限<Tip label="判定回数上限">探索で判定する配合の数の上限です。届くとそこで止まり、それまでに見つかった結果を出します。大きくするほど探索に時間がかかります。</Tip></span><input type="number" aria-label="判定回数上限" value={value} onChange={(e) => onChange(Number(e.target.value))} /></div>;
}
function SelectionChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return <span className="search-selection">{name}<button type="button" aria-label={`${name}を外す`} onClick={onRemove}>×</button></span>;
}
/** 起点の馬を検索して追加し、選んだ馬をチップで並べる */
export function OriginPicker({ label, options, selected, onChange, ariaLabel = `起点の${label}` }: { label: string; options: HorseOption[]; selected: string[]; onChange: (keys: string[]) => void; ariaLabel?: string }) {
  const app = useApp();
  return <div className="search-origin-picker">
    <HorseSelect value="" onChange={(k) => { if (k && !selected.includes(k)) onChange([...selected, k]); }} options={options} placeholder={`${label}を検索して追加`} aria-label={ariaLabel} clearAfterSelect plannedToggle />
    {selected.length > 0 && <div className="search-selections">{selected.map((key) => <SelectionChip key={key} name={app.resolver.label(key)} onRemove={() => onChange(selected.filter((x) => x !== key))} />)}</div>}
  </div>;
}

/**
 * 探索画面の入力と結果をページ移動後も保持するための記憶（アプリ内のみ。再読み込みで消える）。
 * URL に mare などの指定がある時は、その項目だけ URL を優先する。
 */
const memoStore: Record<string, Record<string, unknown>> = { page: {}, one: {}, multi: {}, loop: {}, season: {}, homebred: {} };
export function useMemoState<T>(scope: string, key: string, init: T, override?: T | null): [T, (v: T | ((p: T) => T)) => void] {
  const store = memoStore[scope];
  const initial = (override != null ? override : (key in store ? (store[key] as T) : init));
  const [v, setV] = useState<T>(initial);
  useEffect(() => { store[key] = v; }, [store, key, v]);
  return [v, setV];
}

const mq = typeof matchMedia !== 'undefined' ? matchMedia('(max-width: 720px)') : null;
/** スマホ幅かどうか */
export function useMobile(): boolean {
  return useSyncExternalStore((cb) => { mq?.addEventListener('change', cb); return () => mq?.removeEventListener('change', cb); }, () => !!mq?.matches);
}

export function SortSelect({ value, onChange, costLabel, matings, stallionAttributes = true }: { value: SortKey; onChange: (v: SortKey) => void; costLabel: string; matings?: boolean; stallionAttributes?: boolean }) {
  const app = useApp();
  return (
    <label className="field">並び順
      <select value={value} onChange={(e) => onChange(e.target.value as SortKey)}>
        <option value="recommended">おすすめ順</option>
        {matings && <option value="matings">配合回数が少ない順</option>}
        <option value="cost">{costLabel}</option>
        <option value="cross">クロスが多い順</option>
        <option value="nicks">ニックス段階順</option>
        <option value="nitroSpeed">ニトロ スピード順（参考）</option>
        <option value="nitroStamina">ニトロ スタミナ順（参考）</option>
        <option value="nitroPower">ニトロ パワー順（参考）</option>
        {app.master.meta.crossEffects.map((e) => <option key={e} value={`effect:${e}`}>{e}のクロスが多い順</option>)}
        {stallionAttributes && <>{(Object.keys(ATTR_LABEL) as AttrKey[]).map((k) => <option key={k} value={`attr:${k}`}>種牡馬の{ATTR_LABEL[k]}が高い順</option>)}
        <option value="distLong">種牡馬の距離適性が長い順</option>
        <option value="distShort">種牡馬の距離適性が短い順</option>
        <option value="dirt">種牡馬のダート適性順</option></>}
      </select>
    </label>
  );
}

const isCostUnknown = (c: string) => c.endsWith(COST_UNKNOWN);
/** 表に出す札。横幅を取らないよう、費用の読み方に関わる「種付料は未確認」だけにする */
export function CostUnknownTag({ steps }: { steps: { constraints?: string[] }[] }) {
  return steps.some((s) => s.constraints?.some(isCostUnknown)) ? <span className="tag warn">{COST_UNKNOWN}</span> : null;
}
/** 開いた中で配合ごとに出す札（解禁条件・購入など）。種付料の未確認は表に出すので除く */
export function ConditionTags({ constraints }: { constraints?: string[] }) {
  const cs = (constraints ?? []).filter((c) => !isCostUnknown(c));
  return cs.length ? <>{cs.map((c) => <span key={c} className="tag warn">{c}</span>)}</> : null;
}

export function Summary({ s }: { s: JudgementSummary }) {
  return (
    <span className="small">
      {s.perfectKotta === '成立' ? <Badge v="成立" text="完璧／凝った" /> : s.perfect === '成立' && <Badge v="成立" text="完璧" />}{' '}
      {s.omoshiro === '成立' && <Badge v="成立" text="面白" />}{' '}
      {s.migoto === '成立' && <Badge v="成立" text="見事" />}{' '}
      {s.kotta === '成立' && <Badge v="成立" text="凝った" />}{' '}
      {s.kotta === '未確定' && <Badge v="未確定" text="凝った?" />}{' '}
      {s.nicksLevel > 0 && <Badge v="成立" text={`ニックス${s.nicksLevel}`} />}{' '}
      {s.outbreed === '成立' && <Badge v="成立" text="アウトブリード" />}{' '}
      {s.dangerous === '成立' && <Badge v="danger" text="危険" />}{' '}
      {s.hasUnknownSlots && <Badge v="未確定" text="血統不足" />}{' '}
      <span className="result-line">
        <EffectCountChips counts={s.effectCounts} emptyText={s.crossCount ? '効果のあるクロスなし' : 'クロスなし'} />
        {s.nitro && <span className="nitro small"><span>速<b>{s.nitro.speed}</b></span><span>ス<b>{s.nitro.stamina}</b></span><span>パ<b>{s.nitro.power}</b></span></span>}
      </span>
      {s.crosses.length > 0 && <span className="muted cross-list">クロス: {s.crosses.map((c) => `${c.name}${c.gens}`).join(', ')}</span>}
    </span>
  );
}

export function GoalEditor({ goals, setGoals, multi = false, qualifier, tip }: { goals: SearchGoal[]; setGoals: (g: SearchGoal[]) => void; multi?: boolean; qualifier?: string; tip?: ReactNode }) {
  const app = useApp();
  const [inheritanceOpen, setInheritanceOpen] = useState(false);
  const inheritanceId = useId();
  const inheritanceGoals = goals.filter((g) => g.type === 'inheritEffect');
  const hasEffectGoals = goals.some((g) => EFFECT_TYPES.includes(g.type));
  const has = (t: SearchGoal['type']) => goals.some((g) => g.type === t);
  const toggle = (t: SearchGoal['type']) => setGoals(has(t) ? goals.filter((g) => g.type !== t) : [...goals, { type: t }]);
  const find = (t: SearchGoal['type'], effect?: string) => goals.find((g) => g.type === t && (effect === undefined || g.effect === effect));
  const setNum = (g: SearchGoal, patch: Partial<SearchGoal>) => setGoals(goals.map((x) => (x === g ? { ...x, ...patch } : x)));
  const toggleCounted = (t: SearchGoal['type'], init: Partial<SearchGoal>) => { const g = find(t); setGoals(g ? goals.filter((x) => x !== g) : [...goals, { type: t, ...init }]); };
  const setCrossCondition = (effect: string, value: string) => {
    const otherGoals = goals.filter((g) => g.effect !== effect || !['crossEffect', 'avoidEffect'].includes(g.type));
    if (!value) setGoals(otherGoals);
    else if (value === '0') setGoals([...otherGoals, { type: 'avoidEffect', effect }]);
    else setGoals([...otherGoals, { type: 'crossEffect', effect, min: Number(value) }]);
  };
  const setInheritance = (effect: string, on: boolean) => {
    const otherGoals = goals.filter((g) => g.type !== 'inheritEffect' || g.effect !== effect);
    setGoals(on ? [...otherGoals, { type: 'inheritEffect', effect }] : otherGoals);
  };
  const nitroOf = (stat: NitroStat) => goals.find((g) => g.type === 'nitro' && g.stat === stat);
  const setNitro = (stat: NitroStat, v: string) => {
    const g = nitroOf(stat);
    if (!v) { if (g) setGoals(goals.filter((x) => x !== g)); return; }
    if (g) setNum(g, { min: Number(v) }); else setGoals([...goals, { type: 'nitro', stat, min: Number(v) }]);
  };
  const ancestorOptions = useMemo<HorseOption[]>(() => {
    const withFx = app.master.ancestors.filter((a) => a.effects.length).map((a) => ({ key: a.id, name: a.name, group: '因子のある祖先', sub: a.effects.join('・') }));
    const others = app.master.ancestors.filter((a) => !a.effects.length).map((a) => ({ key: a.id, name: a.name, group: 'その他の祖先' }));
    return [...withFx, ...others];
  }, [app]);
  const counted = (t: SearchGoal['type'], label: string, field: 'min' | 'max', init: Partial<SearchGoal>, unit: string) => {
    const g = find(t);
    return (
      <div className="goal-choice">
        <label><input type="checkbox" checked={!!g} onChange={() => toggleCounted(t, init)} />{label}</label>
        {g && <span className="goal-amount"><input type="number" aria-label={`${label}の値`} min={0} max={30} value={g[field]} onChange={(e) => setNum(g, { [field]: Number(e.target.value) })} />{unit}</span>}
      </div>
    );
  };
  return (
    <>
      <SearchSection title="必ず満たす条件" qualifier={qualifier ?? (multi ? '最終産駒' : undefined)} icon="check" tip={tip}>
        <div className="goal-boolean-grid">
          {BOOL_GOALS.map((t) => <div className="goal-choice" key={t}><label><input type="checkbox" checked={has(t)} onChange={() => toggle(t)} />{goalLabel({ type: t })}</label></div>)}
        </div>
        <div className="goal-count-grid">
          {counted('nicks', 'ニックスの段階', 'min', { min: 1 }, '以上')}
          {counted('maxCrosses', 'クロス本数の上限', 'max', { max: 6 }, '本以下')}
          {counted('minCrosses', 'クロス本数の下限', 'min', { min: 1 }, '本以上')}
          {counted('mareCross', '牝馬クロスの下限', 'min', { min: 1 }, '本以上')}
        </div>
      </SearchSection>
      <SearchSection title="因子（クロス効果）" icon="dna">
        <div className="effect-fields">
          {app.master.meta.crossEffects.map((effect) => {
            const want = find('crossEffect', effect), avoid = find('avoidEffect', effect);
            const value = avoid ? '0' : want ? String(want.min ?? 1) : '';
            return <label className={`field effect-field${value ? ' is-set' : ''}`} key={effect}>{effect}
              <select aria-label={`${effect}のクロス本数`} value={value} onChange={(e) => setCrossCondition(effect, e.target.value)}>
                <option value="">不問</option>
                <option value="0">0本（避ける）</option>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option value={n} key={n}>{n}本以上</option>)}
              </select>
            </label>;
          })}
        </div>
        <div className="effect-footer">
          {hasEffectGoals && <button type="button" className="search-text-button" onClick={() => setGoals(goals.filter((g) => !EFFECT_TYPES.includes(g.type)))}>因子をリセット</button>}
          <button type="button" className="effect-toggle" aria-expanded={inheritanceOpen} aria-controls={inheritanceId} onClick={() => setInheritanceOpen(!inheritanceOpen)}>アウトブリードの因子{inheritanceGoals.length > 0 && <span>（{inheritanceGoals.length}件）</span>}<span className="search-chevron" /></button>
        </div>
        {!inheritanceOpen && inheritanceGoals.length > 0 && <div className="effect-inheritance-summary">両親発動：{inheritanceGoals.map((g) => g.effect).join('・')}</div>}
        <div id={inheritanceId} hidden={!inheritanceOpen}>
          <fieldset className="effect-inheritance">
            <legend>父似・母似のどちらでも発動させたい因子<Tip label="アウトブリードの因子">5代以内にクロスがないアウトブリードでも、産駒が似た側（父似・母似）の血統内の因子が発動することがあります（公知の仕様。発動する範囲は4代以内とする本ツールの推定）。選んだ因子が父側・母側それぞれの4代以内にあり、クロスのない配合に絞ります。</Tip></legend>
            <div className="checks">{app.master.meta.crossEffects.map((effect) => <label key={effect}><input type="checkbox" checked={!!find('inheritEffect', effect)} onChange={(e) => setInheritance(effect, e.target.checked)} />{effect}</label>)}</div>
          </fieldset>
        </div>
      </SearchSection>
      <div className="search-paired-sections">
        <SearchSection title="ニトロの下限" icon="chart" help={<RuleHelp id="nitro" />}>
          <div className="nitro-fields">{(Object.keys(NITRO_LABEL) as NitroStat[]).map((k) => (
            <label key={k} className="field">{NITRO_LABEL[k]}<input type="number" min={1} max={40} value={nitroOf(k)?.min ?? ''} placeholder="不問" onChange={(e) => setNitro(k, e.target.value)} /></label>
          ))}</div>
        </SearchSection>
        <SearchSection title="指定した祖先のクロス" icon="ancestors">
          <HorseSelect value="" onChange={(k) => { if (k && !goals.some((g) => g.type === 'cross' && g.ancestorId === k)) setGoals([...goals, { type: 'cross', ancestorId: k, name: app.resolver.label(k) }]); }} options={ancestorOptions} placeholder="祖先名で検索して追加" aria-label="指定した祖先のクロス" clearAfterSelect />
          {goals.some((g) => g.type === 'cross') && <div className="search-selections">{goals.filter((g) => g.type === 'cross').map((g) => <SelectionChip key={g.ancestorId} name={app.resolver.label(g.ancestorId ?? '')} onRemove={() => setGoals(goals.filter((x) => x !== g))} />)}</div>}
        </SearchSection>
      </div>
    </>
  );
}

/** URL に job があればバックグラウンドの探索を結果ごと読み込み、その種類の画面で開く（探索中は順次取り直す） */
export function SearchPage({ params }: { params: URLSearchParams }) {
  const jobId = params.get('job');
  const { job, error, loaded } = useSearchJob(jobId);
  if (jobId && !job) {
    return <div className="search-page"><PageHeading icon="search" title="配合探索" />
      {loaded ? <div className="error" role="alert">{error || 'この探索は見つかりません。'}<div><a href="#/search">探索画面へ</a></div></div> : <p className="muted">探索の結果を読み込んでいます</p>}
    </div>;
  }
  return <SearchPageBody params={params} job={job} />;
}

function SearchPageBody({ params, job }: { params: URLSearchParams; job: SearchJob | null }) {
  const app = useApp();
  const [mode, setMode] = useMemoState<'one' | 'multi' | 'loop' | 'season' | 'homebred'>('page', 'mode', 'one', job ? (job.kind === 'loop' ? 'loop' : 'multi') : params.get('mode') === 'one' || params.get('stallion') ? 'one' : params.get('mode') === 'loop' ? 'loop' : params.get('mare') || params.get('replan') ? 'multi' : null);
  const [origin, setOrigin] = useMemoState<OneGenOrigin>('one', 'origin', 'mare', params.get('stallion') ? 'stallion' : params.get('mare') ? 'mare' : null);
  const [mares, setMares] = useMemoState<string[]>('one', 'selected:mare', ownedOrigins(app, 'mare'), params.get('mare') ? [params.get('mare')!] : null);
  const [stallions, setStallions] = useMemoState<string[]>('one', 'selected:stallion', ownedOrigins(app, 'stallion'), params.get('stallion') ? [params.get('stallion')!] : null);
  const [mareRun, setMareRun] = useMemoState<number>('one', 'run:mare', 0, params.get('mare') ? 1 : null);
  const [stallionRun, setStallionRun] = useMemoState<number>('one', 'run:stallion', 0, params.get('stallion') ? 1 : null);
  const oneSelection = origin === 'mare' ? { selected: mares, setSelected: setMares, run: mareRun, setRun: setMareRun } : { selected: stallions, setSelected: setStallions, run: stallionRun, setRun: setStallionRun };
  const [oneFilter, setOneFilter] = useMemoState<StallionFilterState>('one', 'filter', EMPTY_FILTER);
  const restoredFilter = job ? { ...EMPTY_FILTER, includeOverseas: app.master.stallions.some(h => h.overseas && (job.request.stallionPool.includes(h.id) || (job.kind === 'lineage' && [job.request.finalStallion, job.request.intermediateStallion].includes(h.id)))) } : null;
  const [multiFilter, setMultiFilter] = useMemoState<StallionFilterState>('multi', 'filter', EMPTY_FILTER, job?.kind === 'lineage' ? restoredFilter : null);
  const [loopFilter, setLoopFilter] = useMemoState<StallionFilterState>('loop', 'filter', EMPTY_FILTER, job?.kind === 'loop' ? restoredFilter : null);
  const [seasonFilter, setSeasonFilter] = useMemoState<StallionFilterState>('season', 'filter', EMPTY_FILTER);
  const [homebredFilter, setHomebredFilter] = useMemoState<StallionFilterState>('homebred', 'filter', EMPTY_FILTER);
  const currentFilter = { one: oneFilter, multi: multiFilter, loop: loopFilter, season: seasonFilter, homebred: homebredFilter }[mode];
  const marePool = mode === 'one' && origin === 'stallion';
  const availableCount = (marePool ? damOptions : sireOptions)(app, { onlyAvailable: true, requirePedigree: true, includePlanned: includePlannedInSearch(app), includeOverseas: currentFilter.includeOverseas }).length;
  const poolLabel = marePool ? '繁殖牝馬' : '種牡馬';
  return (
    <div className="search-page">
      <PageHeading icon="search" title="配合探索" actions={<a className="search-pool" href={`#/data?tab=${marePool ? 'broodmares' : 'stallions'}`} aria-label={`候補の${poolLabel} ${availableCount}頭。データを開く`}><span>候補の{poolLabel}</span><strong>{availableCount}<small>頭</small></strong><span className="search-pool-link">データ<span aria-hidden="true"> ↗</span></span></a>} />
      <div className="search-mode" role="group" aria-label="探索モード">
        <button aria-pressed={mode === 'one'} onClick={() => setMode('one')}>1世代の総当たり</button>
        <button aria-pressed={mode === 'multi'} onClick={() => setMode('multi')}>牝系を進める数世代探索</button>
        <button aria-pressed={mode === 'loop'} onClick={() => setMode('loop')}>凝った配合ループ探索</button>
        <button aria-pressed={mode === 'homebred'} onClick={() => setMode('homebred')}>自家製種牡馬づくり</button>
        <button aria-pressed={mode === 'season'} onClick={() => setMode('season')}>今年の種付け</button>
      </div>
      {mode === 'one' ? <OneGen filter={oneFilter} setFilter={setOneFilter} key={origin} origin={origin} onOriginChange={setOrigin} {...oneSelection} /> : mode === 'multi' ? <MultiGen filter={multiFilter} setFilter={setMultiFilter} params={params} job={job?.kind === 'lineage' ? job : null} /> : mode === 'loop' ? <LoopSearch filter={loopFilter} setFilter={setLoopFilter} job={job?.kind === 'loop' ? job : null} /> : mode === 'homebred' ? <HomebredSearch filter={homebredFilter} setFilter={setHomebredFilter} /> : <SeasonPlanner filter={seasonFilter} setFilter={setSeasonFilter} />}
    </div>
  );
}

function OneGen({ filter, setFilter, origin, onOriginChange, selected, setSelected, run, setRun }: { filter: StallionFilterState; setFilter: (filter: StallionFilterState) => void; origin: OneGenOrigin; onOriginChange: (origin: OneGenOrigin) => void; selected: string[]; setSelected: (keys: string[]) => void; run: number; setRun: (run: number) => void }) {
  const app = useApp();
  const mobile = useMobile();
  const fromStallion = origin === 'stallion';
  const originLabel = fromStallion ? '種牡馬' : '繁殖牝馬';
  const partnerLabel = fromStallion ? '繁殖牝馬' : '種牡馬';
  // 相手の候補（探索に使う集合）は設定 excludePlannedFromSearch、起点の選択リストは表示設定 hidePlanned に従う（連動しない）
  const includePool = includePlannedInSearch(app);
  const dOpts = useMemo(() => damOptions(app, { onlyAvailable: true, requirePedigree: true, includePlanned: includePool }), [app, includePool]);
  const sOpts = useMemo(() => sireOptions(app, { onlyAvailable: true, requirePedigree: true, includePlanned: includePool, includeOverseas: filter.includeOverseas }), [app, includePool, filter.includeOverseas]);
  const hidePlanned = !!app.data.settings.hidePlanned;
  const originOptions = useMemo(() => (fromStallion ? sireOptions : damOptions)(app, { onlyAvailable: true, requirePedigree: true, includePlanned: !hidePlanned }), [app, fromStallion, hidePlanned]);
  const [goals, setGoals] = useMemoState<SearchGoal[]>('one', 'goals', []);
  const [sort, setSort] = useMemoState<OneGenSort>('one', `tableSort:${origin}`, DEFAULT_ONEGEN_SORT);
  // 起点を切り替えても、相手の属性条件を固定した種牡馬へ適用しない。
  const sireKeys = useMemo(() => fromStallion ? selected : sOpts.filter((o) => { const m = app.master.stallions.find((s) => s.id === o.key); return !m || matchesStallion(m, filter); }).map((o) => o.key), [fromStallion, selected, sOpts, filter, app]);
  const damKeys = useMemo(() => fromStallion ? dOpts.map((o) => o.key) : selected, [fromStallion, dOpts, selected]);
  const partnerCount = fromStallion ? damKeys.length : sireKeys.length;
  const evaluated = useMemo(() => {
    if (!run || !selected.length) return null;
    return bruteForceOneGeneration({ ctx: app.ctx, rules: app.rules, resolve: (k) => app.resolver.get(k) }, sireKeys, damKeys)
      .filter((r) => goals.every((g) => goalVerdict(r.judgement, g) === '成立'))
      .map((r) => ({ ...r, s: summarize(r.judgement), sireName: app.resolver.label(r.sire), damName: app.resolver.label(r.dam), stallion: stallionValues(app.resolver.get(r.sire)!, app.resolver.master(r.sire), app.resolver.user(r.sire)) }));
  }, [run, selected.length, goals, app, sireKeys, damKeys]);
  const results = useMemo(() => {
    if (!evaluated) return null;
    const wanted = wantedEffects(goals);
    return [...evaluated].sort((a, b) => compareOneGenResults(a, b, sort, wanted));
  }, [evaluated, goals, sort]);
  const resultPage = useResultPage(results ?? [], mobile ? 100 : 300);
  const abilityColumns = horseColumns('stallion').slice(2);
  const columns = [
    { key: fromStallion ? 'dam' : 'sire', label: fromStallion ? '母（繁殖牝馬）' : '父（種牡馬）' },
    { key: fromStallion ? 'sire' : 'dam', label: fromStallion ? '父（起点）' : '母（起点）' },
    { key: 'price', label: '種付料（万）', numeric: true }, ...abilityColumns,
    { key: 'judgement', label: '判定' },
  ];
  const changeSort = (column: string) => {
    const direction = sort.column === column ? sort.direction === 'asc' ? 'desc' : 'asc' : ['sire', 'dam', 'price', 'grown'].includes(column) ? 'asc' : 'desc';
    setSort({ column, direction, judgement: 'recommended' });
    resultPage.setPage(0);
  };
  const abilityCell = (r: NonNullable<typeof results>[number], key: string) => horseCell(r.stallion, key);
  const partnerKey = (r: { sire: string; dam: string }) => fromStallion ? r.dam : r.sire;
  const originKey = (r: { sire: string; dam: string }) => fromStallion ? r.sire : r.dam;
  const constraints = (key: string) => { const h = app.resolver.get(key); return h ? <CostUnknownTag steps={[h]} /> : null; };
  const matingLink = (r: { sire: string; dam: string }) => '#/mating?' + new URLSearchParams({ sire: r.sire, dam: r.dam });
  // 行を押すとその場で血統表と判定を展開し、相手の馬名を押すと馬の詳細をオーバーレイで開く
  const [open, setOpen] = useMemoState<string | null>('one', 'open', null);
  const [detail, setDetail] = useState<string | null>(null);
  const rowKey = (r: { sire: string; dam: string }) => `${r.sire}:${r.dam}`;
  const nameButton = (key: string) => <button type="button" className="result-name-button" onClick={(e) => { e.stopPropagation(); setDetail(key); }}>{app.resolver.label(key)}</button>;
  const expanded = (r: { sire: string; dam: string; judgement: Judgement }) => <div className="result-expanded" onClick={(e) => e.stopPropagation()}>
    <div className="inline-row"><a href={matingLink(r)}>配合確認で開く</a><a href={`#/search?mare=${encodeURIComponent(r.dam)}&final=${encodeURIComponent(r.sire)}`}>数世代の配合を探す</a></div>
    <SummaryStrip j={r.judgement} />
    <Pedigree j={r.judgement} />
    <details><summary className="small">判定の根拠</summary><JudgeView j={r.judgement} showSummary={false} /></details>
  </div>;
  return (
    <div>
      <div className="search-form">
        <SearchSection title="起点の馬" icon="horse">
          <div className="search-origin-toggle" role="group" aria-label="総当たりの起点">
            <button type="button" aria-pressed={!fromStallion} onClick={() => onOriginChange('mare')}>繁殖牝馬から探す</button>
            <button type="button" aria-pressed={fromStallion} onClick={() => onOriginChange('stallion')}>種牡馬から探す</button>
          </div>
          <OriginPicker label={originLabel} options={originOptions} selected={selected} onChange={setSelected} />
        </SearchSection>
        <GoalEditor goals={goals} setGoals={setGoals} />
        {!fromStallion && <SearchSection title="種牡馬の属性" icon="sliders"><StallionFilter value={filter} onChange={setFilter} /></SearchSection>}
        <div className="search-actions">
          <button type="button" className="search-reset" onClick={() => { setGoals([]); if (!fromStallion) setFilter(EMPTY_FILTER); setRun(0); }}><SearchIcon name="reset" />条件をリセット</button>
          <button className="primary search-submit" disabled={!selected.length || !partnerCount} onClick={() => { setRun(run + 1); resultPage.setPage(0); }}><SearchIcon name="search" />総当たり<span className="search-submit-count">{originLabel} {selected.length}頭 × {partnerLabel} {partnerCount}頭</span></button>
        </div>
      </div>
      {results && (
        <div className="panel">
          <div className="result-status"><div><b>条件を満たす組み合わせ {results.length} 件</b><span className="muted">　全 {sireKeys.length * damKeys.length} 件を判定</span></div></div>
          <div className="onegen-sort-tools">
            {mobile ? <label className="field">並べ替える列<select value={sort.column} onChange={e => changeSort(e.target.value)}>{columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label> : <span className="small muted">{sort.column === 'judgement' ? sort.judgement === 'recommended' ? 'おすすめ順' : '判定の詳細順' : `${columns.find(c => c.key === sort.column)?.label} ${sort.direction === 'asc' ? '↑ 昇順' : '↓ 降順'}`}{sort.column === 'judgement' && sort.direction === 'asc' && '（逆順）'}{sort.column === 'dist' && '（上限で比較）'}</span>}
            {mobile && <button type="button" onClick={() => { setSort({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' }); resultPage.setPage(0); }}>{sort.direction === 'asc' ? '↑ 昇順' : '↓ 降順'}</button>}
            <details><summary className="small">判定の詳細順</summary><SortSelect value={sort.column === 'judgement' ? sort.judgement : 'recommended'} onChange={value => { setSort({ column: 'judgement', direction: 'desc', judgement: value }); resultPage.setPage(0); }} costLabel="種付料が安い順" stallionAttributes={false} /></details>
          </div>
          {mobile ? (
            <div className="result-cards">
              {resultPage.rows.map((r) => (
                <div key={rowKey(r)} className={'result-card clickable' + (open === rowKey(r) ? ' selected' : '')} onClick={() => setOpen(open === rowKey(r) ? null : rowKey(r))}>
                  <div className="result-head"><b>{nameButton(partnerKey(r))} {constraints(partnerKey(r))}</b><span className="num muted">{r.judgement.costUnknown ? '未確認' : `${r.judgement.cost.toLocaleString()}万`}</span></div>
                  <div className="small muted">{fromStallion ? '父' : '母'}：{app.resolver.label(originKey(r))} {constraints(originKey(r))}</div>
                  <dl className="onegen-card-abilities" aria-label="種牡馬の能力">{abilityColumns.map(c => <div key={c.key}><dt>{c.label}</dt><dd>{abilityCell(r, c.key)}</dd></div>)}</dl>
                  <Summary s={r.s} />
                  {open === rowKey(r) && expanded(r)}
                </div>
              ))}
            </div>
          ) : (
          <div className="table-wrap"><table className="onegen-table" aria-label="総当たりの検索結果">
            <thead><tr>{columns.map(c => <th key={c.key} className={c.numeric ? 'num' : undefined} aria-sort={sort.column === c.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => changeSort(c.key)} title={c.key === 'dist' ? '距離上限で並べ替え' : c.key === 'judgement' ? 'おすすめ順で並べ替え' : `${c.label}で並べ替え`}>{c.label}<span aria-hidden="true">{sort.column === c.key ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ' ↕'}</span></button></th>)}</tr></thead>
            <tbody>
              {resultPage.rows.map((r) => [
                <tr key={rowKey(r)} className={'clickable' + (open === rowKey(r) ? ' selected' : '')} onClick={() => setOpen(open === rowKey(r) ? null : rowKey(r))}>
                  <td className="name">{nameButton(partnerKey(r))} {constraints(partnerKey(r))}</td><td className="name">{nameButton(originKey(r))} {constraints(originKey(r))}</td><td className="num">{r.judgement.costUnknown ? '—' : r.judgement.cost.toLocaleString()}</td>
                  {abilityColumns.map(c => <td key={c.key} className={c.key === 'dist' ? 'onegen-distance' : 'onegen-rating'}><span className={abilityCell(r, c.key) === '—' ? 'muted' : undefined}>{abilityCell(r, c.key)}</span></td>)}
                  <td className="wrap onegen-judgement"><Summary s={r.s} /></td>
                </tr>,
                open === rowKey(r) && <tr key={'d' + rowKey(r)} className="result-expanded-row"><td colSpan={columns.length} className="wrap">{expanded(r)}</td></tr>,
              ])}
            </tbody>
          </table></div>
          )}
          {results.length === 0 && <p className="empty small">条件を満たす組み合わせはありません。</p>}
          <ResultPagination {...resultPage} onChange={resultPage.setPage} />
        </div>
      )}
      {detail && <HorseDialog horseKey={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

/** 計画の手順から探し直す時の起点と、計画の探索条件を残りの手順に合わせて戻した条件 */
function replanTarget(app: ReturnType<typeof useApp>, params: URLSearchParams): { plan: Plan; from: number; dam: string; request: SearchRequest } | null {
  const plan = app.data.plans.find((p) => p.id === params.get('replan'));
  const from = Number(params.get('from'));
  const step = plan?.steps[from];
  if (!plan || !step) return null;
  const before = plan.steps.slice(0, from);
  const spent = before.reduce((c, s) => c + (app.resolver.get(s.sire)?.price ?? 0), 0);
  const r = plan.request;
  const remaining = plan.steps.length - from;
  return { plan, from, dam: step.dam, request: {
    startMares: [step.dam], stallionPool: r?.stallionPool ?? [], finalPool: null,
    intermediateStallion: r?.intermediateStallion && !before.some((s) => s.sire === r.intermediateStallion) ? r.intermediateStallion : null,
    finalStallion: r?.finalStallion ?? null,
    minMatings: Math.max(1, (r?.minMatings ?? 1) - from), maxMatings: Math.max(1, r ? r.maxMatings - from : remaining),
    goals: plan.goals, maxCost: r?.maxCost == null ? null : Math.max(0, r.maxCost - spent),
    maxEvaluations: r?.maxEvaluations ?? 50_000_000, allowRepeatStallion: r?.allowRepeatStallion ?? true,
  } };
}

function MultiGen({ filter, setFilter, params, job }: { filter: StallionFilterState; setFilter: (filter: StallionFilterState) => void; params: URLSearchParams; job: (SearchJob & { kind: 'lineage' }) | null }) {
  const app = useApp();
  const mobile = useMobile();
  // バックグラウンドの探索を開いた時は、その条件を入力欄に戻し、結果は取り直すたびに差し替える（この画面で新しく探索を始めたら切り離す）
  const jr = job?.request ?? null;
  const [viewingJob, setViewingJob] = useState(!!job);
  // sOpts は途中・最後の種牡馬の候補（探索に使う集合）で設定 excludePlannedFromSearch に従う。選択リストは表示設定 hidePlanned に従う（連動しない）
  const sOpts = useMemo(() => sireOptions(app, { onlyAvailable: true, requirePedigree: true, includePlanned: includePlannedInSearch(app), includeOverseas: filter.includeOverseas }), [app, filter.includeOverseas]);
  const hidePlanned = !!app.data.settings.hidePlanned;
  const damPick = useMemo(() => damOptions(app, { onlyAvailable: true, requirePedigree: true, includePlanned: !hidePlanned }), [app, hidePlanned]);
  const sirePick = useMemo(() => sireOptions(app, { onlyAvailable: true, requirePedigree: true, includePlanned: !hidePlanned, includeOverseas: filter.includeOverseas }), [app, hidePlanned, filter.includeOverseas]);
  // 計画の途中から探し直す時は、その手順の母を起点に、計画の探索条件から残りの手順の分を入力欄に戻す
  // URL の replan・from で開いた時だけ。保存するとその計画の手順を置き換える
  const replan = useMemo(() => replanTarget(app, params), [app, params]);
  const pr = replan?.request ?? jr;
  const [mares, setMares] = useMemoState<string[]>('multi', 'mares', ownedOrigins(app, 'mare'), replan ? [replan.dam] : params.get('mare') ? [params.get('mare')!] : jr?.startMares ?? null);
  const [intermediate, setIntermediate] = useMemoState<string>('multi', 'intermediate', '', params.get('mare') ? '' : pr ? (pr.intermediateStallion ?? '') : null);
  const [final, setFinal] = useMemoState<string>('multi', 'final', '', params.get('mare') ? (params.get('final') ?? '') : pr ? (pr.finalStallion ?? '') : null);
  const [minM, setMinM] = useMemoState<number>('multi', 'minM', 1, pr?.minMatings ?? null);
  const [maxM, setMaxM] = useMemoState<number>('multi', 'maxM', 2, pr?.maxMatings ?? null);
  const [goals, setGoals] = useMemoState<SearchGoal[]>('multi', 'goals', [{ type: 'perfect' }], pr?.goals ?? null);
  const [maxCost, setMaxCost] = useMemoState<string>('multi', 'maxCost', '', pr ? (pr.maxCost == null ? '' : String(pr.maxCost)) : null);
  const [maxEval, setMaxEval] = useMemoState<number>('multi', 'maxEval', 50_000_000, pr?.maxEvaluations ?? null);
  const [repeat, setRepeat] = useMemoState<boolean>('multi', 'repeat', true, pr?.allowRepeatStallion ?? null);
  const origins = replan ? [replan.dam] : mares;
  const [progress, setProgress] = useState<{ evaluated: number; pruned: number; found: number } | null>(null);
  const [report, setReport] = useMemoState<SearchReport | null>('multi', 'report', null, job ? lineageReport(job) : null);
  const [err, setErr] = useState('');
  const [started, setStarted] = useState<SearchJob | null>(null);
  useEffect(() => { if (job && viewingJob) setReport(lineageReport(job)); }, [job, viewingJob, setReport]);
  const jobRunning = viewingJob && !!job && isSearchJobActive(job);
  const running = !!progress || jobRunning;
  const runningProgress = progress ?? (jobRunning ? job.progress : null);
  const [sort, setSort] = useMemoState<SortKey>('multi', 'sort', 'recommended');
  const [showFolded, setShowFolded] = useState(false);
  const [open, setOpen] = useMemoState<string | null>('multi', 'open', null);
  const [resultHorse, setResultHorse] = useState('');
  const [resultFinal, setResultFinal] = useState('');
  const [resultOrigin, setResultOrigin] = useState('');
  const [replacing, setReplacing] = useState<SearchResult | null>(null);
  const [savingResult, setSavingResult] = useState<SearchResult | null>(null);
  const [saveRole, setSaveRole] = useMemoState<'stallion' | 'broodmare' | 'none'>('multi', 'saveRole', 'none');
  const [saved, setSaved] = useMemoState<Record<string, { id: string; name: string }>>('multi', 'saved', {});
  const [previewStep, setPreviewStep] = useMemoState<number>('multi', 'previewStep', -1);
  const [savedMsg, setSavedMsg] = useState<{ id: string; name: string } | null>(null);
  const resultKey = (r: SearchResult) => r.steps.map((st) => st.sire).join('>');
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  const makeFoal = (s: HorseRecord, m: HorseRecord, k: number) => makeFoalRecord(s, m, { key: `p:l${k}:${s.key}`, name: `${m.name}の${k + 1}代目（${s.name}産駒）`, sex: 'F', kind: 'planned' }, app.rules);
  /** 経路の k 回目の配合を判定し直す。途中の母（計画上の娘）は探索と同じ手順で組み立てる */
  const stepJudgement = (r: SearchResult, stepIdx: number) => {
    const st = r.steps[stepIdx];
    const s = app.resolver.get(st.sire);
    let dam = app.resolver.get(st.dam);
    if (!dam) {
      let m = app.resolver.get(r.steps[0].dam);
      for (let k = 0; k < stepIdx && m; k++) { const sk = app.resolver.get(r.steps[k].sire); m = sk ? makeFoal(sk, m, k) : null; }
      dam = m;
    }
    return s && dam ? judge(s, dam, app.ctx) : null;
  };
  /** 展開した経路の中身: 手順の一覧と、選んだ回の血統表・判定 */
  const expanded = (r: SearchResult) => {
    const stepIdx = previewStep < 0 || previewStep >= r.steps.length ? r.steps.length - 1 : previewStep;
    const st = r.steps[stepIdx];
    const j = stepJudgement(r, stepIdx);
    return <div className="result-expanded" onClick={(e) => e.stopPropagation()}>
      <ol className="steps">
        {r.steps.map((s, k) => (
          <li key={k}>
            <b>{s.sireName}</b> × {s.damName}（{s.cost}万）→ {k < r.steps.length - 1 ? '牝馬を残して繁殖入り' : '最終産駒'} <ConditionTags constraints={s.constraints} />
            <div><Summary s={s.judgement} /></div>
          </li>
        ))}
      </ol>
      <div className="small">目標: {r.goals.map((g, k) => <span key={k} className="tag">{goalLabel(g.goal)}: {g.verdict}</span>)}</div>
      <div className="small">所要年数の目安: 最短 {estimateYears(r.matings).minYears} 年、途中で牝馬を得るための期待生産 {estimateYears(r.matings).expectedFoals.toFixed(0)} 頭 <Tip label="所要年数の目安">{YEAR_ASSUMPTIONS.note}</Tip></div>
      <div className="inline-row">
        {r.steps.length > 1 && <select value={stepIdx} onChange={(e) => setPreviewStep(Number(e.target.value))}>{r.steps.map((x, k) => <option key={k} value={k}>{k + 1}回目: {x.sireName}</option>)}</select>}
        <a href={`#/mating?sire=${encodeURIComponent(st.sire)}&dam=${encodeURIComponent(st.dam)}`}>{r.steps.length > 1 ? 'この回を' : ''}配合確認で開く</a>
      </div>
      {j ? <><SummaryStrip j={j} /><Pedigree j={j} /><details><summary className="small">判定の根拠</summary><JudgeView j={j} showSummary={false} /></details></> : <div className="muted small">この手順の血統は表示できません</div>}
    </div>;
  };

  const buildRequest = (): SearchRequest => {
    const passes = (key: string) => { const m = app.master.stallions.find((s) => s.id === key); return !m || matchesStallion(m, filter); };
    const all = sOpts.map((o) => o.key);
    const filtered = isFilterActive(filter) ? all.filter(passes) : all;
    return {
      startMares: origins, intermediateStallion: intermediate || null, stallionPool: filter.applyToIntermediate ? filtered : all, finalStallion: final || null, finalPool: final ? null : (isFilterActive(filter) ? filtered : null),
      minMatings: minM, maxMatings: maxM, goals, maxCost: maxCost ? Number(maxCost) : null, maxEvaluations: maxEval, allowRepeatStallion: repeat,
    };
  };
  const validate = () => {
    const e = !origins.length ? '起点の繁殖牝馬を選んでください'
      : intermediate && maxM < 2 ? '途中で使う種牡馬を指定するときは、配合回数の最大を2回以上にしてください'
      : !filter.includeOverseas && app.master.stallions.some(h => h.overseas && [intermediate, final].includes(h.id)) ? '指定した種牡馬に海外種牡馬が含まれています。「海外種牡馬を除外」のチェックを外すか、指定を解除してください'
      : '';
    setErr(e);
    return !e;
  };
  const startedAt = useRef(0);
  const start = () => {
    if (!validate()) return;
    resultPage.setPage(0); setResultHorse(''); setResultFinal(''); setResultOrigin('');
    setErr(''); setReport(null); setSaved({}); setSavedMsg(null); setStarted(null); setOpen(null); setViewingJob(false); setShowFolded(false); setProgress({ evaluated: 0, pruned: 0, found: 0 });
    const req = buildRequest();
    startedAt.current = Date.now();
    worker.current?.terminate();
    const w = new Worker(new URL('../core/worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === 'progress') {
        setProgress({ evaluated: m.evaluated, pruned: m.pruned, found: m.found });
        // 見つかった経路は終了を待たずに並べる（集計は途中の値）
        if (m.results.length) setReport((prev) => ({ status: '中止', results: [...(prev?.results ?? []), ...(m.results as SearchResult[])], evaluated: m.evaluated, pruned: m.pruned, dataIssues: 0, elapsedMs: Date.now() - startedAt.current, request: req }));
      } else if (m.type === 'done') { setReport(m.report); setProgress(null); }
      else if (m.type === 'error') { setErr(m.message); setProgress(null); }
    };
    w.postMessage({ type: 'start', master: app.master, userHorses: allUserHorses(app.data), rules: app.data.settings.rules, request: req } satisfies WorkerIn);
  };
  const cancel = () => (progress ? worker.current?.postMessage({ type: 'cancel' } satisfies WorkerIn) : job && void stopSearchJob(job.id));
  /** サーバに任せて画面を離れても続ける。結果は右上の「探索」か、この画面の案内から開く */
  const background = async () => {
    if (!validate()) return;
    setErr('');
    try { setStarted(await submitSearchJob('lineage', buildRequest())); } catch (e) { setErr((e as Error).message); }
  };
  // 判定が同じで費用も回数も上回られる経路は既定で畳む
  const { shown, folded } = useMemo(() => (report ? foldDominated(report.results) : { shown: [], folded: 0 }), [report]);
  const sorted = useMemo(() => {
    if (!report) return [];
    const rs = (showFolded ? report.results : shown).filter((r) => (!resultHorse || r.steps.some((step) => step.sire === resultHorse)) && (!resultFinal || r.steps.at(-1)?.sire === resultFinal) && (!resultOrigin || r.steps[0].dam === resultOrigin));
    const attrsOf = (r: SearchResult) => app.master.stallions.find((x) => x.id === r.steps[r.steps.length - 1].sire)?.attrs;
    const item = (r: SearchResult): SortItem => ({ cost: r.cost, matings: r.matings, s: r.steps[r.steps.length - 1].judgement, attrs: attrsOf(r) });
    const wanted = wantedEffects(report.request.goals);
    return [...rs].sort((a, b) => sortCompare(sort, item(a), item(b), wanted));
  }, [report, shown, showFolded, sort, app, resultHorse, resultFinal, resultOrigin]);
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
  const defaultPlanName = (r: SearchResult) => `${app.resolver.label(r.steps[0].dam)} 計画 ${new Date().toLocaleDateString()}${Object.keys(saved).length ? ` (${Object.keys(saved).length + 1})` : ''}`;
  const markSaved = (r: SearchResult, p: Plan) => {
    setSaved({ ...saved, [resultKey(r)]: { id: p.id, name: p.name } });
    setSavedMsg({ id: p.id, name: p.name });
  };
  const save = (r: SearchResult, name: string) => {
    markSaved(r, savePlanFromResult(name, r.steps[0].dam, r, goals, report?.request, app.ctx.rulesVersion, app.ctx.dataVersion, saveRole));
    setSavingResult(null);
  };
  /** 計画から探し直した時は、新しい計画を作らずに計画のその回以降を置き換える */
  const startSave = (r: SearchResult) => (replan ? setReplacing(r) : setSavingResult(r));
  const replace = (r: SearchResult) => {
    markSaved(r, replacePlanSteps(replan!.plan.id, replan!.from, r, goals, report?.request, app.ctx.rulesVersion, app.ctx.dataVersion, saveRole));
    setReplacing(null);
  };
  /** 表（スマホではカード）の「保存」。計画から探し直している時は、計画の手順を置き換える */
  const saveButton = (r: SearchResult) => saved[resultKey(r)]
    ? <a href={`#/plans?id=${saved[resultKey(r)].id}`} className="small" onClick={(e) => e.stopPropagation()}>保存済み</a>
    : <button title={replan ? `計画の${replan.from + 1}回目以降をこの経路に置き換える` : 'この経路を計画として保存'} onClick={(e) => { e.stopPropagation(); startSave(r); }}>{replan ? '置き換え' : '保存'}</button>;
  const multiOrigin = (report?.request.startMares.length ?? 0) > 1;
  const route = (r: SearchResult) => (multiOrigin ? `${r.steps[0].damName}：` : '') + r.steps.map((step) => step.sireName).join(' → ');

  return (
    <div>
      <div className="search-form">
        <SearchSection title="基本設定" icon="horse">
          {replan && <div className="notice search-replan">計画「{replan.plan.name}」の{replan.from + 1}回目から探し直します。保存すると{replan.from + 1}回目以降の手順を置き換えます。<button type="button" className="text-toggle" onClick={() => navigate('/search', { mode: 'multi' })}>やめる</button></div>}
          <div className="search-horse-fields search-horse-fields-three">
            {replan
              ? <div className="field"><span>起点の繁殖牝馬</span><HorseSelect value={replan.dam} onChange={() => undefined} options={[{ key: replan.dam, name: app.resolver.label(replan.dam), group: '計画' }]} aria-label="起点の繁殖牝馬" disabled /></div>
              : <div className="field"><span>起点の繁殖牝馬</span><OriginPicker label="繁殖牝馬" options={damPick} selected={mares} onChange={setMares} /></div>}
            <div className="field"><span>途中で使う種牡馬（任意）</span><HorseSelect value={intermediate} onChange={(key) => { setIntermediate(key); if (key && maxM < 2) setMaxM(2); }} options={sirePick} aria-label="途中で使う種牡馬（任意）" placeholder="最後を除くどこかで使用" plannedToggle /></div>
            <label className="field">最後に付ける種牡馬（任意）<HorseSelect value={final} onChange={setFinal} options={sirePick} aria-label="最後に付ける種牡馬（任意）" plannedToggle /></label>
          </div>
          <div className="search-limits">
            <label className="field">配合回数（最小）<input type="number" min={1} max={10} value={minM} onChange={(e) => setMinM(Number(e.target.value))} /></label>
            <label className="field">配合回数（最大）<input type="number" min={1} max={10} value={maxM} onChange={(e) => setMaxM(Number(e.target.value))} /></label>
            <label className="field">種付料合計の上限（万）<input type="number" value={maxCost} onChange={(e) => setMaxCost(e.target.value)} placeholder="なし" /></label>
            <EvalLimitField value={maxEval} onChange={setMaxEval} />
          </div>
          <label className="search-repeat"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />同じ種牡馬の複数回利用を許可</label>
        </SearchSection>
        <GoalEditor goals={goals} setGoals={setGoals} multi />
        <SearchSection title="種牡馬の属性" icon="sliders"><StallionFilter value={filter} onChange={setFilter} showIntermediate /></SearchSection>
        <div className="search-actions">
          <button type="button" className="search-reset" disabled={running} onClick={() => { setFinal(''); setIntermediate(''); setMinM(1); setMaxM(2); setGoals([{ type: 'perfect' }]); setMaxCost(''); setMaxEval(50_000_000); setRepeat(true); setFilter(EMPTY_FILTER); setReport(null); setOpen(null); setErr(''); setStarted(null); setViewingJob(false); }}><SearchIcon name="reset" />条件をリセット</button>
          {runningProgress && <span className="search-progress-label" role="status">{jobRunning ? 'バックグラウンドで探索中 · ' : ''}判定 {runningProgress.evaluated.toLocaleString()} 回 / 発見 {runningProgress.found} 件</span>}
          {running ? <button className="search-submit" onClick={cancel}>探索を中止</button> : <span className="search-submit-group">
            <button className="search-submit" disabled={!origins.length} onClick={() => void background()}>バックグラウンドで探索</button>
            <button className="primary search-submit" disabled={!origins.length} onClick={start}><SearchIcon name="search" />探索{origins.length > 1 && <span className="search-submit-count">起点 {origins.length}頭</span>}</button>
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
              <b>{running ? `探索中: 条件を満たす経路 ${report.results.length} 件` : report.status === '完了' ? (report.results.length ? `条件を満たす経路 ${report.results.length.toLocaleString()} 件` : '指定範囲に解なし') : `探索未完了（${report.status}）`}</b>
              {!running && report.status === '完了' && <span className="muted">　指定範囲は探索済み</span>}
            </div>
            <div className="small muted">
              判定 {report.evaluated.toLocaleString()} 回、枝刈り {report.pruned.toLocaleString()}、{(report.elapsedMs / 1000).toFixed(1)} 秒{running && '（途中）'}
              {report.dataIssues > 0 && <>。不明な祖先や自家製馬のペア判定不可で「未確定」に留まった候補 {report.dataIssues} 件</>}
            </div>
            {folded > 0 && <div className="small muted">最終配合の判定が同じで、費用と配合回数のどちらも多い経路 {folded.toLocaleString()} 件を{showFolded ? '表示中' : '畳んでいます'}。<button type="button" className="text-toggle" onClick={() => { setShowFolded(!showFolded); resultPage.setPage(0); }}>{showFolded ? '畳む' : '表示する'}</button></div>}
          </div>
          <div className="toolbar lineage-result-toolbar">
            <SortSelect value={sort} onChange={(value) => { setSort(value); resultPage.setPage(0); }} costLabel="費用が安い順" matings />
            <label className="field">最終産駒の役割<select value={saveRole} onChange={(e) => setSaveRole(e.target.value as typeof saveRole)}><option value="none">競走馬（指定なし）</option><option value="broodmare">繁殖牝馬にする</option><option value="stallion">種牡馬にする</option></select></label>
            <SearchResultFilters results={report.results} horse={resultHorse} final={resultFinal} origin={resultOrigin} count={sorted.length}
              onHorseChange={(key) => { setResultHorse(key); resultPage.setPage(0); }} onFinalChange={(key) => { setResultFinal(key); resultPage.setPage(0); }} onOriginChange={(key) => { setResultOrigin(key); resultPage.setPage(0); }} />
          </div>
          <ResultPagination {...resultPage} onChange={resultPage.setPage} />
          {savedMsg && <div className="notice" style={{ marginBottom: 8 }}>計画「{savedMsg.name}」を保存しました。<a href={`#/plans?id=${savedMsg.id}`}>計画を開く</a>　<span className="muted small">この画面の結果はそのまま残ります。</span></div>}
          {mobile ? (
            <div className="result-cards" style={{ marginTop: 8 }}>
              {resultPage.rows.map((r) => {
                const last = r.steps[r.steps.length - 1];
                return (
                  <div key={resultKey(r)} className="result-card">
                    <div className="result-head" onClick={() => setOpen(open === resultKey(r) ? null : resultKey(r))}>
                      <b>{route(r)} <CostUnknownTag steps={r.steps} /></b>
                      <span className="num muted">{r.matings}回（{estimateYears(r.matings).minYears}年〜） / {r.cost.toLocaleString()}万</span>
                    </div>
                    <div onClick={() => setOpen(open === resultKey(r) ? null : resultKey(r))}><Summary s={last.judgement} /></div>
                    <div className="result-card-actions">{saveButton(r)}</div>
                    {open === resultKey(r) && expanded(r)}
                  </div>
                );
              })}
            </div>
          ) : (
          <div className="table-wrap" style={{ marginTop: 8 }}><table>
            <thead><tr><th className="num">#</th><th className="num">回数</th><th className="num">費用</th><th className="wrap">経路（父）</th><th className="wrap">最終配合の判定</th><th></th></tr></thead>
            <tbody>
              {resultPage.rows.map((r, i) => {
                const last = r.steps[r.steps.length - 1];
                return [
                  <tr key={resultKey(r)} className={'clickable' + (open === resultKey(r) ? ' selected' : '')} onClick={() => { setOpen(open === resultKey(r) ? null : resultKey(r)); setPreviewStep(-1); }}>
                    <td className="num">{resultPage.offset + i + 1}</td><td className="num" title={`最短 ${estimateYears(r.matings).minYears} 年の目安`}>{r.matings}<span className="small muted">（{estimateYears(r.matings).minYears}年〜）</span></td><td className="num">{r.cost.toLocaleString()}</td>
                    <td className="name wrap">{route(r)} <CostUnknownTag steps={r.steps} /></td>
                    <td className="wrap"><Summary s={last.judgement} /></td>
                    <td className="action">{saveButton(r)}</td>
                  </tr>,
                  open === resultKey(r) && <tr key={'d' + resultKey(r)} className="result-expanded-row"><td colSpan={6} className="wrap">{expanded(r)}</td></tr>,
                ];
              })}
            </tbody>
          </table></div>
          )}
          <ResultPagination {...resultPage} onChange={resultPage.setPage} />
          {report.results.length > 0 && sorted.length === 0 && <div className="empty">絞り込みに一致する経路はありません。</div>}
          {report.results.length === 0 && !running && <div className="empty">条件を満たす経路は見つかりませんでした。配合回数を増やすか、条件を減らしてください。</div>}
        </div>
      )}
      {savingResult && <SavePlanDialog defaultName={defaultPlanName(savingResult)} onSave={(name) => save(savingResult, name)} onClose={() => setSavingResult(null)} />}
      {replacing && replan && <ActionDialog title="計画の手順を置き換え" onClose={() => setReplacing(null)}>
        <p>計画「{replan.plan.name}」の{replan.from + 1}回目以降（{replan.plan.steps.length - replan.from}手順）を、この経路（{replacing.steps.length}手順）に置き換えますか？</p>
        <p className="small muted">{replan.from > 0 ? `${replan.from}回目までの手順はそのまま残ります。` : ''}外す手順の計画馬のうち、所有馬を紐付けた馬は単独の計画馬として残ります。</p>
        <div className="action-dialog-actions"><button autoFocus onClick={() => setReplacing(null)}>キャンセル</button><button className="primary" onClick={() => replace(replacing)}>置き換える</button></div>
      </ActionDialog>}
    </div>
  );
}

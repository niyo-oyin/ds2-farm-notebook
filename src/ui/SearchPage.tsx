import { StallionShareBadge } from './StallionShare';
import { useEffect, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useApp, sireOptions, damOptions, includePlannedInSearch, type HorseOption } from './app-context';
import { Icon, PageHeading, type IconName } from './icons';
import { HorseSelect } from './HorseSelect';
import { Badge, RuleHelp } from './JudgeView';
import { bruteForceOneGeneration, goalLabel, goalVerdict, summarize, NITRO_LABEL, type NitroStat, type SearchGoal, type JudgementSummary } from '../core/search';
import { StallionFilter, EMPTY_FILTER, matchesStallion, type StallionFilterState } from './StallionFilter';
import { COST_UNKNOWN } from '../core/pedigree';
import type { Judgement } from '../core/types';
import { wantedEffects } from '../core/result-order';
import { ATTR_LABEL, type AttrKey, type OneGenOrigin, type SortKey } from './search-order';
import { OneGenResultList, oneGenColumns } from './OneGenResultList';
import { compareOneGenResults, DEFAULT_ONEGEN_SORT, stallionValues, type OneGenSort } from './onegen-results';
import { EffectCountChips, Pedigree } from './Pedigree';
import { SummaryStrip, JudgeView } from './JudgeView';
import { LoopSearch } from './LoopSearch';
import { SeasonPlanner } from './SeasonPlanner';
import { DesignSearch } from './DesignSearch';
import { HorseDialog } from './HorseDialog';
import type { SearchJob } from '../api';
import { useSearchJob } from '../store/search-jobs';
import { ResultPagination } from './ResultPagination';
import { useResultPage } from './use-result-page';
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
/** 探索の判定回数の上限。血統設計とループ探索で共用する */
export function EvalLimitField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <div className="field"><span>判定回数上限<Tip label="判定回数上限">探索で判定する配合の数の上限です。届くとそこで止まり、それまでに見つかった結果を出します。大きくするほど探索に時間がかかります。</Tip></span><input type="number" aria-label="判定回数上限" value={value} onChange={(e) => onChange(Number(e.target.value))} /></div>;
}
function SelectionChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return <span className="search-selection">{name}<button type="button" aria-label={`${name}を外す`} onClick={onRemove}>×</button></span>;
}
/** 起点の馬を検索して追加し、選んだ馬をチップで並べる */
/** actions は検索欄の横に置く操作（まとめて追加など） */
export function OriginPicker({ label, options, selected, onChange, ariaLabel = `起点の${label}`, actions }: { label: string; options: HorseOption[]; selected: string[]; onChange: (keys: string[]) => void; ariaLabel?: string; actions?: ReactNode }) {
  const app = useApp();
  return <div className="search-origin-picker">
    <HorseSelect value="" onChange={(k) => { if (k && !selected.includes(k)) onChange([...selected, k]); }} options={options} placeholder={`${label}を検索して追加`} aria-label={ariaLabel} clearAfterSelect plannedToggle />
    {actions}
    {selected.length > 0 && <div className="search-selections">{selected.map((key) => <SelectionChip key={key} name={app.resolver.label(key)} onRemove={() => onChange(selected.filter((x) => x !== key))} />)}</div>}
  </div>;
}

/**
 * 探索画面の入力と結果をページ移動後も保持するための記憶（アプリ内のみ。再読み込みで消える）。
 * URL に mare などの指定がある時は、その項目だけ URL を優先する。
 */
const memoStore: Record<string, Record<string, unknown>> = { page: {}, one: {}, design: {}, loop: {}, season: {} };
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

export function SortSelect({ value, onChange, costLabel, matings, matingsLabel = '配合回数が少ない順', stallionAttributes = true }: { value: SortKey; onChange: (v: SortKey) => void; costLabel: string; matings?: boolean; matingsLabel?: string; stallionAttributes?: boolean }) {
  const app = useApp();
  return (
    <label className="field">並び順
      <select value={value} onChange={(e) => onChange(e.target.value as SortKey)}>
        <option value="recommended">おすすめ順</option>
        {matings && <option value="matings">{matingsLabel}</option>}
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
  const urlMode = params.get('mode');
  const [mode, setMode] = useMemoState<'one' | 'design' | 'loop' | 'season'>('page', 'mode', 'one', job ? (job.kind === 'loop' ? 'loop' : 'design') : urlMode === 'one' ? 'one' : urlMode === 'loop' ? 'loop' : urlMode === 'design' || params.get('replan') ? 'design' : null);
  // 1世代の総当たりの起点は、mode=one で開いた時だけ URL から取る
  const oneMare = urlMode === 'one' ? params.get('mare') : null, oneStallion = urlMode === 'one' ? params.get('stallion') : null;
  const [origin, setOrigin] = useMemoState<OneGenOrigin>('one', 'origin', 'mare', oneStallion ? 'stallion' : oneMare ? 'mare' : null);
  const [mares, setMares] = useMemoState<string[]>('one', 'selected:mare', [], oneMare ? [oneMare] : null);
  const [stallions, setStallions] = useMemoState<string[]>('one', 'selected:stallion', [], oneStallion ? [oneStallion] : null);
  const [mareRun, setMareRun] = useMemoState<number>('one', 'run:mare', 0, oneMare ? 1 : null);
  const [stallionRun, setStallionRun] = useMemoState<number>('one', 'run:stallion', 0, oneStallion ? 1 : null);
  const oneSelection = origin === 'mare' ? { selected: mares, setSelected: setMares, run: mareRun, setRun: setMareRun } : { selected: stallions, setSelected: setStallions, run: stallionRun, setRun: setStallionRun };
  const [oneFilter, setOneFilter] = useMemoState<StallionFilterState>('one', 'filter', EMPTY_FILTER);
  const jobStallions = !job ? [] : job.kind === 'loop' ? job.request.stallionPool : [...job.request.stallionPool, ...job.request.colt.sires, job.request.colt.required, job.request.filly.required];
  const restoredFilter = job ? { ...EMPTY_FILTER, includeUnpurchasedOverseas: app.master.stallions.some((h) => h.overseas && !app.data.settings.purchasedStallionShares?.includes(h.id) && jobStallions.includes(h.id)) } : null;
  const [designFilter, setDesignFilter] = useMemoState<StallionFilterState>('design', 'filter', EMPTY_FILTER, job?.kind === 'design' ? restoredFilter : null);
  const [loopFilter, setLoopFilter] = useMemoState<StallionFilterState>('loop', 'filter', EMPTY_FILTER, job?.kind === 'loop' ? restoredFilter : null);
  const [seasonFilter, setSeasonFilter] = useMemoState<StallionFilterState>('season', 'filter', EMPTY_FILTER);
  const currentFilter = { one: oneFilter, design: designFilter, loop: loopFilter, season: seasonFilter }[mode];
  const marePool = mode === 'one' && origin === 'stallion';
  const availableCount = (marePool ? damOptions : sireOptions)(app, { onlyAvailable: true, requirePedigree: true, includePlanned: includePlannedInSearch(app), includeUnpurchasedOverseas: currentFilter.includeUnpurchasedOverseas }).length;
  const poolLabel = marePool ? '繁殖牝馬' : '種牡馬';
  return (
    <div className="search-page">
      <PageHeading icon="search" title="配合探索" actions={<a className="search-pool" href={`#/data?tab=${marePool ? 'broodmares' : 'stallions'}`} aria-label={`候補の${poolLabel} ${availableCount}頭。データを開く`}><span>候補の{poolLabel}</span><strong>{availableCount}<small>頭</small></strong><span className="search-pool-link">データ<span aria-hidden="true"> ↗</span></span></a>} />
      <div className="search-mode" role="group" aria-label="探索モード">
        <button aria-pressed={mode === 'one'} onClick={() => setMode('one')}>1世代の総当たり</button>
        <button aria-pressed={mode === 'design'} onClick={() => setMode('design')}>血統設計</button>
        <button aria-pressed={mode === 'loop'} onClick={() => setMode('loop')}>凝った配合ループ探索</button>
        <button aria-pressed={mode === 'season'} onClick={() => setMode('season')}>今年の種付け</button>
      </div>
      {mode === 'one' ? <OneGen filter={oneFilter} setFilter={setOneFilter} key={origin} origin={origin} onOriginChange={setOrigin} {...oneSelection} /> : mode === 'design' ? <DesignSearch filter={designFilter} setFilter={setDesignFilter} params={params} job={job?.kind === 'design' ? job : null} /> : mode === 'loop' ? <LoopSearch filter={loopFilter} setFilter={setLoopFilter} job={job?.kind === 'loop' ? job : null} /> : <SeasonPlanner filter={seasonFilter} setFilter={setSeasonFilter} />}
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
  const sOpts = useMemo(() => sireOptions(app, { onlyAvailable: true, requirePedigree: true, includePlanned: includePool, includeUnpurchasedOverseas: filter.includeUnpurchasedOverseas }), [app, includePool, filter.includeUnpurchasedOverseas]);
  const hidePlanned = !!app.data.settings.hidePlanned;
  const originOptions = useMemo(() => (fromStallion ? sireOptions : damOptions)(app, { onlyAvailable: true, requirePedigree: true, includePlanned: !hidePlanned }), [app, fromStallion, hidePlanned]);
  const [goals, setGoals] = useMemoState<SearchGoal[]>('one', 'goals', [{ type: 'notDangerous' }]);
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
  const columns = oneGenColumns(fromStallion);
  const changeSort = (column: string) => {
    const direction = sort.column === column ? sort.direction === 'asc' ? 'desc' : 'asc' : ['sire', 'dam', 'price', 'grown'].includes(column) ? 'asc' : 'desc';
    setSort({ column, direction, judgement: 'recommended' });
    resultPage.setPage(0);
  };
  const constraints = (key: string) => { const h = app.resolver.get(key); return h ? <CostUnknownTag steps={[h]} /> : null; };
  const matingLink = (r: { sire: string; dam: string }) => '#/mating?' + new URLSearchParams({ sire: r.sire, dam: r.dam });
  // 行を押すとその場で血統表と判定を展開し、相手の馬名を押すと馬の詳細をオーバーレイで開く
  const [open, setOpen] = useMemoState<string | null>('one', 'open', null);
  const [detail, setDetail] = useState<string | null>(null);
  const nameButton = (key: string) => <><button type="button" className="result-name-button" onClick={(e) => { e.stopPropagation(); setDetail(key); }}>{app.resolver.label(key)}</button> <StallionShareBadge horseKey={key} /></>;
  const expanded = (r: { sire: string; dam: string; judgement: Judgement }) => <div className="result-expanded" onClick={(e) => e.stopPropagation()}>
    <div className="inline-row"><a href={matingLink(r)}>配合確認で開く</a><a href={`#/search?mode=design&mare=${encodeURIComponent(r.dam)}&sire=${encodeURIComponent(r.sire)}`}>血統設計で探す</a></div>
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
          <button type="button" className="search-reset" onClick={() => { setGoals([{ type: 'notDangerous' }]); if (!fromStallion) setFilter(EMPTY_FILTER); setRun(0); }}><SearchIcon name="reset" />条件をリセット</button>
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
          <OneGenResultList rows={resultPage.rows} mobile={mobile} sort={sort} changeSort={changeSort} open={open} toggle={key => setOpen(open === key ? null : key)} nameButton={nameButton} constraints={constraints} expanded={expanded} fromStallion={fromStallion} label="総当たりの検索結果" />
          {results.length === 0 && <p className="empty small">条件を満たす組み合わせはありません。</p>}
          <ResultPagination {...resultPage} onChange={resultPage.setPage} />
        </div>
      )}
      {detail && <HorseDialog horseKey={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

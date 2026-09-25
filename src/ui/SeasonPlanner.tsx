import { useMemo, useState } from 'react';
import { useApp, sireOptions, includePlannedInSearch } from './app-context';
import { Icon } from './icons';
import { StallionFilter, EMPTY_FILTER, matchesStallion, isFilterActive, type StallionFilterState } from './StallionFilter';
import { goalVerdict, summarize, type SearchGoal } from '../core/search';
import { judge } from '../core/judge';
import { wantedEffects } from '../core/result-order';
import { assignWithinBudget } from '../core/season';
import { planProgress } from '../store/plan-progress';
import type { Plan } from '../store/model';
import { GoalEditor, SearchSection, SortSelect, useMemoState, useMobile } from './SearchPage';
import { ownedOrigins, sortCompare } from './search-order';
import { SummaryStrip, JudgeView } from './JudgeView';
import { Pedigree } from './Pedigree';
import { Tip } from './Tip';
import { OneGenResultList, oneGenColumns, type OneGenResultRow } from './OneGenResultList';
import { compareOneGenResults, DEFAULT_ONEGEN_SORT, stallionValues, type OneGenSort } from './onegen-results';
import { HorseDialog } from './HorseDialog';
import { ResultPagination } from './ResultPagination';
import { useResultPage } from './use-result-page';

interface Option extends OneGenResultRow { sireName: string; damName: string; cost: number; costUnknown: boolean; plan?: { plan: Plan; index: number } }
interface Row { mare: string; options: Option[] }

/**
 * 今年の種付け: 所有の繁殖牝馬それぞれに付ける種牡馬を1頭ずつ提案する。
 * 進行中の計画で次の手順の母になっている牝馬には、計画の種牡馬を出す。予算を入れると、合計が収まるように候補の中から選び直す。
 */
export function SeasonPlanner({ filter, setFilter }: { filter: StallionFilterState; setFilter: (filter: StallionFilterState) => void }) {
  const app = useApp();
  const [detailHorse, setDetailHorse] = useState<string | null>(null);
  const sOpts = useMemo(() => sireOptions(app, { onlyAvailable: true, requirePedigree: true, includePlanned: includePlannedInSearch(app), includeOverseas: filter.includeOverseas }), [app, filter.includeOverseas]);
  const mares = useMemo(() => ownedOrigins(app, 'mare'), [app]);
  const [goals, setGoals] = useMemoState<SearchGoal[]>('season', 'goals', [{ type: 'notDangerous' }]);
  const [budget, setBudget] = useMemoState<string>('season', 'budget', '');
  // 牝馬ごとに選び直した種牡馬（予算の割り当てより優先する）
  const [picked, setPicked] = useMemoState<Record<string, string>>('season', 'picked', {});
  const sires = useMemo(() => sOpts.map((o) => o.key).filter((key) => { const m = app.master.stallions.find((s) => s.id === key); return !isFilterActive(filter) || !m || matchesStallion(m, filter); }), [sOpts, filter, app]);

  const rows = useMemo((): Row[] => {
    /** 進行中の計画で、次の手順の母がこの牝馬（またはこの牝馬を紐付けた計画馬）になっているもの */
    const planStep = (mare: string) => {
      for (const plan of app.data.plans) {
        const progress = planProgress(plan, app.data);
        const step = progress.steps[progress.nextIndex];
        if (!step) continue;
        const dam = app.data.plannedHorses.find((h) => h.id === step.dam);
        if (step.dam === mare || dam?.realizedIds.includes(mare)) return { plan, index: progress.nextIndex, sire: step.sire };
      }
      return null;
    };
    const wanted = wantedEffects(goals);
    const attrsOf = (key: string) => app.master.stallions.find((x) => x.id === key)?.attrs;
    return mares.flatMap((mare) => {
      const dam = app.resolver.get(mare);
      if (!dam) return [];
      const option = (sire: string): Option | null => {
        const s = app.resolver.get(sire);
        if (!s) return null;
        const j = judge(s, dam, app.ctx);
        return { sire, dam: mare, sireName: s.name, damName: dam.name, judgement: j, stallion: stallionValues(s, app.resolver.master(sire), app.resolver.user(sire)), cost: j.cost, costUnknown: !!j.costUnknown, s: summarize(j) };
      };
      const fromPlan = planStep(mare);
      const planned = fromPlan && option(fromPlan.sire);
      const ranked = sires.filter(key => key !== fromPlan?.sire).flatMap(key => {
        const o = option(key);
        return o && goals.every(g => goalVerdict(o.judgement, g) === '成立') ? [o] : [];
      }).sort((a, b) => sortCompare('recommended', { ...a, attrs: attrsOf(a.sire) }, { ...b, attrs: attrsOf(b.sire) }, wanted));
      return [{ mare, options: planned ? [{ ...planned, plan: { plan: fromPlan.plan, index: fromPlan.index } }, ...ranked] : ranked }];
    });
  }, [mares, goals, sires, app]);

  const limit = budget ? Number(budget) : null;
  const assignment = useMemo(() => {
    // 計画のある牝馬は計画の種牡馬、選び直した牝馬はその種牡馬に固定し、残りを予算の中で選ぶ
    const fixed = rows.map((r) => {
      const i = r.options.findIndex((o) => o.sire === picked[r.mare]);
      return i >= 0 ? i : r.options[0]?.plan ? 0 : null;
    });
    const choices = rows.map((r, k) => (fixed[k] != null ? [r.options[fixed[k]!]] : r.options));
    const picks = assignWithinBudget(choices, limit);
    return { picks: rows.map((r, k) => (fixed[k] != null ? fixed[k] : picks ? picks[k] : r.options.length ? 0 : null)), fits: !!picks };
  }, [rows, picked, limit]);

  const chosen = rows.map((r, k) => ({ row: r, option: assignment.picks[k] == null ? null : r.options[assignment.picks[k]!] }));
  const total = chosen.reduce((c, x) => c + (x.option?.cost ?? 0), 0);
  const unknownCost = chosen.filter((x) => x.option?.costUnknown).length;
  const matingLink = (sire: string, dam: string) => '#/mating?' + new URLSearchParams({ sire, dam });
  const planTag = (o: Option | null) => o?.plan && <a className="tag" href={`#/plans?id=${o.plan.plan.id}`} onClick={(e) => e.stopPropagation()}>計画「{o.plan.plan.name}」{o.plan.index + 1}回目</a>;
  const nameButton = (key: string) => <button type="button" className="result-name-button" onClick={e => { e.stopPropagation(); setDetailHorse(key); }}>{app.resolver.label(key)}</button>;
  const expanded = (o: Option) => <div className="result-expanded" onClick={e => e.stopPropagation()}>
    <div className="inline-row"><a href={matingLink(o.sire, o.dam)}>配合確認で開く</a><a href={`#/search?mare=${encodeURIComponent(o.dam)}&final=${encodeURIComponent(o.sire)}`}>数世代の配合を探す</a></div>
    <SummaryStrip j={o.judgement} /><Pedigree j={o.judgement} /><details><summary className="small">判定の根拠</summary><JudgeView j={o.judgement} showSummary={false} /></details>
  </div>;


  return (
    <div>
      <div className="search-form">
        <GoalEditor goals={goals} setGoals={setGoals} tip={<Tip label="必ず満たす条件">所有の繁殖牝馬それぞれに付ける種牡馬の条件です。進行中の計画で次の手順の母になっている牝馬には、条件にかかわらず計画の種牡馬を出します。</Tip>} />
        <SearchSection title="種牡馬の属性" icon="sliders"><StallionFilter value={filter} onChange={setFilter} /></SearchSection>
        <SearchSection title="予算" icon="sliders" tip={<Tip label="予算">上限を入れると、種付料の合計が上限に収まるように、各牝馬の候補の中から選び直します。計画のある牝馬と、選び直した牝馬の種牡馬は固定です。</Tip>}>
          <div className="search-limits"><label className="field">種付料合計の上限（万）<input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="なし" /></label></div>
        </SearchSection>
        <div className="search-actions">
          <button type="button" className="search-reset" onClick={() => { setGoals([{ type: 'notDangerous' }]); setBudget(''); setFilter(EMPTY_FILTER); setPicked({}); }}><Icon name="reset" />条件をリセット</button>
        </div>
      </div>
      <div className="panel">
        {!mares.length ? <p className="empty small">所有馬に区分「繁殖牝馬」の牝馬を登録すると、今年付ける種牡馬を提案します。<a href="#/horses">所有馬を開く</a></p> : <>
          <div className="result-status">
            <div><b>所有の繁殖牝馬 {rows.length}頭 · 種付料の合計 {total.toLocaleString()}万</b>{unknownCost > 0 && <span className="muted">（種付料未確認の {unknownCost}頭を除く）</span>}{limit != null && <span className="muted">　予算 {limit.toLocaleString()}万</span>}</div>
            {!assignment.fits && <div className="small">予算内に収まる組み合わせがありません。各牝馬の第1候補を表示しています。</div>}
          </div>
          {chosen.map(({ row, option }) => <details className="season-mare-results" key={row.mare} open>
            <summary className="season-mare-heading"><span className="season-mare-name">{app.resolver.label(row.mare)}</span><span className="small muted">候補 {row.options.length}頭</span></summary>
            {row.options.length ? <SeasonCandidates key={`${row.mare}:${JSON.stringify(goals)}:${JSON.stringify(filter)}`} options={row.options} goals={goals} nameButton={nameButton} expanded={o => <>
              <div className="inline-row season-choice" onClick={e => e.stopPropagation()}>{planTag(o)}{o.sire === option?.sire ? <span className="tag">今年の種付けに選択中</span> : <button type="button" onClick={() => setPicked({ ...picked, [row.mare]: o.sire })}>今年の種付けに選ぶ</button>}</div>
              {expanded(o)}
            </>} /> : <p className="small muted">条件を満たす種牡馬なし</p>}
          </details>)}
        </>}
      </div>
      {detailHorse && <HorseDialog horseKey={detailHorse} onClose={() => setDetailHorse(null)} />}
    </div>
  );
}

function SeasonCandidates({ options, goals, ...list }: {
  options: Option[]; goals: SearchGoal[];
} & Pick<Parameters<typeof OneGenResultList<Option>>[0], 'nameButton' | 'expanded'>) {
  const mobile = useMobile();
  const [sort, setSort] = useState<OneGenSort>(DEFAULT_ONEGEN_SORT);
  const [open, setOpen] = useState<string | null>(null);
  const results = useMemo(() => [...options].sort((a, b) => compareOneGenResults(a, b, sort, wantedEffects(goals))), [options, sort, goals]);
  const page = useResultPage(results, 10);
  const updateSort = (next: OneGenSort) => { setSort(next); page.setPage(0); };
  const changeSort = (column: string) => updateSort({ column, direction: sort.column === column ? sort.direction === 'asc' ? 'desc' : 'asc' : ['sire', 'price', 'grown'].includes(column) ? 'asc' : 'desc', judgement: 'recommended' });
  return <>
    <div className="onegen-sort-tools">
      {mobile && <><label className="field">並べ替える列<select value={sort.column} onChange={e => changeSort(e.target.value)}>{oneGenColumns(false, false).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label><button type="button" onClick={() => updateSort({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}>{sort.direction === 'asc' ? '↑ 昇順' : '↓ 降順'}</button></>}
      <details><summary className="small">判定の詳細順</summary><SortSelect value={sort.column === 'judgement' ? sort.judgement : 'recommended'} onChange={value => updateSort({ column: 'judgement', direction: 'desc', judgement: value })} costLabel="種付料が安い順" stallionAttributes={false} /></details>
    </div>
    <OneGenResultList {...list} rows={page.rows} showOrigin={false} mobile={mobile} sort={sort} changeSort={changeSort} open={open} toggle={key => setOpen(open === key ? null : key)} constraints={() => null} label="今年の種付けの候補" />
    <ResultPagination {...page} onChange={page.setPage} />
  </>;
}

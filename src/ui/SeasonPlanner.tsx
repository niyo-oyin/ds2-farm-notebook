import { useMemo } from 'react';
import { useApp, sireOptions, includePlannedInSearch } from './app-context';
import { Icon } from './icons';
import { StallionFilter, EMPTY_FILTER, matchesStallion, isFilterActive, type StallionFilterState } from './StallionFilter';
import { goalVerdict, summarize, type JudgementSummary, type SearchGoal } from '../core/search';
import { judge } from '../core/judge';
import { wantedEffects } from '../core/result-order';
import { assignWithinBudget } from '../core/season';
import { planProgress } from '../store/plan-progress';
import type { Plan } from '../store/model';
import { GoalEditor, SearchSection, SortSelect, Summary, useMemoState, useMobile } from './SearchPage';
import { ownedOrigins, sortCompare, type SortKey } from './search-order';
import { SummaryStrip, JudgeView } from './JudgeView';
import { Pedigree } from './Pedigree';
import { Tip } from './Tip';

/** 繁殖牝馬ごとに出す候補の数 */
const CANDIDATES = 5;

interface Option { sire: string; cost: number; costUnknown: boolean; s: JudgementSummary; plan?: { plan: Plan; index: number } }
interface Row { mare: string; options: Option[] }

/**
 * 今年の種付け: 所有の繁殖牝馬それぞれに付ける種牡馬を1頭ずつ提案する。
 * 進行中の計画で次の手順の母になっている牝馬には、計画の種牡馬を出す。予算を入れると、合計が収まるように候補の中から選び直す。
 */
export function SeasonPlanner({ filter, setFilter }: { filter: StallionFilterState; setFilter: (filter: StallionFilterState) => void }) {
  const app = useApp();
  const mobile = useMobile();
  const sOpts = useMemo(() => sireOptions(app, { onlyAvailable: true, requirePedigree: true, includePlanned: includePlannedInSearch(app), includeOverseas: filter.includeOverseas }), [app, filter.includeOverseas]);
  const mares = useMemo(() => ownedOrigins(app, 'mare'), [app]);
  const [goals, setGoals] = useMemoState<SearchGoal[]>('season', 'goals', []);
  const [budget, setBudget] = useMemoState<string>('season', 'budget', '');
  const [sort, setSort] = useMemoState<SortKey>('season', 'sort', 'recommended');
  const [open, setOpen] = useMemoState<string | null>('season', 'open', null);
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
        return { sire, cost: j.cost, costUnknown: !!j.costUnknown, s: summarize(j) };
      };
      const fromPlan = planStep(mare);
      const planned = fromPlan && option(fromPlan.sire);
      const ranked = sires.filter((key) => key !== fromPlan?.sire).flatMap((key) => {
        const s = app.resolver.get(key);
        if (!s) return [];
        const j = judge(s, dam, app.ctx);
        return goals.every((g) => goalVerdict(j, g) === '成立') ? [{ sire: key, cost: j.cost, costUnknown: !!j.costUnknown, s: summarize(j) }] : [];
      }).sort((a, b) => sortCompare(sort, { ...a, attrs: attrsOf(a.sire) }, { ...b, attrs: attrsOf(b.sire) }, wanted)).slice(0, CANDIDATES);
      return [{ mare, options: planned ? [{ ...planned, plan: { plan: fromPlan.plan, index: fromPlan.index } }, ...ranked] : ranked }];
    });
  }, [mares, goals, sort, sires, app]);

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
  const sireName = (o: Option | null) => (o ? <>{app.resolver.label(o.sire)} {planTag(o)}</> : <span className="muted small">条件を満たす種牡馬なし</span>);
  const toggle = (mare: string) => setOpen(open === mare ? null : mare);

  /** 開いた行: 候補の比較と選び直し、選んだ配合の血統表と判定 */
  const detail = (row: Row, option: Option | null) => {
    const sire = option && app.resolver.get(option.sire), dam = app.resolver.get(row.mare);
    const j = sire && dam ? judge(sire, dam, app.ctx) : null;
    return <div className="result-expanded" onClick={(e) => e.stopPropagation()}>
      {row.options.length > 1 && <ol className="steps">{row.options.map((o) => <li key={o.sire}>
        <b>{app.resolver.label(o.sire)}</b>（{o.costUnknown ? '種付料未確認' : `${o.cost.toLocaleString()}万`}） {planTag(o)}{' '}
        {o.sire === option?.sire ? <span className="tag">選択中</span> : <button type="button" onClick={() => setPicked({ ...picked, [row.mare]: o.sire })}>この種牡馬にする</button>}
        <div><Summary s={o.s} /></div>
      </li>)}</ol>}
      {option && <div className="inline-row"><a href={matingLink(option.sire, row.mare)}>配合確認で開く</a></div>}
      {j && <><SummaryStrip j={j} /><Pedigree j={j} /><details><summary className="small">判定の根拠</summary><JudgeView j={j} showSummary={false} /></details></>}
    </div>;
  };

  return (
    <div>
      <div className="search-form">
        <GoalEditor goals={goals} setGoals={setGoals} tip={<Tip label="必ず満たす条件">所有の繁殖牝馬それぞれに付ける種牡馬の条件です。進行中の計画で次の手順の母になっている牝馬には、条件にかかわらず計画の種牡馬を出します。</Tip>} />
        <SearchSection title="種牡馬の属性" icon="sliders"><StallionFilter value={filter} onChange={setFilter} /></SearchSection>
        <SearchSection title="予算" icon="sliders" tip={<Tip label="予算">上限を入れると、種付料の合計が上限に収まるように、各牝馬の候補の中から選び直します。計画のある牝馬と、選び直した牝馬の種牡馬は固定です。</Tip>}>
          <div className="search-limits"><label className="field">種付料合計の上限（万）<input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="なし" /></label></div>
        </SearchSection>
        <div className="search-actions">
          <button type="button" className="search-reset" onClick={() => { setGoals([]); setBudget(''); setFilter(EMPTY_FILTER); setPicked({}); }}><Icon name="reset" />条件をリセット</button>
        </div>
      </div>
      <div className="panel">
        {!mares.length ? <p className="empty small">所有馬に区分「繁殖牝馬」の牝馬を登録すると、今年付ける種牡馬を提案します。<a href="#/horses">所有馬を開く</a></p> : <>
          <div className="result-status">
            <div><b>所有の繁殖牝馬 {rows.length}頭 · 種付料の合計 {total.toLocaleString()}万</b>{unknownCost > 0 && <span className="muted">（種付料未確認の {unknownCost}頭を除く）</span>}{limit != null && <span className="muted">　予算 {limit.toLocaleString()}万</span>}</div>
            {!assignment.fits && <div className="small">予算内に収まる組み合わせがありません。各牝馬の第1候補を表示しています。</div>}
          </div>
          <div className="toolbar"><SortSelect value={sort} onChange={(value) => { setSort(value); setPicked({}); }} costLabel="種付料が安い順" /></div>
          {mobile ? (
            <div className="result-cards">
              {chosen.map(({ row, option }) => <div key={row.mare} className={'result-card clickable' + (open === row.mare ? ' selected' : '')} onClick={() => toggle(row.mare)}>
                <div className="result-head"><b>{app.resolver.label(row.mare)}</b><span className="num muted">{!option ? '' : option.costUnknown ? '未確認' : `${option.cost.toLocaleString()}万`}</span></div>
                <div>{sireName(option)}</div>
                {option && <Summary s={option.s} />}
                {open === row.mare && detail(row, option)}
              </div>)}
            </div>
          ) : (
            <div className="table-wrap"><table>
              <thead><tr><th>繁殖牝馬</th><th>種牡馬</th><th className="num">種付料</th><th className="wrap">判定</th></tr></thead>
              <tbody>{chosen.map(({ row, option }) => [
                <tr key={row.mare} className={'clickable' + (open === row.mare ? ' selected' : '')} onClick={() => toggle(row.mare)}>
                  <td className="name">{app.resolver.label(row.mare)}</td>
                  <td className="name">{sireName(option)}</td>
                  <td className="num">{!option ? '' : option.costUnknown ? '—' : option.cost.toLocaleString()}</td>
                  <td className="wrap">{option && <Summary s={option.s} />}</td>
                </tr>,
                open === row.mare && <tr key={'d' + row.mare} className="result-expanded-row"><td colSpan={4} className="wrap">{detail(row, option)}</td></tr>,
              ])}</tbody>
            </table></div>
          )}
        </>}
      </div>
    </div>
  );
}

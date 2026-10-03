import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Icon, PageHeading } from './icons';
import { useApp } from './app-context';
import { store, type Plan } from '../store/userdata';
import { planProgress } from '../store/plan-progress';
import { judge } from '../core/judge';
import { goalLabel, goalVerdict } from '../core/search';
import { Badge, SummaryStrip } from './JudgeView';
import type { PlannedHorse } from '../core/types';
import { navigate } from './router';
import { estimateYears, YEAR_ASSUMPTIONS } from '../core/estimate';
import { PlannedHorseLinks } from './PlannedHorseLinks';
import { ActionDialog } from './ActionDialog';
import { nameSearch } from './name-search';
import { planContext } from './plan-context';
import { PlanHorseName } from './PlanHorseName';
import { plannedProgress } from '../store/model';
import { comparePlanEntries, PLAN_SORTS, type PlanListOrder, type PlanSortKey } from './plan-list-order';
import { planListSummary } from './plan-list-summary';
import './PlansPage.css';

const mq = typeof matchMedia !== 'undefined' ? matchMedia('(max-width: 900px)') : null;
const useNarrow = () => useSyncExternalStore((cb) => { mq?.addEventListener('change', cb); return () => mq?.removeEventListener('change', cb); }, () => !!mq?.matches);
const roleLabel = (h: PlannedHorse) => h.role === 'broodmare' ? '繁殖牝馬' : h.role === 'stallion' ? '種牡馬' : '競走馬';
// アプリ内のタブ移動では並び順を保つ。再読み込み時は進捗の高い順から始める。
const plansMemo = { sort: { key: 'progress', direction: 'desc' } as PlanListOrder };

export function PlansPage({ params }: { params: URLSearchParams }) {
  const app = useApp();
  const narrow = useNarrow();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState<PlanListOrder>(plansMemo.sort);
  useEffect(() => { plansMemo.sort = sort; }, [sort]);
  const targetFoal = params.get('foal');
  const [sel, setSel] = useState<string | null | undefined>(params.get('id') ?? app.data.plans.find((p) => p.steps.some((s) => s.foalId === targetFoal))?.id ?? targetFoal ?? undefined);
  const summaries = useMemo(() => new Map(app.data.plans.map((p) => [p.id, planListSummary(p, app.data, (id) => app.resolver.label(id))])), [app.data, app.resolver]);
  const standalone = app.data.plannedHorses.filter((h) => !app.data.plans.some((p) => p.steps.some((s) => s.foalId === h.id)));
  const search = nameSearch(query);
  const plans = app.data.plans.filter((p) => { const summary = summaries.get(p.id)!; return (filter === 'all' || (filter === 'done' ? summary.progress.complete : filter === 'active' && !summary.progress.complete)) && search.matches(p.name, app.resolver.label(p.startKey), ...summary.searchNames); })
    .map((p) => { const state = summaries.get(p.id)!.progress; return { ...p, origin: app.resolver.label(p.startKey), completed: state.completed, matings: p.steps.length, pendingProgress: state.steps[state.nextIndex]?.progress ?? null }; })
    .sort((a, b) => comparePlanEntries(a, b, sort));
  const foals = filter === 'all' || filter === 'standalone' ? standalone.filter((h) => search.matches(h.name, app.resolver.label(h.sireKey), app.resolver.label(h.damKey)))
    .map((h) => { const p = plannedProgress(h, app.data.horses); const complete = p.born && p.sexOk && (!h.role || p.bred); return { ...h, origin: app.resolver.label(h.damKey), completed: Number(complete), matings: 1, pendingProgress: complete ? null : p }; })
    .sort((a, b) => comparePlanEntries(a, b, sort)) : [];
  const sortOption = PLAN_SORTS.find((s) => s.key === sort.key)!;
  const selectedId = sel === undefined && !narrow ? plans[0]?.id ?? foals[0]?.id : sel;
  const plan = app.data.plans.find((p) => p.id === selectedId);
  const foal = standalone.find((h) => h.id === selectedId);
  const select = (id: string) => {
    setSel(id);
    history.replaceState(null, '', '#/plans?' + new URLSearchParams(app.data.plans.some((p) => p.id === id) ? { id } : { foal: id }));
    if (narrow) window.scrollTo(0, 0);
  };
  const back = () => { setSel(null); history.replaceState(null, '', '#/plans'); window.scrollTo(0, 0); };
  const removed = () => { setSel(undefined); history.replaceState(null, '', '#/plans'); };
  return <div className="plans-page">
    <PageHeading icon="plans" title="配合計画" count={{ value: app.data.plans.length, unit: '件' }} actions={narrow && (plan || foal) ? <button onClick={back}>‹ 計画一覧へ</button> : <><button onClick={() => navigate('/mating')}>配合を確認して作る</button><button className="primary" onClick={() => navigate('/search')}>配合探索から作る</button></>} />
    <div className={'plans-workspace' + (plan || foal ? ' has-detail' : '')}>
      <aside className="plan-list-panel">
        <div className="plan-list-search"><input aria-label="計画を検索" placeholder="計画名・馬名で検索" value={query} onChange={(e) => setQuery(e.target.value)} /><select aria-label="計画の表示対象" value={filter} onChange={(e) => { setFilter(e.target.value); setSel(undefined); }}><option value="all">すべて</option><option value="active">進行中</option><option value="done">完了</option><option value="standalone">単独の計画馬</option></select></div>
        <div className="plan-list-caption"><span>{plans.length}件{foals.length > 0 && `・計画馬 ${foals.length}頭`}</span><div className="plan-list-sort">
          <select aria-label="配合計画の並べ替え" value={sort.key} onChange={(e) => { setSel(selectedId); setSort({ key: e.target.value as PlanSortKey, direction: ['name', 'origin', 'matings'].includes(e.target.value) ? 'asc' : 'desc' }); }}>{PLAN_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
          <button type="button" aria-label={`${sortOption.label}：${sortOption[sort.direction]}。クリックで${sortOption[sort.direction === 'asc' ? 'desc' : 'asc']}`} onClick={() => { setSel(selectedId); setSort({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' }); }}>{sort.direction === 'asc' ? '↑' : '↓'} {sortOption[sort.direction]}</button>
        </div></div>
        <div className="plan-list-items">
          {plans.map((p) => {
            const summary = summaries.get(p.id)!;
            const { progress: state, current } = summary;
            const mating = current && <span className={'plan-list-mating' + (summary.horses.length ? ' secondary' : '')}><span><span className="plan-list-field">父</span><b>{summary.sire}</b></span><span className="plan-list-cross" aria-hidden="true">×</span><span><span className="plan-list-field">母</span><b>{summary.dam}</b></span>{current.foal && current.progress && (!current.progress.born || !current.progress.sexOk) && <span className="plan-list-target"><span className="plan-list-cross" aria-hidden="true">→</span><span className={`pill sex-${current.foal.desiredSex ?? 'none'}`} title="産駒の希望性別">{current.foal.desiredSex === 'F' ? '牝馬' : current.foal.desiredSex === 'M' ? '牡馬' : '不問'}</span></span>}</span>;
            return <button key={p.id} className={'plan-list-row' + (p.id === selectedId ? ' selected' : '')} aria-pressed={p.id === selectedId} onClick={() => select(p.id)}>
              <span className="plan-list-title plan-list-plan-title"><b title={p.name}>{p.name}</b><span className={'plan-status' + (state.complete ? ' complete' : current?.progress?.born ? ' waiting' : '')}>{state.complete ? 'すべて完了' : current ? `${state.nextIndex + 1}回目 · ${current.status}` : '配合手順なし'}</span></span>
              <span className="plan-list-body">
                {summary.horses.length > 0 ? <span className="plan-list-current-horses"><span className="plan-list-field">{state.complete ? '最終産駒' : current?.status === '種牡馬入り待ち' ? '種牡馬入り待ち' : current?.status === '繁殖入り待ち' ? '繁殖待ち' : '生産済み'}</span><span>{summary.horses.map((h, i) => <span key={h.id}>{i > 0 && '・'}<b>{h.name}</b>{summary.horses.length > 1 && <small>（{h.sex === 'F' ? '牝' : h.sex === 'M' ? '牡' : '性別未確認'}）</small>}</span>)}</span></span> : mating || <span />}
                <span className="plan-list-count">{state.completed} / {p.steps.length} 完了</span>
              </span>
              {summary.horses.length > 0 && mating}
              {current?.progress?.born && !summary.horses.length && <span className="plan-list-origin">生産済みの実馬は未紐付け</span>}
              <span className="plan-progress-track" aria-hidden="true"><span style={{ width: `${p.steps.length ? state.completed / p.steps.length * 100 : 0}%` }} /></span>
            </button>;
          })}
          {foals.length > 0 && <div className="plan-list-group">単独の計画馬</div>}
          {foals.map((h) => <button key={h.id} className={'plan-list-row' + (h.id === selectedId ? ' selected' : '')} aria-pressed={h.id === selectedId} onClick={() => select(h.id)}><span className="plan-list-title"><b>{h.name}</b><span className="pill">計画馬</span></span><span className="plan-list-origin">{roleLabel(h)}予定・所有馬 {h.realizedIds.length}頭</span></button>)}
          {!plans.length && !foals.length && <div className="plan-list-empty">{app.data.plans.length || standalone.length ? <><p>該当する計画はありません。</p><button onClick={() => { setQuery(''); setFilter('all'); }}>絞り込みを解除</button></> : <p>保存した配合計画がここに並びます。</p>}</div>}
        </div>
      </aside>
      <div className="plan-detail-panel">
        {plan ? <PlanDetail key={plan.id} plan={plan} initialFoal={targetFoal} onRemoved={removed} /> : foal ? <StandaloneHorse key={foal.id} foal={foal} onRemoved={removed} /> : <div className="plan-empty"><Icon name="plans" /><h3>{app.data.plans.length || standalone.length ? '一覧から計画を選択' : '配合を計画'}</h3><p>配合手順と進捗、産まれた所有馬をまとめて管理できます。</p>{!app.data.plans.length && !standalone.length && <button className="primary" onClick={() => navigate('/search')}>配合を探索する</button>}</div>}
      </div>
    </div>
  </div>;
}

function EditableTitle({ value, label, onSave }: { value: string; label: string; onSave: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft?.trim() && draft.trim() !== value) onSave(draft.trim()); setDraft(null); };
  return draft === null ? <div className="plan-title"><h3>{value}</h3><button aria-label={`${label}を編集`} title={`${label}を編集`} onClick={() => setDraft(value)}>✎</button></div> : <input className="plan-title-input" autoFocus aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur(); if (e.key === 'Escape') setDraft(null); }} />;
}

function PlanDetail({ plan, initialFoal, onRemoved }: { plan: Plan; initialFoal: string | null; onRemoved: () => void }) {
  const baseApp = useApp();
  const app = useMemo(() => planContext(baseApp, plan), [baseApp, plan]);
  const horseName = (id: string, label: string) => <PlanHorseName name={app.resolver.label(id)} {...app.choice(id)} label={label} onChange={(horseId) => {
    const realizedSelections = { ...plan.realizedSelections };
    if (horseId) realizedSelections[id] = horseId; else delete realizedSelections[id];
    store.updatePlan(plan.id, { realizedSelections });
  }} />;
  const progress = planProgress(plan, app.data);
  const narrow = useNarrow();
  const [selected, setSelected] = useState(() => { const target = plan.steps.findIndex((s) => s.foalId === initialFoal); return Math.max(0, target >= 0 ? target : progress.nextIndex); });
  const [memoDraft, setMemoDraft] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const steps = useMemo(() => plan.steps.map((s) => {
    try { const sire = app.resolver.get(app.key(s.sire)), dam = app.resolver.get(app.key(s.dam)); return { j: sire && dam ? judge(sire, dam, app.ctx) : null, error: !sire || !dam ? '父または母が見つかりません' : '' }; }
    catch (e) { return { j: null, error: (e as Error).message }; }
  }), [plan, app]);
  const index = Math.min(selected, plan.steps.length - 1);
  const stepList = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = stepList.current;
    const selected = list?.querySelector<HTMLElement>('[aria-pressed="true"]')?.parentElement;
    if (list && selected && list.scrollWidth > list.clientWidth) list.scrollLeft += selected.getBoundingClientRect().left - list.getBoundingClientRect().left;
  }, [index]);
  const step = progress.steps[index], result = steps[index], last = steps.at(-1)?.j;
  const next = progress.steps[progress.nextIndex];
  const cost = steps.reduce((total, s) => total + (s.j?.cost ?? 0), 0);
  const years = estimateYears(plan.steps.length);
  const versionChanged = plan.rulesVersion !== app.ctx.rulesVersion || plan.dataVersion !== app.ctx.dataVersion;
  return <>
    <section className="plan-overview">
      <div className="plan-overview-heading"><div><EditableTitle value={plan.name} label="計画名" onSave={(name) => store.updatePlan(plan.id, { name })} /></div><button className="text-toggle plan-delete" onClick={() => setDeleting(true)}>計画を削除</button></div>
      <div className="plan-overview-body"><div><div className="plan-start"><span>起点</span>{horseName(plan.startKey, '起点の所有馬')}</div><dl className="plan-metrics"><div><dt>手順の完了</dt><dd>{progress.completed}<small> / {plan.steps.length}</small></dd></div><div><dt>種付料の合計</dt><dd>{steps.some((s) => !s.j || s.j.costUnknown) ? '—' : cost.toLocaleString()}<small>万円</small></dd></div></dl></div><details className="plan-memo" open={!narrow}><summary>メモ{plan.memo && <span>{plan.memo}</span>}</summary><textarea aria-label="計画のメモ" rows={3} placeholder="計画についてのメモ" value={memoDraft ?? plan.memo} onChange={(e) => setMemoDraft(e.target.value)} onBlur={() => { if (memoDraft !== null && memoDraft !== plan.memo) store.updatePlan(plan.id, { memo: memoDraft }); setMemoDraft(null); }} /></details></div>
      {plan.goals.length > 0 && <div className="plan-goals"><span>最終配合の目標</span><div>{plan.goals.map((g, i) => <span key={i} className="plan-goal">{goalLabel(g)} <Badge v={last ? goalVerdict(last, g) : '未確定'} /></span>)}</div></div>}
      <details className="plan-assumptions"><summary>所要年数の目安</summary><p>約{years.estimatedYears}年・期待生産 {years.expectedFoals.toFixed(0)}頭。{YEAR_ASSUMPTIONS.note}</p>{versionChanged && <p>データ・ルールの変更を反映して再判定しています。</p>}</details>
    </section>
    <div className={'plan-next' + (progress.complete ? ' complete' : '')}><Icon name={progress.complete ? 'check' : 'plans'} /><div><b>{progress.complete ? 'すべての手順が完了' : next ? `次に進める手順：${progress.nextIndex + 1}回目` : '配合手順がありません'}</b>{next && <span>{next.foal ? app.label(next.foalId) : '計画馬なし'} · {next.status}</span>}</div>{next && index !== progress.nextIndex && <button onClick={() => setSelected(progress.nextIndex)}>この手順を開く</button>}</div>
    <section className="plan-workflow" aria-label="配合手順">
      <div className="plan-step-nav"><div className="plan-section-heading"><h3>配合手順</h3><span>{plan.steps.length}回</span></div><ol ref={stepList}>{progress.steps.map((s, i) => <li key={s.foalId}><button className={i === index ? 'selected' : ''} aria-pressed={i === index} onClick={() => setSelected(i)}><span className={'plan-step-number' + (s.complete ? ' complete' : '')}>{s.complete ? '✓' : String(i + 1).padStart(2, '0')}</span><span className="plan-step-label"><b>{s.foal ? app.label(s.foalId) : `産駒 ${i + 1}`}</b><span>{app.label(s.sire)}</span><small className={s.complete ? 'is-complete' : ''}>{s.status}</small></span><span aria-hidden="true">›</span></button></li>)}</ol></div>
      {step && <div className="plan-step-detail" key={step.foalId}>
        <div className="plan-section-heading"><h3>{index + 1}回目の配合</h3><div className="plan-step-actions"><button onClick={() => navigate('/mating', { sire: app.key(step.sire), dam: app.key(step.dam), plan: plan.id })}>配合確認</button><button title={`${index + 1}回目以降の手順を、この母から探し直す`} onClick={() => navigate('/search', { mode: 'design', replan: plan.id, from: String(index) })}>ここから再探索</button></div></div>
        <div className="plan-parents"><div><span>父</span>{horseName(step.sire, '父として使う所有馬')}</div><span aria-hidden="true">×</span><div><span>母</span>{horseName(step.dam, '母として使う所有馬')}</div></div>
        {[step.sire, step.dam].some((id) => app.choice(id).candidates.length > 1 && !app.choice(id).selected) && <p className="small muted">所有馬を選ぶと、その馬の血統で判定します。未選択の間は計画上の血統を使います。</p>}
        {result.error && <p className="error">{result.error}</p>}
        {result.j && <div className="plan-step-result"><SummaryStrip j={result.j} /></div>}
        {step.foal ? <><div className="plan-foal-heading"><span>{app.choice(step.foalId).candidates.length ? '産駒' : '予定する産駒'}</span>{horseName(step.foalId, 'この手順の所有馬')}<span className="pill">{roleLabel(step.foal)}予定</span>{step.foal.desiredSex && <span className={`pill sex-${step.foal.desiredSex}`}>{step.foal.desiredSex === 'F' ? '牝' : '牡'}</span>}</div><PlannedHorseLinks foal={step.foal} parents={{ sire: app.key(step.sire), dam: app.key(step.dam) }} /></> : <p className="notice">この手順の計画馬が見つかりません。</p>}
        <div className="plan-step-paging"><button disabled={index === 0} onClick={() => setSelected(index - 1)}>‹ 前の手順</button><button disabled={index >= steps.length - 1} onClick={() => setSelected(index + 1)}>次の手順 ›</button></div>
      </div>}
    </section>
    {deleting && <ActionDialog title="配合計画を削除" onClose={() => setDeleting(false)}><p>「{plan.name}」を削除しますか？</p><p className="small muted">所有馬と、他の血統・計画で使う計画馬は残ります。</p><div className="action-dialog-actions"><button autoFocus onClick={() => setDeleting(false)}>キャンセル</button><button className="danger" onClick={() => { store.deletePlan(plan.id); onRemoved(); }}>削除する</button></div></ActionDialog>}
  </>;
}

function StandaloneHorse({ foal, onRemoved }: { foal: PlannedHorse; onRemoved: () => void }) {
  const app = useApp();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  return <section className="plan-standalone">
    <div className="plan-overview-heading"><div><span className="plan-eyebrow">単独の計画馬</span><EditableTitle value={foal.name} label="馬名" onSave={(name) => store.updatePlannedHorse(foal.id, { name })} /></div><button className="text-toggle plan-delete" onClick={() => setDeleting(true)}>計画馬を削除</button></div>
    <div className="plan-parents"><div><span>父</span><b>{app.resolver.label(foal.sireKey)}</b></div><span aria-hidden="true">×</span><div><span>母</span><b>{app.resolver.label(foal.damKey)}</b></div></div>
    <div className="plan-standalone-actions"><label className="field">産駒の予定<select value={foal.role ?? ''} onChange={(e) => store.updatePlannedHorse(foal.id, { role: (e.target.value || undefined) as PlannedHorse['role'], desiredSex: e.target.value === 'stallion' ? 'M' : e.target.value === 'broodmare' ? 'F' : undefined })}><option value="">競走馬</option><option value="broodmare">繁殖牝馬</option><option value="stallion">種牡馬</option></select></label><button onClick={() => navigate('/mating', { sire: foal.sireKey, dam: foal.damKey })}>配合確認</button></div>
    <PlannedHorseLinks foal={foal} />
    {deleting && <ActionDialog title="計画馬を削除" onClose={() => { setDeleting(false); setError(''); }}><p>「{foal.name}」を削除しますか？</p><p className="small muted">紐付けた所有馬は残ります。</p>{error && <p role="alert" className="error">{error}</p>}<div className="action-dialog-actions"><button autoFocus onClick={() => setDeleting(false)}>キャンセル</button><button className="danger" onClick={() => { const error = store.deletePlannedHorse(foal.id); if (error) setError(error); else onRemoved(); }}>削除する</button></div></ActionDialog>}
  </section>;
}

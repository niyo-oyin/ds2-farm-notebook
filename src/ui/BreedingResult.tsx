import { useMemo, useState } from 'react';
import type { BreedingScreen, ImportJob } from '../api';
import { applyMasterFields, breedingCardRows, homebredBlockReason, masterDiffRows, masterFromBreedingCard, nicksProposals } from '../core/master-edits';
import { damOptions, useApp } from './app-context';
import { applyMasterJob, applyNicksProposals, type AppliedInfo } from './import-apply';

export function BreedingResult({ job, reading, onDone }: { job: ImportJob; reading: BreedingScreen; onDone: (info: AppliedInfo) => void }) {
  const app = useApp();
  const b = reading.breeding;
  const mares = useMemo(() => damOptions(app, { includePlanned: false }), [app]);
  const [mareKey, setMareKey] = useState(job.targetHorseId && mares.some((m) => m.key === job.targetHorseId) ? job.targetHorseId : '');
  const [includeZero, setIncludeZero] = useState(true);
  const [saveNicks, setSaveNicks] = useState(true);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');
  const mare = mareKey ? app.resolver.get(mareKey) : null;
  const rows = useMemo(() => breedingCardRows(b, app.master.stallions), [b, app.master.stallions]);
  const updates = useMemo(() => rows.flatMap((row) => {
    if (!row.stallion || homebredBlockReason({ name: row.name, sire: '', dam: '' }, app.data.horses, app.data.plannedHorses)) return [];
    const next = masterFromBreedingCard(row.stallion, row.reading);
    const diff = masterDiffRows(row.stallion, next, app.master.meta.bigSystems, id => app.resolver.label(id));
    return diff.length ? [{ existing: row.stallion, next, diff }] : [];
  }), [rows, app.data.horses, app.data.plannedHorses, app.master.meta.bigSystems, app.resolver]);
  const targets = updates.map((u) => ({ ...u, keys: u.diff.map((d) => d.key).filter((key) => !excluded.has(`${u.existing.id}:${key}`)) })).filter((u) => u.keys.length);
  const proposals = useMemo(() => (mare?.smallSystem ? nicksProposals(rows, mare.smallSystem, app.master.nicks, includeZero) : []), [rows, mare, app.master.nicks, includeZero]);
  const applicable = saveNicks ? proposals.filter((p) => p.status !== '不整合') : [];
  const level = (n: number | null) => n === null ? '—' : n > 0 ? '★'.repeat(n) : '0';
  const toggle = (key: string) => setExcluded((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const summary = [targets.length ? `種牡馬 ${targets.length}頭` : '', applicable.length ? `ニックス ${applicable.length}組` : ''].filter(Boolean).join('・');
  const apply = () => {
    try {
      for (const u of targets) applyMasterJob(u.existing, applyMasterFields(u.existing, u.next, u.keys));
      if (applicable.length) applyNicksProposals(applicable, mare?.name ?? '');
      onDone({ name: summary, href: targets.length ? '#/data?tab=stallions' : '#/data?tab=nicks' });
    } catch (e) { setError((e as Error).message); }
  };
  return <div className="import-card">
    <div className="import-card-title"><b>種牡馬一覧</b>{b.sort !== '不明' && <span className="pill">{b.sort}順</span>}<span className="small muted">{b.cards.length}頭{b.selected_name && ` · 選択中 ${b.selected_name}${b.selected_small_system ? `（${b.selected_small_system}系）` : ''}`}</span></div>
    {reading.notes && <div className="small muted">読み取りメモ: {reading.notes}</div>}
    <div className="import-table-scroll"><table className="import-diff import-stallions"><thead><tr><th>種牡馬</th><th>種付料</th><th>配合理論</th><th>ニックス</th><th>距離</th><th>成長</th><th>ダート</th><th>体質</th><th>気性</th><th>実績</th><th>底力</th><th>安定</th></tr></thead><tbody>{rows.map((r, i) => <tr key={i}>
      <th>{r.name}{!r.stallion && <div className="small muted">未登録</div>}</th><td>{r.reading.fee || '—'}</td><td>{r.reading.theory || '—'}</td><td>{level(r.level)}</td>
      {(['distance', 'growth', 'dirt', 'kenko', 'kisyo', 'jisseki', 'konjo', 'antei'] as const).map((key) => <td key={key}>{r.reading.abilities?.[key] || '—'}</td>)}
    </tr>)}</tbody></table></div>
    {updates.length > 0 && <details className="import-factors" open>
      <summary>種牡馬データの更新（{updates.length}頭）</summary>
      <div className="import-fields-head"><span className="small muted">反映する項目</span><button type="button" onClick={() => setExcluded(new Set())}>すべて</button><button type="button" onClick={() => setExcluded(new Set(updates.flatMap((u) => u.diff.map((d) => `${u.existing.id}:${d.key}`))))}>すべて外す</button></div>
      <table className="import-diff"><thead><tr><th>反映</th><th>種牡馬</th><th>項目</th><th>現在</th><th>読み取り</th></tr></thead><tbody>{updates.flatMap((u) => u.diff.map((d) => {
        const key = `${u.existing.id}:${d.key}`;
        return <tr key={key} className={excluded.has(key) ? 'excluded' : ''}><td><input type="checkbox" aria-label={`${u.existing.name}の${d.label}を更新する`} checked={!excluded.has(key)} onChange={() => toggle(key)} /></td><th>{u.existing.name}</th><th>{d.label}</th><td className="muted">{d.before}</td><td>{d.after}</td></tr>;
      }))}</tbody></table>
    </details>}
    <label className="field import-breeding-mare">ニックスの反映先となる繁殖牝馬<select value={mareKey} onChange={(e) => setMareKey(e.target.value)}><option value="">選択…</option>{mares.map((m) => <option key={m.key} value={m.key}>{m.name}{m.sub ? `（${m.sub}）` : ''}</option>)}</select></label>
    {mare && !mare.smallSystem && <div className="error">{mare.name} の小系統が不明なので、ニックスの組にできません。</div>}
    {mare?.smallSystem && <>
      <div className="import-fields-head"><label className="small"><input type="checkbox" checked={saveNicks} onChange={(e) => setSaveNicks(e.target.checked)} />ニックス表に記録（母 {mare.smallSystem}系）</label><label className="small"><input type="checkbox" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} />★のない種牡馬も段階0として記録</label></div>
      <table className="import-diff"><thead><tr><th>父の小系統</th><th>段階</th><th>状態</th><th>種牡馬</th></tr></thead><tbody>{proposals.map((p) => <tr key={p.sire} className={p.status === '不整合' ? 'excluded' : ''}><th>{p.sire}</th><td>{level(p.level)}{p.current !== undefined && p.current !== p.level && <span className="muted">（表は {level(p.current)}）</span>}</td><td><span className={'tag' + (p.status === '食い違い' || p.status === '不整合' ? ' warn' : '')}>{p.status}</span></td><td className="small muted">{p.stallions.join('、')}</td></tr>)}</tbody></table>
    </>}
    <div className="import-apply"><button type="button" className="primary" disabled={!targets.length && !applicable.length} onClick={apply}>{summary ? `${summary}を反映` : '反映する変更なし'}</button>{error && <span className="error">{error}</span>}</div>
  </div>;
}

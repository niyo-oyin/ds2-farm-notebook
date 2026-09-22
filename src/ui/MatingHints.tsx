import { useMemo } from 'react';
import type { MasterHorse } from '../core/types';
import { kottaHints, nicksHints } from '../core/master-edits';
import { judge } from '../core/judge';
import { useApp } from './app-context';

/** 配合の手がかり: 本馬の小系統に対するニックス、4代以内の祖先が載る凝ったペア、それらが成立する相手 */
export function MatingHints({ horse }: { horse: MasterHorse }) {
  const app = useApp();
  const nicks = useMemo(() => nicksHints(horse.smallSystem, horse.kind, app.master.nicks), [horse, app.master.nicks]);
  const kotta = useMemo(() => kottaHints(horse, app.master.kotta, app.rules.kottaSymmetric, app.rules.kottaGenerations), [horse, app.master.kotta, app.rules]);
  // マスターに登録された相手全頭と判定し、凝った配合とニックスが成立する相手を挙げる。
  const partners = useMemo(() => {
    const self = app.resolver.get(horse.id);
    if (!self) return { kotta: [], nicks: [] };
    const others = horse.kind === 'stallion' ? app.master.broodmares : app.master.stallions;
    const kottaOk: string[] = [], nicksOk: { name: string; level: number }[] = [];
    for (const o of others) {
      const other = app.resolver.get(o.id);
      if (!other) continue;
      const j = horse.kind === 'stallion' ? judge(self, other, app.ctx) : judge(other, self, app.ctx);
      if (j.kotta.verdict === '成立') kottaOk.push(o.name);
      if (j.nicks.level > 0) nicksOk.push({ name: o.name, level: j.nicks.level });
    }
    return { kotta: kottaOk, nicks: nicksOk.sort((a, b) => b.level - a.level) };
  }, [horse, app]);
  const side = horse.kind === 'stallion' ? '母' : '父';
  const stars = (n: number) => '★'.repeat(n);
  return <section className="sheet-section">
    <div className="sheet-section-heading"><h3>配合の手がかり</h3><span className="small muted">凝ったペア表とニックス相性表から。表の確認・追加はデータの各タブで</span></div>
    <h4 className="master-code-title">ニックス（{horse.smallSystem ? `${horse.smallSystem}系` : '小系統が未登録'}）</h4>
    {nicks.length ? <div className="pairs-chips">{nicks.map((n) => <span key={n.partner} className={'pairs-chip' + (n.level === 0 ? ' zero' : '')}><span className="pairs-chip-name">{side} {n.partner}系</span><span className="pairs-chip-level">{n.level > 0 ? stars(n.level) : '0'}</span></span>)}</div>
      : <p className="small muted">相性表に登録がありません（未確認）。</p>}
    {partners.nicks.length > 0 && <p className="small">成立する相手 {partners.nicks.length}頭: {partners.nicks.slice(0, 20).map((p) => `${p.name} ${stars(p.level)}`).join('、')}{partners.nicks.length > 20 ? ` 他${partners.nicks.length - 20}頭` : ''}</p>}
    <h4 className="master-code-title">凝ったペア（本馬と4代以内の祖先）</h4>
    {kotta.length ? <table className="small hints-table"><tbody>{kotta.map((k) => <tr key={k.path}><th>{k.path}</th><td>{k.name}</td><td className="wrap">{k.partners.join('、')}</td></tr>)}</tbody></table>
      : <p className="small muted">本馬と4代以内の祖先はペア表に載っていません。</p>}
    <p className="small">{partners.kotta.length ? <>凝った配合になる相手 {partners.kotta.length}頭: {partners.kotta.slice(0, 20).join('、')}{partners.kotta.length > 20 ? ` 他${partners.kotta.length - 20}頭` : ''}</> : <span className="muted">凝った配合になる相手はいません。</span>}</p>
  </section>;
}

import { useState } from 'react';
import { useApp } from './app-context';
import { store, plannedProgress, realizedProgress } from '../store/userdata';
import type { PlannedHorse } from '../core/types';
import { HorseSelect } from './HorseSelect';
import { navigate } from './router';

export function PlannedHorseLinks({ foal }: { foal: PlannedHorse }) {
  const app = useApp();
  const [linking, setLinking] = useState(false);
  const actual = realizedProgress(foal, app.data.horses);
  const progress = plannedProgress(foal, app.data.horses);
  const linked = app.data.horses.filter((h) => foal.realizedIds.includes(h.id));
  const options = app.data.horses.filter((h) => !foal.realizedIds.includes(h.id)).map((h) => ({ key: h.id, name: h.name, group: h.sireKey === foal.sireKey && h.damKey === foal.damKey ? '同じ父母の所有馬' : '所有馬', sub: `${h.sex === 'F' ? '牝' : h.sex === 'M' ? '牡' : '性別未確認'}・${h.category}` })).sort((a, b) => Number(b.group === '同じ父母の所有馬') - Number(a.group === '同じ父母の所有馬'));
  return <div className="plan-horse-links">
    <h4>進捗</h4>
    <div className="plan-progress-checks">
      {([['born', '生産済み'], ['sexOk', '希望の性別'], ['bred', '繁殖入り済み']] as const).filter(([key]) => (key !== 'bred' || foal.role) && (key !== 'sexOk' || foal.desiredSex)).map(([key, title]) => <label key={key} title={actual[key] ? '紐付けた所有馬から反映' : undefined}><input type="checkbox" checked={progress[key]} disabled={actual[key]} onChange={(e) => store.updatePlannedHorse(foal.id, { achieved: { born: false, sexOk: false, bred: false, ...foal.achieved, [key]: e.target.checked } })} /><span>{title}{actual[key] && <small>所有馬から反映</small>}</span></label>)}
    </div>
    <div className="plan-actual-heading"><h4>対応する所有馬 <span>{linked.length}頭</span></h4></div>
    {linked.length > 0 ? <div className="plan-actual-list">{linked.map((h) => <div key={h.id}><div><a href={`#/horses?id=${encodeURIComponent(h.id)}`}>{h.name}</a><span className="small muted">{h.sex === 'F' ? '牝' : h.sex === 'M' ? '牡' : '性別未確認'}・{h.category}</span></div><button type="button" aria-label={`${h.name}の紐付けを解除`} onClick={() => store.linkPlannedHorse(foal.id, h.id, false)}>解除</button></div>)}</div> : <p className="plan-no-horses">まだ所有馬が紐付いていません。</p>}
    <div className="plan-link-actions"><button type="button" className="primary" onClick={() => navigate('/horses', { new: '1', planned: foal.id })}>産まれた馬を登録</button><button type="button" aria-expanded={linking} onClick={() => setLinking(!linking)}>所有馬を紐付ける</button></div>
    {linking && <div className="plan-link-picker"><HorseSelect value="" options={options} onChange={(id) => { if (id) { store.linkPlannedHorse(foal.id, id, true); setLinking(false); } }} placeholder="所有馬名で検索" aria-label={`${foal.name}に紐付ける所有馬`} clearAfterSelect />{!options.length && <p className="small muted">紐付けられる所有馬がありません。</p>}</div>}
  </div>;
}

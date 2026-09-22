import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, sireOptions, damOptions } from './app-context';
import { Icon, PageHeading } from './icons';
import { HorseSelect, type HorseSelectHandle } from './HorseSelect';
import { JudgeView, SummaryStrip } from './JudgeView';
import { Pedigree } from './Pedigree';
import { ActionDialog } from './ActionDialog';
import { judge } from '../core/judge';
import { summarize } from '../core/search';
import { savePlanFromResult } from '../store/userdata';
import { navigate } from './router';
import './MatingPage.css';

/** 他のタブへ移動して戻った時に父母と表示タブを保つための記憶（アプリ内のみ。再読み込みで消える） */
const matingMemo = { sire: '', dam: '', tab: 'pedigree' };

export function MatingPage({ params }: { params: URLSearchParams }) {
  const app = useApp();
  const [sire, setSire] = useState(params.get('sire') ?? matingMemo.sire);
  const [dam, setDam] = useState(params.get('dam') ?? matingMemo.dam);
  const [tab, setTab] = useState(matingMemo.tab);
  useEffect(() => { Object.assign(matingMemo, { sire, dam, tab }); }, [sire, dam, tab]);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState<'none' | 'broodmare' | 'stallion'>('none');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const sOpts = useMemo(() => sireOptions(app, { requirePedigree: true, includePlanned: !app.data.settings.hidePlanned }), [app]);
  const dOpts = useMemo(() => damOptions(app, { requirePedigree: true, includePlanned: !app.data.settings.hidePlanned }), [app]);
  const sireRef = useRef<HorseSelectHandle>(null);
  const sireIdx = sOpts.findIndex((o) => o.key === sire), damIdx = dOpts.findIndex((o) => o.key === dam);
  const changeSire = (key: string) => { setSire(key); setMessage(''); setError(''); };
  const changeDam = (key: string) => { setDam(key); setMessage(''); setError(''); };
  const moveSire = (by: number) => { const next = sOpts[sireIdx + by]; if (next) changeSire(next.key); };
  const moveDam = (by: number) => { const next = dOpts[damIdx + by]; if (next) changeDam(next.key); };
  useEffect(() => {
    const query = new URLSearchParams();
    if (sire) query.set('sire', sire);
    if (dam) query.set('dam', dam);
    history.replaceState(null, '', '#/mating' + (query.size ? '?' + query : ''));
  }, [sire, dam]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (saving || target?.closest('input, select, textarea, dialog, [contenteditable="true"]')) return;
      if (e.key === '[' && sireIdx > 0) { moveSire(-1); e.preventDefault(); }
      else if (e.key === ']' && sireIdx >= 0 && sireIdx < sOpts.length - 1) { moveSire(1); e.preventDefault(); }
      else if (e.key === '/') { sireRef.current?.focus(); e.preventDefault(); }
    };
    addEventListener('keydown', keydown);
    return () => removeEventListener('keydown', keydown);
  });
  const result = useMemo(() => {
    if (!sire || !dam) return null;
    try {
      const s = app.resolver.get(sire), d = app.resolver.get(dam);
      if (!s || !d) return { error: '選択した馬が見つかりません。父母を選び直してください。' };
      return { j: judge(s, d, app.ctx) };
    } catch (e) { return { error: (e as Error).message }; }
  }, [sire, dam, app]);
  const j = result?.j;
  const copy = async () => {
    try {
      const url = new URL(location.href);
      url.hash = '/mating?' + new URLSearchParams({ sire, dam });
      await navigator.clipboard.writeText(`${app.resolver.label(sire)} × ${app.resolver.label(dam)}\n${url}`);
      setMessage('配合のリンクをコピーしました'); setError('');
    } catch { setError('リンクをコピーできませんでした。アドレス欄からコピーしてください。'); }
  };
  const save = () => {
    if (!j || !name.trim()) return;
    try {
      const plan = savePlanFromResult(name.trim(), dam, {
        steps: [{ sire, dam, sireName: app.resolver.label(sire), damName: app.resolver.label(dam), cost: j.cost, foalName: name.trim() + ' 産駒', judgement: summarize(j) }],
        matings: 1, cost: j.cost, goals: [],
      }, [], undefined, app.ctx.rulesVersion, app.ctx.dataVersion, role);
      navigate('/plans', { id: plan.id });
    } catch (e) { setError((e as Error).message); }
  };
  return <div className="mating-page">
    <PageHeading icon="mating" title="配合確認" actions={<button disabled={!sire && !dam} onClick={() => { changeSire(''); changeDam(''); }}>選択をクリア</button>} />
    <section className="mating-pair" aria-label="配合する父母">
      <div className="mating-parent sire">
        <div className="mating-parent-heading"><span className="mating-parent-label">父</span><b>種牡馬</b><div className="mating-browse"><button disabled={sireIdx <= 0} aria-label="前の種牡馬" title="前の種牡馬 [" onClick={() => moveSire(-1)}>‹</button><button disabled={sireIdx < 0 || sireIdx >= sOpts.length - 1} aria-label="次の種牡馬" title="次の種牡馬 ]" onClick={() => moveSire(1)}>›</button></div></div>
        <HorseSelect ref={sireRef} value={sire} onChange={changeSire} options={sOpts} aria-label="父の種牡馬" placeholder="種牡馬を検索" plannedToggle />
        <div className="mating-parent-meta">{sireIdx >= 0 ? <><span>{sOpts[sireIdx].group}</span><span>{sOpts[sireIdx].sub}</span></> : '種牡馬を選択'}</div>
      </div>
      <span className="mating-pair-cross" aria-hidden="true">×</span>
      <div className="mating-parent dam">
        <div className="mating-parent-heading"><span className="mating-parent-label">母</span><b>繁殖牝馬</b><div className="mating-browse"><button disabled={damIdx <= 0} aria-label="前の繁殖牝馬" onClick={() => moveDam(-1)}>‹</button><button disabled={damIdx < 0 || damIdx >= dOpts.length - 1} aria-label="次の繁殖牝馬" onClick={() => moveDam(1)}>›</button></div></div>
        <HorseSelect value={dam} onChange={changeDam} options={dOpts} aria-label="母の繁殖牝馬" placeholder="繁殖牝馬を検索" plannedToggle />
        <div className="mating-parent-meta">{damIdx >= 0 ? <><span>{dOpts[damIdx].group}</span><span>{dOpts[damIdx].sub}</span></> : '繁殖牝馬を選択'}</div>
      </div>
    </section>
    <div className="mating-actions">
      <div><button disabled={!dam} onClick={() => navigate('/search', { mare: dam, mode: 'one' })}>この母の相手を探す</button><button disabled={!sire} onClick={() => navigate('/search', { stallion: sire, mode: 'one' })}>この父の相手を探す</button><button disabled={!dam} onClick={() => navigate('/search', { mare: dam, ...(sire ? { final: sire } : {}) })}>数世代の配合を探す</button></div>
      <div><button disabled={!j} onClick={() => navigate('/horses', { new: '1', sire, dam })}>産まれた馬を登録</button><button className="primary" disabled={!j} onClick={() => { setName(`${app.resolver.label(dam)}の配合計画`); setError(''); setSaving(true); }}>計画として保存</button></div>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="mating-feedback" role="status">{message}</p>}
    {result?.error && <p className="error" role="alert">{result.error}</p>}
    {j ? <>
      <div className="mating-result-heading"><h3>判定結果</h3><button className="text-toggle" onClick={() => void copy()}>リンクをコピー</button></div>
      <SummaryStrip j={j} />
      <section className="mating-inspection">
        <nav className="mating-tabs" aria-label="判定結果の表示">{[{ id: 'pedigree', label: '血統表' }, { id: 'theories', label: '配合理論' }, { id: 'crosses', label: 'クロス・因子' }].map((t) => <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}</nav>
        <div className="mating-inspection-body" key={`${sire}:${dam}:${tab}`}>
          {tab === 'pedigree' ? <Pedigree j={j} /> : <JudgeView j={j} showSummary={false} section={tab as 'theories' | 'crosses'} />}
        </div>
      </section>
    </> : !result?.error && <div className="mating-empty"><Icon name="mating" /><h3>{!sire && !dam ? '父と母を選んで配合を確認' : !sire ? '父となる種牡馬を選択' : '母となる繁殖牝馬を選択'}</h3><p>配合理論・クロス・産駒の血統をまとめて確認できます。</p></div>}
    {saving && <ActionDialog title="配合計画として保存" onClose={() => setSaving(false)}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <p className="mating-save-pair">{app.resolver.label(sire)} <span>×</span> {app.resolver.label(dam)}</p>
        <label className="field">計画名<input autoFocus required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">産駒の予定<select value={role} onChange={(e) => setRole(e.target.value as typeof role)}><option value="none">競走馬</option><option value="broodmare">繁殖牝馬</option><option value="stallion">種牡馬</option></select></label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="action-dialog-actions"><button type="button" onClick={() => setSaving(false)}>キャンセル</button><button className="primary" type="submit" disabled={!name.trim()}>保存して計画を開く</button></div>
      </form>
    </ActionDialog>}
  </div>;
}

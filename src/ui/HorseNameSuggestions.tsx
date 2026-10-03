import { useRef, useState } from 'react';
import { parseFoalName } from '../core/owned-horse';
import { namingParent, namingPedigree } from '../core/horse-names';
import type { Sex } from '../core/types';
import { HorseNameRequestSchema } from '../shared/horse-names';
import { checkWorkspace, workspaceGeneration } from '../store/workspace';
import { isNamingActive, submitHorseNameJob, useHorseNameJobs } from '../store/horse-name-jobs';
import { ActionDialog } from './ActionDialog';
import { useApp } from './app-context';
import './HorseNameSuggestions.css';

export function HorseNameSuggestions({ horseId, name, sex, color, sireKey, damKey, onSelect }: {
  horseId?: string; name: string; sex: Sex | ''; color: string; sireKey: string; damKey: string; onSelect: (name: string) => void;
}) {
  const app = useApp();
  const farm = app.data.settings.farm;
  const affix = farm?.separateBySex ? sex === 'M' ? farm.maleAffix : sex === 'F' ? farm.femaleAffix : undefined : farm?.commonAffix;
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const { items, loaded, error: loadError } = useHorseNameJobs();
  const targetKey = horseId ?? `draft:${JSON.stringify([name, sex, sireKey, damKey, color])}`;
  const jobs = items.filter(j => j.targetKey === targetKey);
  const latest = jobs.at(-1);
  const busy = sending || jobs.some(isNamingActive);
  const completed = jobs.findLast(j => j.status === 'done');
  const used = new Set([...app.data.horses, ...app.master.stallions, ...app.master.broodmares].map(h => h.name));
  const candidates = completed?.result?.candidates.filter(c => !used.has(c.name)) ?? [];
  const previous = [...new Set(jobs.flatMap(j => j.result?.candidates.map(c => c.name) ?? []))].slice(-30);
  const shownAffix = completed?.affix ?? latest?.affix ?? affix;
  const candidateGeneration = useRef(workspaceGeneration());
  const show = () => { candidateGeneration.current = workspaceGeneration(); setOpen(true); };
  const close = () => setOpen(false);
  const generate = async () => {
    if (busy || !loaded) return;
    show(); setError('');
    if (farm?.separateBySex && !sex) { setError('牡牝別の冠名を使うには、馬の性別を設定してください。'); return; }
    const inferredDamName = parseFoalName(name.normalize('NFKC'))?.damName;
    const request = HorseNameRequestSchema.safeParse({
      sire: namingParent(sireKey, app.resolver, app.master, 'M'),
      dam: namingParent(damKey, app.resolver, app.master, 'F', inferredDamName),
      pedigree: namingPedigree(sireKey, damKey, app.resolver, app.master, inferredDamName),
      sex: sex || null, color, farm: farm?.name ?? '', affix: affix ?? { text: '', position: 'prefix' }, previous,
    });
    if (!request.success) { setError('父母の記録や牧場設定の形式・文字数を確認してください（冠名はカタカナ8文字以内）。'); return; }
    setSending(true);
    try { await submitHorseNameJob(targetKey, request.data); }
    catch (e) { setError((e as Error).message); }
    finally { setSending(false); }
  };
  return <>
    <button type="button" className="sheet-name-suggest" disabled={!loaded} onClick={() => latest || busy || loadError ? show() : void generate()}>{busy ? '命名候補を生成中…' : latest?.status === 'failed' ? '命名のエラーを確認' : candidates.length ? '命名候補を確認' : '命名候補を生成'}</button>
    {open && <ActionDialog title="命名候補" onClose={close} className="horse-name-dialog">
      {shownAffix?.text && <p className="small muted">冠名：{shownAffix.text}（{shownAffix.position === 'prefix' ? '前' : '後ろ'}）・冠名なしの候補も提案</p>}
      {busy && <p role="status">{latest?.status === 'queued' ? '生成待ちです。' : 'AIが名前を考えています…'}この画面を閉じても生成は続きます。あとでこの馬の命名ボタンから確認できます。</p>}
      {(error || loadError || latest?.error) && <p className="error" role="alert">{error || loadError || latest?.error}</p>}
      {!busy && completed && !candidates.length && <p className="small muted">候補が登録済みの馬名と重複しています。別の候補を生成してください。</p>}
      <ul className="horse-name-candidates">{candidates.map(candidate => <li key={candidate.name}>
        <div><b>{candidate.name}</b><p>{candidate.meaning}</p></div>
        <button type="button" disabled={busy} onClick={() => {
          try { checkWorkspace(candidateGeneration.current); onSelect(candidate.name); close(); }
          catch (e) { setError((e as Error).message); }
        }}>この名前にする</button>
      </li>)}</ul>
      <div className="horse-name-actions"><button type="button" onClick={close}>閉じる</button><button type="button" disabled={busy || !loaded} onClick={() => void generate()}>{candidates.length ? '別の候補を生成' : '再試行'}</button></div>
    </ActionDialog>}
  </>;
}

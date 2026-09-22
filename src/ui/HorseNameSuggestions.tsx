import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { parseFoalName } from '../core/owned-horse';
import { namingParent, namingPedigree } from '../core/horse-names';
import type { Sex } from '../core/types';
import { HorseNameIdeasSchema, HorseNameRequestSchema, type HorseNameIdeas } from '../shared/horse-names';
import { checkWorkspace, workspaceGeneration } from '../store/workspace';
import { ActionDialog } from './ActionDialog';
import { useApp } from './app-context';
import './HorseNameSuggestions.css';

export function HorseNameSuggestions({ name, sex, color, sireKey, damKey, onSelect }: {
  name: string; sex: Sex | ''; color: string; sireKey: string; damKey: string; onSelect: (name: string) => void;
}) {
  const app = useApp();
  const farm = app.data.settings.farm;
  const affix = farm?.separateBySex ? sex === 'M' ? farm.maleAffix : sex === 'F' ? farm.femaleAffix : undefined : farm?.commonAffix;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState<HorseNameIdeas['candidates']>([]);
  const previous = useRef<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  const candidateGeneration = useRef(workspaceGeneration());
  useEffect(() => () => controller.current?.abort(), []);
  const close = () => { controller.current?.abort(); setBusy(false); setOpen(false); };
  const generate = async () => {
    setOpen(true); setError('');
    if (farm?.separateBySex && !sex) { setError('牡牝別の冠名を使うには、馬の性別を設定してください。'); return; }
    const inferredDamName = parseFoalName(name.normalize('NFKC'))?.damName;
    const request = HorseNameRequestSchema.safeParse({
      sire: namingParent(sireKey, app.resolver, app.master, 'M'),
      dam: namingParent(damKey, app.resolver, app.master, 'F', inferredDamName),
      pedigree: namingPedigree(sireKey, damKey, app.resolver, app.master, inferredDamName),
      sex: sex || null, color, farm: farm?.name ?? '', affix: affix ?? { text: '', position: 'prefix' }, previous: previous.current,
    });
    if (!request.success) { setError('父母の記録や牧場設定の形式・文字数を確認してください（冠名はカタカナ8文字以内）。'); return; }
    setBusy(true);
    const abort = new AbortController(); controller.current = abort;
    const generation = workspaceGeneration();
    try {
      const result = HorseNameIdeasSchema.parse(await api('/api/horse-names', { method: 'POST', body: JSON.stringify(request.data), signal: abort.signal }));
      if (abort.signal.aborted) return;
      checkWorkspace(generation);
      candidateGeneration.current = generation;
      const used = new Set([...app.data.horses, ...app.master.stallions, ...app.master.broodmares].map(h => h.name));
      const available = result.candidates.filter(c => !used.has(c.name));
      previous.current = [...previous.current, ...result.candidates.map(c => c.name)].slice(-30);
      if (!available.length) { setError('候補が登録済みの馬名と重複しました。もう一度生成してください。'); return; }
      setCandidates(available);
    } catch (e) { if (!abort.signal.aborted) setError((e as Error).message); }
    finally { if (controller.current === abort) setBusy(false); }
  };
  return <>
    <button type="button" className="sheet-name-suggest" onClick={() => candidates.length ? setOpen(true) : void generate()}>命名候補を生成</button>
    {open && <ActionDialog title="命名候補" onClose={close} className="horse-name-dialog">
      {affix?.text && <p className="small muted">冠名：{affix.text}（{affix.position === 'prefix' ? '前' : '後ろ'}）・冠名なしの候補も提案</p>}
      {busy && <p role="status">AIが名前を考えています…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="horse-name-candidates">{candidates.map(candidate => <li key={candidate.name}>
        <div><b>{candidate.name}</b><p>{candidate.meaning}</p></div>
        <button type="button" disabled={busy} onClick={() => {
          try { checkWorkspace(candidateGeneration.current); onSelect(candidate.name); close(); }
          catch (e) { setError((e as Error).message); }
        }}>この名前にする</button>
      </li>)}</ul>
      <div className="horse-name-actions"><button type="button" onClick={close}>{busy ? '中止' : '閉じる'}</button><button type="button" disabled={busy} onClick={() => void generate()}>{candidates.length ? '別の候補を生成' : '再試行'}</button></div>
    </ActionDialog>}
  </>;
}

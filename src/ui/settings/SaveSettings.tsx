import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api';
import { SAVE_SLOT_COUNT, type SaveSlot } from '../../shared/save-data';
import { loadSnapshot, saveSnapshot } from '../../store/userdata';
import { useApp } from '../app-context';

const date = (value: string) => new Date(value).toLocaleString('ja-JP');

export function SaveSettings() {
  const { data } = useApp();
  const [saves, setSaves] = useState<SaveSlot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<{ slot: number; save?: SaveSlot } | null>(null);
  const [confirming, setConfirming] = useState<{ action: 'load' | 'delete'; save: SaveSlot } | null>(null);
  const [name, setName] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api<{ slots: SaveSlot[] }>('/api/saves', { signal: controller.signal }).then((res) => { setSaves(res.slots); setLoaded(true); }).catch((e) => { if (!controller.signal.aborted) setError((e as Error).message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if ((editing || confirming) && !dialog.current?.open) dialog.current?.showModal();
    if (!editing && !confirming && dialog.current?.open) dialog.current?.close();
  }, [editing, confirming]);
  const refresh = async () => { const res = await api<{ slots: SaveSlot[] }>('/api/saves'); setSaves(res.slots); setLoaded(true); };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setEditing(null); setConfirming(null);
        try { await refresh(); } catch { /* 操作時のエラーを表示する */ }
      }
      setError((e as Error).message);
    } finally { setBusy(false); }
  };
  const openSave = (slot: number, save?: SaveSlot) => {
    setError(''); setMessage('');
    setName(save?.name ?? `${data.settings.gameYear === undefined ? '' : `${data.settings.gameYear}年 `}セーブ${slot}`);
    setEditing({ slot, save });
  };
  return <>
    <div className="settings-save-intro">
      <p className="settings-note">所有馬・計画・設定・マスターデータの編集をサーバに保存します。ロードした状態は他の端末にも反映されます。</p>
      <button disabled={busy} onClick={() => void run(refresh)}>一覧を更新</button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="settings-save-message" role="status">{message}</p>}
    {!loaded && !error && <p className="settings-note" role="status">セーブデータを取得中…</p>}
    <ol className="settings-save-list" aria-label="セーブデータ" aria-busy={busy}>
      {Array.from({ length: SAVE_SLOT_COUNT }, (_, i) => {
        const slot = i + 1, save = saves.find((s) => s.slot === slot);
        return <li key={slot} className={save ? '' : 'empty-save'}>
          <span className="settings-save-number">{String(slot).padStart(2, '0')}</span>
          <div className="settings-save-info">
            <b title={save?.name}>{save?.name ?? '空きスロット'}</b>
            {save && <>
              <time dateTime={save.savedAt}>{date(save.savedAt)}</time>
              <div className="settings-save-stats">
                <span>{save.gameYear === null ? '年未設定' : `${save.gameYear}年`}</span><span>所有馬 {save.horses}頭</span><span>計画馬 {save.plannedHorses}頭</span><span>計画 {save.plans}件</span>
              </div>
            </>}
          </div>
          <div className="settings-save-actions">
            <button disabled={!loaded || busy} onClick={() => openSave(slot, save)}>セーブ</button>
            <button className="primary" disabled={!save || busy} onClick={() => { if (save) { setError(''); setConfirming({ action: 'load', save }); } }}>ロード</button>
            {save && <button className="settings-save-delete" aria-label={`セーブ${slot}を削除`} disabled={busy} onClick={() => { setError(''); setConfirming({ action: 'delete', save }); }}>削除</button>}
          </div>
        </li>;
      })}
    </ol>
    <dialog ref={dialog} className="settings-save-dialog" aria-labelledby="save-dialog-title" onCancel={(e) => { if (busy) e.preventDefault(); else { setEditing(null); setConfirming(null); } }} onClose={() => { if (!dialog.current?.open) { setEditing(null); setConfirming(null); } }}>
      {editing && <form onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || busy) return;
        void run(async () => {
          const save = await saveSnapshot(editing.slot, name.trim(), editing.save?.revision ?? null);
          setSaves((prev) => [...prev.filter((s) => s.slot !== save.slot), save]);
          setEditing(null); setMessage(`「${save.name}」にセーブしました。`);
        });
      }}>
        <h3 id="save-dialog-title">セーブ{editing.slot}{editing.save ? 'を上書き' : 'に保存'}</h3>
        {editing.save && <p className="settings-note">{date(editing.save.savedAt)}の「{editing.save.name}」を現在の状態で上書きします。</p>}
        <label className="field">セーブ名<input value={name} autoFocus required maxLength={80} disabled={busy} onChange={(e) => setName(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="settings-save-dialog-actions"><button type="button" disabled={busy} onClick={() => setEditing(null)}>キャンセル</button><button type="submit" className="primary" disabled={!name.trim() || busy}>{busy ? 'セーブ中…' : editing.save ? '上書きする' : 'セーブする'}</button></div>
      </form>}
      {confirming && <div>
        <h3 id="save-dialog-title">セーブデータを{confirming.action === 'load' ? 'ロード' : '削除'}</h3>
        <p><b>{confirming.save.name}</b><br /><span className="small muted">{date(confirming.save.savedAt)}{confirming.save.gameYear !== null && `・${confirming.save.gameYear}年`}</span></p>
        <p className="settings-note">{confirming.action === 'load'
          ? '現在の所有馬・計画・設定・マスターデータの編集を置き換えます。セーブしていない変更は失われ、取り込み待ちの写真も破棄されます。'
          : 'このセーブデータを削除します。現在の状態は変わりません。'}</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="settings-save-dialog-actions">
          <button disabled={busy} onClick={() => setConfirming(null)}>キャンセル</button>
          <button className={confirming.action === 'load' ? 'primary' : 'danger'} disabled={busy} onClick={() => void run(async () => {
            const { action, save } = confirming;
            if (action === 'load') await loadSnapshot(save);
            else {
              await api(`/api/saves/${save.slot}`, { method: 'DELETE', body: JSON.stringify({ revision: save.revision }) });
              setSaves((prev) => prev.filter((s) => s.slot !== save.slot)); setMessage('セーブデータを削除しました。');
            }
            setConfirming(null);
          })}>{busy ? '処理中…' : confirming.action === 'load' ? 'ロードする' : '削除する'}</button>
        </div>
      </div>}
    </dialog>
  </>;
}

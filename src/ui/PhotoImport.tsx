import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { submitJob, useImportJobs, type CaptureTarget } from '../store/jobs';
import { imageToBase64, type EncodedImage, type ScreenType } from '../api';
import { damOptions, useApp } from './app-context';
import './PhotoImport.css';
import { Tip } from './Tip';

const coarse = typeof matchMedia !== 'undefined' ? matchMedia('(pointer: coarse)') : null;
const useTouch = () => useSyncExternalStore((cb) => { coarse?.addEventListener('change', cb); return () => coarse?.removeEventListener('change', cb); }, () => !!coarse?.matches);
interface Pending { id: string; file: File; image: EncodedImage | null; rotation: number; preparing: boolean; sending: boolean; error: string }

/** 送信元ごとの説明。scope（判別の候補）に含まれる種類の分だけ並べる */
const SCOPE_HINTS: Record<ScreenType, string> = {
  育成馬: 'カードは判明した項目だけを所有馬に重ね、写っている馬の画像も切り出します。',
  入厩馬: 'カードは判明した項目だけを所有馬に重ね、写っている馬の画像も切り出します。',
  血統: '血統・クロスの画面は父母の名前から反映先の候補を出します。',
  種牡馬: '種牡馬データを登録・更新します。',
  繁殖牝馬: '繁殖牝馬データを登録・更新します。',
  種付け: '種牡馬一覧から種付料・能力を更新できます。繁殖牝馬を選ぶとニックスも記録できます。',
};
const scopeHint = (scope: ScreenType[]) => {
  const hints = [...new Set(scope.map((t) => SCOPE_HINTS[t]))];
  return `送れる画面: ${scope.join('・')}。${scope.length > 1 ? '種類は自動で判別します。' : ''}${hints.join('')}`;
};

/**
 * 写真からの取り込み（撮影と送信）。撮影（または選択）→ 写りを確認して送信 → サーバのジョブが解析。
 * 送信後は待たずに次の写真を撮れる。結果の確認と反映はヘッダーの取り込みトレイ（ImportTray）で行う。
 * scope は判別の候補にする画面の種類。送信元の画面で決まり、ヘッダーから送ると全種類になる。
 */
export function PhotoImport({ onClose, scope, target = null }: { onClose: () => void; scope: ScreenType[]; target?: CaptureTarget | null }) {
  const app = useApp();
  const touch = useTouch();
  const [pending, setPending] = useState<Pending[]>([]);
  // ニックスを記録する場合の母を、読み取り結果に引き継ぐ
  const [mareKey, setMareKey] = useState('');
  const mares = useMemo(() => (scope.includes('種付け') && !target ? damOptions(app, { includePlanned: false }) : []), [app, scope, target]);
  const [dragging, setDragging] = useState(false);
  const busy = useRef(new Set<string>());
  const nextId = useRef(0);
  const { jobs } = useImportJobs();
  const update = (id: string, patch: Partial<Pending>) => setPending(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  const prepare = async (p: Pending, rotation: number) => {
    if (busy.current.has(p.id)) return;
    busy.current.add(p.id);
    update(p.id, { preparing: true, error: '' });
    try {
      const image = await imageToBase64(p.file, 1600, undefined, 0, false, rotation);
      update(p.id, { image, rotation, preparing: false });
    } catch { update(p.id, { preparing: false, error: '画像を開けませんでした。もう一度読み込むか、別の写真を選んでください。' }); }
    finally { busy.current.delete(p.id); }
  };

  const add = (files: FileList | File[] | null | undefined) => {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith('image/'));
    const added: Pending[] = list.map(file => ({ id: String(++nextId.current), file, image: null, rotation: 0, preparing: true, sending: false, error: '' }));
    setPending(prev => [...prev, ...added]);
    added.forEach(p => void prepare(p, 0));
  };
  const remove = (p: Pending) => setPending(prev => prev.filter(x => x.id !== p.id));
  const send = async (p: Pending) => {
    if (!p.image || busy.current.has(p.id)) return;
    busy.current.add(p.id);
    update(p.id, { sending: true, error: '' });
    try { await submitJob(p.image, scope, target?.id ?? (mareKey || undefined)); remove(p); }
    catch (e) { update(p.id, { sending: false, error: (e as Error).message }); }
    finally { busy.current.delete(p.id); }
  };
  const sendable = pending.filter(p => p.image && !p.preparing && !p.sending);
  const sendAll = () => sendable.forEach(p => void send(p));
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
  const waiting = jobs.filter((j) => j.status === 'done' || j.status === 'failed').length;

  return <div className="panel photo-import">
    <div className="photo-import-heading">
      <div className="tip-heading"><h3>{target ? `${target.name} の写真を送る` : '写真から取り込み'}</h3><Tip label="送れる画面">{target ? '血統・クロスの画面を送ると、この馬の父母として登録します。' : scopeHint(scope)}</Tip></div>
      <button type="button" className="photo-import-close" onClick={onClose}>閉じる</button>
    </div>
    {mares.length > 0 && <label className="field photo-import-mare">ニックスの反映先となる繁殖牝馬（任意）<select value={mareKey} onChange={(e) => setMareKey(e.target.value)}><option value="">選択…</option>{['所有馬', '繁殖牝馬'].map((g) => { const list = mares.filter((m) => m.group === g); return list.length ? <optgroup key={g} label={g}>{list.map((m) => <option key={m.key} value={m.key}>{m.name}{m.sub ? `（${m.sub}）` : ''}</option>)}</optgroup> : null; })}</select></label>}

    <div className={'photo-capture' + (dragging ? ' active' : '')}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); }}>
      {touch && <label className="photo-capture-camera"><input type="file" accept="image/*" capture="environment" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />カメラで撮影</label>}
      <label className="photo-capture-pick"><input type="file" accept="image/*" multiple onChange={(e) => { add(e.target.files); e.target.value = ''; }} />{touch ? '写真を選ぶ' : '画像を選ぶ（複数可）またはここにドロップ'}</label>
    </div>

    {pending.length > 0 && <div className="photo-pending">
      <div className="photo-pending-heading"><b>送信前の写真 {pending.length}枚</b><span className="small muted">向きと写りを確かめてから送信してください</span>{pending.length > 1 && <button type="button" className="primary" disabled={!sendable.length || pending.some(p => p.preparing)} onClick={sendAll}>すべて送信</button>}</div>
      <div className="photo-pending-list">{pending.map((p, i) => <figure key={p.id} className="photo-pending-item" aria-label={`送信前の写真 ${i + 1}`}>
        {p.image ? <img src={`data:${p.image.mediaType};base64,${p.image.image}`} alt={`送信前の写真 ${i + 1}`} /> : <div className="photo-preview-empty">{p.preparing ? '画像を準備中…' : 'プレビューなし'}</div>}
        <figcaption>
          <div className="photo-rotate-actions">
            <button type="button" disabled={p.preparing || p.sending || !p.image} onClick={() => void prepare(p, (p.rotation + 3) % 4)} aria-label={`写真 ${i + 1}を左に90度回転`}>↶ 左に90°</button>
            <button type="button" disabled={p.preparing || p.sending || !p.image} onClick={() => void prepare(p, (p.rotation + 1) % 4)} aria-label={`写真 ${i + 1}を右に90度回転`}>↷ 右に90°</button>
            {p.preparing && p.image && <span className="small muted" role="status">回転中…</span>}
          </div>
          {!p.image && !p.preparing && <button type="button" onClick={() => void prepare(p, p.rotation)}>再読み込み</button>}
          <button type="button" className="primary" disabled={p.sending || p.preparing || !p.image} onClick={() => void send(p)}>{p.sending ? '送信中…' : '送信'}</button>
          <button type="button" disabled={p.sending || p.preparing} onClick={() => remove(p)}>{touch && p.file.name.startsWith('image') ? '撮り直す' : '外す'}</button>
          {p.error && <span className="error">{p.error}</span>}
        </figcaption>
      </figure>)}</div>
    </div>}

    <p className="small muted photo-import-status">{active ? `${active}枚を解析中。` : ''}{waiting ? `${waiting}件が確認待ち。` : ''}{jobs.length ? '結果は画面右上の「取り込み」から、どの画面にいても確認できます。' : '送信した写真は画面右上の「取り込み」に並び、解析が終わるとそこから登録・更新できます。'}</p>
  </div>;
}

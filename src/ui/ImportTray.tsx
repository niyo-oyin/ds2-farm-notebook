import { useEffect, useRef, useState } from 'react';
import type { ImportJob } from '../api';
import { ALL_SCREEN_TYPES, imageUrl } from '../api';
import { closeCapture, dismissJob, requestCapture, retryFailedJob, reviewJob, useCaptureRequest, useImportJobs, useReviewJob } from '../store/jobs';
import { useApp } from './app-context';
import { addMasterJob, applyCardJob, applyMasterJob, applyPedigreeJob, autoDecision, saveNewAncestorFactors, type AppliedInfo } from './import-apply';
import { ImportJobCard } from './ImportJobCard';
import { PhotoImport } from './PhotoImport';
import { CameraCapture } from './CameraCapture';
import { cameraLaunchPending, endCameraLaunch, inAppCameraAvailable, useTouch } from './use-touch';
import './Tray.css';
import './ImportTray.css';

const STATUS: Record<ImportJob['status'], string> = { queued: '待機中', running: '解析中', done: '確認待ち', failed: '失敗' };
const time = (iso: string) => new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
const jobTitle = (job: ImportJob) => {
  const r = job.result;
  if (job.status !== 'done' || !r) return '写真';
  if (r.screen_type === '血統') return `血統: ${r.pedigree.sire || '?'} × ${r.pedigree.dam || '?'}`;
  if (r.screen_type === 'その他') return '判別できない画面';
  if ('master' in r) return `${r.screen_type}: ${r.master.name || '（馬名なし）'}`;
  if ('breeding' in r) return `種牡馬一覧（${r.breeding.cards.length}頭）`;
  return r.card.name || '（馬名なし）';
};

/**
 * 写真の解析状況を表示する取り込みトレイ。
 * 完了したジョブはダイアログで反映先を選び、登録・更新する。
 */
const typing = () => { const el = document.activeElement; return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'); };

export function ImportTray() {
  const app = useApp();
  const { jobs, error } = useImportJobs();
  const { importAutoOpen, importAutoApply, importAutoMasterUpdate, importAutoMasterAdd } = app.data.settings;
  const anyAuto = !!(importAutoApply || importAutoMasterUpdate || importAutoMasterAdd);
  const [open, setOpen] = useState(false);
  const openJobId = useReviewJob();
  const [imported, setImported] = useState<AppliedInfo | null>(null);
  const capture = useCaptureRequest();
  const touch = useTouch();
  // 右下のカメラボタンから開いたアプリ内カメラ。判別の候補は全種類。ホーム画面のアイコンから開いた時は最初から開く
  const [camera, setCamera] = useState(cameraLaunchPending);
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const captureDialog = useRef<HTMLDialogElement>(null);
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
  const waiting = jobs.filter((j) => j.status === 'done').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;
  const openJob = jobs.find((j) => j.id === openJobId) ?? null;
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (openJob && !d.open) d.showModal();
    if (!openJob && d.open) d.close();
  }, [openJob]);
  // 設定による自動処理。完了したジョブごとに一度だけ判断し、自動反映できなければ確認を自動で開く（入力中や別のダイアログ表示中は次の更新に回す）
  const handled = useRef(new Set<string>());
  const applying = useRef(new Set<string>());
  // 設定が変わったら（同期で後から届いた場合も含む）完了済みのジョブを判断し直す
  useEffect(() => { handled.current.clear(); }, [importAutoOpen, anyAuto, importAutoApply, importAutoMasterUpdate, importAutoMasterAdd]);
  useEffect(() => {
    for (const job of jobs) {
      if (job.status !== 'done' || handled.current.has(job.id) || applying.current.has(job.id)) continue;
      if (anyAuto) {
        const decision = autoDecision(app, job);
        if (decision) {
          applying.current.add(job.id);
          const run: Promise<AppliedInfo> = decision.kind === 'card' ? applyCardJob(job, decision.reading, decision.target, true).then((h) => ({ name: h.name, href: `#/horses?id=${encodeURIComponent(h.id)}` }))
            : decision.kind === 'pedigree' ? Promise.resolve(applyPedigreeJob(decision.target, decision.sireKey, decision.damKey)).then((h) => { saveNewAncestorFactors(app, decision.reading); return { name: h.name, href: `#/horses?id=${encodeURIComponent(h.id)}` }; })
              : Promise.resolve(decision.existing ? applyMasterJob(decision.existing, decision.next, decision.additions) : addMasterJob(decision.next, decision.additions));
          void run.then((info) => { setImported(info); void dismissJob(job.id); }).catch(() => { handled.current.add(job.id); }).finally(() => applying.current.delete(job.id));
          continue;
        }
      }
      if (importAutoOpen) {
        // 撮影中（ダイアログ・アプリ内カメラ）や入力中は開かず、終わってから開く
        if (openJobId || capture.open || camera || typing()) return;
        handled.current.add(job.id);
        setOpen(false); reviewJob(job.id);
        return;
      }
      handled.current.add(job.id);
    }
  }, [jobs, anyAuto, importAutoOpen, openJobId, capture.open, camera, app]);
  // ダイアログの中で処理し終えたら、閉じずに次の完了済みジョブへ差し替える（閉じてから開くと close イベントの遅延で次が閉じられる）
  const advance = (fromId: string) => {
    const next = importAutoOpen ? jobs.find((j) => j.status === 'done' && j.id !== fromId && !handled.current.has(j.id) && !applying.current.has(j.id)) : undefined;
    if (next) { handled.current.add(next.id); reviewJob(next.id); } else reviewJob(null);
  };
  useEffect(() => {
    const d = captureDialog.current;
    if (!d) return;
    if (capture.open && !d.open) d.showModal();
    if (!capture.open && d.open) d.close();
  }, [capture.open]);
  return <div className="tray" ref={root}>
    <button type="button" className={'tray-button' + (waiting ? ' waiting' : '')} aria-expanded={open} aria-label={`取り込み: 解析中${active}件、確認待ち${waiting}件${failed ? `、失敗${failed}件` : ''}`} title="写真の取り込み" onClick={() => setOpen(!open)}>
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3 4.5h14v9H12l-1 2H9l-1-2H3z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M3 10.5h4.5l1 2h3l1-2H17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
      <span className="tray-label">取り込み</span>
      {jobs.length > 0 && <span className={'tray-badge' + (active ? ' active' : '')}>{jobs.length}</span>}
    </button>
    {open && <div className="tray-panel" role="dialog" aria-label="写真の取り込み">
      <div className="tray-heading"><b>写真の取り込み</b><span className="small muted">{active ? `解析中 ${active}` : ''}{active && waiting ? ' · ' : ''}{waiting ? `確認待ち ${waiting}` : ''}{!active && !waiting && !failed ? '送った写真はここに並びます' : ''}</span></div>
      {error && <div className="error small">{error}</div>}
      <ul className="tray-list import-tray-list">{[...jobs].reverse().map((job) => <li key={job.id} className={`status-${job.status}`}>
        <img src={imageUrl(job.imageId)} alt="" loading="lazy" />
        <span className="tray-body">
          <b>{jobTitle(job)}</b>
          <span className="small muted">{STATUS[job.status]} · {time(job.createdAt)}{job.error ? ` · ${job.error}` : ''}</span>
        </span>
        <span className="tray-actions">
          {job.status === 'done' && <button type="button" className="primary" onClick={() => { setOpen(false); reviewJob(job.id); }}>確認</button>}
          {job.status === 'failed' && <button type="button" onClick={() => void retryFailedJob(job.id)}>再試行</button>}
          <button type="button" aria-label="このジョブを破棄" onClick={() => void dismissJob(job.id)}>破棄</button>
        </span>
      </li>)}</ul>
      {imported && <div className="tray-done small">{imported.name} に反映しました <a href={imported.href} onClick={() => { setOpen(false); setImported(null); }}>開く</a></div>}
      <div className="tray-foot"><button type="button" className="primary" onClick={() => { setOpen(false); requestCapture(ALL_SCREEN_TYPES); }}>写真を送る</button></div>
    </div>}
    {touch && !camera && <button type="button" className="camera-fab" aria-label="カメラで撮影して取り込む" onClick={() => (inAppCameraAvailable() ? setCamera(true) : requestCapture(ALL_SCREEN_TYPES))}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
    </button>}
    {camera && <CameraCapture scope={ALL_SCREEN_TYPES} onClose={() => { endCameraLaunch(); setCamera(false); }} />}
    <dialog ref={captureDialog} className="import-dialog" onClose={() => { if (!captureDialog.current?.open) closeCapture(); }} onClick={(e) => { if (e.target === captureDialog.current) closeCapture(); }}>
      {capture.open && <div className="import-dialog-body"><PhotoImport scope={capture.scope} onClose={closeCapture} target={capture.target} /></div>}
    </dialog>
    {/* close イベントは非同期に届くため、次のジョブを続けて開いた直後に届いた古い close で閉じないよう、実際に閉じている時だけ状態を戻す */}
    <dialog ref={dialog} className="import-dialog" onClose={() => { if (!dialog.current?.open) reviewJob(null); }} onClick={(e) => { if (e.target === dialog.current) reviewJob(null); }}>
      {openJob && <div className="import-dialog-body">
        <div className="import-dialog-heading"><b>読み取り結果の確認</b><button type="button" onClick={() => advance(openJob.id)}>閉じる</button></div>
        <ImportJobCard key={openJob.id} job={openJob} onDismiss={() => { void dismissJob(openJob.id); advance(openJob.id); }} onRetry={() => void retryFailedJob(openJob.id)} onApplied={(info) => { setImported(info); void dismissJob(openJob.id); advance(openJob.id); }} />
      </div>}
    </dialog>
  </div>;
}

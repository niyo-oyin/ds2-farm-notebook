import { useEffect, useRef, useState } from 'react';
import { isSearchJobActive, type SearchJob } from '../api';
import { dismissSearchJob, stopSearchJob, useSearchJobs } from '../store/search-jobs';
import { useApp } from './app-context';
import { goalLabel } from '../core/search';
import './Tray.css';

const STATUS: Record<SearchJob['status'], string> = { queued: '待機中', running: '探索中', done: '完了', failed: '失敗', cancelled: '中止' };
const time = (iso: string) => new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

/**
 * バックグラウンドの数世代探索・ループ探索の状況を表示するトレイ。
 * 探索中も、見つかった結果を探索画面で開ける。
 */
export function SearchTray() {
  const app = useApp();
  const { jobs, error } = useSearchJobs();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const active = jobs.filter(isSearchJobActive).length;
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const title = (job: SearchJob) => job.kind === 'lineage'
    ? `数世代探索: ${app.resolver.label(job.request.startMare)}${job.request.finalStallion ? ` → ${app.resolver.label(job.request.finalStallion)}` : ''}`
    : `ループ探索: 周期 ${job.request.minLength}〜${job.request.maxLength}`;
  const detail = (job: SearchJob) => {
    const goals = job.request.goals.map(goalLabel).join('・') || '条件なし';
    const range = job.kind === 'lineage' ? `配合 ${job.request.minMatings}〜${job.request.maxMatings} 回` : `種牡馬 ${job.request.stallionPool.length} 頭`;
    return `${range} · ${goals}`;
  };
  const state = (job: SearchJob) => {
    const p = job.progress;
    if (job.status === 'failed') return `失敗 · ${job.error ?? ''}`;
    if (job.status === 'queued') return `待機中 · ${time(job.createdAt)}`;
    if (job.status === 'running') return `探索中 · 判定 ${p.evaluated.toLocaleString()} 回 · 発見 ${p.found} 件`;
    // 完了でも上限で止まったものは、判定回数上限を添える
    const outcome = job.status === 'done' && job.outcome && job.outcome.status !== '完了' ? `（${job.outcome.status}）` : '';
    return `${STATUS[job.status]}${outcome} · ${p.found} 件 · ${(p.elapsedMs / 1000).toFixed(1)} 秒`;
  };
  const canOpen = (job: SearchJob) => job.status !== 'failed' && job.status !== 'queued';
  const openJob = (job: SearchJob) => { setOpen(false); window.location.assign(`#/search?job=${encodeURIComponent(job.id)}`); };
  return <div className="tray" ref={root}>
    <button type="button" className="tray-button" aria-expanded={open} aria-label={`探索: 実行中${active}件、全${jobs.length}件`} title="バックグラウンドの探索" onClick={() => setOpen(!open)}>
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M10 6v4l3 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span className="tray-label">探索</span>
      {jobs.length > 0 && <span className={'tray-badge' + (active ? ' active' : '')}>{jobs.length}</span>}
    </button>
    {open && <div className="tray-panel" role="dialog" aria-label="バックグラウンドの探索">
      <div className="tray-heading"><b>バックグラウンドの探索</b><span className="small muted">{active ? `実行中 ${active}（同時に2件まで）` : jobs.length ? '' : '探索画面の「バックグラウンドで探索」で始めた探索がここに並びます'}</span></div>
      {error && <div className="error small">{error}</div>}
      <ul className="tray-list">{[...jobs].reverse().map((job) => <li key={job.id} className={`status-${job.status}`}>
        <span className="tray-body">
          <b>{title(job)}</b>
          <span className="small muted">{detail(job)}</span>
          <span className="small muted">{state(job)}</span>
        </span>
        <span className="tray-actions">
          {canOpen(job) && <button type="button" className={job.status === 'done' ? 'primary' : ''} onClick={() => openJob(job)}>{job.status === 'running' ? '途中経過' : '開く'}</button>}
          {isSearchJobActive(job) && <button type="button" onClick={() => void stopSearchJob(job.id)}>中止</button>}
          <button type="button" aria-label="この探索を破棄" onClick={() => void dismissSearchJob(job.id)}>破棄</button>
        </span>
      </li>)}</ul>
    </div>}
  </div>;
}

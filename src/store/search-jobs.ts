// 探索ジョブ（サーバでバックグラウンド実行する数世代探索・ループ探索）の状態。
// 一覧はヘッダーのトレイが購読して定期取得し、開いている1件は探索画面が結果ごと取得する
import { useEffect, useState } from 'react';
import { cancelSearchJob, createSearchJob, deleteSearchJob, getSearchJob, isSearchJobActive, listSearchJobs, type SearchJob } from '../api';
import type { LoopReport, LoopRequest } from '../core/loop-search';
import type { SearchReport, SearchRequest } from '../core/search';
import { syncNow } from './userdata';
import { checkWorkspace, workspaceGeneration } from './workspace';
import { pollingStore } from './polling';

const poll = pollingStore<SearchJob>(listSearchJobs, isSearchJobActive);
export const refreshSearchJobs = poll.refresh;
/** サーバは同期済みのレコードから判定の材料を作るので、送る前に未送信分を同期する */
export async function submitSearchJob(kind: 'lineage', request: SearchRequest): Promise<SearchJob>;
export async function submitSearchJob(kind: 'loop', request: LoopRequest): Promise<SearchJob>;
export async function submitSearchJob(kind: 'lineage' | 'loop', request: SearchRequest | LoopRequest): Promise<SearchJob> {
  const generation = workspaceGeneration();
  await syncNow();
  const job = await createSearchJob(kind, request);
  checkWorkspace(generation);
  poll.update((jobs) => [...jobs.filter((j) => j.id !== job.id), job]);
  return job;
}
export async function stopSearchJob(id: string) {
  const job = await cancelSearchJob(id);
  poll.update((jobs) => jobs.map((j) => (j.id === id ? job : j)));
}
export async function dismissSearchJob(id: string) {
  poll.update((jobs) => jobs.filter((j) => j.id !== id));
  await deleteSearchJob(id);
}
export const resetSearchJobs = () => poll.reset();
export function useSearchJobs(): { jobs: SearchJob[]; error: string } {
  const { items, error } = poll.use();
  return { jobs: items, error };
}

const DETAIL_INTERVAL = 2000;
/** 1件を結果ごと取得する。探索中は定期的に取り直し、見つかった結果が順次増える */
export function useSearchJob(id: string | null): { job: SearchJob | null; error: string; loaded: boolean } {
  const [state, setState] = useState<{ job: SearchJob | null; error: string; loaded: boolean }>({ job: null, error: '', loaded: !id });
  useEffect(() => {
    if (!id) return;
    let timer: ReturnType<typeof setTimeout> | null = null, stopped = false;
    const load = async () => {
      try {
        const job = await getSearchJob(id);
        if (stopped) return;
        setState({ job, error: '', loaded: true });
        if (isSearchJobActive(job)) timer = setTimeout(() => void load(), DETAIL_INTERVAL);
      } catch (e) { if (!stopped) setState({ job: null, error: (e as Error).message, loaded: true }); }
    };
    void load();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [id]);
  return state;
}

/** ジョブを探索画面の結果（report）の形にする。探索中は途中までの結果で、集計は進捗の値 */
export function lineageReport(job: SearchJob & { kind: 'lineage' }): SearchReport {
  const o = job.outcome;
  return { status: o?.status ?? '中止', results: job.results ?? [], evaluated: o?.evaluated ?? job.progress.evaluated, pruned: o?.pruned ?? job.progress.pruned, dataIssues: o?.dataIssues ?? 0, elapsedMs: o?.elapsedMs ?? job.progress.elapsedMs, request: job.request };
}
export function loopReport(job: SearchJob & { kind: 'loop' }): LoopReport {
  const o = job.outcome;
  return { status: o?.status ?? '中止', results: job.results ?? [], evaluated: o?.evaluated ?? job.progress.evaluated, pruned: o?.pruned ?? job.progress.pruned, elapsedMs: o?.elapsedMs ?? job.progress.elapsedMs, request: job.request };
}

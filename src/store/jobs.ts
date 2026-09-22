// 写真取り込みジョブの状態。画面が開いている間だけサーバを定期取得する。
import { useSyncExternalStore } from 'react';
import { createJob, deleteJob, listJobs, retryJob, type ImportJob, type ScreenType } from '../api';
import { checkWorkspace, workspaceGeneration } from './workspace';
import { pollingStore } from './polling';

const poll = pollingStore<ImportJob>(listJobs, (j) => j.status === 'queued' || j.status === 'running');
export const refreshJobs = poll.refresh;
export async function submitJob(file: File, scope: ScreenType[], targetHorseId?: string) {
  const generation = workspaceGeneration();
  const job = await createJob(file, scope, targetHorseId);
  checkWorkspace(generation);
  poll.update((jobs) => [...jobs.filter((j) => j.id !== job.id), job]);
  return job;
}
export async function dismissJob(id: string) {
  poll.update((jobs) => jobs.filter((j) => j.id !== id));
  await deleteJob(id);
}
export async function retryFailedJob(id: string) {
  const generation = workspaceGeneration();
  const job = await retryJob(id);
  checkWorkspace(generation);
  poll.update((jobs) => jobs.map((j) => (j.id === id ? job : j)));
}

// ---- 撮影ダイアログの呼び出し。送信元の画面が判別の候補（scope）を決め、血統表タブなどは反映先も固定する ----
export interface CaptureTarget { id: string; name: string }
export interface CaptureRequest { open: boolean; scope: ScreenType[]; target: CaptureTarget | null }
let captureRequest: CaptureRequest = { open: false, scope: [], target: null };
const captureListeners = new Set<() => void>();
export function requestCapture(scope: ScreenType[], target: CaptureTarget | null = null) { captureRequest = { open: true, scope, target }; captureListeners.forEach((l) => l()); }
export function closeCapture() { captureRequest = { open: false, scope: [], target: null }; captureListeners.forEach((l) => l()); }
export function resetImportJobs() {
  poll.reset();
  closeCapture();
}
export function useCaptureRequest() {
  return useSyncExternalStore((l) => { captureListeners.add(l); return () => captureListeners.delete(l); }, () => captureRequest);
}

/** ジョブ一覧を購読する。購読中だけ定期取得が動く */
export function useImportJobs(): { jobs: ImportJob[]; error: string; loaded: boolean } {
  const { items, error, loaded } = poll.use();
  return { jobs: items, error, loaded };
}

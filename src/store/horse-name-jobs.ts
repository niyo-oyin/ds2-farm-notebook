import { api } from '../api';
import type { HorseNameJob, HorseNameRequest } from '../shared/horse-names';
import { pollingStore } from './polling';
import { checkWorkspace, workspaceGeneration } from './workspace';

export const isNamingActive = (job: HorseNameJob) => job.status === 'queued' || job.status === 'running';
const poll = pollingStore<HorseNameJob>(async () => (await api<{ jobs: HorseNameJob[] }>(`/api/horse-names?generation=${workspaceGeneration()}`)).jobs, isNamingActive);
export const useHorseNameJobs = poll.use;
export const resetHorseNameJobs = poll.reset;
export async function submitHorseNameJob(targetKey: string, request: HorseNameRequest) {
  const generation = workspaceGeneration();
  const { job } = await api<{ job: HorseNameJob }>('/api/horse-names', { method: 'POST', body: JSON.stringify({ generation, targetKey, request }) });
  checkWorkspace(generation);
  poll.update(jobs => [...jobs.filter(j => j.id !== job.id), job]);
  return job;
}

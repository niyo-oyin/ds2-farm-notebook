// サーバAPIクライアント。認証トークンは必要な場合だけ localStorage に保持する
import type { CardReading, PedigreeReading } from './core/owned-horse';
import type { BreedingReading, MasterReading } from './core/master-edits';
import type { SearchRequest, SearchResult, SearchStatus } from './core/search';
import type { LoopRequest, LoopResult } from './core/loop-search';
import { workspaceGeneration } from './store/workspace';
import { getCatalog } from './data/catalog';
const TOKEN_KEY = 'ds2tool.apitoken';
export const getToken = () => localStorage.getItem(TOKEN_KEY) ?? '';
export const setToken = (t: string) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers as Record<string, string> ?? {}) };
  const t = getToken();
  if (t) headers.authorization = `Bearer ${t}`;
  const res = await fetch(path, { ...init, headers });
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  if (!res.ok) {
    let msg = res.statusText;
    if (isJson) { try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* 本文が JSON でなければ HTTP ステータスを使う */ } }
    throw new ApiError(res.status, msg);
  }
  if (!isJson) throw new ApiError(res.status, `サーバの応答が JSON ではありません（${path}）。サーバが古い可能性があります。npm run server で再起動してください`);
  return (await res.json()) as T;
}

/** 画面1枚の読み取り結果（server の ScreenReading と同じ）。種類はサーバが送信元の候補（scope）の中から判別する */
export interface CardBox { x0: number; y0: number; x1: number; y1: number }
export type ScreenType = '育成馬' | '入厩馬' | '血統' | '種牡馬' | '繁殖牝馬' | '種付け';
export const ALL_SCREEN_TYPES: ScreenType[] = ['育成馬', '入厩馬', '血統', '種牡馬', '繁殖牝馬', '種付け'];
export interface CardScreen { screen_type: '育成馬' | '入厩馬'; card: Omit<CardReading, 'screen_type'> & { horse_box: CardBox }; notes: string }
export interface PedigreeScreen { screen_type: '血統'; pedigree: PedigreeReading; notes: string }
export interface MasterScreen { screen_type: '種牡馬' | '繁殖牝馬'; master: MasterReading; notes: string }
export interface BreedingScreen { screen_type: '種付け'; breeding: BreedingReading; notes: string }
export interface OtherScreen { screen_type: 'その他'; notes: string }
export type ScreenReading = CardScreen | PedigreeScreen | MasterScreen | BreedingScreen | OtherScreen;

export interface EncodedImage { image: string; mediaType: 'image/jpeg' }
/**
 * 画像を縮小して JPEG の base64 にする（アップロード量とトークンを抑える）。box を渡すとその範囲（比率）だけを切り出す。
 * EXIFの向きを反映し、縦長なら指定された向きに回転した後、rotation の回数だけ右へ90度回転する。
 * square なら切り出し範囲を正方形に広げる（馬の画像は正方形の枠に収めるので、欠けないように短い辺を伸ばす。画像の端では反対側へずらす）
 */
export async function imageToBase64(file: File | Blob, maxSide = 1600, box?: CardBox, pad = 0, square = false, { rotation = 0, portraitRotation }: { rotation?: number; portraitRotation?: 'left' | 'right' } = {}): Promise<EncodedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    let sx = box ? clamp(box.x0 - pad) * bitmap.width : 0, sy = box ? clamp(box.y0 - pad) * bitmap.height : 0;
    let sw = box ? clamp(box.x1 + pad) * bitmap.width - sx : bitmap.width, sh = box ? clamp(box.y1 + pad) * bitmap.height - sy : bitmap.height;
    if (square) {
      const side = Math.min(Math.max(sw, sh), bitmap.width, bitmap.height);
      sx = Math.min(Math.max(0, sx + (sw - side) / 2), bitmap.width - side);
      sy = Math.min(Math.max(0, sy + (sh - side) / 2), bitmap.height - side);
      sw = side; sh = side;
    }
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    const width = Math.max(1, Math.round(sw * scale)), height = Math.max(1, Math.round(sh * scale));
    const autoTurns = bitmap.height > bitmap.width ? portraitRotation === 'left' ? -1 : portraitRotation === 'right' ? 1 : 0 : 0;
    const turns = (((rotation + autoTurns) % 4) + 4) % 4;
    canvas.width = turns % 2 ? height : width; canvas.height = turns % 2 ? width : height;
    const ctx = canvas.getContext('2d')!;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(turns * Math.PI / 2);
    ctx.drawImage(bitmap, sx, sy, sw, sh, -width / 2, -height / 2, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { image: dataUrl.split(',')[1], mediaType: 'image/jpeg' };
  } finally { bitmap.close(); }
}
export const hasBox = (box: CardBox | undefined) => !!box && box.x1 - box.x0 > 0.02 && box.y1 - box.y0 > 0.02;

// ---- 写真取り込みのジョブ ----
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export interface ImportJob {
  id: string; status: JobStatus; imageId: string; scope: ScreenType[]; targetHorseId?: string; createdAt: string; updatedAt: string;
  result?: ScreenReading; model?: string; error?: string;
}
/** 写真を送ってジョブに登録する。解析はサーバが順次行う。scope は判別の候補にする画面の種類。targetHorseId を渡すと反映先を固定する（種付け画面では選んだ繁殖牝馬のキー） */
export async function createJob(img: EncodedImage, scope: ScreenType[], targetHorseId?: string): Promise<ImportJob> {
  const generation = workspaceGeneration();
  return (await api<{ job: ImportJob }>('/api/jobs', { method: 'POST', body: JSON.stringify({ ...img, scope, targetHorseId, generation }) })).job;
}
export const listJobs = async () => (await api<{ jobs: ImportJob[] }>('/api/jobs')).jobs;
export const retryJob = async (id: string) => (await api<{ job: ImportJob }>(`/api/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' })).job;
export const deleteJob = (id: string) => api(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
/** サーバに保存した画像を取得する（切り出し用） */
export async function fetchImage(id: string): Promise<Blob> {
  const res = await fetch(imageUrl(id));
  if (!res.ok) throw new ApiError(res.status, '画像を取得できません');
  return res.blob();
}

// ---- 馬の画像（サーバにファイルとして保存） ----
export const PORTRAIT_MAX_SIDE = 480;
export async function uploadImage(img: EncodedImage): Promise<string> {
  return (await api<{ id: string }>('/api/images', { method: 'POST', body: JSON.stringify(img) })).id;
}
export async function deleteImage(id: string) { try { await api(`/api/images/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch { /* 孤立ファイルは無視 */ } }
export function imageUrl(id: string) { const t = getToken(); return `/api/images/${encodeURIComponent(id)}${t ? `?token=${encodeURIComponent(t)}` : ''}`; }

// ---- 探索ジョブ（サーバでバックグラウンド実行する数世代探索・ループ探索） ----
export type SearchJobKind = 'lineage' | 'loop';
export type SearchJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export interface SearchProgress { evaluated: number; pruned: number; found: number; elapsedMs: number }
/** 終了した探索の集計。結果本体は results（一覧では省かれ、個別取得で付く） */
export interface SearchOutcome { status: SearchStatus; evaluated: number; pruned: number; elapsedMs: number; dataIssues?: number }
export type SearchJob = {
  id: string; masterRevision: string; status: SearchJobStatus; progress: SearchProgress; outcome?: SearchOutcome; error?: string; createdAt: string; updatedAt: string;
} & ({ kind: 'lineage'; request: SearchRequest; results?: SearchResult[] } | { kind: 'loop'; request: LoopRequest; results?: LoopResult[] });
export const isSearchJobActive = (job: SearchJob) => job.status === 'queued' || job.status === 'running';
export async function createSearchJob(kind: SearchJobKind, request: SearchRequest | LoopRequest): Promise<SearchJob> {
  return (await api<{ job: SearchJob }>('/api/search-jobs', { method: 'POST', body: JSON.stringify({ kind, request, generation: workspaceGeneration(), masterRevision: getCatalog().revision }) })).job;
}
export const listSearchJobs = async () => (await api<{ jobs: SearchJob[] }>('/api/search-jobs')).jobs;
export const getSearchJob = async (id: string) => (await api<{ job: SearchJob }>(`/api/search-jobs/${encodeURIComponent(id)}`)).job;
export const cancelSearchJob = async (id: string) => (await api<{ job: SearchJob }>(`/api/search-jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' })).job;
export const deleteSearchJob = (id: string) => api(`/api/search-jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });

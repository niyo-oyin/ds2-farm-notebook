// 数世代探索とループ探索をワーカースレッドで並列実行し、途中経過と結果を SQLite に保存する。
// 画面を閉じても探索は継続する。
import { Worker } from 'node:worker_threads';
import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import type { SyncRecord } from '../src/shared/save-data.js';
import type { SearchReport, SearchRequest, SearchResult, SearchStatus } from '../src/core/search.js';
import type { LoopReport, LoopRequest, LoopResult } from '../src/core/loop-search.js';

export type SearchJobKind = 'lineage' | 'loop';
export type SearchJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export interface SearchProgress { evaluated: number; pruned: number; found: number; elapsedMs: number }
/** 終了した探索の集計（結果本体は results に持つ） */
export interface SearchOutcome { status: SearchStatus; evaluated: number; pruned: number; elapsedMs: number; dataIssues?: number }
export type SearchJob = {
  id: string; status: SearchJobStatus; progress: SearchProgress; outcome?: SearchOutcome; error?: string; createdAt: string; updatedAt: string;
} & ({ kind: 'lineage'; request: SearchRequest; results?: SearchResult[] } | { kind: 'loop'; request: LoopRequest; results?: LoopResult[] });

export interface SearchWorkerIn { kind: SearchJobKind; request: SearchRequest | LoopRequest; records: SyncRecord[] }
export type SearchWorkerOut =
  | { type: 'progress'; evaluated: number; pruned: number; found: number; elapsedMs: number; results: (SearchResult | LoopResult)[] }
  | { type: 'done'; report: SearchReport | LoopReport }
  | { type: 'error'; message: string };

interface Row { id: string; status: SearchJobStatus; kind: SearchJobKind; request: string; progress: string; results: string | null; outcome: string | null; error: string | null; created_at: string; updated_at: string }
const ZERO: SearchProgress = { evaluated: 0, pruned: 0, found: 0, elapsedMs: 0 };
const now = () => new Date().toISOString();
const toJob = (r: Row): SearchJob => ({
  id: r.id, status: r.status, kind: r.kind, request: JSON.parse(r.request), progress: JSON.parse(r.progress), createdAt: r.created_at, updatedAt: r.updated_at,
  ...(r.results ? { results: JSON.parse(r.results) } : {}), ...(r.outcome ? { outcome: JSON.parse(r.outcome) } : {}), ...(r.error ? { error: r.error } : {}),
} as SearchJob);

export class SearchJobQueue {
  private running = new Map<string, Worker>();
  /** records は探索の材料（所有馬・計画馬・マスターデータの修正・判定ルール）。開始時点の同期済みレコードを使う */
  constructor(private db: DatabaseSync, private records: () => SyncRecord[], private concurrency = 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS search_jobs (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, kind TEXT NOT NULL, request TEXT NOT NULL, progress TEXT NOT NULL,
        results TEXT NOT NULL, outcome TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );`);
    // 前回の終了時に探索中だったものは最初からやり直す
    db.prepare(`UPDATE search_jobs SET status = 'queued', progress = ?, results = '[]', updated_at = ? WHERE status = 'running'`).run(JSON.stringify(ZERO), now());
    this.tick();
  }
  /** 一覧は結果本体を含まない（進捗の found が件数） */
  list(): SearchJob[] {
    return (this.db.prepare('SELECT id, status, kind, request, progress, NULL AS results, outcome, error, created_at, updated_at FROM search_jobs ORDER BY created_at').all() as unknown as Row[]).map(toJob);
  }
  get(id: string): SearchJob | null {
    const row = this.db.prepare('SELECT * FROM search_jobs WHERE id = ?').get(id) as unknown as Row | undefined;
    return row ? toJob(row) : null;
  }
  enqueue(kind: SearchJobKind, request: SearchRequest | LoopRequest): SearchJob {
    const id = `search_${randomBytes(6).toString('hex')}`, t = now();
    this.db.prepare(`INSERT INTO search_jobs (id, status, kind, request, progress, results, created_at, updated_at) VALUES (?, 'queued', ?, ?, ?, '[]', ?, ?)`).run(id, kind, JSON.stringify(request), JSON.stringify(ZERO), t, t);
    this.tick();
    return this.get(id)!;
  }
  /** 待機中は即座に中止、探索中はワーカーに伝えて区切りで止める（それまでの結果は残る） */
  cancel(id: string): SearchJob | null {
    const job = this.get(id);
    if (!job) return null;
    if (job.status === 'queued') this.db.prepare(`UPDATE search_jobs SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(now(), id);
    else this.running.get(id)?.postMessage('cancel');
    return this.get(id);
  }
  remove(id: string) {
    this.stop(id);
    this.db.prepare('DELETE FROM search_jobs WHERE id = ?').run(id);
  }
  /** ロード前のデータで始めた探索は新しい状態と合わないので全て捨てる */
  clear() {
    for (const id of [...this.running.keys()]) this.stop(id);
    this.db.exec('DELETE FROM search_jobs');
  }
  private stop(id: string) {
    const w = this.running.get(id);
    if (!w) return;
    this.running.delete(id);
    void w.terminate();
    this.tick();
  }
  private tick() {
    while (this.running.size < this.concurrency) {
      const row = this.db.prepare(`SELECT * FROM search_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1`).get() as unknown as Row | undefined;
      if (!row) return;
      this.db.prepare(`UPDATE search_jobs SET status = 'running', updated_at = ? WHERE id = ?`).run(now(), row.id);
      this.execute(toJob(row));
    }
  }
  private execute(job: SearchJob) {
    const worker = new Worker(new URL('./search-worker.ts', import.meta.url), {
      workerData: { kind: job.kind, request: job.request, records: this.records() } satisfies SearchWorkerIn,
      execArgv: ['--import', 'tsx'],
    });
    this.running.set(job.id, worker);
    let results: unknown[] = [];
    const finish = (patch: { status: SearchJobStatus; outcome?: SearchOutcome; error?: string; progress?: SearchProgress }) => {
      if (!this.running.has(job.id)) return; // 削除・破棄済み
      this.running.delete(job.id);
      this.db.prepare(`UPDATE search_jobs SET status = ?, progress = COALESCE(?, progress), results = ?, outcome = ?, error = ?, updated_at = ? WHERE id = ?`)
        .run(patch.status, patch.progress ? JSON.stringify(patch.progress) : null, JSON.stringify(results), patch.outcome ? JSON.stringify(patch.outcome) : null, patch.error ?? null, now(), job.id);
      void worker.terminate();
      this.tick();
    };
    worker.on('message', (m: SearchWorkerOut) => {
      if (m.type === 'progress') {
        for (const result of m.results) results.push(result);
        const progress: SearchProgress = { evaluated: m.evaluated, pruned: m.pruned, found: m.found, elapsedMs: m.elapsedMs };
        this.db.prepare(`UPDATE search_jobs SET progress = ?, results = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(progress), JSON.stringify(results), now(), job.id);
      } else if (m.type === 'done') {
        const { results: all, request: _request, ...rest } = m.report;
        results = all;
        finish({ status: rest.status === '中止' ? 'cancelled' : 'done', outcome: rest, progress: { evaluated: rest.evaluated, pruned: rest.pruned, found: all.length, elapsedMs: rest.elapsedMs } });
      } else finish({ status: 'failed', error: m.message });
    });
    worker.on('error', (e) => finish({ status: 'failed', error: e.message }));
    worker.on('exit', (code) => { if (code !== 0) finish({ status: 'failed', error: `探索が異常終了しました（${code}）` }); });
  }
}

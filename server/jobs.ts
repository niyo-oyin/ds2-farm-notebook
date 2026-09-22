// 写真読み取りのジョブキュー。SQLite に永続化し、プロセス内のワーカーが並列に解析する。
import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import type { ScreenType } from './llm.js';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export interface ImportJob {
  id: string; status: JobStatus; imageId: string;
  /** 判別の候補にする画面の種類。送信元の画面で決まる（ヘッダーから送ると全種類） */
  scope: ScreenType[];
  /** 反映先を固定して送った場合の所有馬ID（血統表タブからの登録） */
  targetHorseId?: string;
  createdAt: string; updatedAt: string;
  result?: unknown; model?: string; error?: string;
}
interface JobRow { id: string; status: JobStatus; image_id: string; scope: string; target_horse_id: string | null; result: string | null; model: string | null; error: string | null; created_at: string; updated_at: string }
type Runner = (job: ImportJob) => Promise<{ result: unknown; model?: string }>;

const now = () => new Date().toISOString();
const toJob = (r: JobRow): ImportJob => ({
  id: r.id, status: r.status, imageId: r.image_id, scope: JSON.parse(r.scope), createdAt: r.created_at, updatedAt: r.updated_at, ...(r.target_horse_id ? { targetHorseId: r.target_horse_id } : {}),
  ...(r.result ? { result: JSON.parse(r.result) } : {}), ...(r.model ? { model: r.model } : {}), ...(r.error ? { error: r.error } : {}),
});

export class JobQueue {
  private running = 0;
  constructor(private db: DatabaseSync, private run: Runner, private concurrency = 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS import_jobs (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, image_id TEXT NOT NULL, scope TEXT NOT NULL, target_horse_id TEXT,
        result TEXT, model TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );`);
    // 前回の終了時に解析中だったものは待機に戻す
    db.prepare(`UPDATE import_jobs SET status = 'queued', updated_at = ? WHERE status = 'running'`).run(now());
    this.tick();
  }
  list(): ImportJob[] {
    return (this.db.prepare('SELECT * FROM import_jobs ORDER BY created_at').all() as unknown as JobRow[]).map(toJob);
  }
  get(id: string): ImportJob | null {
    const row = this.db.prepare('SELECT * FROM import_jobs WHERE id = ?').get(id) as unknown as JobRow | undefined;
    return row ? toJob(row) : null;
  }
  enqueue(imageId: string, scope: ScreenType[], targetHorseId: string | null): ImportJob {
    const id = `job_${randomBytes(6).toString('hex')}`, t = now();
    this.db.prepare('INSERT INTO import_jobs (id, status, image_id, scope, target_horse_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, 'queued', imageId, JSON.stringify(scope), targetHorseId, t, t);
    this.tick();
    return this.get(id)!;
  }
  retry(id: string): ImportJob | null {
    this.db.prepare(`UPDATE import_jobs SET status = 'queued', error = NULL, updated_at = ? WHERE id = ? AND status = 'failed'`).run(now(), id);
    this.tick();
    return this.get(id);
  }
  /** 削除して画像IDを返す（呼び出し側で画像ファイルを消す） */
  remove(id: string): string | null {
    const job = this.get(id);
    if (!job) return null;
    this.db.prepare('DELETE FROM import_jobs WHERE id = ?').run(id);
    return job.imageId;
  }
  /** ロード前の写真を新しい状態に反映しない。実行中の結果も、削除済み行には書き戻されない。 */
  clear(): string[] {
    const images = this.list().map((job) => job.imageId);
    this.db.exec('DELETE FROM import_jobs');
    return images;
  }
  private tick() {
    while (this.running < this.concurrency) {
      const row = this.db.prepare(`SELECT * FROM import_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1`).get() as unknown as JobRow | undefined;
      if (!row) return;
      this.db.prepare(`UPDATE import_jobs SET status = 'running', updated_at = ? WHERE id = ?`).run(now(), row.id);
      this.running++;
      void this.execute(toJob(row));
    }
  }
  private async execute(job: ImportJob) {
    try {
      const { result, model } = await this.run(job);
      this.db.prepare(`UPDATE import_jobs SET status = 'done', result = ?, model = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(result), model ?? null, now(), job.id);
    } catch (e) {
      this.db.prepare(`UPDATE import_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).run((e as Error).message, now(), job.id);
    } finally {
      this.running--;
      this.tick();
    }
  }
}

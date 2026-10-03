import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HorseNameJobRequestSchema, type HorseNameJob, type HorseNameRequest } from '../src/shared/horse-names.js';
import { generateHorseNames } from './horse-names.js';
import { llmReady } from './llm-client.js';

interface Row { id: string; target_key: string; status: HorseNameJob['status']; request: string; result: string | null; error: string | null; created_at: string; updated_at: string }
const now = () => new Date().toISOString();
const toJob = (row: Row): HorseNameJob => ({
  id: row.id, targetKey: row.target_key, status: row.status, affix: (JSON.parse(row.request) as HorseNameRequest).affix,
  createdAt: row.created_at, updatedAt: row.updated_at,
  ...(row.result ? { result: JSON.parse(row.result) } : {}), ...(row.error ? { error: row.error } : {}),
});

export class HorseNameJobQueue {
  private running = new Map<string, AbortController>();
  constructor(private db: DatabaseSync, private generate = generateHorseNames, private concurrency = 2) {
    db.exec(`CREATE TABLE IF NOT EXISTS horse_name_jobs (
      id TEXT PRIMARY KEY, target_key TEXT NOT NULL, status TEXT NOT NULL, request TEXT NOT NULL,
      result TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    db.prepare("UPDATE horse_name_jobs SET status = 'queued' WHERE status = 'running'").run();
    this.tick();
  }
  list(): HorseNameJob[] {
    return (this.db.prepare('SELECT * FROM horse_name_jobs ORDER BY rowid').all() as unknown as Row[]).map(toJob);
  }
  get(id: string): HorseNameJob | null {
    const row = this.db.prepare('SELECT * FROM horse_name_jobs WHERE id = ?').get(id) as unknown as Row | undefined;
    return row ? toJob(row) : null;
  }
  enqueue(targetKey: string, request: HorseNameRequest): HorseNameJob {
    const active = this.db.prepare("SELECT * FROM horse_name_jobs WHERE target_key = ? AND status IN ('queued', 'running')").get(targetKey) as unknown as Row | undefined;
    if (active) return toJob(active);
    const id = randomUUID(), at = now();
    this.db.prepare("INSERT INTO horse_name_jobs (id, target_key, status, request, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?)")
      .run(id, targetKey, JSON.stringify(request), at, at);
    this.tick();
    return this.get(id)!;
  }
  /** セーブのロードでは古い命名資料を破棄し、実行中の結果も新しい牧場へ持ち込まない。 */
  clear() {
    for (const controller of this.running.values()) controller.abort();
    this.running.clear();
    this.db.exec('DELETE FROM horse_name_jobs');
  }
  private tick() {
    while (this.running.size < this.concurrency) {
      const row = this.db.prepare("SELECT * FROM horse_name_jobs WHERE status = 'queued' ORDER BY rowid LIMIT 1").get() as unknown as Row | undefined;
      if (!row) return;
      const controller = new AbortController();
      this.running.set(row.id, controller);
      this.db.prepare("UPDATE horse_name_jobs SET status = 'running', updated_at = ? WHERE id = ?").run(now(), row.id);
      void this.execute(row, controller);
    }
  }
  private async execute(row: Row, controller: AbortController) {
    try {
      const result = await this.generate(JSON.parse(row.request), controller.signal);
      if (!controller.signal.aborted) this.db.prepare("UPDATE horse_name_jobs SET status = 'done', result = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(result), now(), row.id);
    } catch (e) {
      if (!controller.signal.aborted) {
        console.error('Horse name generation failed:', e instanceof Error ? e.name : 'Error');
        this.db.prepare("UPDATE horse_name_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
          .run('命名候補を生成できませんでした。もう一度お試しください。', now(), row.id);
      }
    } finally {
      this.running.delete(row.id);
      this.tick();
    }
  }
}

export function horseNameRoutes(queue: HorseNameJobQueue, generation: () => number, ready = llmReady) {
  const app = new Hono();
  app.use('*', bodyLimit({ maxSize: 256 * 1024, onError: c => c.json({ error: '命名の資料が大きすぎます。' }, 413) }));
  app.get('/', c => c.req.query('generation') !== String(generation())
    ? c.json({ error: 'セーブデータがロードされました。同期してから確認してください。' }, 409)
    : c.json({ jobs: queue.list() }));
  app.post('/', async c => {
    const parsed = HorseNameJobRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: '父母の記録や牧場設定の形式・文字数を確認してください（冠名はカタカナ8文字以内）。' }, 400);
    if (parsed.data.generation !== generation()) return c.json({ error: 'セーブデータがロードされました。同期してから生成してください。' }, 409);
    if (!ready()) return c.json({ error: 'サーバのLLM_API_KEYを設定すると命名候補を生成できます。' }, 503);
    return c.json({ job: queue.enqueue(parsed.data.targetKey, parsed.data.request) }, 202);
  });
  return app;
}

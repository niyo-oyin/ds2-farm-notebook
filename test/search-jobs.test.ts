import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseMaster } from '../src/data/base-master';
import { HorseResolver } from '../src/core/pedigree';
import { makeContext } from '../src/core/judge';
import { DEFAULT_RULES } from '../src/core/rules';
import { searchLineage, type SearchRequest } from '../src/core/search';
import { SearchJobQueue, searchJobRoutes, type SearchJob } from '../server/search-jobs';
import { emptyUserData } from '../src/store/model';
import { toRecords } from '../src/store/sync';

const M = { ...baseMaster, stallions: baseMaster.stallions.map(h => ({ ...h, price: h.price + 321 })) };
const catalog = { revision: 'test-master', data: { master: M, races: [], searchAliases: [] } };
const request: SearchRequest = {
  startMares: [M.broodmares[0].id], stallionPool: M.stallions.slice(0, 12).map((s) => s.id), intermediateStallion: null, finalStallion: null, finalPool: null,
  minMatings: 1, maxMatings: 2, goals: [{ type: 'notDangerous' }], maxCost: null, maxEvaluations: 1_000_000, allowRepeatStallion: true,
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(queue: SearchJobQueue, id: string, done: (j: SearchJob) => boolean, timeoutMs = 30000): Promise<SearchJob> {
  const t0 = Date.now();
  for (;;) {
    const job = queue.get(id)!;
    if (done(job)) return job;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout: ${job.status}`);
    await wait(100);
  }
}

describe('探索ジョブ', () => {
  let dir: string, db: DatabaseSync, queue: SearchJobQueue;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ds2-search-')); db = new DatabaseSync(join(dir, 'test.sqlite')); });
  afterEach(() => { queue.clear(); db.close(); rmSync(dir, { recursive: true, force: true }); });

  it('画面のマスターがサーバーと違う場合は探索を受け付けず、一致する場合だけ登録する', async () => {
    queue = new SearchJobQueue(db, () => [], catalog, 0);
    const app = searchJobRoutes(queue, () => 0);
    const submit = (masterRevision: string) => app.request('/search-jobs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'lineage', request, generation: 0, masterRevision }),
    });
    const rejected = await submit('old-master');
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ error: expect.stringContaining('再読み込み') });
    expect(queue.list()).toEqual([]);
    const accepted = await submit(catalog.revision);
    expect(accepted.status).toBe(200);
    expect(queue.list()).toHaveLength(1);
  });

  it('再起動時に別のマスターへ変わった待機中・実行中の探索を再実行しない', () => {
    queue = new SearchJobQueue(db, () => [], catalog, 0);
    const waiting = queue.enqueue('lineage', request), running = queue.enqueue('lineage', request);
    db.prepare("UPDATE search_jobs SET status = 'running' WHERE id = ?").run(running.id);
    queue = new SearchJobQueue(db, () => [], { ...catalog, revision: 'new-master' }, 1);
    for (const id of [waiting.id, running.id]) {
      expect(queue.get(id)).toMatchObject({ status: 'failed', error: expect.stringContaining('再読み込み'), results: [] });
    }
  });

  it('同じマスターで再起動した探索を継続し、途中の種牡馬指定も含めて画面の探索と同じ結果を残す', async () => {
    const req = { ...request, intermediateStallion: request.stallionPool[0] };
    queue = new SearchJobQueue(db, () => toRecords(emptyUserData()), catalog, 0);
    const pending = queue.enqueue('lineage', req);
    queue = new SearchJobQueue(db, () => toRecords(emptyUserData()), catalog, 1);
    const job = await until(queue, pending.id, (j) => j.status === 'done' || j.status === 'failed');
    expect(job.status).toBe('done');
    expect(job.masterRevision).toBe(catalog.revision);
    const resolver = new HorseResolver(M, [], DEFAULT_RULES);
    const direct = await searchLineage({ ctx: makeContext(M), rules: DEFAULT_RULES, resolve: (k) => resolver.get(k) }, req);
    expect(job.outcome).toMatchObject({ status: direct.status, evaluated: direct.evaluated, pruned: direct.pruned });
    expect(job.results).toEqual(direct.results);
    expect(job.progress.found).toBe(direct.results.length);
    // 一覧は結果本体を持たない
    expect(queue.list().find((j) => j.id === job.id)).not.toHaveProperty('results');
  }, 60000);

  it('待機中の中止は即座に、探索中の中止は区切りで止まり、それまでの結果を残す。同時実行は上限まで', async () => {
    queue = new SearchJobQueue(db, () => toRecords(emptyUserData()), catalog, 1);
    const heavy: SearchRequest = { ...request, stallionPool: M.stallions.map((s) => s.id), maxMatings: 3, maxEvaluations: 1_000_000_000 };
    const first = queue.enqueue('lineage', heavy), second = queue.enqueue('lineage', request);
    expect(queue.get(second.id)!.status).toBe('queued');
    expect(queue.cancel(second.id)!.status).toBe('cancelled');
    await until(queue, first.id, (j) => j.status === 'running' && j.progress.found > 0);
    queue.cancel(first.id);
    const stopped = await until(queue, first.id, (j) => j.status === 'cancelled');
    expect(stopped.outcome?.status).toBe('中止');
    expect(stopped.results!.length).toBeGreaterThan(0);
    expect(stopped.results!.length).toBe(stopped.progress.found);
  }, 60000);
});

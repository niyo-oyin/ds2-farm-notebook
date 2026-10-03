import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { HorseNameJobQueue, horseNameRoutes } from '../server/horse-name-jobs';
import type { HorseNameIdeas, HorseNameRequest } from '../src/shared/horse-names';

const request: HorseNameRequest = { sire: { origin: 'unknown', name: '父' }, dam: { origin: 'unknown', name: '母' }, pedigree: [], sex: 'F', color: '鹿毛', farm: '', affix: { text: '', position: 'prefix' }, previous: [] };
const result: HorseNameIdeas = { candidates: ['アカツキ', 'ツバサ', 'ヒカリ', 'キセキ', 'ハヤテ'].map(name => ({ name, meaning: '願い' })) };
const databases: DatabaseSync[] = [];
const database = () => { const db = new DatabaseSync(':memory:'); databases.push(db); return db; };
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const post = (body: unknown, signal?: AbortSignal) => new Request('http://localhost/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });

it('受付後に画面の通信を切っても生成を続け、結果を再取得・サーバ再起動後にも復元できる', async () => {
  const completion = Promise.withResolvers<HorseNameIdeas>();
  const db = database(), generate = vi.fn(() => completion.promise);
  const queue = new HorseNameJobQueue(db, generate);
  const app = horseNameRoutes(queue, () => 3, () => true);
  const controller = new AbortController();
  const response = await app.fetch(post({ generation: 3, targetKey: 'u:foal', request }, controller.signal));
  expect(response.status).toBe(202);
  const { job } = await response.json();
  controller.abort();
  expect(generate.mock.calls[0][1]?.aborted).toBe(false);
  expect(queue.get(job.id)?.status).toBe('running');
  const duplicate = await app.fetch(post({ generation: 3, targetKey: 'u:foal', request }));
  expect((await duplicate.json()).job.id).toBe(job.id);
  expect(generate).toHaveBeenCalledTimes(1);
  completion.resolve(result);
  await vi.waitFor(() => expect(queue.get(job.id)?.status).toBe('done'));
  const jobs = (await (await app.request('/?generation=3')).json()).jobs;
  expect(jobs[0]).toMatchObject({ targetKey: 'u:foal', result });
  const restarted = new HorseNameJobQueue(db, generate);
  expect(restarted.get(job.id)?.result).toEqual(result);
  expect(generate).toHaveBeenCalledTimes(1);
});

it('待機中の別馬を順に実行し、途中でサーバが終了したジョブは再開する', async () => {
  const db = database(), completions = [Promise.withResolvers<HorseNameIdeas>(), Promise.withResolvers<HorseNameIdeas>()];
  const generate = vi.fn().mockReturnValueOnce(completions[0].promise).mockReturnValueOnce(completions[1].promise);
  const queue = new HorseNameJobQueue(db, generate, 1);
  const a = queue.enqueue('u:a', request), b = queue.enqueue('u:b', request);
  expect(queue.get(a.id)?.status).toBe('running');
  expect(queue.get(b.id)?.status).toBe('queued');
  completions[0].resolve(result);
  await vi.waitFor(() => expect(queue.get(b.id)?.status).toBe('running'));
  completions[1].resolve(result);
  await vi.waitFor(() => expect(queue.get(b.id)?.status).toBe('done'));
  // プロセスが終了した直後の永続状態を再現する。
  db.prepare("UPDATE horse_name_jobs SET status = 'running', result = NULL WHERE id = ?").run(b.id);
  const resumed = new HorseNameJobQueue(db, async () => result);
  await vi.waitFor(() => expect(resumed.get(b.id)?.result).toEqual(result));
});

it('失敗を保存して再試行でき、別の馬の結果と混ざらない', async () => {
  const generate = vi.fn().mockRejectedValueOnce(new Error('private upstream detail')).mockResolvedValue(result);
  const queue = new HorseNameJobQueue(database(), generate);
  const failed = queue.enqueue('u:a', request);
  await vi.waitFor(() => expect(queue.get(failed.id)?.status).toBe('failed'));
  expect(queue.get(failed.id)?.error).not.toContain('private upstream');
  const retry = queue.enqueue('u:a', request), other = queue.enqueue('u:b', request);
  expect(retry.id).not.toBe(failed.id);
  await vi.waitFor(() => expect(queue.get(other.id)?.status).toBe('done'));
  expect(queue.get(retry.id)).toMatchObject({ targetKey: 'u:a', status: 'done', result });
  expect(queue.get(other.id)?.targetKey).toBe('u:b');
});

it('セーブをロードすると実行を中断し、遅れて返る結果も破棄する', async () => {
  const pending = Promise.withResolvers<HorseNameIdeas>();
  const generate = vi.fn(() => pending.promise);
  const queue = new HorseNameJobQueue(database(), generate);
  let generation = 0;
  const app = horseNameRoutes(queue, () => generation, () => true);
  queue.enqueue('u:old', request);
  queue.clear(); generation++;
  expect(generate.mock.calls[0][1]?.aborted).toBe(true);
  pending.resolve(result);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(queue.list()).toEqual([]);
  expect((await app.fetch(post({ generation: 0, targetKey: 'u:old', request }))).status).toBe(409);
  expect((await app.request('/?generation=0')).status).toBe(409);
  expect((await app.request('/?generation=1')).status).toBe(200);
});

it('不正な入力やLLM未設定ではジョブを作成しない', async () => {
  const generate = vi.fn(async () => result), queue = new HorseNameJobQueue(database(), generate);
  const app = horseNameRoutes(queue, () => 0, () => true);
  for (const text of ['ABC', '牧場', '１２３', 'アイウエオカキクケ']) {
    expect((await app.fetch(post({ generation: 0, targetKey: 'u:foal', request: { ...request, affix: { text, position: 'prefix' } } }))).status).toBe(400);
  }
  expect((await horseNameRoutes(queue, () => 0, () => false).fetch(post({ generation: 0, targetKey: 'u:foal', request }))).status).toBe(503);
  expect(queue.list()).toEqual([]);
  expect(generate).not.toHaveBeenCalled();
});

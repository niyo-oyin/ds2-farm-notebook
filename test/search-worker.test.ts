import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseMaster } from '../src/data/base-master';
import type { SearchHooks } from '../src/core/search';
import type { DesignReport, DesignRequest, DesignResult } from '../src/core/design-search';
import type { LoopReport, LoopRequest, LoopResult } from '../src/core/loop-search';
import type { WorkerIn, WorkerOut } from '../src/core/worker';

const searches = vi.hoisted(() => ({ design: vi.fn(), loop: vi.fn() }));
vi.mock('../src/core/design-search', () => ({ searchDesigns: searches.design }));
vi.mock('../src/core/loop-search', () => ({ searchLoops: searches.loop }));

const request: DesignRequest = {
  colt: { starts: [], sires: [baseMaster.stallions[0].id], minGenerations: 0, maxGenerations: 0, required: null },
  filly: { starts: [baseMaster.broodmares[0].id], minGenerations: 0, maxGenerations: 1, required: null },
  stallionPool: [baseMaster.stallions[0].id], goals: [], strongLines: false, maxCost: null, maxEvaluations: 10_000,
};
const loopRequest: LoopRequest = { stallionPool: request.stallionPool, minLength: 5, maxLength: 6, goals: [], maxCost: null, maxEvaluations: 10_000 };

describe('探索 Worker の進捗通知', () => {
  let scope: { onmessage: (event: { data: WorkerIn }) => Promise<void>; postMessage: (message: WorkerOut) => void };
  let sent: { at: number; message: WorkerOut }[];

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    sent = [];
    scope = { onmessage: async () => {}, postMessage: (message) => sent.push({ at: performance.now(), message: structuredClone(message) }) };
    vi.stubGlobal('self', scope);
    await import('../src/core/worker');
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it.each(['startDesign', 'startLoop'] as const)('%s は通知をまとめ、未送信の結果も完了時に届ける', async (type) => {
    const results = Array.from({ length: 8 }, (_, cost) => ({ steps: [], length: 5, cost, goals: [] }) as unknown as DesignResult & LoopResult);
    const report: DesignReport | LoopReport = type === 'startDesign'
      ? { status: '完了', results, evaluated: 8, pruned: 0, dataIssues: 0, folded: 0, elapsedMs: 800, request }
      : { status: '完了', results, evaluated: 8, pruned: 0, elapsedMs: 800, request: loopRequest };
    const search = type === 'startDesign' ? searches.design : searches.loop;
    search.mockImplementation(async (_env, _request, hooks: SearchHooks<DesignResult | LoopResult>) => {
      for (let i = 0; i < results.length; i++) {
        hooks.onFound?.(results[i]);
        await hooks.onProgress?.({ evaluated: i + 1, pruned: 0, found: i + 1, depth: 1 });
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
      return report;
    });
    const input: WorkerIn = type === 'startDesign'
      ? { type, master: baseMaster, userHorses: [], rules: {}, request }
      : { type, master: baseMaster, userHorses: [], rules: {}, request: loopRequest };
    const done = scope.onmessage({ data: input });
    await vi.runAllTimersAsync();
    await done;
    const updates = sent.filter((item) => item.message.type === 'progress');
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.length).toBeLessThan(results.length);
    for (let i = 1; i < updates.length; i++) expect(updates[i].at - updates[i - 1].at).toBeGreaterThanOrEqual(250);
    const delivered = updates.flatMap(({ message }) => message.type === 'progress' ? message.results : []);
    expect(delivered).toEqual(results.slice(0, delivered.length));
    expect(delivered.length).toBeLessThan(results.length);
    expect(sent.at(-1)?.message).toEqual({ type: type === 'startDesign' ? 'designDone' : 'loopDone', report });
  });

  it('表示の通知を省いた区切りでも中止を受け取り、直前に見つけた結果を残す', async () => {
    const result = { cost: 100, goals: [] } as unknown as DesignResult;
    searches.design.mockImplementation(async (_env, _request, hooks: SearchHooks<DesignResult>) => {
      hooks.onFound?.(result);
      setTimeout(() => { void scope.onmessage({ data: { type: 'cancel' } }); }, 0);
      await hooks.onProgress?.({ evaluated: 1, pruned: 2000, found: 1, depth: 1 });
      expect(hooks.shouldStop?.()).toBe(true);
      return { status: '中止', results: [result], evaluated: 1, pruned: 2000, dataIssues: 0, folded: 0, elapsedMs: 1, request } satisfies DesignReport;
    });
    const done = scope.onmessage({ data: { type: 'startDesign', master: baseMaster, userHorses: [], rules: {}, request } });
    await vi.runAllTimersAsync();
    await done;
    expect(sent).toHaveLength(1);
    expect(sent[0].message).toMatchObject({ type: 'designDone', report: { status: '中止', results: [result] } });
  });
});

// ブラウザと共通の探索コアを Node のワーカースレッドで実行し、進捗と結果を親へ送る。
// 中止メッセージは探索コアの処理の区切りで受け付ける。
import { parentPort, workerData } from 'node:worker_threads';
import { baseMaster } from '../src/data/base-master.js';
import { applyMasterEdits } from '../src/core/master-edits.js';
import { DEFAULT_RULES } from '../src/core/rules.js';
import { HorseResolver } from '../src/core/pedigree.js';
import { makeContext } from '../src/core/judge.js';
import { searchLineage, type SearchRequest, type SearchResult } from '../src/core/search.js';
import { searchLoops, type LoopRequest, type LoopResult } from '../src/core/loop-search.js';
import { allUserHorses } from '../src/store/model.js';
import { userDataFromRecords } from './user-data.js';
import type { SearchWorkerIn, SearchWorkerOut } from './search-jobs.js';

const input = workerData as SearchWorkerIn;
const port = parentPort!;
const post = (m: SearchWorkerOut) => port.postMessage(m);
let cancelled = false;
port.on('message', (m: unknown) => { if (m === 'cancel') cancelled = true; });

const POST_INTERVAL_MS = 1000;
try {
  const data = userDataFromRecords(input.records);
  const master = applyMasterEdits(baseMaster, data.masterEdits, data.ancestorEdits, data.kottaEdits, data.nicksEdits);
  const rules = { ...DEFAULT_RULES, ...data.settings.rules };
  const userHorses = allUserHorses(data);
  const resolver = new HorseResolver(master, userHorses, rules);
  const env = { ctx: makeContext(master, rules, userHorses), rules, resolve: (k: string) => resolver.get(k) };
  const t0 = Date.now();
  let found: (SearchResult | LoopResult)[] = [], lastPost = performance.now();
  const hooks = {
    shouldStop: () => cancelled,
    onFound: (r: SearchResult | LoopResult) => { found.push(r); },
    onProgress: async (p: { evaluated: number; pruned: number; found: number }) => {
      const now = performance.now();
      // 保存と画面更新が頻発しないよう、発見した結果も通知間隔に合わせてまとめて送る。
      if (now - lastPost >= POST_INTERVAL_MS) {
        post({ type: 'progress', evaluated: p.evaluated, pruned: p.pruned, found: p.found, elapsedMs: Date.now() - t0, results: found });
        found = []; lastPost = now;
      }
      await new Promise<void>((resolve) => setImmediate(resolve)); // 中止メッセージを受け取る区切り
    },
  };
  const report = input.kind === 'loop' ? await searchLoops(env, input.request as LoopRequest, hooks) : await searchLineage(env, input.request as SearchRequest, hooks);
  post({ type: 'done', report });
} catch (e) {
  post({ type: 'error', message: (e as Error).message });
}

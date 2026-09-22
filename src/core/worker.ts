// 探索を Web Worker で実行する。見つかった結果は終了を待たずに進捗と一緒に順次送る
import type { MasterData, UserHorse } from './types';
import { DEFAULT_RULES, type RuleOptions } from './rules';
import { HorseResolver } from './pedigree';
import { makeContext } from './judge';
import { searchLineage, type SearchReport, type SearchRequest, type SearchResult } from './search';
import { searchLoops, type LoopReport, type LoopRequest, type LoopResult } from './loop-search';

export type WorkerIn =
  | { type: 'start'; master: MasterData; userHorses: UserHorse[]; rules: Partial<RuleOptions>; request: SearchRequest }
  | { type: 'startLoop'; master: MasterData; userHorses: UserHorse[]; rules: Partial<RuleOptions>; request: LoopRequest }
  | { type: 'cancel' };
export type WorkerOut =
  | { type: 'progress'; evaluated: number; pruned: number; found: number; depth: number; results: (SearchResult | LoopResult)[] }
  | { type: 'done'; report: SearchReport }
  | { type: 'loopDone'; report: LoopReport }
  | { type: 'error'; message: string };

let cancelled = false;
const POST_INTERVAL_MS = 250;
self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type === 'cancel') { cancelled = true; return; }
  cancelled = false;
  try {
    const rules = { ...DEFAULT_RULES, ...msg.rules };
    const resolver = new HorseResolver(msg.master, msg.userHorses, rules);
    const ctx = makeContext(msg.master, rules, msg.userHorses);
    const env = { ctx, rules, resolve: (k: string) => resolver.get(k) };
    let found: (SearchResult | LoopResult)[] = [];
    let lastPost = performance.now();
    const hooks = {
      shouldStop: () => cancelled,
      onFound: (r: SearchResult | LoopResult) => { found.push(r); },
      onProgress: (p: { evaluated: number; pruned: number; found: number; depth: number }) => new Promise<void>((resolve) => {
        const now = performance.now();
        if (now - lastPost >= POST_INTERVAL_MS) {
          (self as unknown as Worker).postMessage({ type: 'progress', ...p, results: found } satisfies WorkerOut);
          found = [];
          lastPost = now;
        }
        // 表示の通知を間引いても、中止を受け付ける頻度は保つ。
        // 未送信の結果は次の進捗か、終了時の report に含まれる。
        setTimeout(resolve, 0); // cancel メッセージを受け取る区切り
      }),
    };
    if (msg.type === 'startLoop') {
      const report = await searchLoops(env, msg.request, hooks);
      (self as unknown as Worker).postMessage({ type: 'loopDone', report } satisfies WorkerOut);
      return;
    }
    const report = await searchLineage(env, msg.request, hooks);
    (self as unknown as Worker).postMessage({ type: 'done', report } satisfies WorkerOut);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: (err as Error).message } satisfies WorkerOut);
  }
};

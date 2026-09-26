import { describe, expect, it } from 'vitest';
import { pollingStore } from '../src/store/polling';

describe('ジョブ一覧の定期取得', () => {
  it('取得中に手元で足したジョブを、古い取得結果で消さずに取り直す', async () => {
    const server: { id: string }[] = [{ id: 'old' }];
    let release: (() => void) | null = null;
    let fetches = 0;
    const store = pollingStore(async () => {
      fetches++;
      const snapshot = [...server];
      if (fetches === 1) await new Promise<void>((r) => { release = r; });
      return snapshot;
    }, () => false);
    const pending = store.refresh();
    // 取得の途中で写真を送った（サーバにもジョブができる）
    server.push({ id: 'new' });
    store.update((items) => [...items, { id: 'new' }]);
    release!();
    await pending;
    await new Promise((r) => setTimeout(r, 0));
    let items: { id: string }[] = [];
    store.update((xs) => { items = xs; return xs; });
    expect(fetches).toBe(2);
    expect(items.map((x) => x.id)).toEqual(['old', 'new']);
  });
});

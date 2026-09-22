// サーバのジョブ一覧を、画面が購読している間だけ定期取得する共通の仕組み（写真の取り込みと探索で共有）
import { useEffect, useSyncExternalStore } from 'react';
import { workspaceGeneration } from './workspace';

export interface PollState<T> { items: T[]; error: string; loaded: boolean }
const ACTIVE_INTERVAL = 3000, IDLE_INTERVAL = 30000;

export function pollingStore<T extends { id: string }>(fetchAll: () => Promise<T[]>, isActive: (item: T) => boolean) {
  let state: PollState<T> = { items: [], error: '', loaded: false };
  const listeners = new Set<() => void>();
  const setState = (patch: Partial<PollState<T>>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let subscribers = 0;
  const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const schedule = () => {
    stop();
    if (!subscribers || (typeof document !== 'undefined' && document.hidden)) return;
    timer = setTimeout(() => void refresh(), state.items.some(isActive) ? ACTIVE_INTERVAL : IDLE_INTERVAL);
  };
  const refresh = async () => {
    const generation = workspaceGeneration();
    try { const items = await fetchAll(); if (generation === workspaceGeneration()) setState({ items, error: '', loaded: true }); }
    catch (e) { if (generation === workspaceGeneration()) setState({ error: (e as Error).message, loaded: true }); }
    schedule();
  };
  // 画面が隠れている間（スマホのロック、他アプリ）は取得を止め、戻った瞬間に取り直す
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden && subscribers) void refresh(); else stop(); });
  return {
    refresh,
    /** 一覧を手元で書き換え、取得の間隔を状態に合わせ直す */
    update(fn: (items: T[]) => T[]) { setState({ items: fn(state.items) }); schedule(); },
    reset() { setState({ items: [], error: '', loaded: false }); },
    /** 一覧を購読する。購読中だけ定期取得が動く */
    use(): PollState<T> {
      useEffect(() => {
        subscribers++;
        void refresh();
        return () => { subscribers--; if (!subscribers) stop(); };
      }, []);
      return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
    },
  };
}

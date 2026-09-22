// サーバとの同期。レコード単位で更新時刻の新しい方を残す。サーバに繋がらなければローカルだけで動く。
import { api, ApiError } from '../api';
import type { UserHorse } from '../core/types';
import { pairKey, type AncestorEdit, type KottaEdit, type MasterEdit, type NicksEdit } from '../core/master-edits';
import { allUserHorses, emptyUserData, normalizeUserData } from './model';
import { workspaceGeneration, setWorkspaceGeneration } from './workspace';
import type { SyncRecord, RecordsResponse } from '../shared/save-data';
export type { SyncRecord } from '../shared/save-data';
import type { Plan, Settings, UserData } from './userdata';
import type { RaceEdit } from '../core/races';

export type SyncState = { status: 'idle' | 'syncing' | 'ok' | 'offline' | 'unauthorized' | 'error'; message?: string; lastSync?: string };

const SINCE_KEY = 'ds2tool.sync.since';
let state: SyncState = { status: 'idle' };
const listeners = new Set<() => void>();
export const getSyncState = () => state;
export const subscribeSync = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
const setState = (s: SyncState) => { state = s; listeners.forEach((l) => l()); };

const queue: SyncRecord[] = [];
let flushing = false;
let requestRefresh = () => {};
export function onSyncConflict(refresh: () => void) { requestRefresh = refresh; }

export function enqueue(records: SyncRecord[]) {
  for (const r of records) {
    const i = queue.findIndex((q) => q.id === r.id);
    if (i >= 0) queue[i] = r; else queue.push(r);
  }
  void flush();
}

async function flush() {
  if (flushing || !queue.length) return;
  flushing = true;
  const batch = queue.splice(0, queue.length);
  const generation = workspaceGeneration();
  try {
    await api('/api/records', { method: 'POST', body: JSON.stringify({ records: batch, generation }) });
    if (generation === workspaceGeneration()) setState({ status: 'ok', lastSync: new Date().toISOString() });
  } catch (e) {
    if (generation === workspaceGeneration()) {
      if (e instanceof ApiError && e.status === 409) { queue.length = 0; requestRefresh(); }
      else queue.unshift(...batch);
      fail(e);
    }
  } finally {
    flushing = false;
    if (queue.length && state.status === 'ok') void flush();
  }
}

function fail(e: unknown) {
  if (e instanceof ApiError && e.status === 401) setState({ status: 'unauthorized', message: '認証が必要です' });
  else if (e instanceof ApiError) setState({ status: 'error', message: e.message });
  else setState({ status: 'offline', message: 'サーバに接続できません（ローカル保存のみ）' });
}

/** ユーザーデータ全体をレコードに分解する */
export function toRecords(d: UserData): SyncRecord[] {
  return [
    ...allUserHorses(d).map((h) => ({ id: h.id, kind: 'horse' as const, data: h, updatedAt: h.updatedAt })),
    ...d.plans.map((p) => ({ id: p.id, kind: 'plan' as const, data: p, updatedAt: p.updatedAt })),
    ...d.masterEdits.map((e) => ({ id: `master:${e.id}`, kind: 'masterEdit' as const, data: e, updatedAt: e.updatedAt })),
    ...d.ancestorEdits.map((e) => ({ id: `ancestor:${e.name}`, kind: 'ancestorEdit' as const, data: e, updatedAt: e.updatedAt })),
    ...d.kottaEdits.map((e) => ({ id: `kotta:${pairKey(e.sire, e.dam)}`, kind: 'kottaEdit' as const, data: e, updatedAt: e.updatedAt })),
    ...d.nicksEdits.map((e) => ({ id: `nicks:${pairKey(e.sire, e.dam)}`, kind: 'nicksEdit' as const, data: e, updatedAt: e.updatedAt })),
    ...d.raceEdits.map((e) => ({ id: `race:${e.id}`, kind: 'raceEdit' as const, data: e, updatedAt: e.updatedAt })),
    { id: 'settings', kind: 'settings' as const, data: d.settings, updatedAt: d.settings.updatedAt ?? '1970-01-01T00:00:00.000Z' },
  ];
}

/** 前後の状態を比べ、変わったレコードだけをキューに入れる */
export function pushDiff(prev: UserData, next: UserData) {
  const before = new Map(toRecords(prev).map((r) => [r.id, r]));
  const out: SyncRecord[] = [];
  for (const r of toRecords(next)) {
    const b = before.get(r.id);
    if (!b || b.updatedAt !== r.updatedAt) out.push(r);
    before.delete(r.id);
  }
  const now = new Date().toISOString();
  for (const [, b] of before) out.push({ id: b.id, kind: b.kind, data: null, updatedAt: now, deleted: true });
  if (out.length) enqueue(out);
}

/** ロード後は世代を切り替えて古い送信待ちを捨てる。 */
export function acceptRecords(local: UserData, res: RecordsResponse): UserData | null {
  if (res.generation < workspaceGeneration()) return null;
  const replace = res.generation !== workspaceGeneration();
  if (replace) { queue.length = 0; local = emptyUserData(); }
  let horses = allUserHorses(local), plans = local.plans.slice(), masterEdits = local.masterEdits.slice(), ancestorEdits = local.ancestorEdits.slice(), kottaEdits = local.kottaEdits.slice(), nicksEdits = local.nicksEdits.slice(), settings = local.settings, changed = replace;
  const raceEdits = local.raceEdits.slice();
  // 父側|母側の組が識別子の表（凝ったペア・ニックス）の取り込み
  const mergePair = <T extends { sire: string; dam: string; updatedAt: string }>(list: T[], r: SyncRecord, prefix: string) => {
    const key = r.id.slice(prefix.length);
    const i = list.findIndex((e) => pairKey(e.sire, e.dam) === key);
    const cur = i >= 0 ? list[i] : null;
    if (cur && cur.updatedAt >= r.updatedAt) return;
    if (r.deleted) { if (cur) { list.splice(i, 1); changed = true; } }
    else { if (i >= 0) list[i] = r.data as T; else list.push(r.data as T); changed = true; }
  };
  for (const r of res.records) {
    if (r.kind === 'horse') {
      const i = horses.findIndex((h) => h.id === r.id);
      const cur = i >= 0 ? horses[i] : null;
      if (cur && cur.updatedAt >= r.updatedAt) continue;
      if (r.deleted) { if (cur) { horses.splice(i, 1); changed = true; } }
      else { if (i >= 0) horses[i] = r.data as UserHorse; else horses.push(r.data as UserHorse); changed = true; }
    } else if (r.kind === 'plan') {
      const i = plans.findIndex((p) => p.id === r.id);
      const cur = i >= 0 ? plans[i] : null;
      if (cur && cur.updatedAt >= r.updatedAt) continue;
      if (r.deleted) { if (cur) { plans.splice(i, 1); changed = true; } }
      else { if (i >= 0) plans[i] = r.data as Plan; else plans.push(r.data as Plan); changed = true; }
    } else if (r.kind === 'masterEdit') {
      const id = r.id.replace(/^master:/, '');
      const i = masterEdits.findIndex((e) => e.id === id);
      const cur = i >= 0 ? masterEdits[i] : null;
      if (cur && cur.updatedAt >= r.updatedAt) continue;
      if (r.deleted) { if (cur) { masterEdits.splice(i, 1); changed = true; } }
      else { if (i >= 0) masterEdits[i] = r.data as MasterEdit; else masterEdits.push(r.data as MasterEdit); changed = true; }
    } else if (r.kind === 'raceEdit') {
      const id = r.id.slice('race:'.length);
      const i = raceEdits.findIndex((e) => e.id === id);
      const cur = i >= 0 ? raceEdits[i] : null;
      if (cur && cur.updatedAt >= r.updatedAt) continue;
      if (r.deleted) { if (cur) { raceEdits.splice(i, 1); changed = true; } }
      else { if (i >= 0) raceEdits[i] = r.data as RaceEdit; else raceEdits.push(r.data as RaceEdit); changed = true; }
    } else if (r.kind === 'ancestorEdit') {
      const name = r.id.replace(/^ancestor:/, '');
      const i = ancestorEdits.findIndex((e) => e.name === name);
      const cur = i >= 0 ? ancestorEdits[i] : null;
      if (cur && cur.updatedAt >= r.updatedAt) continue;
      if (r.deleted) { if (cur) { ancestorEdits.splice(i, 1); changed = true; } }
      else { if (i >= 0) ancestorEdits[i] = r.data as AncestorEdit; else ancestorEdits.push(r.data as AncestorEdit); changed = true; }
    } else if (r.kind === 'kottaEdit') mergePair<KottaEdit>(kottaEdits, r, 'kotta:');
    else if (r.kind === 'nicksEdit') mergePair<NicksEdit>(nicksEdits, r, 'nicks:');
    else if (r.kind === 'settings' && !r.deleted) {
      if ((settings.updatedAt ?? '') < r.updatedAt) { settings = r.data as Settings; changed = true; }
    }
  }
  setWorkspaceGeneration(res.generation);
  localStorage.setItem(SINCE_KEY, res.latest);
  setState({ status: 'ok', lastSync: res.serverTime });
  return changed ? normalizeUserData({ ...local, horses: horses.filter((h) => h.kind === 'owned'), plannedHorses: horses.filter((h) => h.kind === 'planned'), plans, masterEdits, ancestorEdits, kottaEdits, nicksEdits, raceEdits, settings }) : null;
}

/** 応答が届くまでに行われた編集も含めて比較し、古い取得結果で上書きしない。 */
export async function pull(current: () => UserData, full = false): Promise<UserData | null> {
  const since = full ? '' : localStorage.getItem(SINCE_KEY) ?? '';
  setState({ ...state, status: 'syncing' });
  try {
    const params = new URLSearchParams({ generation: String(workspaceGeneration()) });
    if (since) params.set('since', since);
    const res = await api<RecordsResponse>('/api/records?' + params);
    return acceptRecords(current(), res);
  } catch (e) { fail(e); return null; }
}

/** ローカルの全レコードを送信キューに入れる。 */
export function pushAll(d: UserData) { enqueue(toRecords(d)); }

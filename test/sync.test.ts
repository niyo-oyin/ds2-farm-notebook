import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyUserData, normalizeUserData } from '../src/store/model';
import { memoryStorage, owned, planned, plan, timestamp } from './horse-fixtures';
import { api } from '../src/api';
import { pull, toRecords } from '../src/store/sync';
import { userDataFromRecords } from '../server/user-data';

vi.mock('../src/api', async (original) => ({ ...await original<typeof import('../src/api')>(), api: vi.fn() }));
const mockedApi = vi.mocked(api);
const response = (records: unknown[]) => ({ records, generation: 0, replace: false, latest: timestamp, serverTime: timestamp });

describe('所有馬と計画馬の同期', () => {
  beforeEach(() => { mockedApi.mockReset(); vi.stubGlobal('localStorage', memoryStorage()); });

  it('レースの追加・修正を端末とサーバで復元し、削除差分も反映する', async () => {
    const data = { ...emptyUserData(), raceEdits: [
      { id: 'rc:img-1-1', added: false, data: { distance: 2000 }, updatedAt: timestamp },
      { id: 'rc:u:1', added: true, data: { name: '3歳未勝利' }, updatedAt: timestamp },
    ] };
    const records = toRecords(data);
    expect(userDataFromRecords(records).raceEdits).toEqual(data.raceEdits);
    mockedApi.mockResolvedValueOnce(response(records));
    const synced = await pull(() => emptyUserData(), true);
    expect(synced?.raceEdits).toEqual(data.raceEdits);
    mockedApi.mockResolvedValueOnce(response([{ id: 'race:rc:u:1', kind: 'raceEdit', deleted: true, data: null, updatedAt: '2025-02-01' }]));
    const removed = await pull(() => synced!);
    expect(removed?.raceEdits).toEqual([data.raceEdits[0]]);
  });

  it('両区分と複数の紐付けを往復しても所有馬に計画馬が混ざらない', async () => {
    const data = { ...emptyUserData(), horses: [owned('u:1'), owned('u:2')], plannedHorses: [planned('p:1', { realizedIds: ['u:1', 'u:2'] }), planned('p:2', { realizedIds: ['u:1'] })], plans: [plan('plan:1', ['p:1', 'p:2'])] };
    mockedApi.mockResolvedValueOnce(response(toRecords(data)));
    const pulled = await pull(() => emptyUserData(), true);
    expect(pulled?.horses).toEqual(normalizeUserData(data).horses);
    expect(pulled?.plannedHorses).toEqual(data.plannedHorses);
  });

  it('計画馬の削除差分を取り込み、ローカルの別配列から復活させない', async () => {
    const local = { ...emptyUserData(), horses: [owned('u:1')], plannedHorses: [planned('p:1')] };
    mockedApi.mockResolvedValueOnce(response([{ id: 'p:1', kind: 'horse', deleted: true, updatedAt: '2025-02-01', data: null }]));
    const pulled = await pull(() => local);
    expect(pulled?.horses).toEqual(normalizeUserData(local).horses);
    expect(pulled?.plannedHorses).toEqual([]);
  });
});

describe('ロードと同期の競合', () => {
  beforeEach(() => { vi.resetModules(); mockedApi.mockReset(); vi.stubGlobal('localStorage', memoryStorage()); });

  it('別端末のロードでは新しい時刻のローカル編集も捨て、後から届いた古い取得結果を無視する', async () => {
    const sync = await import('../src/store/sync');
    const local = { ...emptyUserData(), horses: [owned('u:old', { updatedAt: '2099-01-01' })], settings: { rules: {}, gameYear: 40, updatedAt: '2099-01-01' } };
    const saved = { ...emptyUserData(), horses: [owned('u:saved')], settings: { rules: {}, gameYear: 28, updatedAt: timestamp } };
    mockedApi.mockResolvedValueOnce({ ...response(toRecords(saved)), generation: 1, replace: true });
    const restored = await sync.pull(() => local);
    expect(restored?.horses.map((h) => h.id)).toEqual(['u:saved']);
    expect(restored?.settings.gameYear).toBe(28);
    expect(sync.acceptRecords(restored!, response(toRecords(local)))).toBeNull();
  });

  it('別タブの保存で共有キャッシュが更新されても、古いタブの状態を新世代として送らない', async () => {
    const workspace = await import('../src/store/workspace');
    const sync = await import('../src/store/sync');
    expect(workspace.workspaceGeneration()).toBe(0);
    localStorage.setItem(workspace.USER_DATA_KEY, JSON.stringify({ ...emptyUserData(), syncGeneration: 1 }));
    mockedApi.mockResolvedValue({ applied: 1 });
    sync.pushAll({ ...emptyUserData(), horses: [owned('u:stale-tab')] });
    await Promise.resolve();
    expect(JSON.parse(mockedApi.mock.calls[0][1]!.body as string).generation).toBe(0);
  });

  it('ロード前の送信が遅れて失敗しても、その内容を再送しない', async () => {
    const sync = await import('../src/store/sync');
    const pending = Promise.withResolvers<unknown>();
    mockedApi.mockReturnValueOnce(pending.promise);
    sync.pushAll({ ...emptyUserData(), horses: [owned('u:before')] });
    const restored = sync.acceptRecords(emptyUserData(), { ...response(toRecords({ ...emptyUserData(), horses: [owned('u:saved')] })), generation: 1, replace: true })!;
    pending.reject(new Error('late network failure'));
    await pending.promise.catch(() => {});
    mockedApi.mockResolvedValue({ applied: 1 });
    sync.pushAll(restored);
    await Promise.resolve();
    const sent = mockedApi.mock.calls.filter(([path]) => path === '/api/records').map(([, init]) => JSON.parse(init!.body as string));
    expect(sent).toHaveLength(2);
    expect(sent[1].generation).toBe(1);
    expect(sent[1].records.some((r: { id: string }) => r.id === 'u:before')).toBe(false);
  });

  it('取得中に入力した変更は古い応答で消さず、全件同期でも削除差分を処理する', async () => {
    const sync = await import('../src/store/sync');
    const pending = Promise.withResolvers<unknown>();
    let current = { ...emptyUserData(), horses: [owned('u:1'), owned('u:deleted')] };
    mockedApi.mockReturnValueOnce(pending.promise);
    const reading = sync.pull(() => current, true);
    current = { ...current, horses: [owned('u:1', { name: '取得中の編集', updatedAt: '2026-01-01' }), owned('u:deleted')] };
    pending.resolve(response([{ id: 'u:1', kind: 'horse', data: owned('u:1'), updatedAt: timestamp }, { id: 'u:deleted', kind: 'horse', data: null, updatedAt: '2025-02-01', deleted: true }]));
    const result = await reading;
    expect(result?.horses.map((h) => h.name)).toEqual(['取得中の編集']);
  });
});

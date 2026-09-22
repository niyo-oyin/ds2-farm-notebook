import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SaveDataStore, saveDataRoutes } from '../server/save-data';
import { ImageStore } from '../server/images';
import { JobQueue } from '../server/jobs';
import { emptyUserData, type UserData } from '../src/store/model';
import { toRecords } from '../src/store/sync';
import { owned, planned, plan, timestamp } from './horse-fixtures';
import type { RecordsResponse, SaveSlot } from '../src/shared/save-data';

describe('サーバのセーブ・ロード', () => {
  let dir: string, db: DatabaseSync, images: ImageStore, store: SaveDataStore, app: ReturnType<typeof saveDataRoutes>;
  const original = (): UserData => ({
    ...emptyUserData(), horses: [owned('u:mare', { name: '試行前の牝馬' })], plannedHorses: [planned('p:foal', { realizedIds: ['u:mare'] })], plans: [plan('plan:1', ['p:foal'])],
    masterEdits: [{ id: 'st:1', kind: 'stallion', added: false, data: { name: '訂正した種牡馬' }, updatedAt: timestamp }],
    ancestorEdits: [{ name: '祖先A', system: 1, sex: 'M' as const, effects: ['速力'], updatedAt: timestamp }],
    kottaEdits: [{ sire: '父A', dam: '母A', active: true, source: '実機確認', note: '', updatedAt: timestamp }],
    nicksEdits: [{ sire: '父系統', dam: '母系統', level: 2, source: '実機確認', note: '', updatedAt: timestamp }],
    raceEdits: [{ id: 'rc:img-1-1', added: false, data: { month: 1, distance: 2000 }, updatedAt: timestamp }],
    settings: { rules: { omoshiroThreshold: 6 }, gameYear: 28, importAutoApply: true, updatedAt: timestamp,
      farm: { name: 'あおい牧場', separateBySex: true, commonAffix: { text: 'アオイ', position: 'prefix' }, maleAffix: { text: 'アオイ', position: 'prefix' }, femaleAffix: { text: 'ヒメ', position: 'suffix' } },
    },
  });
  const request = (path: string, method: string, body: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const save = async (slot = 1, records = toRecords(original())) => {
    const res = await request(`/saves/${slot}`, 'PUT', { name: '配合前', revision: null, generation: 0, records });
    expect(res.status).toBe(200);
    return (await res.json() as { save: SaveSlot }).save;
  };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ds2-saves-')); db = new DatabaseSync(join(dir, 'test.sqlite'));
    images = new ImageStore(join(dir, 'images')); store = new SaveDataStore(db, images); app = saveDataRoutes(store);
  });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  it('未同期分も含めて保存し、年・紐付け・マスターデータの編集・設定を全件置換で復元する', async () => {
    const before = original(), snapshot = await save(1, toRecords(before));
    expect(snapshot).toMatchObject({ gameYear: 28, horses: 1, plannedHorses: 1, plans: 1 });
    const after = { ...emptyUserData(), horses: [owned('u:extra'), owned('u:mare', { name: '試行後' })], settings: { rules: {}, gameYear: 30 } };
    store.write(0, toRecords(after));
    const res = await request('/saves/1/load', 'POST', { generation: 0, revision: snapshot.revision });
    expect(res.status).toBe(200);
    const restored = await res.json() as RecordsResponse;
    expect(restored).toMatchObject({ generation: 1, replace: true });
    expect(restored.records).toHaveLength(toRecords(before).length);
    for (const record of toRecords(before)) {
      const actual = restored.records.find((r) => r.id === record.id)!;
      expect(actual.data).toEqual({ ...record.data as object, updatedAt: actual.updatedAt });
    }
    expect(restored.records.some((r) => r.id === 'u:extra')).toBe(false);
    expect(store.list()).toEqual([snapshot]);
    expect(store.load(1, 1, snapshot.revision).generation).toBe(2);
  });

  it('ロード前の端末の更新を拒否し、古い差分カーソルでも復元後の全件を返す', async () => {
    const snapshot = await save(); store.load(1, 0, snapshot.revision);
    const stale = toRecords({ ...emptyUserData(), horses: [owned('u:resurrected', { updatedAt: '2099-01-01T00:00:00.000Z' })] });
    expect((await request('/records', 'POST', { generation: 0, records: stale })).status).toBe(409);
    const res = await app.request('/records?generation=0&since=2099-01-01T00:00:00.000Z');
    const data = await res.json() as RecordsResponse;
    expect(data.replace).toBe(true);
    expect(data.records.some((r) => r.id === 'u:mare')).toBe(true);
    expect(data.records.some((r) => r.id === 'u:resurrected')).toBe(false);
    expect((await request('/saves/2', 'PUT', { generation: 0, records: stale, revision: null, name: '古い端末' })).status).toBe(409);
  });

  it('5件を独立して保持し、上書き・削除・再起動後の一覧を扱う', async () => {
    const slots: SaveSlot[] = [];
    for (let i = 1; i <= 5; i++) slots.push(await save(i));
    const sixth = await request('/saves/6', 'PUT', { generation: 0, records: toRecords(original()), revision: null, name: '6件目' });
    expect(sixth.status).toBe(400);
    const body = { generation: 0, records: toRecords(original()), revision: slots[0].revision, name: '別の試行' };
    const updated = await request('/saves/1', 'PUT', body);
    expect(updated.status).toBe(200);
    expect(store.list().slice(1)).toEqual(slots.slice(1));
    expect((await request('/saves/1', 'PUT', body)).status).toBe(409);
    expect((await request('/saves/1/load', 'POST', { generation: 0, revision: slots[0].revision })).status).toBe(409);
    await request('/saves/2', 'DELETE', { revision: slots[1].revision });
    expect(store.list().map((s) => s.slot)).toEqual([1, 3, 4, 5]);
    db.close(); db = new DatabaseSync(join(dir, 'test.sqlite')); store = new SaveDataStore(db, images);
    expect(store.list().map((s) => s.name)).toEqual(['別の試行', '配合前', '配合前', '配合前']);
  });

  it('差し替えた馬の写真を複数のセーブが共有し、ロード後も表示できるように残す', async () => {
    const id = images.save(Buffer.from('test image').toString('base64'), 'image/png')!;
    const records = toRecords({ ...original(), horses: [owned('u:mare', { imageId: id })] });
    const first = await save(1, records), second = await save(2, records);
    store.deleteUnusedImage(id); expect(images.read(id)).not.toBeNull();
    store.remove(1, first.revision); expect(images.read(id)).not.toBeNull();
    store.load(2, 0, second.revision); store.remove(2, second.revision);
    store.deleteUnusedImage(id); expect(images.read(id)).not.toBeNull();
    store.write(1, [{ id: 'u:mare', kind: 'horse', data: owned('u:mare'), updatedAt: '2099-01-01T00:00:00.000Z' }]);
    store.deleteUnusedImage(id); expect(images.read(id)).toBeNull();
  });

  it('壊れたセーブで既存のスロットを失わず、ロードの途中失敗でも現在の状態を保つ', async () => {
    const snapshot = await save();
    const invalid = await request('/saves/1', 'PUT', { generation: 0, revision: snapshot.revision, name: '壊れた写真', records: toRecords({ ...original(), horses: [owned('u:mare', { imageId: 'missing.png' })] }) });
    expect(invalid.status).toBe(409); expect(store.list()).toEqual([snapshot]);
    store.write(0, toRecords({ ...emptyUserData(), horses: [owned('u:current')] }));
    const before = store.records(0).records;
    const failing = new SaveDataStore(db, images, () => { throw new Error('failed'); });
    expect(() => failing.load(1, 0, snapshot.revision)).toThrow('failed');
    expect(failing.generation).toBe(0); expect(failing.records(0).records).toEqual(before);
  });

  it('ロード前の取り込みジョブを除き、遅れて完了した解析結果も戻さない', async () => {
    let complete!: (value: { result: unknown }) => void;
    const queue = new JobQueue(db, () => new Promise((resolve) => { complete = resolve; }));
    const id = images.save(Buffer.from('job image').toString('base64'), 'image/png')!;
    queue.enqueue(id, ['育成馬'], null);
    store = new SaveDataStore(db, images, () => queue.clear()); app = saveDataRoutes(store);
    const snapshot = await save(); store.load(1, 0, snapshot.revision);
    complete({ result: { screen_type: 'その他' } });
    await Promise.resolve();
    expect(queue.list()).toEqual([]); expect(images.read(id)).toBeNull();
  });
});

import { beforeEach, expect, it, vi } from 'vitest';
import type { CardScreen, ImportJob } from '../src/api';
import { memoryStorage, owned, timestamp } from './horse-fixtures';
import { testCatalog } from './setup-catalog';

vi.mock('../src/store/sync', () => ({ pushDiff: vi.fn(), pushAll: vi.fn(), pull: vi.fn().mockResolvedValue(null) }));
vi.mock('../src/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/api')>(),
  fetchImage: vi.fn(), imageToBase64: vi.fn().mockResolvedValue({ image: 'crop', mediaType: 'image/jpeg' }), uploadImage: vi.fn().mockResolvedValue('portrait'),
}));

const reading: CardScreen = { screen_type: '育成馬', notes: '', card: {
  name: '母馬の27', class: '', sex: '牝', age: 1, color: '鹿毛', distance: '', weight: '', stable: '',
  abilities: { speed: '○' }, traits: {}, record: '', earnings_current: '', earnings_total: '', races: [],
  horse_box: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 },
} };
const job: ImportJob = { id: 'job:foal', status: 'done', imageId: 'photo', scope: ['育成馬'], createdAt: timestamp, updatedAt: timestamp, result: reading };

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.stubGlobal('localStorage', memoryStorage());
  (await import('../src/data/catalog')).initializeCatalog(testCatalog);
});

it('画像保存中に手動と自動の反映が重なっても、所有馬と読み取り履歴を一度だけ追加する', async () => {
  const api = await import('../src/api');
  const image = Promise.withResolvers<Blob>();
  vi.mocked(api.fetchImage).mockReturnValue(image.promise);
  const { applyCardJob } = await import('../src/ui/import-apply');
  const { getUserData, store } = await import('../src/store/userdata');
  const first = applyCardJob(job, reading, undefined, true);
  const second = applyCardJob(job, reading, undefined, true);
  expect(getUserData().horses).toHaveLength(0);
  image.resolve(new Blob());
  const [a, b] = await Promise.all([first, second]);
  expect(a.id).toBe(b.id);
  expect(getUserData().horses).toHaveLength(1);
  expect(a.observations).toHaveLength(1);
  expect(api.uploadImage).toHaveBeenCalledTimes(1);

  store.updateHorse(a.id, { name: '命名後の馬', memo: '登録後の追記' });
  vi.resetModules();
  (await import('../src/data/catalog')).initializeCatalog(testCatalog);
  const replay = await (await import('../src/ui/import-apply')).applyCardJob(job, reading, undefined, true);
  expect(replay).toMatchObject({ id: a.id, name: '命名後の馬', memo: '登録後の追記' });
  expect(replay.observations).toHaveLength(1);
});

it('同期前の別画面でも同じジョブは同じ馬として登録し、別ジョブの明示的な新規登録は区別する', async () => {
  const first = await (await import('../src/ui/import-apply')).applyCardJob(job, reading, undefined, false);
  vi.resetModules(); vi.stubGlobal('localStorage', memoryStorage());
  (await import('../src/data/catalog')).initializeCatalog(testCatalog);
  const { applyCardJob } = await import('../src/ui/import-apply');
  const second = await applyCardJob(job, reading, undefined, false);
  const other = await applyCardJob({ ...job, id: 'job:another' }, reading, undefined, false);
  expect(second.id).toBe(first.id);
  expect(other.id).not.toBe(first.id);
});

it('画像保存を待つ間に編集された既存馬の情報を保持し、反映済みのジョブを新規として再登録しない', async () => {
  const api = await import('../src/api');
  const image = Promise.withResolvers<Blob>();
  vi.mocked(api.fetchImage).mockReturnValue(image.promise);
  const { applyCardJob } = await import('../src/ui/import-apply');
  const { store, getUserData } = await import('../src/store/userdata');
  const target = store.addHorse(owned('u:existing', { sex: 'F' }));
  const pending = applyCardJob(job, reading, target, true);
  store.updateHorse(target.id, { profile: { races: [{ race: '新馬', finish: '1' }] } });
  image.resolve(new Blob());
  await pending;
  const saved = await applyCardJob(job, reading, undefined, false);
  expect(saved.id).toBe(target.id);
  expect(saved.profile?.races).toEqual([{ race: '新馬', finish: '1' }]);
  expect(getUserData().horses).toHaveLength(1);
});

it('保存失敗後には再試行でき、セーブロードをまたいだ読み取りは登録しない', async () => {
  const { applyCardJob } = await import('../src/ui/import-apply');
  await expect(applyCardJob(job, { ...reading, card: { ...reading.card, name: '' } }, undefined, false)).rejects.toThrow('馬名');
  const saved = await applyCardJob(job, reading, undefined, false);
  expect(saved.name).toBe(reading.card.name);
  const api = await import('../src/api');
  const image = Promise.withResolvers<Blob>();
  vi.mocked(api.fetchImage).mockReturnValue(image.promise);
  const pending = applyCardJob({ ...job, id: 'job:old' }, reading, undefined, true);
  (await import('../src/store/workspace')).setWorkspaceGeneration(1);
  image.resolve(new Blob());
  await expect(pending).rejects.toThrow('ロード');
  expect((await import('../src/store/userdata')).getUserData().horses).toHaveLength(1);
});

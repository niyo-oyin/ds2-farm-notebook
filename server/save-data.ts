import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { z } from 'zod';
import { SAVE_SLOT_COUNT, type SaveSlot, type SyncRecord, type RecordsResponse } from '../src/shared/save-data.js';
import type { ImageStore } from './images.js';

const recordSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['horse', 'plan', 'settings', 'masterEdit', 'ancestorEdit', 'kottaEdit', 'nicksEdit', 'raceEdit']),
  data: z.unknown(),
  updatedAt: z.iso.datetime(),
  deleted: z.boolean().optional(),
});
const generationSchema = z.number().int().nonnegative();
const revisionSchema = z.string().min(1).nullable();
const writeSchema = z.object({ generation: generationSchema, records: z.array(recordSchema) });
const saveSchema = writeSchema.extend({ name: z.string().trim().min(1).max(80), revision: revisionSchema });
const loadSchema = z.object({ generation: generationSchema, revision: z.string().min(1) });
interface RecordRow { id: string; kind: SyncRecord['kind']; data: string; updated_at: string; deleted: number }
interface SnapshotRow { slot: number; name: string; revision: string; saved_at: string; records: string }
const fromRow = (r: RecordRow): SyncRecord => ({ id: r.id, kind: r.kind, data: JSON.parse(r.data), updatedAt: r.updated_at, deleted: !!r.deleted });
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
const imageIds = (records: SyncRecord[]) => [...new Set(records.filter((r) => !r.deleted && r.kind === 'horse').map((r) => object(r.data).imageId).filter((id): id is string => typeof id === 'string' && !!id))];

class DataError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) { super(message); }
}

/** 同期中の状態と、独立した5件のセーブ。ロードは世代の切り替えと全件置換を同じトランザクションで行う。 */
export class SaveDataStore {
  constructor(private db: DatabaseSync, private images: ImageStore, private discardJobs: () => string[] = () => []) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, owner TEXT NOT NULL DEFAULT 'local',
        data TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS records_owner_updated ON records(owner, updated_at);
      CREATE TABLE IF NOT EXISTS workspace_state (id INTEGER PRIMARY KEY CHECK(id = 1), generation INTEGER NOT NULL);
      INSERT OR IGNORE INTO workspace_state VALUES (1, 0);
      CREATE TABLE IF NOT EXISTS save_slots (
        slot INTEGER PRIMARY KEY CHECK(slot BETWEEN 1 AND ${SAVE_SLOT_COUNT}),
        name TEXT NOT NULL, revision TEXT NOT NULL, saved_at TEXT NOT NULL, records TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS save_images (slot INTEGER NOT NULL, image_id TEXT NOT NULL, PRIMARY KEY(slot, image_id));
    `);
  }
  get generation() { return (this.db.prepare('SELECT generation FROM workspace_state WHERE id = 1').get() as { generation: number }).generation; }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = run(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  private checkGeneration(generation: number) {
    if (generation !== this.generation) throw new DataError('別の端末でセーブデータがロードされました。同期してからやり直してください。', 409);
  }
  private checkSlot(slot: number, revision: string | null) {
    if (!Number.isInteger(slot) || slot < 1 || slot > SAVE_SLOT_COUNT) throw new DataError('セーブ先が不正です。', 400);
    const current = this.db.prepare('SELECT * FROM save_slots WHERE slot = ?').get(slot) as unknown as SnapshotRow | undefined;
    if ((current?.revision ?? null) !== revision) throw new DataError('このセーブデータは更新されています。一覧を更新してください。', 409);
    return current;
  }
  records(generation: number, since?: string): RecordsResponse {
    const replace = generation !== this.generation;
    const rows = (since && !replace
      ? this.db.prepare('SELECT * FROM records WHERE owner = ? AND updated_at > ? ORDER BY updated_at').all('local', since)
      : this.db.prepare('SELECT * FROM records WHERE owner = ? ORDER BY updated_at').all('local')) as unknown as RecordRow[];
    return { records: rows.map(fromRow), generation: this.generation, replace, latest: rows.at(-1)?.updated_at ?? (replace ? '' : since ?? ''), serverTime: new Date().toISOString() };
  }
  write(generation: number, records: SyncRecord[]) {
    return this.transaction(() => {
      this.checkGeneration(generation);
      const select = this.db.prepare('SELECT updated_at FROM records WHERE id = ?');
      const insert = this.db.prepare('INSERT INTO records (id, kind, data, updated_at, deleted) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, data=excluded.data, updated_at=excluded.updated_at, deleted=excluded.deleted');
      let applied = 0;
      for (const r of records) {
        const current = select.get(r.id) as { updated_at: string } | undefined;
        if (current && current.updated_at >= r.updatedAt) continue;
        insert.run(r.id, r.kind, JSON.stringify(r.data ?? null), r.updatedAt, r.deleted ? 1 : 0); applied++;
      }
      return { applied };
    });
  }
  private summary(row: SnapshotRow): SaveSlot {
    const records = JSON.parse(row.records) as SyncRecord[];
    const year = object(records.find((r) => r.kind === 'settings')?.data).gameYear;
    return {
      slot: row.slot, name: row.name, revision: row.revision, savedAt: row.saved_at, gameYear: typeof year === 'number' ? year : null,
      horses: records.filter((r) => r.kind === 'horse' && object(r.data).kind === 'owned').length,
      plannedHorses: records.filter((r) => r.kind === 'horse' && object(r.data).kind === 'planned').length,
      plans: records.filter((r) => r.kind === 'plan').length,
    };
  }
  list(): SaveSlot[] { return (this.db.prepare('SELECT * FROM save_slots ORDER BY slot').all() as unknown as SnapshotRow[]).map((r) => this.summary(r)); }
  save(slot: number, input: z.infer<typeof saveSchema>): SaveSlot {
    const oldImages = this.savedImages(slot);
    const result = this.transaction(() => {
      this.checkGeneration(input.generation); this.checkSlot(slot, input.revision);
      const records = input.records;
      if (records.some((r) => r.deleted || !r.data || typeof r.data !== 'object') || new Set(records.map((r) => r.id)).size !== records.length || records.filter((r) => r.kind === 'settings' && r.id === 'settings').length !== 1) throw new DataError('セーブするデータの形式が不正です。', 400);
      const ids = imageIds(records);
      if (ids.some((id) => !this.images.read(id))) throw new DataError('馬の画像が見つかりません。画像を確認してからセーブしてください。', 409);
      const row: SnapshotRow = { slot, name: input.name, revision: randomUUID(), saved_at: new Date().toISOString(), records: JSON.stringify(records) };
      this.db.prepare('INSERT INTO save_slots VALUES (?, ?, ?, ?, ?) ON CONFLICT(slot) DO UPDATE SET name=excluded.name, revision=excluded.revision, saved_at=excluded.saved_at, records=excluded.records').run(slot, row.name, row.revision, row.saved_at, row.records);
      this.db.prepare('DELETE FROM save_images WHERE slot = ?').run(slot);
      const addImage = this.db.prepare('INSERT INTO save_images VALUES (?, ?)');
      for (const id of ids) addImage.run(slot, id);
      return this.summary(row);
    });
    for (const id of oldImages) this.deleteUnusedImage(id);
    return result;
  }
  load(slot: number, generation: number, revision: string): RecordsResponse {
    const oldImages = imageIds(this.records(this.generation).records);
    let jobImages: string[] = [];
    const result = this.transaction(() => {
      this.checkGeneration(generation);
      const row = this.checkSlot(slot, revision);
      if (!row) throw new DataError('セーブデータがありません。', 404);
      const records = JSON.parse(row.records) as SyncRecord[];
      if (imageIds(records).some((id) => !this.images.read(id))) throw new DataError('セーブデータの画像が見つかりません。', 409);
      const time = new Date().toISOString();
      this.db.exec('DELETE FROM records');
      const insert = this.db.prepare('INSERT INTO records (id, kind, data, updated_at) VALUES (?, ?, ?, ?)');
      for (const r of records) insert.run(r.id, r.kind, JSON.stringify({ ...object(r.data), updatedAt: time }), time);
      this.db.exec('UPDATE workspace_state SET generation = generation + 1 WHERE id = 1');
      jobImages = this.discardJobs();
      return this.records(generation);
    });
    for (const id of [...oldImages, ...jobImages]) this.deleteUnusedImage(id);
    return result;
  }
  remove(slot: number, revision: string) {
    const ids = this.savedImages(slot);
    this.transaction(() => {
      this.checkSlot(slot, revision);
      this.db.prepare('DELETE FROM save_slots WHERE slot = ?').run(slot);
      this.db.prepare('DELETE FROM save_images WHERE slot = ?').run(slot);
    });
    for (const id of ids) this.deleteUnusedImage(id);
  }
  private savedImages(slot: number) { return (this.db.prepare('SELECT image_id FROM save_images WHERE slot = ?').all(slot) as { image_id: string }[]).map((r) => r.image_id); }
  /** セーブや現在の馬が参照している画像は、写真の差し替え・削除後も残す。 */
  deleteUnusedImage(id: string) {
    if (this.db.prepare('SELECT 1 FROM save_images WHERE image_id = ? LIMIT 1').get(id)) return;
    if (imageIds(this.records(this.generation).records).includes(id)) return;
    this.images.delete(id);
  }
}

export function saveDataRoutes(store: SaveDataStore) {
  const app = new Hono();
  app.onError((e, c) => {
    if (e instanceof DataError) return c.json({ error: e.message }, e.status);
    if (e instanceof z.ZodError || e instanceof SyntaxError) return c.json({ error: 'リクエストの形式が不正です。' }, 400);
    throw e;
  });
  app.get('/records', (c) => c.json(store.records(generationSchema.parse(Number(c.req.query('generation'))), c.req.query('since'))));
  app.post('/records', async (c) => { const body = writeSchema.parse(await c.req.json()); return c.json(store.write(body.generation, body.records)); });
  app.get('/saves', (c) => c.json({ slots: store.list(), limit: SAVE_SLOT_COUNT }));
  app.put('/saves/:slot', async (c) => c.json({ save: store.save(Number(c.req.param('slot')), saveSchema.parse(await c.req.json())) }));
  app.post('/saves/:slot/load', async (c) => { const b = loadSchema.parse(await c.req.json()); return c.json(store.load(Number(c.req.param('slot')), b.generation, b.revision)); });
  app.delete('/saves/:slot', async (c) => { const b = z.object({ revision: z.string().min(1) }).parse(await c.req.json()); store.remove(Number(c.req.param('slot')), b.revision); return c.json({ ok: true }); });
  return app;
}

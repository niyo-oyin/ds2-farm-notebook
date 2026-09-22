import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import type { MasterCatalog } from '../src/shared/master-catalog.js';

/** サーバー稼働中は、画面への配信と探索に同じスナップショットを使う。 */
export function loadMasterCatalog(path: string | URL = new URL('../data/data.json', import.meta.url)): MasterCatalog {
  const bytes = readFileSync(path);
  return { revision: createHash('sha256').update(bytes).digest('hex'), data: JSON.parse(bytes.toString('utf8')) };
}

export function masterCatalogRoutes(catalog: MasterCatalog) {
  return new Hono().get('/master', c => {
    c.header('Cache-Control', 'no-store');
    return c.json(catalog);
  });
}

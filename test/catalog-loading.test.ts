import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMasterCatalog, masterCatalogRoutes } from '../server/master-catalog';

it('サーバー稼働中は読み込んだマスターを配信し、再起動後は版名が同じでも内容の変更を識別する', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds2-catalog-')), path = join(dir, 'data.json');
  const data = { master: { meta: { dataVersion: 'test' }, stallions: [], broodmares: [], ancestors: [], kotta: [], nicks: [] }, races: [], searchAliases: [] };
  try {
    writeFileSync(path, JSON.stringify(data));
    const original = loadMasterCatalog(path), app = masterCatalogRoutes(original);
    const updated = { ...data, searchAliases: [['試験馬', 'テストウマ']] };
    writeFileSync(path, JSON.stringify(updated));
    const oldResponse = await app.request('/master');
    expect(oldResponse.headers.get('cache-control')).toBe('no-store');
    expect(await oldResponse.json()).toEqual(original);
    const current = loadMasterCatalog(path);
    const newResponse = await masterCatalogRoutes(current).request('/master');
    expect(await newResponse.json()).toEqual({ revision: current.revision, data: updated });
    expect(current.revision).not.toBe(original.revision);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

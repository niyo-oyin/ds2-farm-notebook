import type { MasterCatalog } from '../shared/master-catalog';

let catalog: MasterCatalog | undefined;

/** 画面の起動前にサーバーから取得したマスターを設定する。 */
export function initializeCatalog(value: MasterCatalog) { catalog = value; }

export function getCatalog(): MasterCatalog {
  if (!catalog) throw new Error('マスターデータが読み込まれていません');
  return catalog;
}

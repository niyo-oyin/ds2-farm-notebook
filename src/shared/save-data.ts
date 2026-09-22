/** サーバ保存・同期で共有する通信形式。UI やブラウザの保存処理には依存しない。 */
export interface SyncRecord {
  id: string;
  kind: 'horse' | 'plan' | 'settings' | 'masterEdit' | 'ancestorEdit' | 'kottaEdit' | 'nicksEdit' | 'raceEdit';
  data: unknown;
  updatedAt: string;
  deleted?: boolean;
}
export interface RecordsResponse {
  records: SyncRecord[];
  generation: number;
  replace: boolean;
  latest: string;
  serverTime: string;
}
export const SAVE_SLOT_COUNT = 5;
export interface SaveSlot {
  slot: number;
  name: string;
  revision: string;
  savedAt: string;
  gameYear: number | null;
  horses: number;
  plannedHorses: number;
  plans: number;
}

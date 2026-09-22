// 同期レコードの全件からユーザーデータを組み立てる（探索ジョブがサーバ側で判定の材料を作るため）
import type { SyncRecord } from '../src/shared/save-data.js';
import { normalizeUserData, type UserData } from '../src/store/model.js';
import type { UserHorse } from '../src/core/types.js';

export function userDataFromRecords(records: SyncRecord[]): UserData {
  const live = records.filter((r) => !r.deleted);
  const of = <T,>(kind: SyncRecord['kind']): T[] => live.filter((r) => r.kind === kind).map((r) => r.data as T);
  const horses = of<UserHorse>('horse');
  return normalizeUserData({
    version: 2,
    horses: horses.filter((h) => h.kind === 'owned'),
    plannedHorses: horses.filter((h) => h.kind === 'planned'),
    plans: of('plan'), masterEdits: of('masterEdit'), ancestorEdits: of('ancestorEdit'), kottaEdits: of('kottaEdit'), nicksEdits: of('nicksEdit'), raceEdits: of('raceEdit'),
    settings: live.find((r) => r.kind === 'settings')?.data ?? { rules: {} },
  });
}

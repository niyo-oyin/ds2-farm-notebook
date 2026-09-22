import type { MasterData } from '../core/types';
import type { Race } from '../core/races';

export interface MasterCatalog {
  revision: string;
  data: { master: MasterData; races: Race[]; searchAliases: string[][] };
}

export const MASTER_CHANGED_MESSAGE = 'マスターデータが更新されています。画面を再読み込みしてから探索してください。';

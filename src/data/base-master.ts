// 利用者の追加・修正を適用する前のマスターデータ。
import data from '../../data/data.json';
import type { MasterData } from '../core/types';
export const baseMaster = data.master as unknown as MasterData;

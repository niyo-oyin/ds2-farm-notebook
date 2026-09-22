import type { MasterHorse } from './types';

/** 毎回の種付料と区別して表示する解禁条件。金額の単位は万円。 */
export function horseUnlockConditions(horse: Pick<MasterHorse, 'unlock' | 'breedingRightPrice'>): string[] {
  const conditions = horse.unlock ? [horse.unlock] : [];
  if (horse.breedingRightPrice != null) {
    const price = horse.breedingRightPrice;
    const oku = Math.floor(price / 10000), man = price % 10000;
    const amount = `${oku ? `${oku.toLocaleString('ja-JP')}億` : ''}${man || !oku ? `${man.toLocaleString('ja-JP')}万` : ''}円`;
    conditions.push(`種付け権の購入：${amount}`);
  }
  return conditions;
}

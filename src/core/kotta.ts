import type { MasterData, UserHorse } from './types';

export type KottaParents = Map<string, [string, string]>;
const MALE_SLOTS = [2, 4, 6, 8, 10, 12, 14];
const BRANCHES = [[2, 4, 8], [10], [6, 12], [14]];

/** 同じIDの祖先に異なる親が登録されている場合、その親リンクは判定に使わない。 */
export function kottaParents(master: MasterData, horses: UserHorse[] = []): KottaParents {
  const parents: KottaParents = new Map();
  const conflicts = new Set<string>();
  const add = (key: string, sire: string, dam: string) => {
    if (!key || conflicts.has(key)) return;
    const previous = parents.get(key);
    if (previous && ((previous[0] && sire && previous[0] !== sire) || (previous[1] && dam && previous[1] !== dam))) {
      parents.delete(key); conflicts.add(key); return;
    }
    parents.set(key, [sire || previous?.[0] || '', dam || previous?.[1] || '']);
  };
  const masterHorses = [...master.stallions, ...master.broodmares];
  for (const ancestor of master.ancestors) {
    if (ancestor.sireId || ancestor.damId) add(ancestor.id, ancestor.sireId ?? '', ancestor.damId ?? '');
  }
  for (const horse of masterHorses) {
    const nodes = ['', horse.id, ...horse.ancestors];
    for (let n = 1; n < 16; n++) add(nodes[n], nodes[2 * n] ?? '', nodes[2 * n + 1] ?? '');
  }
  for (const horse of horses) if (horse.kind !== 'owned' || !horse.masterKey) add(horse.id, horse.sireKey, horse.damKey);
  return parents;
}

export interface KottaProfile {
  branches: string[][];
  ancestors: Set<string>;
  complete: boolean;
}

/** 比較対象自身は含めず、その3代血統の牡馬7枠を4本の父系に分ける。 */
export function kottaProfile(key: string, parents: KottaParents): KottaProfile {
  const nodes = Array<string>(16).fill('');
  nodes[1] = key;
  for (let n = 1; n < 8; n++) {
    const p = parents.get(nodes[n]);
    if (p) [nodes[n * 2], nodes[n * 2 + 1]] = p;
  }
  return {
    branches: BRANCHES.map(branch => branch.map(n => nodes[n])),
    ancestors: new Set(MALE_SLOTS.map(n => nodes[n]).filter(Boolean)),
    complete: MALE_SLOTS.every(n => !!nodes[n]),
  };
}

/** 父側の各枝を最大1本と数える。同じ祖先が別枝に現れる場合は別々に数える。 */
export function compareKottaProfiles(sire: KottaProfile, dam: KottaProfile, effects: (key: string) => readonly string[] | undefined): { pair: boolean; complete: boolean; crosses: string[] } {
  const crosses: string[] = [];
  let complete = sire.complete && dam.complete;
  for (const branch of sire.branches) {
    for (const key of branch) {
      if (!key || !dam.ancestors.has(key)) continue;
      const e = effects(key);
      if (!e) complete = false;
      if (e?.length) { crosses.push(key); break; }
    }
  }
  return { pair: crosses.length >= 3, complete, crosses };
}

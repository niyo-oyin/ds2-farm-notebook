import type { NamingParent, NamingPedigree } from '../shared/horse-names';
import { foalNodes, nameOfKey, nodePath, unknownRecord, type HorseResolver } from './pedigree';
import type { MasterData, Sex } from './types';

/** 親の参照先を優先し、仮名から取り出した母名は一致する登録馬が一頭の場合だけ解決する。 */
function resolveParentKey(key: string, resolver: HorseResolver, master: MasterData, sex: Sex, inferredName = ''): string {
  if (!key && inferredName) {
    const normalize = (name: string) => name.normalize('NFKC').trim();
    const matches = [...master.stallions, ...master.broodmares, ...resolver.allUsers()]
      .filter(h => h.sex === sex && normalize(h.name) === normalize(inferredName));
    if (matches.length === 1) key = matches[0].id;
  }
  return key;
}

export function namingParent(key: string, resolver: HorseResolver, master: MasterData, sex: Sex, inferredName = ''): NamingParent {
  key = resolveParentKey(key, resolver, master, sex, inferredName);
  const real = resolver.master(key);
  if (real) return { origin: 'real', name: real.name, color: real.color ?? '', pedigree: { sire: real.ancestors[0] ?? '', dam: real.ancestors[1] ?? '' } };
  const own = resolver.user(key);
  if (own?.kind === 'owned') {
    const profile = own.profile;
    return {
      origin: 'homebred', name: own.name, color: profile?.color ?? '',
      pedigree: { sire: resolver.label(own.sireKey), dam: resolver.label(own.damKey) },
      career: {
        record: profile?.record ?? '', wins: profile?.wins ?? '', earnings: profile?.earnings ?? null,
        races: (profile?.races ?? []).map(r => ({ date: r.date, race: r.race, place: r.place, finish: r.finish, grade: r.grade ?? '', surface: r.surface ?? '', distance: r.distance ?? null })),
      },
      abilities: Object.fromEntries(Object.entries(own.abilities?.race ?? {}).filter(([, value]) => value && value !== '-')),
      factors: own.effects ?? [], memo: own.memo ?? '',
    };
  }
  return { origin: 'unknown', name: own?.name ?? nameOfKey(key) ?? inferredName };
}

/** 命名する産駒から見た3代血統。重複する祖先も血統上の位置ごとに残す。 */
export function namingPedigree(sireKey: string, damKey: string, resolver: HorseResolver, master: MasterData, inferredDamName = ''): NamingPedigree {
  damKey = resolveParentKey(damKey, resolver, master, 'F', inferredDamName);
  const sire = resolver.get(sireKey), dam = resolver.get(damKey);
  const nodes = foalNodes(sire ?? unknownRecord(), dam ?? unknownRecord());
  return nodes.slice(2, 16).flatMap((key, i) => {
    if (!key) return i === 1 && inferredDamName ? [{ position: '母', name: inferredDamName, origin: 'unknown' as const }] : [];
    const origin = nameOfKey(key) !== null ? 'real' : resolver.user(key)?.kind === 'owned' ? 'homebred' : 'unknown';
    return [{ position: nodePath(i + 2), name: resolver.label(key), origin }];
  });
}

import type { MasterData } from '../core/types';
import { horseIdentities } from '../core/horse-identity';
import type { HorseOption } from './app-context';

export function ancestorOptions(master: MasterData): HorseOption[] {
  const identities = horseIdentities(master);
  const names = new Map<string, number>();
  for (const h of identities.values()) names.set(h.name, (names.get(h.name) ?? 0) + 1);
  const horses = new Map([...master.stallions, ...master.broodmares].map(h => [h.id, h]));
  return [...identities.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja')).map(h => {
    const horse = horses.get(h.id);
    const parents = horse?.ancestors.slice(0, 2).map(id => identities.get(id)?.name ?? '不明').join(' × ');
    return { key: h.id, name: h.name, group: '祖先', sub: [h.sex === 'M' ? '牡' : h.sex === 'F' ? '牝' : '', parents, (names.get(h.name) ?? 0) > 1 ? h.id : ''].filter(Boolean).join(' · ') };
  });
}

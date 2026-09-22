import type { OwnedHorse } from './types';
import type { HorseResolver } from './pedigree';
import { nodePath } from './pedigree';
import type { StoryFacts } from '../shared/horse-story';
import { horseAge, isUnnamedHorse } from './owned-horse';

export function canReadHorseStory(horse: OwnedHorse, gameYear?: number): boolean {
  if (isUnnamedHorse(horse.name)) return false;
  const age = horseAge(horse.profile?.birthYear, gameYear) ?? horse.observations?.findLast(o => o.age !== undefined)?.age;
  if (age === undefined || age < 3) return false;
  const starts = horse.profile?.record?.normalize('NFKC').match(/(\d+)\s*戦/);
  return !!(starts && Number(starts[1]) > 0) || !!horse.profile?.races?.some(r => /^(?:[1-9]\d*(?:着)?(?:\s*\(同着\))?|(?:競走)?中止|失格)$/.test(r.finish.normalize('NFKC').trim()));
}

const ABILITY_LABELS: Record<string, string> = {
  speed: 'スピード', stamina: 'スタミナ', power: 'パワー', guts: '根性', temperament: '気性', turf: '芝', dirt: 'ダート', distance: '距離適性',
  growth: '成長', start: 'スタート', corner: 'コーナー', heavyTrack: '重馬場', roughTrack: '荒れ馬場', fastTrack: '高速馬場', health: '体質', legs: '脚元', concentration: '集中力', timid: 'こわがり', soundReaction: '音反応', reaction: '反応',
};

/** 記事に渡すのは対象馬と父母の情報だけ。保存済みの記事や他の所有馬は含めない。 */
export function storyFacts(horse: OwnedHorse, resolver: HorseResolver, horses: OwnedHorse[]): StoryFacts {
  const profile = horse.profile;
  const record = resolver.get(horse.id);
  return {
    horseId: horse.id, name: horse.name, sex: horse.sex === 'M' ? '牡' : horse.sex === 'F' ? '牝' : '', category: horse.category,
    color: profile?.color ?? '', birthYear: profile?.birthYear ?? null, record: profile?.record ?? '', wins: profile?.wins ?? '',
    earnings: profile?.earnings ?? null, stable: profile?.stable ?? '', memo: horse.memo ?? '',
    abilities: Object.entries(horse.abilities?.race ?? {}).filter(([, v]) => v && v !== '-').map(([k, v]) => `${ABILITY_LABELS[k] ?? k}: ${v}`), factors: horse.effects ?? [],
    parents: (['父', '母'] as const).map((role, i) => {
      const key = i ? horse.damKey : horse.sireKey;
      const parent = horses.find(h => h.id === key);
      const resolved = key ? resolver.get(key) : null;
      return { role, name: resolved?.name ?? '', system: resolved?.smallSystem ?? '', record: parent?.profile?.record ?? '', wins: parent?.profile?.wins ?? '', memo: parent?.memo ?? '' };
    }),
    pedigree: record ? record.nodes.slice(2, 16).flatMap((key, i) => key ? [{ position: nodePath(i + 2), name: resolver.label(key) }] : []) : [],
    races: (profile?.races ?? []).map(r => ({ date: r.date, place: r.place, race: r.race, finish: r.finish, grade: r.grade ?? '', surface: r.surface ?? '', distance: r.distance ?? null, going: r.going ?? '' })),
  };
}

export const storyRaceWins = (facts: StoryFacts) => facts.races.filter(r => /^1(?:着)?(?:\s*\(同着\))?$/.test(r.finish.normalize('NFKC').trim()));

import { z } from 'zod';

const text = (max: number) => z.string().max(max);
const race = z.object({ date: text(40), place: text(80), race: text(120), finish: text(40), grade: text(30), surface: text(10), distance: z.number().nonnegative().nullable(), going: text(10) });
export const StoryFactsSchema = z.object({
  horseId: text(100).min(1), name: text(100).min(1), sex: text(10), category: text(30), color: text(30), birthYear: z.number().int().nullable(),
  record: text(100), wins: text(1000), earnings: z.number().nonnegative().nullable(), stable: text(100), memo: text(4000),
  abilities: z.array(text(100)).max(40), factors: z.array(text(30)).max(20),
  parents: z.array(z.object({ role: z.enum(['父', '母']), name: text(100), system: text(100), record: text(100), wins: text(1000), memo: text(2000) })).max(2),
  pedigree: z.array(z.object({ position: text(30), name: text(100) })).max(14), races: z.array(race).max(300),
});
export const StoryRequestSchema = z.object({ facts: StoryFactsSchema, direction: text(1500), tone: z.enum(['documentary', 'lyrical', 'bloodline']) });
export const StoryContentSchema = z.object({
  title: text(70).min(1), subtitle: text(180).min(1), lead: text(600).min(1), signature: text(100).min(1),
  palette: z.enum(['navy', 'forest', 'burgundy']),
  chapters: z.array(z.object({ paragraphs: z.array(text(1200).min(1)).min(1).max(3) })).min(3).max(5),
  closing: text(500).min(1),
});
export type StoryFacts = z.infer<typeof StoryFactsSchema>;
export type StoryRequest = z.infer<typeof StoryRequestSchema>;
export type StoryContent = z.infer<typeof StoryContentSchema>;
export interface HorseStory { id: string; createdAt: string; model: string; request: StoryRequest; content: StoryContent }

import { z } from 'zod';

export const HorseNameSchema = z.string().min(2).max(9).regex(/^[ァ-ヺー]+$/u);
const parentIdentity = { name: z.string().max(100), color: z.string().max(30), pedigree: z.object({ sire: z.string().max(100), dam: z.string().max(100) }) };
export const NamingParentSchema = z.discriminatedUnion('origin', [
  z.object({ origin: z.literal('real'), ...parentIdentity }),
  z.object({
    origin: z.literal('homebred'), ...parentIdentity,
    career: z.object({
      record: z.string().max(100), wins: z.string().max(1000), earnings: z.number().nonnegative().nullable(),
      races: z.array(z.object({
        date: z.string().max(40), race: z.string().max(120), place: z.string().max(80), finish: z.string().max(40),
        grade: z.string().max(30), surface: z.string().max(10), distance: z.number().nonnegative().nullable(),
      })).max(300),
    }),
    abilities: z.record(z.string().max(30), z.string().max(100)), factors: z.array(z.string().max(30)).max(20), memo: z.string().max(4000),
  }),
  z.object({ origin: z.literal('unknown'), name: z.string().max(100) }),
]);
export type NamingParent = z.infer<typeof NamingParentSchema>;
const NamingPedigreeSchema = z.array(z.object({
  position: z.string().regex(/^[父母]{1,3}$/u), name: z.string().min(1).max(100), origin: z.enum(['real', 'homebred', 'unknown']),
})).max(14);
export type NamingPedigree = z.infer<typeof NamingPedigreeSchema>;
export const HorseNameRequestSchema = z.object({
  sire: NamingParentSchema, dam: NamingParentSchema, sex: z.enum(['M', 'F']).nullable(), color: z.string().max(30),
  pedigree: NamingPedigreeSchema,
  farm: z.string().max(100),
  affix: z.object({ text: z.string().max(8).regex(/^[ァ-ヺー]*$/u), position: z.enum(['prefix', 'suffix']) }),
  previous: z.array(HorseNameSchema).max(30),
});
export const HorseNameIdeasSchema = z.object({ candidates: z.array(z.object({ name: HorseNameSchema, meaning: z.string().min(1).max(160) })).length(5) });
export type HorseNameRequest = z.infer<typeof HorseNameRequestSchema>;
export type HorseNameIdeas = z.infer<typeof HorseNameIdeasSchema>;

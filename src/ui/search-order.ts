// 探索画面で共用する並べ替えと起点の既定。
import type { AppCtx } from './app-context';
import { breedingKey, pedigreeIssue } from '../core/owned-horse';
import { recommendedCompare, type Ranked } from '../core/result-order';

export type AttrKey = 'jisseki' | 'antei' | 'konjo' | 'kenko' | 'kisyo';
export const ATTR_LABEL: Record<AttrKey, string> = { jisseki: '実績', antei: '安定', konjo: '底力', kenko: '健康', kisyo: '気性' };
const RANK: Record<string, number> = { A: 3, B: 2, C: 1 };
export type OneGenOrigin = 'mare' | 'stallion';

export type SortKey = 'recommended' | 'cost' | 'matings' | 'cross' | 'nicks' | 'nitroSpeed' | 'nitroStamina' | 'nitroPower' | `effect:${string}` | `attr:${AttrKey}` | 'distLong' | 'distShort' | 'dirt';
export type SortItem = Ranked & { attrs?: Record<string, unknown> };
/** 選んだ並び順で比べ、同じ値はおすすめ順で並べる */
export function sortCompare(sort: SortKey, a: SortItem, b: SortItem, wanted: string[]): number {
  const tie = recommendedCompare(a, b, wanted);
  const rank = (x: SortItem, k: AttrKey) => RANK[String(x.attrs?.[k] ?? '')] ?? 0;
  const dist = (x: SortItem) => (x.attrs?.dist as [number, number] | undefined) ?? [0, 0];
  const dirt = (x: SortItem) => ({ '◎': 3, '○': 2, '◯': 2, '△': 1 } as Record<string, number>)[String(x.attrs?.dirt ?? '')] ?? 0;
  if (sort.startsWith('attr:')) { const k = sort.slice(5) as AttrKey; return rank(b, k) - rank(a, k) || tie; }
  if (sort === 'distLong') return dist(b)[1] - dist(a)[1] || tie;
  if (sort === 'distShort') return dist(a)[0] - dist(b)[0] || tie;
  if (sort === 'dirt') return dirt(b) - dirt(a) || tie;
  switch (sort) {
    case 'recommended': return tie;
    case 'cost': return a.cost - b.cost || tie;
    case 'matings': return (a.matings ?? 0) - (b.matings ?? 0) || tie;
    case 'cross': return b.s.crossCount - a.s.crossCount || tie;
    case 'nicks': return b.s.nicksLevel - a.s.nicksLevel || tie;
    case 'nitroSpeed': return b.s.nitro.speed - a.s.nitro.speed || tie;
    case 'nitroStamina': return b.s.nitro.stamina - a.s.nitro.stamina || tie;
    case 'nitroPower': return b.s.nitro.power - a.s.nitro.power || tie;
    default: { const e = sort.slice(7); return (b.s.effectCounts[e] ?? 0) - (a.s.effectCounts[e] ?? 0) || tie; }
  }
}
/** 探索の起点の既定: 探索から外していない所有の繁殖牝馬・種牡馬 */
export const ownedOrigins = (app: AppCtx, side: OneGenOrigin) => app.data.horses.filter((h) => h.sex === (side === 'mare' ? 'F' : 'M') && h.category === (side === 'mare' ? '繁殖牝馬' : '種牡馬') && !h.excludeFromSearch && !pedigreeIssue(h)).map(breedingKey);

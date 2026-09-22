import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { baseMaster } from '../src/data/base-master';
import type { Verdict } from '../src/core/types';
import { HorseResolver } from '../src/core/pedigree';
import { judge, makeContext } from '../src/core/judge';
import { DEFAULT_RULES } from '../src/core/rules';
import { JudgeView, SummaryStrip } from '../src/ui/JudgeView';

const data = baseMaster;
const resolver = new HorseResolver(data, [], DEFAULT_RULES);
const base = judge(resolver.get(data.stallions[0].id)!, resolver.get(data.broodmares[0].id)!, makeContext(data));

describe('配合判定の表示', () => {
  it('危険な配合も、成立・未確定なら表示し、不成立なら折りたたむ', () => {
    for (const verdict of ['成立', '未確定', '不成立'] as Verdict[]) {
      const j = { ...base, dangerous: { ...base.dangerous, verdict } };
      const html = renderToStaticMarkup(<JudgeView j={j} showSummary={false} section="theories" />);
      expect(html.includes('危険な配合')).toBe(verdict !== '不成立');
    }
  });

  it('見出しに採用されない同時成立の理論もバッジに表示する', () => {
    const j = {
      ...base,
      dangerous: { ...base.dangerous, verdict: '不成立' as const },
      perfectKotta: { ...base.perfectKotta, verdict: '成立' as const, estimated: false },
      perfect: { ...base.perfect, verdict: '成立' as const },
      outbreed: { ...base.outbreed, verdict: '成立' as const },
    };
    const badges = (html: string) => [...html.matchAll(/class="ind [^"]+"[^>]*>(.*?)<\/span>/g)].map((m) => m[1]);
    expect(badges(renderToStaticMarkup(<SummaryStrip j={j} />))).toEqual(expect.arrayContaining(['完璧／凝った', '完璧', 'アウトブリード']));
    const hidden = renderToStaticMarkup(<SummaryStrip j={{ ...j, outbreed: { ...j.outbreed, verdict: '不成立' } }} />);
    expect(badges(hidden)).not.toContain('アウトブリード');
    const unknown = renderToStaticMarkup(<SummaryStrip j={{ ...j, outbreed: { ...j.outbreed, verdict: '未確定' } }} />);
    expect(badges(unknown)).toContain('アウトブリード?');
  });
});

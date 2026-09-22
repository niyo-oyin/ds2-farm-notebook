// 馬のイラストの切り出し矩形。Meta Model API の SAM 3.1 に "horse" を指定して検出し、最大面積の矩形を画像比率で返す。
// 読み取り（LLM）とは別の呼び出しで、並列に実行する。血統画面など馬が写らない画像では null。
import { LLM } from './llm.js';

export interface Box { x0: number; y0: number; x1: number; y1: number }
const SAM_MODEL = process.env.SAM_MODEL ?? 'sam-3.1';
/** SAM は Meta Model API でだけ使える。別の提供元を LLM に使っている場合は切り出しをしない */
export const samReady = () => !!LLM.apiKey && LLM.baseUrl.includes('api.meta.ai');

export async function detectHorseBox(image: string, mediaType: string): Promise<Box | null> {
  if (!samReady()) return null;
  const body = {
    model: SAM_MODEL,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'horse' }, { type: 'input_image', image_url: `data:${mediaType};base64,${image}` }] }],
  };
  const res = await fetch(`${LLM.baseUrl}/responses`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${LLM.apiKey}` }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`SAM API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { output?: { content?: { type: string; text?: string }[] }[] };
  const text = (json.output ?? []).flatMap((o) => o.content ?? []).map((c) => c.text ?? '').join('');
  return largestBox(text);
}

/** SAM の出力テキスト `<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|>` から最大面積の矩形を比率で取り出す */
export function largestBox(text: string): Box | null {
  let best: { area: number; box: Box } | null = null;
  for (const m of text.matchAll(/<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)\|>/g)) {
    const [x1, y1, x2, y2, w, h] = m.slice(1).map(Number);
    if (!w || !h || x2 <= x1 || y2 <= y1) continue;
    const area = (x2 - x1) * (y2 - y1);
    if (!best || area > best.area) best = { area, box: { x0: x1 / w, y0: y1 / h, x1: x2 / w, y1: y2 / h } };
  }
  return best?.box ?? null;
}

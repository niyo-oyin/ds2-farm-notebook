export const LLM = {
  baseUrl: (process.env.LLM_BASE_URL ?? 'https://api.meta.ai/v1').replace(/\/$/, ''),
  apiKey: process.env.LLM_API_KEY ?? '',
  model: process.env.LLM_MODEL ?? 'muse-spark-1.3-contributor',
};
export const llmReady = () => !!LLM.apiKey;

export function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = cleaned.indexOf('{');
  return JSON.parse(cleaned.slice(start >= 0 ? start : 0));
}

export async function chatCompletion(messages: unknown[], schema: { name: string; schema: unknown }, options: { temperature?: number; signal?: AbortSignal; reasoningEffort?: 'low' } = {}): Promise<{ text: string; usage?: unknown; model?: string }> {
  const body = { model: LLM.model, messages, temperature: options.temperature ?? 0, reasoning_effort: options.reasoningEffort, response_format: { type: 'json_schema', json_schema: { name: schema.name, strict: true, schema: schema.schema } } };
  const res = await fetch(`${LLM.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${LLM.apiKey}` },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!res.ok) throw new Error(`LLM API ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string | { type: string; text?: string }[] } }[]; usage?: unknown; model?: string };
  const content = json.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content : (content ?? []).map((p) => p.text ?? '').join('');
  return { text, usage: json.usage, model: json.model };
}


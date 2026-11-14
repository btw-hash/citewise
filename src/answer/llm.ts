import type { Hit } from '../bm25.js';
import type { Answerer, Claim, Draft } from './types.js';

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

const SYSTEM = `You answer questions using ONLY the numbered sources provided.
Reply with JSON: {"answerable": boolean, "claims": [{"text": string, "chunkId": string, "quote": string}]}.
Each claim is one sentence of the answer. "chunkId" is the id of the source that supports it.
"quote" is a verbatim excerpt from that source, copied character for character.
If the sources do not contain the answer, reply {"answerable": false, "claims": []}.`;

// Works with any OpenAI-compatible chat completions endpoint.
export class LlmAnswerer implements Answerer {
  readonly name: string;

  constructor(private readonly config: LlmConfig) {
    this.name = `llm:${config.model}`;
  }

  async answer(question: string, hits: Hit[]): Promise<Draft> {
    const sources = hits
      .map((h) => `[${h.chunk.id}] ${h.chunk.title}\n${h.chunk.text}`)
      .join('\n\n');
    const doFetch = this.config.fetchImpl ?? fetch;
    const response = await doFetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Sources:\n\n${sources}\n\nQuestion: ${question}` },
        ],
      }),
    });
    if (!response.ok) throw new Error(`LLM request failed with status ${response.status}`);
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return parseDraft(body.choices?.[0]?.message?.content ?? '');
  }
}

export function parseDraft(content: string): Draft {
  let data: unknown;
  try {
    data = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
  } catch {
    return { answerable: false, claims: [] };
  }
  if (typeof data !== 'object' || data === null) return { answerable: false, claims: [] };
  const raw = data as { answerable?: unknown; claims?: unknown };
  const claims: Claim[] = Array.isArray(raw.claims)
    ? raw.claims.flatMap((c: unknown) => {
        const claim = c as Partial<Claim>;
        return typeof claim?.text === 'string' &&
          typeof claim.chunkId === 'string' &&
          typeof claim.quote === 'string'
          ? [{ text: claim.text, chunkId: claim.chunkId, quote: claim.quote }]
          : [];
      })
    : [];
  return { answerable: raw.answerable === true && claims.length > 0, claims };
}

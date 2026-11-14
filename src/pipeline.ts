import { ExtractiveAnswerer } from './answer/extractive.js';
import { LlmAnswerer } from './answer/llm.js';
import type { Answerer } from './answer/types.js';
import { verifyClaims, type VerifiedClaim } from './answer/verify.js';
import { Bm25Index, type Hit } from './bm25.js';
import { loadCorpus } from './chunk.js';

export interface Answer {
  question: string;
  answerable: boolean;
  claims: VerifiedClaim[];
  dropped: VerifiedClaim[];
  sources: { id: string; title: string; file: string; text: string; score: number }[];
  mode: string;
  ms: number;
}

const TOP_K = 4;

export class Pipeline {
  constructor(
    private readonly index: Bm25Index,
    private readonly answerer: Answerer
  ) {}

  get mode(): string {
    return this.answerer.name;
  }

  retrieve(question: string): Hit[] {
    return this.index.search(question, TOP_K);
  }

  async ask(question: string): Promise<Answer> {
    const started = performance.now();
    const hits = this.retrieve(question);
    const draft = hits.length
      ? await this.answerer.answer(question, hits)
      : { answerable: false, claims: [] };
    const checked = verifyClaims(draft.claims, hits);
    const claims = checked.filter((c) => c.verified);
    const cited = new Set(claims.map((c) => c.chunkId));
    return {
      question,
      answerable: draft.answerable && claims.length > 0,
      claims,
      dropped: checked.filter((c) => !c.verified),
      sources: hits
        .filter((h) => cited.has(h.chunk.id))
        .map((h) => ({ ...h.chunk, score: Number(h.score.toFixed(3)) })),
      mode: this.answerer.name,
      ms: Math.round(performance.now() - started),
    };
  }
}

export function createPipeline(corpusDir: string, env: NodeJS.ProcessEnv = process.env): Pipeline {
  const index = new Bm25Index(loadCorpus(corpusDir));
  const answerer: Answerer =
    env.LLM_API_KEY && env.LLM_MODEL
      ? new LlmAnswerer({
          baseUrl: env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1',
          apiKey: env.LLM_API_KEY,
          model: env.LLM_MODEL,
        })
      : new ExtractiveAnswerer((term) => index.idf(term));
  return new Pipeline(index, answerer);
}

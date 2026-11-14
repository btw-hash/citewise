import type { Hit } from '../bm25.js';
import { splitSentences, tokenize } from '../text.js';
import type { Answerer, Claim, Draft } from './types.js';

const MAX_CLAIMS = 3;
const MIN_COVERAGE = 0.5;

// No model involved: picks the sentences that cover the most question terms
// and returns them as-is, so each claim is its own quote.
export class ExtractiveAnswerer implements Answerer {
  readonly name = 'extractive';

  constructor(private readonly idf: (term: string) => number) {}

  async answer(question: string, hits: Hit[]): Promise<Draft> {
    const terms = [...new Set(tokenize(question))];
    const totalWeight = terms.reduce((sum, t) => sum + this.idf(t), 0);
    if (totalWeight === 0) return { answerable: false, claims: [] };

    const candidates = hits.flatMap((hit, rank) =>
      splitSentences(hit.chunk.text).map((sentence) => {
        const present = new Set(tokenize(sentence));
        const matched = terms.filter((t) => present.has(t));
        const coverage = matched.reduce((sum, t) => sum + this.idf(t), 0) / totalWeight;
        return { sentence, chunkId: hit.chunk.id, coverage, matched, rank };
      })
    );
    candidates.sort((a, b) => b.coverage - a.coverage || a.rank - b.rank);

    const best = candidates[0];
    if (!best || best.coverage < MIN_COVERAGE) return { answerable: false, claims: [] };

    const claims: Claim[] = [];
    const covered = new Set<string>();
    for (const c of candidates) {
      if (claims.length >= MAX_CLAIMS) break;
      if (c.coverage < MIN_COVERAGE && !c.matched.some((t) => !covered.has(t))) continue;
      if (c.coverage < best.coverage * 0.6) break;
      if (claims.some((k) => k.quote === c.sentence)) continue;
      claims.push({ text: c.sentence, chunkId: c.chunkId, quote: c.sentence });
      c.matched.forEach((t) => covered.add(t));
    }
    return { answerable: true, claims };
  }
}

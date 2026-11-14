import type { Chunk } from './chunk.js';
import { tokenize } from './text.js';

export interface Hit {
  chunk: Chunk;
  score: number;
}

const K1 = 1.4;
const B = 0.75;

export class Bm25Index {
  private readonly docs: { chunk: Chunk; tf: Map<string, number>; length: number }[];
  private readonly df = new Map<string, number>();
  private readonly avgLength: number;

  constructor(chunks: Chunk[]) {
    this.docs = chunks.map((chunk) => {
      const tokens = tokenize(`${chunk.title} ${chunk.text}`);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { chunk, tf, length: tokens.length };
    });
    const total = this.docs.reduce((sum, d) => sum + d.length, 0);
    this.avgLength = this.docs.length ? total / this.docs.length : 0;
  }

  idf(term: string): number {
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (this.docs.length - df + 0.5) / (df + 0.5));
  }

  search(query: string, k: number): Hit[] {
    const terms = [...new Set(tokenize(query))];
    return this.docs
      .map(({ chunk, tf, length }) => {
        let score = 0;
        for (const term of terms) {
          const f = tf.get(term);
          if (!f) continue;
          score +=
            (this.idf(term) * (f * (K1 + 1))) / (f + K1 * (1 - B + (B * length) / this.avgLength));
        }
        return { chunk, score };
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

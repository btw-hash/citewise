import type { Hit } from '../bm25.js';

export interface Claim {
  text: string;
  chunkId: string;
  quote: string;
}

export interface Draft {
  answerable: boolean;
  claims: Claim[];
}

export interface Answerer {
  readonly name: string;
  answer(question: string, hits: Hit[]): Promise<Draft>;
}

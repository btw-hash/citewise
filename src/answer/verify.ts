import type { Hit } from '../bm25.js';
import { normalize } from '../text.js';
import type { Claim } from './types.js';

export interface VerifiedClaim extends Claim {
  verified: boolean;
  reason?: 'unknown-source' | 'quote-not-in-source';
}

// A claim survives only if it points at a chunk that was actually retrieved
// and its quote appears in that chunk verbatim (whitespace and case aside).
export function verifyClaims(claims: Claim[], hits: Hit[]): VerifiedClaim[] {
  const byId = new Map(hits.map((h) => [h.chunk.id, h.chunk]));
  return claims.map((claim) => {
    const chunk = byId.get(claim.chunkId);
    if (!chunk) return { ...claim, verified: false, reason: 'unknown-source' };
    const quote = normalize(claim.quote);
    if (quote.length < 12 || !normalize(chunk.text).includes(quote)) {
      return { ...claim, verified: false, reason: 'quote-not-in-source' };
    }
    return { ...claim, verified: true };
  });
}

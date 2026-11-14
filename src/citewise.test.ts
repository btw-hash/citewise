import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LlmAnswerer, parseDraft } from './answer/llm.js';
import { verifyClaims } from './answer/verify.js';
import { Bm25Index } from './bm25.js';
import { chunkMarkdown } from './chunk.js';
import { createPipeline, Pipeline } from './pipeline.js';

const corpus = join(import.meta.dirname, '..', 'corpus');

describe('chunkMarkdown', () => {
  it('makes one chunk per heading with a stable id', () => {
    const chunks = chunkMarkdown('a.md', '# Doc\n\nIntro text.\n\n## First part\n\nBody one.\n');
    expect(chunks.map((c) => c.id)).toEqual(['a.md#overview', 'a.md#first-part']);
    expect(chunks[1]?.title).toBe('Doc › First part');
  });
});

describe('verifyClaims', () => {
  const hits = [
    {
      chunk: { id: 'a.md#x', file: 'a.md', title: 'A', text: 'Leave is 26 days per year.' },
      score: 1,
    },
  ];

  it('keeps a claim whose quote is in the cited source', () => {
    const [c] = verifyClaims(
      [{ text: '26 days.', chunkId: 'a.md#x', quote: 'leave is 26  days' }],
      hits
    );
    expect(c?.verified).toBe(true);
  });

  it('rejects a quote that is not in the source', () => {
    const [c] = verifyClaims(
      [{ text: '30 days.', chunkId: 'a.md#x', quote: 'Leave is 30 days per year.' }],
      hits
    );
    expect(c).toMatchObject({ verified: false, reason: 'quote-not-in-source' });
  });

  it('rejects a source that was never retrieved', () => {
    const [c] = verifyClaims(
      [{ text: 'x', chunkId: 'b.md#y', quote: 'Leave is 26 days per year.' }],
      hits
    );
    expect(c).toMatchObject({ verified: false, reason: 'unknown-source' });
  });
});

describe('pipeline without a model', () => {
  const pipeline = createPipeline(corpus, {});

  it('answers from the right document with a verbatim quote', async () => {
    const answer = await pipeline.ask('How many days of annual leave do I get?');
    expect(answer.answerable).toBe(true);
    expect(answer.claims[0]?.chunkId).toBe('time-off.md#annual-leave');
    expect(answer.claims[0]?.quote).toContain('26 days');
  });

  it('refuses when the documents do not cover the question', async () => {
    const answer = await pipeline.ask("What is the company's stock option vesting schedule?");
    expect(answer.answerable).toBe(false);
    expect(answer.claims).toEqual([]);
  });
});

describe('pipeline with a model', () => {
  const chunks = chunkMarkdown('a.md', '# Doc\n\n## Leave\n\nLeave is 26 days per year.\n');
  const reply = (content: string) =>
    (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
      })) as typeof fetch;
  const build = (content: string) =>
    new Pipeline(
      new Bm25Index(chunks),
      new LlmAnswerer({
        baseUrl: 'http://llm.test',
        apiKey: 'k',
        model: 'm',
        fetchImpl: reply(content),
      })
    );

  it('drops a fabricated quote and refuses', async () => {
    const answer = await build(
      JSON.stringify({
        answerable: true,
        claims: [
          { text: 'You get 40 days.', chunkId: 'a.md#leave', quote: 'Leave is 40 days per year.' },
        ],
      })
    ).ask('How much leave?');
    expect(answer.answerable).toBe(false);
    expect(answer.dropped).toHaveLength(1);
  });

  it('keeps a grounded claim', async () => {
    const answer = await build(
      JSON.stringify({
        answerable: true,
        claims: [
          { text: 'You get 26 days.', chunkId: 'a.md#leave', quote: 'Leave is 26 days per year.' },
        ],
      })
    ).ask('How much leave?');
    expect(answer.answerable).toBe(true);
    expect(answer.sources.map((s) => s.id)).toEqual(['a.md#leave']);
  });

  it('treats malformed model output as no answer', () => {
    expect(parseDraft('sorry, I cannot')).toEqual({ answerable: false, claims: [] });
  });
});

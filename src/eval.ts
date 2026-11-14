import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPipeline } from './pipeline.js';

interface Case {
  question: string;
  expected: string | null;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cases = JSON.parse(readFileSync(join(root, 'evals', 'testset.json'), 'utf8')) as Case[];
const pipeline = createPipeline(join(root, 'corpus'));

const rows = [];
for (const c of cases) {
  const retrieved = pipeline.retrieve(c.question).map((h) => h.chunk.id);
  const answer = await pipeline.ask(c.question);
  const cited = answer.claims.map((k) => k.chunkId);
  rows.push({
    question: c.question,
    expected: c.expected,
    retrievedTop3: c.expected ? retrieved.slice(0, 3).includes(c.expected) : null,
    answered: answer.answerable,
    citedExpected: c.expected ? cited.includes(c.expected) : null,
    dropped: answer.dropped.length,
    claims: answer.claims.length,
  });
}

const answerable = rows.filter((r) => r.expected !== null);
const unanswerable = rows.filter((r) => r.expected === null);
const share = (n: number, d: number) => (d === 0 ? 1 : n / d);
const totalClaims = rows.reduce((s, r) => s + r.claims + r.dropped, 0);

const metrics = {
  cases: rows.length,
  retrievalHitAt3: share(answerable.filter((r) => r.retrievedTop3).length, answerable.length),
  answeredWithExpectedSource: share(
    answerable.filter((r) => r.answered && r.citedExpected).length,
    answerable.length
  ),
  refusalAccuracy: share(unanswerable.filter((r) => !r.answered).length, unanswerable.length),
  verifiedCitationRate: share(
    rows.reduce((s, r) => s + r.claims, 0),
    totalClaims
  ),
};

const report = { mode: pipeline.mode, ranAt: new Date().toISOString(), metrics, rows };
writeFileSync(join(root, 'evals', 'last-report.json'), JSON.stringify(report, null, 2) + '\n');

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
console.log(`mode:                          ${pipeline.mode}`);
console.log(`cases:                         ${metrics.cases}`);
console.log(`retrieval hit@3:               ${pct(metrics.retrievalHitAt3)}`);
console.log(`answered with expected source: ${pct(metrics.answeredWithExpectedSource)}`);
console.log(`refusal accuracy:              ${pct(metrics.refusalAccuracy)}`);
console.log(`verified citation rate:        ${pct(metrics.verifiedCitationRate)}`);
for (const r of rows) {
  const ok = r.expected === null ? !r.answered : r.answered && r.citedExpected;
  if (!ok) console.log(`  MISS  ${r.question}`);
}

const THRESHOLD = 0.8;
if (metrics.retrievalHitAt3 < THRESHOLD || metrics.refusalAccuracy < THRESHOLD) {
  console.error(`\n[FAIL] below regression threshold ${THRESHOLD}`);
  process.exit(1);
}
console.log(`\n[PASS] retrieval and refusals >= ${THRESHOLD}`);

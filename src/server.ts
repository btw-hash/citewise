import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createPipeline } from './pipeline.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pipeline = createPipeline(join(root, 'corpus'));
const app = express();

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const seen = new Map<string, { count: number; resetAt: number }>();

function allowed(ip: string): boolean {
  const now = Date.now();
  const entry = seen.get(ip);
  if (!entry || entry.resetAt < now) {
    seen.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_PER_WINDOW;
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '4kb' }));
app.use(express.static(join(root, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mode: pipeline.mode });
});

app.get('/api/eval', (_req, res) => {
  const file = join(root, 'evals', 'last-report.json');
  if (!existsSync(file)) {
    res.status(404).json({ error: 'No eval report yet. Run npm run eval.' });
    return;
  }
  res.type('json').send(readFileSync(file, 'utf8'));
});

app.post('/api/ask', async (req, res) => {
  if (!allowed(req.ip ?? 'unknown')) {
    res.status(429).json({ error: 'Too many questions. Try again in a minute.' });
    return;
  }
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (question.length < 3 || question.length > 300) {
    res.status(422).json({ error: 'Ask a question between 3 and 300 characters.' });
    return;
  }
  try {
    res.json(await pipeline.ask(question));
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: 'The answer service is unavailable right now.' });
  }
});

const port = Number(process.env.PORT ?? 3460);
app.listen(port, () => {
  console.log(`citewise listening on http://localhost:${port} (${pipeline.mode})`);
});

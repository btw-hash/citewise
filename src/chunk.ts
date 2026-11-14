import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Chunk {
  id: string;
  file: string;
  title: string;
  text: string;
}

const MAX_CHARS = 900;

function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function chunkMarkdown(file: string, markdown: string): Chunk[] {
  const chunks: Chunk[] = [];
  let docTitle = file;
  let heading = '';
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    buffer = [];
    if (!text || !heading) return;
    const paragraphs = text.split(/\n{2,}/);
    const parts: string[] = [];
    let current = '';
    for (const p of paragraphs) {
      if (current && current.length + p.length > MAX_CHARS) {
        parts.push(current);
        current = p;
      } else {
        current = current ? `${current}\n\n${p}` : p;
      }
    }
    if (current) parts.push(current);
    parts.forEach((part, i) => {
      const suffix = parts.length > 1 ? `-${i + 1}` : '';
      chunks.push({
        id: `${file}#${slug(heading)}${suffix}`,
        file,
        title: `${docTitle} › ${heading}`,
        text: part.replace(/\s*\n\s*/g, ' ').trim(),
      });
    });
  };

  for (const line of markdown.split(/\r?\n/)) {
    const h1 = /^#\s+(.*)$/.exec(line);
    const h2 = /^#{2,3}\s+(.*)$/.exec(line);
    if (h1?.[1]) {
      flush();
      docTitle = h1[1].trim();
      heading = 'Overview';
    } else if (h2?.[1]) {
      flush();
      heading = h2[1].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return chunks;
}

export function loadCorpus(dir: string): Chunk[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .flatMap((f) => chunkMarkdown(f, readFileSync(join(dir, f), 'utf8')));
}

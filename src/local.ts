// The local half: models running in Ollama on this Mac. Embeddings find past judgments
// that match a new screen; a small vision model gives a fast first look before Claude.
import { readFileSync } from 'node:fs';
import { open } from './store.ts';

const OLLAMA = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
export const LOCAL = { embed: process.env.UNDERSTUDY_EMBED ?? 'nomic-embed-text', vision: process.env.UNDERSTUDY_VISION ?? 'qwen2.5vl:7b' };

export async function available(): Promise<{ embed: boolean; vision: boolean }> {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`); const { models } = await r.json() as { models: { name: string }[] };
    const has = (m: string) => models.some(x => x.name === m || x.name === `${m}:latest`);
    return { embed: has(LOCAL.embed), vision: has(LOCAL.vision) };
  } catch { return { embed: false, vision: false }; }
}

export async function embed(texts: string[], kind: 'document' | 'query'): Promise<Float32Array[]> {
  // nomic-embed-text wants its task named in the text
  const input = texts.map(t => `${kind === 'query' ? 'search_query' : 'search_document'}: ${t}`);
  const r = await fetch(`${OLLAMA}/api/embed`, { method: 'POST', body: JSON.stringify({ model: LOCAL.embed, input }) });
  if (!r.ok) throw new Error(`ollama embed: ${r.status}`);
  const { embeddings } = await r.json() as { embeddings: number[][] };
  return embeddings.map(e => { const v = Float32Array.from(e); let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; for (let i = 0; i < v.length; i++) v[i] /= n; return v; });
}
const dot = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

const readingText = (r: { quote: string; gist: string; project: string | null }) => `${r.gist} "${r.quote}" (${r.project ?? ''})`;

// Embed every reading and has not been embedded with this model.
export async function indexMoments(log: (s: string) => void = () => {}): Promise<number> {
  const db = open();
  const rows = db.prepare(`select r.id, r.quote, r.gist, m.project from readings r join moments m on m.id = r.moment
    left join embeddings e on e.moment = r.id and e.model = ? where e.moment is null`).all(LOCAL.embed) as { id: string; quote: string; gist: string; project: string }[];
  const put = db.prepare('insert or replace into embeddings (moment, model, vec) values (?, ?, ?)');
  for (let i = 0; i < rows.length; i += 32) {
    const batch = rows.slice(i, i + 32); const vecs = await embed(batch.map(readingText), 'document');
    db.exec('begin'); batch.forEach((m, j) => put.run(m.id, LOCAL.embed, Buffer.from(vecs[j].buffer))); db.exec('commit');
    log(`  embedded ${Math.min(i + 32, rows.length)} of ${rows.length}`);
  }
  return rows.length;
}

// The past readings closest to a description of a new screen.
export async function nearest(query: string, k = 12): Promise<{ id: string; score: number }[]> {
  const db = open();
  const rows = db.prepare('select moment, vec from embeddings where model = ?').all(LOCAL.embed) as { moment: string; vec: Uint8Array }[];
  if (!rows.length) return [];
  const [q] = await embed([query], 'query');
  return rows.map(r => ({ id: r.moment, score: dot(q, new Float32Array(r.vec.buffer, r.vec.byteOffset, r.vec.byteLength / 4)) }))
    .sort((a, b) => b.score - a.score).slice(0, k);
}

// A fast first look: what is on the screen, and which common tells of generated UI it shows.
export type FirstLook = { describe: string; tells: string[]; ms: number };
const TELLS = ['identical rounded cards in a grid', 'pill-shaped tag chips', 'glowing or neon accents on a dark background', 'tracked-out all-caps labels above headings', 'a gradient hero with a centered tagline', 'large empty areas with nothing in them', 'emoji used as icons', 'text overlapping other text or images', 'inconsistent colours or button styles between areas', 'grainy, blurry or pixelated imagery or text'];
export async function firstLook(imagePath: string): Promise<FirstLook> {
  const t0 = Date.now();
  const image = readFileSync(imagePath).toString('base64');
  const prompt = `Look at this screenshot of software.
First, in two or three sentences, describe what is on screen: the kind of interface, its layout, its colours and type.
Then list which of these are clearly visible, using the exact phrases, one per line after the word TELLS:. Only list what you can point to.
${TELLS.map(t => `- ${t}`).join('\n')}`;
  const r = await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: LOCAL.vision, prompt, images: [image], stream: false, options: { temperature: 0 } }) });
  if (!r.ok) throw new Error(`ollama vision: ${r.status}`);
  const { response } = await r.json() as { response: string };
  const [describe, rest = ''] = response.split(/TELLS:/i);
  const tells = TELLS.filter(t => rest.toLowerCase().includes(t.toLowerCase().slice(0, 24)));
  return { describe: describe.replace(/\*\*/g, '').trim(), tells, ms: Date.now() - t0 };
}

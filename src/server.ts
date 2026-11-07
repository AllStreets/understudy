import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, json } from './store.ts';
import { paths } from './paths.ts';

export const PORT = Number(process.env.UNDERSTUDY_PORT ?? 4730);
const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'dist');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };

const send = (res: ServerResponse, code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
async function body(req: IncomingMessage): Promise<any> { let s = ''; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; }
async function file(res: ServerResponse, p: string, cache = false) {
  try { await stat(p); res.writeHead(200, { 'content-type': TYPES[extname(p).toLowerCase()] ?? 'application/octet-stream', ...(cache ? { 'cache-control': 'max-age=31536000, immutable' } : {}) }); res.end(await readFile(p)); }
  catch { res.writeHead(404); res.end(); }
}

type MomentRow = { id: string; session: string; at: string; project: string; text: string; said_before: string; said_after: string; pasted: string; before: string; after: string; kind: string; aspect: string; quote: string; gist: string; taste: number };
type ReadingRow = { id: string; moment: string; kind: string; aspect: string; quote: string; gist: string };
const readingsOf = (id: string) => open().prepare('select * from readings where moment = ? order by id').all(id) as ReadingRow[];
export const moment = (r: MomentRow) => ({
  id: r.id, at: r.at, project: r.project, text: r.text, saidBefore: r.said_before, saidAfter: r.said_after,
  pasted: json<string[]>(r.pasted, []), before: json<string[]>(r.before, []), after: json<string[]>(r.after, []),
  kind: r.kind, aspect: r.aspect, quote: r.quote, gist: r.gist, taste: r.taste === 1, readings: readingsOf(r.id),
});

const routes: [string, RegExp, (m: RegExpMatchArray, req: IncomingMessage, res: ServerResponse) => unknown][] = [
  ['GET', /^\/api\/summary$/, () => {
    const db = open(); const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    return { sessions: n('select count(*) n from sessions'), moments: n('select count(*) n from moments'), design: n('select count(*) n from moments where design = 1'),
      taste: n('select count(*) n from moments where taste = 1'), statements: n('select count(*) n from statements where removed = 0'), checks: n('select count(*) n from checks') };
  }],
  // the run: every moment that showed taste, oldest first, those with a screenshot beside them
  ['GET', /^\/api\/moments$/, () => (open().prepare(`select * from moments where taste = 1 order by at`).all() as MomentRow[]).map(moment)],
  ['GET', /^\/api\/moments\/([^/]+)$/, m => { const r = open().prepare('select * from moments where id = ?').get(decodeURIComponent(m[1])) as MomentRow | undefined; return r ? moment(r) : null; }],
  ['GET', /^\/api\/pairs$/, async () => { const { pairsWaiting } = await import('./calibrate.ts'); return pairsWaiting().map((p: any) => ({ ...p, a_shot: basename(p.a_shot), b_shot: basename(p.b_shot) })); }],
  ['POST', /^\/api\/pairs\/([^/]+)$/, async (m, req) => { const { pick } = await import('./calibrate.ts'); const b = await body(req); return pick(m[1], b.pick, b.note); }],
  ['GET', /^\/api\/lessons$/, () => (open().prepare(`select * from lessons where status not in ('recording', 'abandoned') order by started_at desc`).all() as any[]).map(l => ({ ...l, procedure: json(l.procedure, null), rehearsals: json(l.rehearsals, []) }))],
  ['POST', /^\/api\/lessons\/([^/]+)\/install$/, async m => { const { install } = await import('./teach.ts'); return install(m[1]); }],
  ['GET', /^\/api\/statements$/, () => (open().prepare('select * from statements where removed = 0 order by weight desc').all() as any[]).map(s => ({ ...s, evidence: json<string[]>(s.evidence, []), edited: !!s.edited }))],
  ['POST', /^\/api\/statements\/([^/]+)$/, async (m, req) => {
    const b = await body(req); const db = open();
    if (b.removed) db.prepare('update statements set removed = 1 where id = ?').run(m[1]);
    if (typeof b.text === 'string') db.prepare('update statements set text = ?, edited = 1 where id = ?').run(b.text, m[1]);
    return { ok: true };
  }],
  // the checks worth a decision: fixed, or stuck; a first-look pass needs none
  ['GET', /^\/api\/checks$/, () => (open().prepare(`select * from checks where after_shot is not null or verdict = 'stuck' order by at desc`).all() as any[]).map(c => ({ ...c, notes: json(c.found ?? c.notes, []), open: json(c.notes, []), before_shot: basename(c.before_shot), after_shot: c.after_shot ? basename(c.after_shot) : null }))],
  ['POST', /^\/api\/checks\/([^/]+)\/undo$/, async m => { const { undo } = await import('./check.ts'); return undo(m[1]); }],
  ['POST', /^\/api\/checks\/([^/]+)\/call$/, async (m, req) => {
    const { call, note } = await body(req);
    const db = open(); const at = new Date().toISOString();
    // reset clears a call without recording a verdict (used when recording the demo)
    if (call === 'reset') { db.prepare('update checks set call = null where id = ?').run(m[1]); return { ok: true }; }
    if (!['keep', 'undo', 'not-quite'].includes(call)) return { ok: false, error: 'call must be keep, undo or not-quite' };
    db.prepare('update checks set call = ? where id = ?').run(call, m[1]);
    db.prepare('insert into verdicts (at, subject, call, note) values (?, ?, ?, ?)').run(at, m[1], call, note ?? null);
    return { ok: true, at };
  }],
];

export function serve(port = PORT) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    // Only this machine, addressed by name: a page elsewhere that rebinds its own domain to
    // 127.0.0.1 still sends its own Host. Writes must carry a header a browser will not send
    // cross-origin without a preflight, which this server never grants.
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) { res.writeHead(403); return res.end(); }
    if (req.method !== 'GET' && req.headers['x-understudy'] !== '1') return send(res, 403, { error: 'writes need the x-understudy header' });
    try {
      const img = url.pathname.match(/^\/img\/([a-f0-9]{8,40})$/);
      if (img) { const r = open().prepare('select path from images where sha = ?').get(img[1]) as { path: string } | undefined; return r ? file(res, r.path, true) : (res.writeHead(404), res.end()); }
      const shot = url.pathname.match(/^\/shot\/([\w.-]+\.(png|jpg))$/);
      if (shot) return file(res, join(paths.shots, shot[1]));
      for (const [method, re, fn] of routes) { const m = url.pathname.match(re); if (m && req.method === method) return send(res, 200, await fn(m, req, res)); }
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
      const p = join(APP, url.pathname === '/' ? 'index.html' : url.pathname);
      return file(res, p.startsWith(APP) ? p : join(APP, 'index.html'));
    } catch (e) { send(res, 500, { error: (e as Error).message }); }
  });
  server.listen(port, '127.0.0.1', () => console.log(`Understudy on http://127.0.0.1:${port}`));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) serve();

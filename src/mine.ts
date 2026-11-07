import { createReadStream, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { paths, ensureDirs } from './paths.ts';
import { open } from './store.ts';

// Words that show up when someone is judging how a thing looks or feels. Deliberately
// broad: the classifier narrows it later, and a missed judgment is worse than an extra one.
const DESIGN = /\b(look(s|ed|ing)?|ugly|beautiful|gorgeous|pretty|design|ui|ux|font|fonts|type|typography|colou?rs?|layout|spacing|padding|margin|glow|theme|clean|sleek|generic|slop|ai[- ]?(generated|look|ish)|cards?|dashboard|icons?|logo|banner|aesthetic|feel|animation|motion|polish|premium|cheap|amateur|janky|busy|cluttered|dead space|screenshot|mockup|concept|option [a-d1-4]|uniform|consistent|photo ?real|realism|readme|hero|grainy|blurry|crisp|contrast|bold|thin|serif|mono|dark mode|light mode|align(ed|ment)?|centered|overlap|i love|love it|i like|don'?t like|hate|not a fan|wow)\b/i;

const NOT_TYPED = [/^Stop hook feedback/, /Understudy held this screen/, /^<(command|local-command|system|task-notification|bash-|user-prompt)/, /^\[Request interrupted/, /^Base directory for this skill/, /^This session is being continued/, /^Caveat:/];

export type Img = { sha: string; media: string };
type Block = { type: string; text?: string; source?: { data: string; media_type: string }; content?: unknown; input?: Record<string, unknown> };

function saveImage(b: Block): Img | null {
  const src = b.source; if (!src?.data) return null;
  const buf = Buffer.from(src.data, 'base64');
  const sha = createHash('sha1').update(buf).digest('hex').slice(0, 20);
  const ext = (src.media_type ?? 'image/png').split('/')[1].replace('jpeg', 'jpg');
  const path = join(paths.images, `${sha}.${ext}`);
  if (!existsSync(path)) writeFileSync(path, buf);
  const db = open();
  db.prepare('insert or ignore into images (sha, path, media, bytes) values (?, ?, ?, ?)').run(sha, path, src.media_type ?? 'image/png', buf.length);
  return { sha, media: src.media_type };
}

// Which project was the agent working in? Count the project folders named in its tool
// calls around the message; the session's own folder is the fallback.
const ROOTS = [join(homedir(), 'Downloads'), join(homedir(), 'code'), join(homedir(), 'Desktop'), join(homedir(), 'Documents'), homedir()];
const repoCache = new Map<string, string | null>();
// The project is the first folder on the path that is a git repository. A worktree
// counts as the repository it belongs to; a plain folder falls back to its own name.
function repoName(dir: string): string | null {
  if (repoCache.has(dir)) return repoCache.get(dir)!;
  let name: string | null = null;
  const git = join(dir, '.git');
  try {
    if (existsSync(git)) {
      if (statSync(git).isFile()) {
        const m = readFileSync(git, 'utf8').match(/gitdir:\s*(.+?)\/\.git\/worktrees\//);
        name = m ? basename(m[1]) : basename(dir);
      } else name = basename(dir);
    }
  } catch { name = null; }
  repoCache.set(dir, name); return name;
}
export function projectOf(p: string): string | null {
  for (const r of ROOTS) {
    if (!p.startsWith(r + '/')) continue;
    const segs = p.slice(r.length + 1).split('/');
    for (let i = 1; i <= Math.min(segs.length, 4); i++) {
      const dir = join(r, ...segs.slice(0, i));
      if (segs[i - 1].startsWith('.')) break;
      const n = repoName(dir); if (n) return n;
    }
    if (r === homedir()) return null;
    const seg = segs[0];
    // a worktree that has since been removed: name-plan2, name-pass and the like
    const wt = seg?.match(/^(.+?)-(plan\d*|pass|bluetooth|bp\d*|beauty|redesign[\w-]*)$/);
    if (wt && existsSync(join(r, wt[1]))) return repoName(join(r, wt[1])) ?? wt[1];
    if (seg && !seg.includes('.') && segs.length > 1) return seg;
    return null;
  }
  return null;
}

type Pending = { line: number; at: string | null; text: string; pasted: Img[]; before: Img[]; saidBefore: string; cwd: string | null; hints: Map<string, number> };

export async function mineSession(id: string, file: string): Promise<number> {
  ensureDirs();
  const db = open();
  db.prepare('delete from moments where session = ?').run(id);
  // a resumed session repeats the messages it carried over; keep only the first copy
  const already = db.prepare('select 1 from moments where at = ? and text = ? and session != ? limit 1');
  const put = db.prepare(`insert into moments (id, session, line, at, project, text, said_before, said_after, pasted, before, after, design)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  let shown: Img[] = [];          // agent screenshots since the last typed message
  let lastSaid = '';              // the agent's latest words
  let recentHints = new Map<string, number>();
  let open_: Pending | null = null;
  let after: Img[] = [], saidAfter = '';
  let count = 0, lineNo = 0;

  const flush = () => {
    if (!open_) return;
    const hints = new Map(open_.hints); for (const [k, v] of recentHints) hints.set(k, (hints.get(k) ?? 0) + v);
    const project = [...hints.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (open_.cwd ? projectOf(open_.cwd) ?? basename(open_.cwd) : null);
    const seen = open_.before.length > 0 || open_.pasted.length > 0;
    const design = DESIGN.test(open_.text) && (seen || /\b(design|ui|ux|look|readme|font|colou?r|layout|icon|logo|card)/i.test(open_.text)) ? 1 : 0;
    if (already.get(open_.at, open_.text, id)) { open_ = null; after = []; saidAfter = ''; return; }
    put.run(`${id}:${open_.line}`, id, open_.line, open_.at, project, open_.text, open_.saidBefore.slice(-1200), saidAfter.slice(0, 1200),
      JSON.stringify(open_.pasted.map(i => i.sha)), JSON.stringify(open_.before.map(i => i.sha)), JSON.stringify(after.map(i => i.sha)), design);
    count++; open_ = null; after = []; saidAfter = '';
  };

  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  db.exec('begin');
  for await (const raw of rl) {
    lineNo++;
    if (!raw || raw.length < 20) continue;
    let d: any; try { d = JSON.parse(raw); } catch { continue; }
    if (d.isSidechain) continue;
    const content: Block[] | string | undefined = d.message?.content;

    if (d.type === 'assistant' && Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'text' && b.text) { lastSaid = b.text; if (open_ && !saidAfter) saidAfter = b.text; }
        if (b.type === 'tool_use' && b.input) for (const v of Object.values(b.input)) if (typeof v === 'string') {
          for (const m of v.matchAll(/\/Users\/[^\s'"`)]+/g)) { const p = projectOf(m[0]); if (p) recentHints.set(p, (recentHints.get(p) ?? 0) + 1); }
        }
      }
      continue;
    }
    if (d.type !== 'user' || d.isMeta || d.isCompactSummary) continue;

    // tool results: screenshots the agent took
    if (Array.isArray(content) && content.some(b => b.type === 'tool_result')) {
      for (const b of content) if (b.type === 'tool_result' && Array.isArray(b.content))
        for (const c of b.content as Block[]) if (c.type === 'image') { const img = saveImage(c); if (img) (open_ ? after : shown).push(img); }
      continue;
    }

    // a message the person typed
    const blocks: Block[] = typeof content === 'string' ? [{ type: 'text', text: content }] : (content ?? []);
    const text = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n').trim();
    const pasted = blocks.filter(b => b.type === 'image').map(saveImage).filter((x): x is Img => !!x);
    if (!pasted.length && (!text || NOT_TYPED.some(r => r.test(text)))) continue;
    flush();
    open_ = { line: lineNo, at: d.timestamp ?? null, text, pasted, before: shown.slice(-6), saidBefore: lastSaid, cwd: d.cwd ?? null, hints: recentHints };
    recentHints = new Map(); shown = [];
  }
  // whatever the agent showed after the last message stands as that message's after
  flush();
  db.exec('commit');
  return count;
}

// The agent's reply screenshots are the "after" of one message and, naturally, the
// "before" of the next. mineSession keeps them apart; this pass links them.
export function linkReplies() {
  const db = open();
  const rows = db.prepare('select id, session, line, before, after from moments order by session, line').all() as { id: string; session: string; line: number; before: string; after: string }[];
  const upd = db.prepare('update moments set before = ? where id = ?');
  db.exec('begin');
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], cur = rows[i];
    if (prev.session !== cur.session) continue;
    const before = JSON.parse(cur.before) as string[];
    if (!before.length) { const a = JSON.parse(prev.after) as string[]; if (a.length) upd.run(JSON.stringify(a.slice(-6)), cur.id); }
  }
  db.exec('commit');
}

export async function mineAll(onSession?: (id: string, n: number) => void): Promise<{ sessions: number; moments: number; design: number; withImages: number }> {
  const db = open();
  const sessions = db.prepare('select id, archived from sessions order by first_at').all() as { id: string; archived: string }[];
  for (const s of sessions) { const n = await mineSession(s.id, s.archived); onSession?.(s.id, n); }
  linkReplies();
  const q = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    sessions: sessions.length,
    moments: q('select count(*) n from moments'),
    design: q('select count(*) n from moments where design = 1'),
    withImages: q(`select count(*) n from moments where design = 1 and (before != '[]' or pasted != '[]')`),
  };
}

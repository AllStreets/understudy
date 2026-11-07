import { readdirSync, statSync, copyFileSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { paths, CLAUDE_PROJECTS, ensureDirs } from './paths.ts';
import { open } from './store.ts';

export type ArchiveResult = { found: number; added: number; grown: number; unchanged: number };

// Main session logs sit one level down (projects/<folder>/<session>.jsonl). Subagent
// logs sit deeper and are not what the person typed, so they are left out.
export function sessionLogs(root = CLAUDE_PROJECTS): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const dir of readdirSync(root)) {
    // sessions run in temporary folders (tests, scratch work) are not the person's judgments
    if (/^-private-tmp-|^-tmp-|^-var-folders-|-scratchpad/.test(dir)) continue;
    const d = join(root, dir);
    if (!statSync(d).isDirectory()) continue;
    for (const f of readdirSync(d)) if (f.endsWith('.jsonl')) out.push(join(d, f));
  }
  return out;
}

function span(file: string): { lines: number; first: string | null; last: string | null } {
  const text = readFileSync(file, 'utf8');
  let lines = 0, first: string | null = null, last: string | null = null;
  for (const line of text.split('\n')) {
    if (!line) continue; lines++;
    const m = line.match(/"timestamp":"([^"]+)"/);
    if (m) { first ??= m[1]; last = m[1]; }
  }
  return { lines, first, last };
}

// Copy every session log into the archive. A log that has grown since the last run is
// copied again (sessions are append-only); one that is unchanged is skipped.
export function archive(root = CLAUDE_PROJECTS): ArchiveResult {
  ensureDirs();
  const db = open();
  const get = db.prepare('select bytes from sessions where id = ?');
  const put = db.prepare(`insert into sessions (id, source, archived, lines, bytes, first_at, last_at, archived_at)
    values (?, ?, ?, ?, ?, ?, ?, ?) on conflict(id) do update set source = excluded.source, lines = excluded.lines,
    bytes = excluded.bytes, first_at = excluded.first_at, last_at = excluded.last_at, archived_at = excluded.archived_at`);
  const res: ArchiveResult = { found: 0, added: 0, grown: 0, unchanged: 0 };
  for (const file of sessionLogs(root)) {
    res.found++;
    const id = basename(file, '.jsonl');
    const bytes = statSync(file).size;
    const prev = get.get(id) as { bytes: number } | undefined;
    if (prev && prev.bytes >= bytes) { res.unchanged++; continue; }
    const dest = join(paths.archive, `${id}.jsonl`);
    copyFileSync(file, dest);
    const s = span(dest);
    put.run(id, file, dest, s.lines, bytes, s.first, s.last, new Date().toISOString());
    prev ? res.grown++ : res.added++;
  }
  return res;
}

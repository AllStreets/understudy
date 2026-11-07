import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { open, json } from './store.ts';
import { capture } from './capture.ts';
import { judge, type Verdict } from './judge.ts';

export const MAX_ROUNDS = 3;

const git = (cwd: string, ...args: string[]) => { try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
// A commit object holding the working tree as it is now, without touching the tree or the stash list.
export function snapshot(cwd: string): string | null { return git(cwd, 'stash', 'create') || git(cwd, 'rev-parse', 'HEAD'); }

export type CheckRow = { id: string; at: string; project: string | null; target: string; before_shot: string; after_shot: string | null; notes: string; verdict: string; rounds: number; patch: string | null; call: string | null; session: string | null; snapshot: string | null; cwd: string | null };
export type Outcome = { check: CheckRow; result: Verdict; status: 'meets' | 'misses' | 'stuck'; round: number };

// Check a screen. Within one agent session, a second check continues the first: the first
// screenshot stays the "before", the newest becomes the "after", and the fix is the diff
// between the code then and now.
export async function check(target: string, o: { project?: string; session?: string; cwd?: string; context?: string; log?: (s: string) => void } = {}): Promise<Outcome> {
  const db = open(), log = o.log ?? (() => {});
  const project = o.project ?? (o.cwd ? basename(o.cwd) : null);
  const openCheck = o.session ? db.prepare(`select * from checks where session = ? and verdict = 'misses' and call is null order by at desc limit 1`).get(o.session) as CheckRow | undefined : undefined;
  log(`Screenshotting ${target}...`);
  const shot = await capture(target);
  const result = await judge(shot, { project: project ?? undefined, context: o.context, log });
  log(`Judged: ${result.verdict}. ${result.summary} ($${result.cost.toFixed(3)})`);

  if (openCheck) {
    const round = openCheck.rounds + 1;
    const patch = openCheck.cwd && openCheck.snapshot ? git(openCheck.cwd, 'diff', openCheck.snapshot) : null;
    const status = result.verdict === 'meets' ? 'meets' : round >= MAX_ROUNDS ? 'stuck' : 'misses';
    // the notes shown in the book are the ones the fix answered; a stuck check keeps what is still open
    const notes = status === 'stuck' ? result.notes : json(openCheck.notes, []);
    db.prepare('update checks set after_shot = ?, rounds = ?, patch = ?, verdict = ?, notes = ? where id = ?').run(shot, round, patch, status, JSON.stringify(notes), openCheck.id);
    if (status === 'misses') db.prepare('update checks set notes = ? where id = ?').run(JSON.stringify(result.notes), openCheck.id);
    return { check: db.prepare('select * from checks where id = ?').get(openCheck.id) as CheckRow, result, status, round };
  }
  const id = randomUUID().slice(0, 12);
  const snap = o.cwd ? snapshot(o.cwd) : null;
  db.prepare(`insert into checks (id, at, project, target, before_shot, notes, verdict, rounds, session, snapshot, cwd) values (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
    .run(id, new Date().toISOString(), project, target, shot, JSON.stringify(result.notes), result.verdict, o.session ?? null, snap, o.cwd ?? null);
  return { check: db.prepare('select * from checks where id = ?').get(id) as CheckRow, result, status: result.verdict, round: 1 };
}

// Take a fix back: apply its diff in reverse, if the code has not moved on underneath it.
export function undo(id: string): { ok: boolean; reason?: string } {
  const db = open();
  const c = db.prepare('select * from checks where id = ?').get(id) as CheckRow | undefined;
  if (!c) return { ok: false, reason: 'no such check' };
  if (!c.patch || !c.cwd) return { ok: false, reason: 'there is no recorded fix to undo' };
  try {
    execFileSync('git', ['apply', '-R', '--check', '-'], { cwd: c.cwd, input: c.patch + '\n', stdio: ['pipe', 'ignore', 'pipe'] });
    execFileSync('git', ['apply', '-R', '-'], { cwd: c.cwd, input: c.patch + '\n', stdio: ['pipe', 'ignore', 'pipe'] });
  } catch (e) { return { ok: false, reason: `the code has changed since the fix, so it cannot be reversed cleanly: ${String((e as { stderr?: Buffer }).stderr ?? e).slice(0, 300)}` }; }
  return { ok: true };
}

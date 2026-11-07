// The Claude Code side. A Stop hook calls this when an agent finishes a turn. If the
// project has a page to look at and the turn changed UI files, Understudy checks the page;
// on a miss it blocks the stop and hands the agent its notes, so the agent fixes them.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { check, MAX_ROUNDS } from './check.ts';
import { forAgent } from './judge.ts';
import { open } from './store.ts';

type StopInput = { session_id: string; transcript_path?: string; cwd: string; stop_hook_active?: boolean };
export type ProjectConfig = { url: string; project?: string; ui?: string[] };

export function findConfig(cwd: string): { config: ProjectConfig; root: string } | null {
  let d = cwd;
  for (let i = 0; i < 12; i++) {
    const p = join(d, '.understudy.json');
    if (existsSync(p)) { try { return { config: JSON.parse(readFileSync(p, 'utf8')), root: d }; } catch { return null; } }
    const up = dirname(d); if (up === d) break; d = up;
  }
  return null;
}

const UI = /\.(css|scss|sass|less|html|jsx|tsx|vue|svelte|astro|mdx)$/i;
// Did this turn touch UI? Read the transcript back to the last message the person typed.
export function uiChangedThisTurn(transcript: string, extra: RegExp[] = []): string[] {
  if (!existsSync(transcript)) return [];
  const lines = readFileSync(transcript, 'utf8').trimEnd().split('\n');
  const files = new Set<string>();
  for (let i = lines.length - 1; i >= 0; i--) {
    let d: any; try { d = JSON.parse(lines[i]); } catch { continue; }
    const c = d.message?.content;
    if (d.type === 'user' && !d.isMeta && (typeof c === 'string' || (Array.isArray(c) && c.some((b: any) => b.type === 'text')))) break;
    if (d.type === 'assistant' && Array.isArray(c)) for (const b of c) {
      if (b.type !== 'tool_use' || !['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(b.name)) continue;
      const f = String(b.input?.file_path ?? ''); if (UI.test(f) || extra.some(r => r.test(f))) files.add(f);
    }
  }
  return [...files];
}

export async function stopHook(raw: string): Promise<{ stdout: string; code: number }> {
  const input = JSON.parse(raw) as StopInput;
  const found = findConfig(input.cwd); if (!found) return { stdout: '', code: 0 };
  const { config, root } = found;
  const db = open();
  const pending = db.prepare(`select id from checks where session = ? and verdict = 'misses' and call is null`).get(input.session_id);
  const changed = input.transcript_path ? uiChangedThisTurn(input.transcript_path, (config.ui ?? []).map(g => new RegExp(g))) : [];
  if (!changed.length && !pending) return { stdout: '', code: 0 };
  const { status, round, result, check: c } = await check(config.url, { project: config.project, session: input.session_id, cwd: root, context: changed.length ? `edited ${changed.map(f => f.replace(root + '/', '')).join(', ')}` : undefined });
  if (status === 'misses') return { stdout: JSON.stringify({ decision: 'block', reason: forAgent(result, round, MAX_ROUNDS) }), code: 0 };
  const said = status === 'stuck'
    ? `Understudy: still missing your bar after ${round} rounds; the best attempt and what is left are in the book (check ${c.id}).`
    : round > 1 ? `Understudy: fixed in ${round - 1} ${round === 2 ? 'round' : 'rounds'} and held at your bar. Before and after are waiting in the book (check ${c.id}).`
    : 'Understudy: this screen meets your bar.';
  return { stdout: JSON.stringify({ systemMessage: said }), code: 0 };
}

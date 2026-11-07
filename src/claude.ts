import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

// Understudy talks to Claude through the person's own Claude Code, headless. Their
// settings and hooks are left out, nothing is saved as a session (so Understudy never
// mines its own calls), and tools are off unless a call needs to read an image.
export type AskOptions = { model?: string; schema?: object; system?: string; readDirs?: string[]; timeoutMs?: number };

export const MODELS = { fast: 'claude-haiku-4-5', judge: 'claude-sonnet-5', deep: 'claude-opus-5-5' };

export async function ask<T = unknown>(prompt: string, o: AskOptions = {}): Promise<{ value: T; cost: number }> {
  const args = ['-p', '--no-session-persistence', '--setting-sources', '', '--output-format', 'json', '--model', o.model ?? MODELS.judge];
  if (o.system) args.push('--system-prompt', o.system);
  if (o.schema) args.push('--json-schema', JSON.stringify(o.schema));
  if (o.readDirs?.length) { args.push('--tools', 'Read', '--allowedTools', 'Read'); for (const d of o.readDirs) args.push('--add-dir', d); }
  else args.push('--tools', '');
  return new Promise((resolve, reject) => {
    const p = spawn('claude', args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('claude timed out')); }, o.timeoutMs ?? 600_000);
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', code => {
      clearTimeout(timer);
      try {
        const d = JSON.parse(out);
        if (d.is_error) return reject(new Error(String(d.result ?? 'claude error')));
        const value = (o.schema ? d.structured_output ?? JSON.parse(d.result) : d.result) as T;
        resolve({ value, cost: d.total_cost_usd ?? 0 });
      } catch { reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 400)}`)); }
    });
    p.stdin.end(prompt);
  });
}

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Understudy talks to Claude through the person's own Claude Code, headless. Their settings,
// hooks, plugins and MCP servers are left out (an MCP server's tool list alone can be tens
// of thousands of tokens), nothing is saved as a session (so Understudy never mines its own
// calls), no tools are offered, and images travel inside the message.
export type AskOptions = { model?: string; schema?: object; system?: string; images?: string[]; timeoutMs?: number };

export const MODELS = { fast: 'claude-haiku-4-5', judge: 'claude-sonnet-5', deep: 'claude-opus-5-5' };

const media = (p: string) => /\.jpe?g$/i.test(p) ? 'image/jpeg' : /\.webp$/i.test(p) ? 'image/webp' : 'image/png';

export async function ask<T = unknown>(prompt: string, o: AskOptions = {}): Promise<{ value: T; cost: number }> {
  const args = ['-p', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--tools', '',
    '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', o.model ?? MODELS.judge];
  if (o.system) args.push('--system-prompt', o.system);
  if (o.schema) args.push('--json-schema', JSON.stringify(o.schema));
  const content = [
    ...(o.images ?? []).map(p => ({ type: 'image', source: { type: 'base64', media_type: media(p), data: readFileSync(p).toString('base64') } })),
    { type: 'text', text: prompt },
  ];
  return new Promise((resolve, reject) => {
    const p = spawn('claude', args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('claude timed out')); }, o.timeoutMs ?? 600_000);
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', code => {
      clearTimeout(timer);
      const last = out.trim().split('\n').reverse().find(l => l.includes('"type":"result"'));
      try {
        const d = JSON.parse(last ?? '');
        if (d.is_error) return reject(new Error(String(d.result ?? 'claude error')));
        if (process.env.UNDERSTUDY_DEBUG) console.error('[claude]', JSON.stringify({ usage: d.usage, cost: d.total_cost_usd, turns: d.num_turns, model: o.model }));
        const value = (o.schema ? d.structured_output ?? JSON.parse(d.result) : d.result) as T;
        resolve({ value, cost: d.total_cost_usd ?? 0 });
      } catch { reject(new Error(`claude exited ${code}: ${(err || out).slice(-400)}`)); }
    });
    p.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
  });
}

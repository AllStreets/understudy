// Teaching a task: you do it once in Claude Code while Understudy watches. It writes the
// task down as a procedure with a check, rehearses it in a throwaway copy of the project,
// and only offers to take it over once a rehearsal passes. Taking over means installing it
// as a Claude Code skill, and that happens only when you say so.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { open, json } from './store.ts';
import { CLAUDE_PROJECTS } from './paths.ts';
import { ask, MODELS } from './claude.ts';
import { snapshot } from './check.ts';

export type Procedure = { name: string; purpose: string; when: string; inputs: { name: string; example: string }[]; steps: string[]; commands: string[]; check: string; touches: string[] };
export type Lesson = { id: string; name: string; cwd: string; started_at: string; stopped_at: string | null; head: string | null; snap: string | null; transcript: string | null; procedure: string | null; status: string; rehearsals: string; installed: string | null };

const git = (cwd: string, ...a: string[]) => { try { return execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

export function start(name: string, cwd: string): Lesson {
  const db = open();
  // a lesson still recording here is dropped, and so is an earlier take of the same task that never went on
  db.prepare(`update lessons set status = 'abandoned' where cwd = ? and (status = 'recording' or (name = ? and status != 'installed'))`).run(cwd, name);
  const id = randomUUID().slice(0, 12);
  db.prepare(`insert into lessons (id, name, cwd, started_at, head, snap, status, rehearsals) values (?, ?, ?, ?, ?, ?, 'recording', '[]')`)
    .run(id, name, cwd, new Date().toISOString(), git(cwd, 'rev-parse', 'HEAD'), snapshot(cwd));
  return db.prepare('select * from lessons where id = ?').get(id) as Lesson;
}

// Claude Code keeps a project's sessions in a folder named after its path.
function transcriptFor(cwd: string, since: string): string | null {
  const dir = join(CLAUDE_PROJECTS, cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  if (!existsSync(dir)) return null;
  const t = Date.parse(since);
  const files = readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => join(dir, f)).filter(f => statSync(f).mtimeMs >= t).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

// The demonstration, as a plain script: what was asked, what was run, what was changed.
export function demonstration(transcript: string, from: string, to: string): { script: string; commands: string[] } {
  const a = Date.parse(from), b = Date.parse(to);
  const lines: string[] = [], commands: string[] = [];
  for (const raw of readFileSync(transcript, 'utf8').split('\n')) {
    let d: any; try { d = JSON.parse(raw); } catch { continue; }
    const at = d.timestamp ? Date.parse(d.timestamp) : NaN; if (!(at >= a && at <= b)) continue;
    const c = d.message?.content;
    if (d.type === 'user' && !d.isMeta) {
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x: any) => x.type === 'text').map((x: any) => x.text).join(' ') : '';
      if (text && !/^<|understudy teach/i.test(text.trim())) lines.push(`PERSON: ${text.slice(0, 1500)}`);
      if (Array.isArray(c)) for (const x of c) if (x.type === 'tool_result') { const r = typeof x.content === 'string' ? x.content : Array.isArray(x.content) ? x.content.filter((y: any) => y.type === 'text').map((y: any) => y.text).join(' ') : ''; if (r) lines.push(`  result: ${r.slice(0, 300).replace(/\s+/g, ' ')}`); }
    }
    if (d.type === 'assistant' && Array.isArray(c)) for (const x of c) {
      if (x.type === 'text' && x.text) lines.push(`AGENT: ${x.text.slice(0, 600)}`);
      if (x.type === 'tool_use') {
        const i = x.input ?? {};
        if (x.name === 'Bash' && typeof i.command === 'string') { lines.push(`  ran: ${i.command}`); if (!/understudy teach/.test(i.command)) commands.push(i.command); }
        else if (['Edit', 'MultiEdit'].includes(x.name)) lines.push(`  edited ${i.file_path}: replaced ${JSON.stringify(String(i.old_string ?? '').slice(0, 200))} with ${JSON.stringify(String(i.new_string ?? '').slice(0, 300))}`);
        else if (x.name === 'Write') lines.push(`  wrote ${i.file_path} (${String(i.content ?? '').length} chars)`);
        else if (x.name === 'Read') lines.push(`  read ${i.file_path}`);
      }
    }
  }
  return { script: lines.join('\n'), commands };
}

const PROC_SCHEMA = {
  type: 'object', required: ['name', 'purpose', 'when', 'inputs', 'steps', 'check', 'touches'],
  properties: {
    inputs: { type: 'array', description: 'what changes each time the task is done, with the value used in the demonstration as the example', items: { type: 'object', required: ['name', 'example'], properties: { name: { type: 'string' }, example: { type: 'string' } } } },
    name: { type: 'string', description: 'a short kebab-case name' },
    purpose: { type: 'string', description: 'one sentence: what the task achieves' },
    when: { type: 'string', description: 'one sentence: when someone would want this done' },
    steps: { type: 'array', items: { type: 'string' }, description: 'the steps, in order, specific to this project, general enough to repeat with different inputs' },
    check: { type: 'string', description: 'one shell command, run from the project root, that exits 0 only if the task was done correctly and exits non-zero on the project as it was before the task; it must not change anything' },
    touches: { type: 'array', items: { type: 'string' }, description: 'the files or folders the task changes' },
  },
};

export async function stop(cwd: string, log: (s: string) => void = () => {}): Promise<Lesson> {
  const db = open();
  const l = db.prepare(`select * from lessons where cwd = ? and status = 'recording' order by started_at desc limit 1`).get(cwd) as Lesson | undefined;
  if (!l) throw new Error('nothing is being taught here; start with: understudy teach start <name>');
  const stopped = new Date().toISOString();
  const transcript = transcriptFor(cwd, l.started_at);
  if (!transcript) throw new Error(`no Claude Code session found for ${cwd} since ${l.started_at}`);
  const { script, commands } = demonstration(transcript, l.started_at, stopped);
  if (!script.trim()) throw new Error('the session has nothing in it since the lesson started');
  log('Writing it down...');
  const { value, cost } = await ask<Omit<Procedure, 'commands'>>(`Here is a demonstration of a task called "${l.name}", done in a coding agent session in the project ${basename(cwd)}.\n\n${script.slice(-40000)}\n\nWrite it down as a procedure someone could repeat. Keep only what the task needed, not detours or mistakes. The check must prove the task worked, using only what the demonstration shows exists (files, scripts, commands).`,
    { model: MODELS.judge, schema: PROC_SCHEMA, system: 'You turn a demonstration into a repeatable procedure. Do not invent steps, files or commands the demonstration does not show.' });
  const proc: Procedure = { ...value, commands: [...new Set(commands)] };
  proc.check = await settleCheck({ ...l, cwd }, proc, log);
  db.prepare(`update lessons set stopped_at = ?, transcript = ?, procedure = ?, status = 'written' where id = ?`).run(stopped, transcript, JSON.stringify(proc), l.id);
  log(`  $${cost.toFixed(3)}`);
  return db.prepare('select * from lessons where id = ?').get(l.id) as Lesson;
}

// The commands a rehearsal may run: the ones the demonstration ran, by their first two words.
// A command with shell operators in it is dropped whole, and programs that delete, escalate,
// publish or reach the network are never allowed, whatever the demonstration did: a
// rehearsal's shell can see outside its copy of the project.
const NEVER = /^(rm|rmdir|sudo|su|doas|dd|mkfs|diskutil|chmod|chown|kill|killall|pkill|launchctl|defaults|osascript|open|security|shutdown|reboot|curl|wget|ssh|scp|sftp|rsync|nc|ncat|telnet|ftp|eval|exec|source|bash|sh|zsh|python|python3|node|perl|ruby|xargs|find|mv)$/;
const NEVER_TWO = /^(git (push|remote|config|clean|reset|filter-branch|gc)|npm (publish|adduser|login|token|exec)|npx \S+|pnpm publish|yarn publish|gh \S+|docker \S+|brew \S+)$/;
export function allowedBash(commands: string[]): string[] {
  const out = new Set<string>();
  for (const c of commands) {
    if (/[;&|`><\n]|\$\(/.test(c)) continue;
    const words = c.trim().split(/\s+/); const w = words.slice(0, 2).join(' ');
    if (!w || NEVER.test(words[0]) || NEVER_TWO.test(w)) continue;
    out.add(`Bash(${w}:*)`);
  }
  return [...out];
}

// A throwaway APFS clone of the project as it is now (shares blocks until something changes).
function cloneNow(l: Lesson): { stage: string; copy: string } {
  const stage = mkdtempSync(join(tmpdir(), 'understudy-rehearsal-')), copy = join(stage, basename(l.cwd));
  execFileSync('cp', ['-cR', l.cwd, copy]);
  return { stage, copy };
}
// The same, put back to how the project was when the lesson began.
function cloneAtStart(l: Lesson): { stage: string; copy: string } {
  const { stage, copy } = cloneNow(l);
  if (l.head) { git(copy, 'reset', '-q', '--hard', l.head); git(copy, 'clean', '-qfd'); if (l.snap && l.snap !== l.head) git(copy, 'stash', 'apply', '-q', l.snap); }
  return { stage, copy };
}
const runs = (cmd: string, cwd: string) => { try { execFileSync('bash', ['-c', cmd], { cwd, stdio: 'ignore', timeout: 120_000 }); return true; } catch { return false; } };

// A check is only worth having if it tells the two states apart: it must pass on the project
// as the demonstration left it, and fail on the project as it was before.
// A generated check never runs in the real project: both states are clones.
async function settleCheck(l: Lesson, proc: Procedure, log: (s: string) => void): Promise<string> {
  const { stage, copy } = cloneAtStart(l), now = cloneNow(l);
  try {
    let check = proc.check;
    for (let attempt = 0; attempt < 3; attempt++) {
      // a check that changes things would spoil the next attempt, so each attempt gets fresh clones
      if (attempt) { rmSync(now.copy, { recursive: true, force: true }); execFileSync('cp', ['-cR', l.cwd, now.copy]); }
      const after = runs(check, now.copy), before = runs(check, copy);
      if (after && !before) return check;
      const why = !after ? 'it fails on the project after the task was done (it may have a syntax error)' : 'it already passes on the project before the task was done, so it proves nothing';
      log(`  The check does not tell before from after: ${why}. Asking for another.`);
      const { value } = await ask<{ check: string }>(`This shell command is meant to prove a task was done, but ${why}:\n\n${check}\n\nTask: ${proc.purpose}\nSteps:\n${proc.steps.join('\n')}\n\nWrite one bash command, run from the project root, that exits 0 after the task is done and non-zero before it. Git is available and HEAD is the state before the task. It must not change anything. Return the command exactly as it should be typed.`,
        { model: MODELS.judge, schema: { type: 'object', required: ['check'], properties: { check: { type: 'string' } } }, system: 'You write precise verification commands for bash.' });
      check = value.check;
    }
    throw new Error(`could not find a check that tells before from after; last tried: ${check}`);
  } finally { rmSync(stage, { recursive: true, force: true }); rmSync(now.stage, { recursive: true, force: true }); }
}

export type Rehearsal = { at: string; passed: boolean; seconds: number; cost: number; check: string; log: string };

// Rehearse in a throwaway APFS clone of the project, put back to how it was when the lesson began.
export async function rehearse(id: string, log: (s: string) => void = () => {}): Promise<Rehearsal> {
  const db = open();
  const l = db.prepare('select * from lessons where id = ?').get(id) as Lesson | undefined;
  if (!l?.procedure) throw new Error('no written procedure to rehearse');
  const proc = json<Procedure>(l.procedure, null as any);
  const { stage, copy } = cloneAtStart(l);
  try {
    const t0 = Date.now();
    log(`Rehearsing "${proc.name}" in ${copy}`);
    const inputs = proc.inputs?.length ? `\n\nInputs for this run:\n${proc.inputs.map(i => `- ${i.name}: ${i.example}`).join('\n')}` : '';
    const prompt = `Do this task in the current project. It has been done here before and written down; follow it.\n\nTask: ${proc.purpose}${inputs}\n\nSteps:\n${proc.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nWhen it is done, stop. Do not run anything outside this folder.`;
    const { out, cost } = await new Promise<{ out: string; cost: number }>((resolve, reject) => {
      const p = spawn('claude', ['-p', prompt, '--model', MODELS.judge, '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config', '--permission-mode', 'acceptEdits',
        // file tools are scoped to the clone (// marks an absolute path); the shell to the demonstration's commands
        '--allowedTools', [`Read(/${copy}/**)`, `Edit(/${copy}/**)`, `Write(/${copy}/**)`, 'Glob', 'Grep', ...allowedBash(proc.commands)].join(' '),
        '--disallowedTools', 'WebFetch WebSearch', '--output-format', 'json'], { cwd: copy, stdio: ['ignore', 'pipe', 'pipe'] });
      let o = ''; p.stdout.on('data', d => o += d);
      const timer = setTimeout(() => p.kill(), 15 * 60_000);
      p.on('close', () => { clearTimeout(timer); try { const d = JSON.parse(o); resolve({ out: String(d.result ?? ''), cost: d.total_cost_usd ?? 0 }); } catch { reject(new Error(`rehearsal agent failed: ${o.slice(-300)}`)); } });
    });
    let passed = false, checkOut = '';
    try { checkOut = execFileSync('bash', ['-c', proc.check], { cwd: copy, encoding: 'utf8', timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'] }); passed = true; }
    catch (e) { checkOut = String((e as { stdout?: string }).stdout ?? '') + String((e as { stderr?: string }).stderr ?? ''); }
    const r: Rehearsal = { at: new Date().toISOString(), passed, seconds: Math.round((Date.now() - t0) / 1000), cost, check: checkOut.slice(-600), log: out.slice(-1200) };
    const rs = json<Rehearsal[]>(l.rehearsals, []); rs.push(r);
    const status = rs.slice(-2).length === 2 && rs.slice(-2).every(x => x.passed) ? 'ready' : 'rehearsing';
    db.prepare('update lessons set rehearsals = ?, status = ? where id = ? and status != ?').run(JSON.stringify(rs), status, id, 'installed');
    log(`  ${passed ? 'Passed' : 'Failed'} in ${r.seconds}s ($${cost.toFixed(3)}).`);
    return r;
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

// Let it go on: write the procedure as a Claude Code skill. Only ever called on the person's say-so.
export function install(id: string): { ok: boolean; path?: string; reason?: string } {
  const db = open();
  const l = db.prepare('select * from lessons where id = ?').get(id) as Lesson | undefined;
  if (!l?.procedure) return { ok: false, reason: 'nothing written down yet' };
  if (l.status !== 'ready') return { ok: false, reason: 'it has not passed two rehearsals in a row yet' };
  const p = json<Procedure>(l.procedure, null as any);
  const slug = p.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  // UNDERSTUDY_SKILLS_DIR lets tests install somewhere harmless
  const dir = join(process.env.UNDERSTUDY_SKILLS_DIR ?? join(homedir(), '.claude', 'skills'), slug); mkdirSync(dir, { recursive: true });
  const file = join(dir, 'SKILL.md');
  writeFileSync(file, `---\nname: ${slug}\ndescription: ${p.purpose} Use when ${p.when.replace(/^when\s+/i, '').replace(/\.$/, '')}.\n---\n\n# ${p.name}\n\nTaught to Understudy in ${basename(l.cwd)} on ${l.started_at.slice(0, 10)} and rehearsed until it passed twice in a row.\n\n## Steps\n\n${p.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n## Check that it worked\n\n\`\`\`sh\n${p.check}\n\`\`\`\n`);
  db.prepare(`update lessons set status = 'installed', installed = ? where id = ?`).run(file, id);
  return { ok: true, path: file };
}

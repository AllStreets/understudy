import { archive } from './archive.ts';
import { mineAll } from './mine.ts';
import { open } from './store.ts';
import { paths } from './paths.ts';
import { readMoments, distil } from './taste.ts';
import { indexMoments, available } from './local.ts';
import { check, undo } from './check.ts';
import { stopHook } from './hook.ts';
import { serve } from './server.ts';
import { calibrate } from './calibrate.ts';
import * as teach from './teach.ts';

const [cmd, ...args] = process.argv.slice(2);

const commands: Record<string, () => Promise<void> | void> = {
  // everything a new user runs once, and anyone can rerun: only new sessions are read again
  async learn() {
    await commands.archive();
    await commands.mine();
    await commands.read();
    const a = await available();
    if (a.embed) await commands.index(); else console.log('Skipping local matching: Ollama with nomic-embed-text is not available.');
    await commands.distil();
  },
  async archive() {
    const r = archive();
    console.log(`Found ${r.found} session logs. Archived ${r.added} new, ${r.grown} grown, ${r.unchanged} unchanged.`);
    console.log(`Archive: ${paths.archive}`);
  },
  async mine() {
    const r = await mineAll((id, n) => args.includes('-v') && console.log(`  ${id.slice(0, 8)}  ${n} messages`));
    console.log(`${r.sessions} sessions, ${r.moments} messages you typed, ${r.design} design judgments, ${r.withImages} with a screenshot beside them.`);
  },
  async read() {
    const r = await readMoments(console.log);
    console.log(`Read ${r.read} judgments for taste. Cost $${r.cost.toFixed(2)}.`);
  },
  async distil() {
    const r = await distil(console.log);
    const db = open();
    for (const s of db.prepare('select text, weight from statements order by weight desc').all() as { text: string; weight: number }[]) console.log(`${String(s.weight).padStart(3)}  ${s.text}`);
    console.log(`${r.statements} statements. Cost $${r.cost.toFixed(2)}.`);
  },
  async index() {
    const a = await available();
    if (!a.embed) { console.log('Ollama is not running, or nomic-embed-text is not pulled: ollama pull nomic-embed-text'); return; }
    console.log(`Embedded ${await indexMoments(console.log)} readings.`);
  },
  async check() {
    const target = args.find(a => !a.startsWith('--')); if (!target) return console.log('understudy check <url or image> [--project name]');
    const pi = args.indexOf('--project');
    const o = await check(target, { project: pi >= 0 ? args[pi + 1] : undefined, cwd: process.cwd(), log: console.log });
    console.log(`\n${o.status === 'meets' ? 'Meets your bar.' : 'Misses your bar.'} ${o.result.summary}\n`);
    o.result.notes.forEach((n, i) => console.log(`${i + 1}. [${n.severity}] ${n.claim}\n   Fix: ${n.fix}\n   ${n.quote ? `You said, ${n.when}: "${n.quote}"` : 'Understudy\'s own note, no past judgment behind it.'}\n`));
    console.log(`Check ${o.check.id}.`);
    process.exitCode = o.status === 'meets' ? 0 : 2;
  },
  async undo() {
    const r = undo(args[0] ?? ''); console.log(r.ok ? 'Undone.' : `Not undone: ${r.reason}`); process.exitCode = r.ok ? 0 : 1;
  },
  async hook() {
    let raw = ''; for await (const c of process.stdin) raw += c;
    const r = await stopHook(raw); if (r.stdout) process.stdout.write(r.stdout); process.exitCode = r.code;
  },
  serve() { serve(); },
  async teach() {
    const [sub, ...rest] = args; const cwd = process.cwd();
    if (sub === 'start') { const l = teach.start(rest.join(' ') || 'task', cwd); console.log(`Watching. Do "${l.name}" in Claude Code here, then run: understudy teach stop`); return; }
    if (sub === 'stop') {
      const l = await teach.stop(cwd, console.log); const p = JSON.parse(l.procedure!);
      console.log(`\n${p.name}: ${p.purpose}\n${p.steps.map((x: string, i: number) => `  ${i + 1}. ${x}`).join('\n')}\n  Check: ${p.check}\n\nRehearse it with: understudy teach rehearse ${l.id}`); return;
    }
    if (sub === 'rehearse') { const id = rest[0]; for (let i = 0; i < Number(rest[1] ?? 2); i++) await teach.rehearse(id, console.log); return; }
    if (sub === 'install') { const r = teach.install(rest[0]); console.log(r.ok ? `Installed as a Claude Code skill: ${r.path}` : `Not installed: ${r.reason}`); return; }
    console.log('understudy teach start <name> | stop | rehearse <id> [times] | install <id>');
  },
  async calibrate() {
    const url = args.find(a => !a.startsWith('--')); if (!url) return console.log('understudy calibrate <url of one of your pages> [--n 6] [--project name]');
    const ni = args.indexOf('--n'), pi = args.indexOf('--project');
    const r = await calibrate(url, { n: ni >= 0 ? Number(args[ni + 1]) : 6, project: pi >= 0 ? args[pi + 1] : undefined, log: console.log });
    console.log(`${r.made} pairs are waiting in the book under Calibration. Cost $${r.cost.toFixed(3)}.`);
  },
  async stats() {
    const db = open();
    const rows = db.prepare(`select coalesce(project, '(unknown)') p, count(*) n, sum(before != '[]' or pasted != '[]') shots
      from moments where design = 1 group by p order by n desc`).all() as { p: string; n: number; shots: number }[];
    for (const r of rows) console.log(`${String(r.n).padStart(4)}  ${String(r.shots).padStart(4)} with shots  ${r.p}`);
  },
  help() {
    console.log(`understudy <command>

  learn     do all of the below in order: archive, mine, read, index, distil
  archive   copy every Claude Code session log into the archive
  mine      find the messages you typed and what you saw around them
  read      ask Claude what each judgment says about your taste
  distil    fold those readings into a short list of statements
  index     embed your judgments with a local model (Ollama) for matching
  check     hold a page or screenshot to your bar: understudy check http://localhost:5173
  undo      take back a fix: understudy undo <check id>
  teach     teach a task by doing it: teach start <name>, then teach stop, teach rehearse <id>, teach install <id>
  calibrate render one of your pages in pairs that differ in one thing, to pick between in the book
  serve     open the prompt book on http://127.0.0.1:4730
  hook      the Claude Code Stop hook (reads its JSON on stdin)
  stats     design judgments per project`);
  },
};

await (commands[cmd ?? 'help'] ?? commands.help)();

import { archive } from './archive.ts';
import { mineAll } from './mine.ts';
import { open } from './store.ts';
import { paths } from './paths.ts';

const [cmd, ...args] = process.argv.slice(2);

const commands: Record<string, () => Promise<void> | void> = {
  async archive() {
    const r = archive();
    console.log(`Found ${r.found} session logs. Archived ${r.added} new, ${r.grown} grown, ${r.unchanged} unchanged.`);
    console.log(`Archive: ${paths.archive}`);
  },
  async mine() {
    const r = await mineAll((id, n) => args.includes('-v') && console.log(`  ${id.slice(0, 8)}  ${n} messages`));
    console.log(`${r.sessions} sessions, ${r.moments} messages you typed, ${r.design} design judgments, ${r.withImages} with a screenshot beside them.`);
  },
  async stats() {
    const db = open();
    const rows = db.prepare(`select coalesce(project, '(unknown)') p, count(*) n, sum(before != '[]' or pasted != '[]') shots
      from moments where design = 1 group by p order by n desc`).all() as { p: string; n: number; shots: number }[];
    for (const r of rows) console.log(`${String(r.n).padStart(4)}  ${String(r.shots).padStart(4)} with shots  ${r.p}`);
  },
  help() {
    console.log(`understudy <command>

  archive   copy every Claude Code session log into the archive
  mine      find the messages you typed and what you saw around them
  stats     design judgments per project
  serve     open the prompt book (npm run serve)`);
  },
};

await (commands[cmd ?? 'help'] ?? commands.help)();

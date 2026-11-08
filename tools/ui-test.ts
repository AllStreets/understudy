// Acceptance test of the book, end to end, in a real browser against a real server.
// It runs on a throwaway copy of the sample data and installs skills into a temp folder,
// so nothing of yours is touched.   npx tsx tools/ui-test.ts
import { chromium, type Page } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const work = mkdtempSync(join(tmpdir(), 'understudy-ui-'));
const home = join(work, 'home'), skills = join(work, 'skills'), repo = join(work, 'repo');
const sample = join(root, '.understudy-local', 'sample');
if (!existsSync(join(sample, 'understudy.db'))) { console.error('Build the sample first: UNDERSTUDY_HOME=.understudy-local/sample npx tsx tools/sample.ts'); process.exit(1); }
execFileSync('cp', ['-cR', sample, home]);
process.env.UNDERSTUDY_HOME = home;
const { open } = await import('../src/store.ts');
const { snapshotTree } = await import('../src/check.ts');

// a real repository with a real fix in it, for Undo to take back
mkdirSync(repo); const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
g('init', '-q'); writeFileSync(join(repo, 'style.css'), '.hero { text-shadow: 0 0 24px #8b5cf6; }\n'); g('add', '-A'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'page');
const before = snapshotTree(repo)!;
writeFileSync(join(repo, 'style.css'), '.hero { text-shadow: none; }\n'); writeFileSync(join(repo, 'list.css'), 'td { border-top: 1px solid #d9d3c4; }\n');
const patch = execFileSync('git', ['diff', '--binary', before, snapshotTree(repo)!], { cwd: repo, encoding: 'utf8' });
const db = open();
const proto = db.prepare('select * from checks limit 1').get() as any;
if (!proto) { console.error('The sample has no check to copy; run tools/e2e.sh against it first.'); process.exit(1); }
db.exec('delete from checks');
db.prepare(`insert into checks (id, at, project, target, before_shot, after_shot, notes, found, verdict, rounds, patch, cwd) values ('ui-check', ?, 'northwind', 'http://127.0.0.1:4740/', ?, ?, ?, ?, 'meets', 2, ?, ?)`)
  .run(new Date().toISOString(), proto.before_shot, proto.after_shot, proto.found ?? proto.notes, proto.found ?? proto.notes, patch, repo);
db.exec(`update pairs set pick = null, picked_at = null; delete from moments where id like 'pair:%'; delete from readings where moment like 'pair:%';
  update lessons set status = 'ready', installed = null where status in ('ready', 'installed')`);

const PORT = 4733;
const server = spawn(join(root, 'node_modules', '.bin', 'tsx'), ['src/server.ts'], { cwd: root, env: { ...process.env, UNDERSTUDY_HOME: home, UNDERSTUDY_PORT: String(PORT), UNDERSTUDY_SKILLS_DIR: skills }, stdio: 'ignore' });
const url = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 40; i++) { try { await fetch(url + 'api/summary'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }

const results: [string, boolean, string][] = [];
const expect = (name: string, ok: boolean, detail = '') => { results.push([name, ok, detail]); console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
const api = (p: string) => fetch(url + p).then(r => r.json());
const u = <T>(js: string) => page.evaluate(js) as Promise<T>;
const wait = (ms: number) => page.waitForTimeout(ms);
const click = async (name: string, after = 1800) => { const p = await u<{ x: number; y: number } | null>(`understudy.where(${JSON.stringify(name)})`); if (!p) throw new Error(`nothing at ${name}`); await page.mouse.click(p.x, p.y); await wait(after); };
// the average colour of a few pixels around a point on screen
async function colour(name: string): Promise<[number, number, number]> {
  const p = (await u<{ x: number; y: number }>(`understudy.where(${JSON.stringify(name)})`))!;
  const buf = await page.screenshot({ clip: { x: p.x - 4, y: p.y + 2, width: 8, height: 8 } });
  // decoded in the page itself, so the test needs no image library
  return page.evaluate(async (b64: string) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const k = c.getContext('2d')!; k.drawImage(img, 0, 0); const d = k.getImageData(0, 0, c.width, c.height).data; let r = 0, gg = 0, bb = 0, n = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; bb += d[i + 2]; n++; } return [r / n, gg / n, bb / n].map(Math.round) as [number, number, number]; }, buf.toString('base64'));
}
// a picture of the cue box in each state, for a person to look at as well
const snapLamps = async (label: string) => { const p = (await u<{ x: number; y: number }>('understudy.where("lamp:standby")'))!; await page.screenshot({ path: join(work, `lamps-${label}.png`), clip: { x: p.x - 90, y: p.y - 70, width: 180, height: 220 } }); };
const isRed = ([r, g, b]: number[]) => r > 150 && r > g * 2.2 && r > b * 2.2;
const isGreen = ([r, g, b]: number[]) => g > 150 && g > r * 2.2 && g > b * 2.2;
const isDark = ([r, g, b]: number[]) => Math.max(r, g, b) < 110;

try {
  await page.goto(url); await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 60000 }); await wait(1500);
  const sections = await u<string[]>('understudy.book()');
  expect('the book has every section', ['call', 'calibrate', 'rehearse', 'bible', 'run'].every(s => sections.includes(s)), [...new Set(sections)].join(', '));
  expect('it opens on Your call', (await u<string>('understudy.key()')) === 'call:ui-check');

  let sb = await colour('lamp:standby'), go = await colour('lamp:go');
  expect('a call waiting: Standby is lit red', (await u<string>('understudy.lamp()')) === 'standby' && isRed(sb), `standby rgb ${sb}`);
  expect('a call waiting: Go is dark', isDark(go), `go rgb ${go}`);
  await snapLamps('standby');

  const home0 = (await u<{ x: number; y: number }>('understudy.where("print:0")'))!;
  await click('print:0', 1600);
  const lifted = (await u<{ x: number; y: number }>('understudy.where("print:0")'))!;
  expect('clicking the before print lifts it to the middle of the view', Math.hypot(lifted.x - 720, lifted.y - 450) < Math.hypot(home0.x - 720, home0.y - 450) - 150, `${Math.round(home0.x)},${Math.round(home0.y)} to ${Math.round(lifted.x)},${Math.round(lifted.y)}`);
  await page.keyboard.press('Escape'); await wait(1300);
  const back = (await u<{ x: number; y: number }>('understudy.where("print:0")'))!;
  expect('Escape puts it back on the page', Math.hypot(back.x - home0.x, back.y - home0.y) < 8);

  await click('call:keep', 1800);
  let c = (await api('api/checks')).find((x: any) => x.id === 'ui-check');
  sb = await colour('lamp:standby'); go = await colour('lamp:go');
  expect('Keep it is recorded', c?.call === 'keep');
  expect('kept: Go is lit green', (await u<string>('understudy.lamp()')) === 'go' && isGreen(go), `go rgb ${go}`);
  expect('kept: Standby is dark', isDark(sb), `standby rgb ${sb}`);
  await snapLamps('go');

  await click('call:not-quite', 1800);
  c = (await api('api/checks')).find((x: any) => x.id === 'ui-check');
  expect('Not quite is recorded', c?.call === 'not-quite');

  await click('call:undo', 2200);
  c = (await api('api/checks')).find((x: any) => x.id === 'ui-check');
  expect('Undo fix is recorded', c?.call === 'undo');
  expect('Undo took the fix back in the repository', readFileSync(join(repo, 'style.css'), 'utf8').includes('24px') && !existsSync(join(repo, 'list.css')));

  await click('tab:calibrate', 2400);
  const pairKey = await u<string>('understudy.key()');
  expect('the Calibration tab opens a pair', pairKey.startsWith('pair:'));
  await click('pick:a', 3200);
  const pid = pairKey.slice(5);
  const picked = db.prepare('select pick from pairs where id = ?').get(pid) as any;
  const learnt = db.prepare('select gist from readings where moment = ?').get(`pair:${pid}`) as any;
  expect('a pick is recorded and becomes a judgment', picked?.pick === 'a' && !!learnt?.gist, learnt?.gist ?? '');
  expect('the next pair turns up on its own', (await u<string>('understudy.key()')) !== pairKey);

  await click('tab:rehearse', 2400);
  sb = await colour('lamp:standby');
  expect('a task ready to go on: Standby is lit red', (await u<string>('understudy.lamp()')) === 'standby' && isRed(sb), `standby rgb ${sb}`);
  await click('go-on', 2200);
  const installed = existsSync(skills) ? readdirSync(skills).flatMap(d => existsSync(join(skills, d, 'SKILL.md')) ? [d] : []) : [];
  go = await colour('lamp:go');
  expect('Let it go on installs the skill', installed.length === 1, installed.join(', '));
  expect('installed: Go is lit green', (await u<string>('understudy.lamp()')) === 'go' && isGreen(go), `go rgb ${go}`);

  await click('tab:bible', 2400);
  expect('the bible tab opens the bible', (await u<string>('understudy.key()')).startsWith('bible:'));
  await click('tab:run', 2400);
  const runKey = await u<string>('understudy.key()');
  expect('the run tab opens the run', runKey.startsWith('run:'));
  await page.keyboard.press('ArrowRight'); await wait(1600);
  const nextKey = await u<string>('understudy.key()');
  expect('the right arrow turns the page', nextKey !== runKey && nextKey.startsWith('run:'));
  await page.keyboard.press('ArrowLeft'); await wait(1600);
  expect('the left arrow turns it back', (await u<string>('understudy.key()')) === runKey);
  await click('next', 1800);
  expect('clicking the outer edge of the page turns it', (await u<string>('understudy.key()')) === nextKey);

  const forged = await fetch(url + 'api/checks/ui-check/call', { method: 'POST', body: JSON.stringify({ call: 'keep' }) });
  expect('a write without the header is refused', forged.status === 403);
  expect('no errors in the page', errors.length === 0, errors.join(' | '));
} catch (e) {
  expect('the test ran to the end', false, (e as Error).message);
} finally {
  await browser.close(); server.kill();
}
const failed = results.filter(r => !r[1]).length;
console.log(`\n${results.length - failed} of ${results.length} passed. Pictures of the lamps: ${work}/lamps-*.png`);
process.exitCode = failed ? 1 : 0;

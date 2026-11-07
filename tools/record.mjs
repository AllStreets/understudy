// Record the prompt book for the README: a headless browser walks through the app while
// Playwright records the page, then ffmpeg makes a GIF and an MP4.
//   node tools/record.mjs [url] [out-name]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const url = process.argv[2] ?? 'http://127.0.0.1:4730/';
const name = process.argv[3] ?? 'demo';
const W = 1440, H = 900;
const dir = mkdtempSync(join(tmpdir(), 'understudy-rec-'));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } } });
const page = await ctx.newPage();
const wait = ms => page.waitForTimeout(ms);
const go = js => page.evaluate(`void (${js})`);
// a visible cursor, since the recording does not draw the system one
await page.addInitScript(() => addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div'); c.id = 'rec-cursor';
  c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;pointer-events:none;z-index:9;transform:translate(-3px,-2px)';
  c.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2 L3 18 L7.5 13.8 L10.6 20.4 L13.4 19.1 L10.4 12.6 L16.4 12.4 Z" fill="#fff" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  document.body.appendChild(c);
  addEventListener('pointermove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
}));
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 60000 });
const start = (Date.now() - t0) / 1000 + .4;
const move = async (x, y, steps = 24) => page.mouse.move(x, y, { steps });

const at = name => page.evaluate(n => window.understudy.where(n), name);
const click = async (name, after = 2400) => { const p = await at(name); if (!p) throw new Error(`nothing at ${name}`); await move(p.x, p.y); await wait(260); await page.mouse.down(); await page.mouse.up(); await wait(after); };
await page.mouse.move(720, 860); await wait(1500);
// read the before: it lifts off the page, then goes back
await click('print:0', 2800); await page.mouse.down(); await page.mouse.up(); await wait(1300);
// and the after
await click('print:1', 2600); await page.mouse.down(); await page.mouse.up(); await wait(1200);
// keep it: the pencil ticks the box, the cue light goes green
await click('call:keep', 2400);
// calibration: pick one, and the next pair turns up
await click('tab:calibrate', 2600); await click('pick:b', 3200);
// a taught task and its rehearsals (looked at, never installed: that would write a real skill)
await click('tab:rehearse', 3400);
// the bible, then the run
await click('tab:bible', 2800); await click('tab:run', 2600); await click('next', 3000);
// put the call back the way it was, so recording leaves no trace
await page.evaluate(() => fetch('/api/checks').then(r => r.json()).then(cs => Promise.all(cs.map(c => fetch(`/api/checks/${c.id}/call`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-understudy': '1' }, body: JSON.stringify({ call: 'reset' }) })))));
await ctx.close(); await browser.close();

const webm = join(dir, readdirSync(dir).find(f => f.endsWith('.webm')));
mkdirSync('docs/media', { recursive: true });
const mp4 = `docs/media/${name}.mp4`, gif = `docs/media/${name}.gif`;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(start), '-i', webm, '-vf', 'scale=1440:-2', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf', 'fps=15,scale=1100:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=200:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle', gif]);
renameSync(webm, `${dir}/raw.webm`);
console.log(mp4, gif);

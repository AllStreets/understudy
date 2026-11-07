// Build the sample dataset used for the README and for trying Understudy without history:
// a fictional designer's judgments on a fictional studio site, with screenshots rendered from
// the fixture pages in test/fixtures. Run with UNDERSTUDY_HOME pointing somewhere new:
//   UNDERSTUDY_HOME=.understudy-local/sample npx tsx tools/sample.ts
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { paths, ensureDirs } from '../src/paths.ts';
import { open } from '../src/store.ts';

if (!process.env.UNDERSTUDY_HOME) { console.error('Set UNDERSTUDY_HOME to a new folder first; the sample never touches your real data.'); process.exit(1); }
ensureDirs();
const db = open();
const fx = (n: string) => 'file://' + resolve('test/fixtures', n, 'index.html');

// renders of the fixture pages, with CSS changes standing in for an agent's attempts
const RENDERS: Record<string, { page: string; css?: string }> = {
  generic: { page: 'site' },
  noglow: { page: 'site', css: '.glow{text-shadow:none!important;color:inherit!important}.cta{box-shadow:none!important}.hero{background:#0b0d17!important}' },
  nocaps: { page: 'site', css: '.eyebrow{display:none!important}.glow{text-shadow:none!important;color:inherit!important}.hero{background:#0b0d17!important}' },
  quiet: { page: 'site-quiet' },
  quietdark: { page: 'site-quiet', css: 'body{background:#1b1a17!important;color:#e9e4d8!important}.top,td{border-color:#3a362e!important}nav a{color:#e9e4d8!important}.sub,td span{color:#a49c8a!important}' },
  quietpills: { page: 'site-quiet', css: '.stack{font-size:0!important}.stack::after{content:"React";font-size:12px;padding:4px 10px;border-radius:999px;background:#e2dccd;color:#5d574b}' },
};
const shas: Record<string, string> = {};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const [name, r] of Object.entries(RENDERS)) {
  await page.goto(fx(r.page)); if (r.css) await page.addStyleTag({ content: r.css }); await page.waitForTimeout(700);
  const buf = await page.screenshot();
  const sha = createHash('sha1').update(buf).digest('hex').slice(0, 20);
  const p = join(paths.images, `${sha}.png`); writeFileSync(p, buf);
  db.prepare('insert or ignore into images (sha, path, media, bytes) values (?, ?, ?, ?)').run(sha, p, 'image/png', buf.length);
  shas[name] = sha;
}
await browser.close();

// the sample designer's judgments: what they saw, what they wrote, what came next
type S = { at: string; project: string; said: string; text: string; before: string; after?: string; readings: [string, string, string][] };
const SAMPLE: S[] = [
  { at: '2026-09-14T15:02:00Z', project: 'northwind', before: 'generic', after: 'noglow', said: 'The landing page is up: hero, call to action and the three projects as cards.',
    text: 'too much glow on the headline and the button. it reads like a nightclub, not a studio. take it all off',
    readings: [['reject', 'too much glow on the headline and the button', 'You reject glow and neon effects on type and buttons.']] },
  { at: '2026-09-14T15:20:00Z', project: 'northwind', before: 'noglow', after: 'nocaps', said: 'Glow removed from the headline and the button.',
    text: 'better. now lose the tiny spaced-out caps label above the headline, nobody reads those. and why is one word a different colour? highlight nothing',
    readings: [['reject', 'lose the tiny spaced-out caps label above the headline', 'You reject small tracked-out all-caps labels above headings.'], ['reject', 'why is one word a different colour? highlight nothing', 'You reject colouring a single word in a headline for emphasis.']] },
  { at: '2026-09-16T10:41:00Z', project: 'northwind', before: 'nocaps', after: 'quiet', said: 'The projects are three cards with tags and a Visit link.',
    text: "the cards look like every template I've seen this year. a plain list with real links is fine. and every project needs a code link, not just visit",
    readings: [['reject', "the cards look like every template I've seen this year", 'You reject identical rounded cards for lists of things.'], ['direct', 'every project needs a code link, not just visit', 'You want every project to link to its code as well as its live site.']] },
  { at: '2026-09-16T11:05:00Z', project: 'northwind', before: 'quiet', said: 'Switched to a ruled list in a serif with Live and Code links on each row.',
    text: 'yes. love the serif headline, that is the one. keep the paper colour',
    readings: [['approve', 'love the serif headline', 'You like a large serif headline with tight leading.'], ['approve', 'keep the paper colour', 'You prefer a warm paper-toned background over pure white or black.']] },
  { at: '2026-09-21T09:12:00Z', project: 'ledger', before: 'quietdark', after: 'quiet', said: 'Added a dark mode that follows the system setting.',
    text: 'the dark version looks muddy. if it can not be as good as the light one, ship light only',
    readings: [['reject', 'the dark version looks muddy', 'You would rather ship one excellent theme than a weaker second one.']] },
  { at: '2026-09-22T16:30:00Z', project: 'ledger', before: 'quietpills', after: 'quiet', said: 'Tech stack shown as tag chips on each row.',
    text: 'no pills. plain text in a quieter grey says the same thing',
    readings: [['reject', 'no pills', 'You reject pill-shaped tag chips; plain secondary text is enough.']] },
  { at: '2026-10-02T13:48:00Z', project: 'relay', before: 'generic', said: 'Here is the first pass at the Relay marketing page, same system as Northwind.',
    text: "there's dead space under the grid, half the screen is empty. either bring the content up or end the page",
    readings: [['reject', "there's dead space under the grid", 'You dislike large empty areas that hold nothing.']] },
  { at: '2026-10-03T10:02:00Z', project: 'relay', before: 'quiet', said: 'Relay now uses the Northwind layout.',
    text: 'good, this matches northwind. keep them uniform, same rules, same grey, same links',
    readings: [['approve', 'keep them uniform, same rules, same grey, same links', 'You want sibling projects to share one consistent visual system.']] },
];
db.exec('begin');
SAMPLE.forEach((s, i) => {
  const id = `sample:${i + 1}`;
  db.prepare(`insert or replace into moments (id, session, line, at, project, text, said_before, said_after, pasted, before, after, design, taste, kind, aspect, quote, gist)
    values (?, 'sample', ?, ?, ?, ?, ?, '', '[]', ?, ?, 1, 1, ?, 'look', ?, ?)`).run(id, i + 1, s.at, s.project, s.text, s.said, JSON.stringify([shas[s.before]]), JSON.stringify(s.after ? [shas[s.after]] : []), s.readings[0][0], s.readings[0][1], s.readings[0][2]);
  s.readings.forEach(([kind, quote, gist], n) => db.prepare('insert or replace into readings (id, moment, kind, aspect, quote, gist) values (?, ?, ?, ?, ?, ?)').run(`${id}#${n}`, id, kind, 'look', quote, gist));
});
const STATEMENTS: [string, string, string[]][] = [
  ['no-glow', 'You reject glow, neon and gradient effects on type and buttons.', ['sample:1#0']],
  ['no-template-cards', 'You reject identical rounded cards and pill chips; a ruled list with plain secondary text is enough.', ['sample:3#0', 'sample:6#0']],
  ['no-caps-eyebrows', 'You reject tracked-out all-caps labels above headings, and colouring one word of a headline.', ['sample:2#0', 'sample:2#1']],
  ['code-links', 'You want every project to link to its code as well as its live site.', ['sample:3#1']],
  ['serif-on-paper', 'You like a large serif headline on a warm paper background.', ['sample:4#0', 'sample:4#1']],
  ['one-good-theme', 'You would rather ship one excellent theme than add a weaker second one.', ['sample:5#0']],
  ['no-dead-space', 'You dislike large empty areas that hold nothing.', ['sample:7#0']],
  ['uniform-siblings', 'You want sibling projects to share one consistent visual system.', ['sample:8#0']],
];
for (const [id, text, ev] of STATEMENTS) db.prepare('insert or replace into statements (id, text, aspect, evidence, weight) values (?, ?, ?, ?, ?)').run(id, text, 'look', JSON.stringify(ev), ev.length);
db.prepare(`insert or replace into sessions (id, source, archived, lines, bytes, first_at, last_at, archived_at, mined) values ('sample', 'sample', 'sample', 0, 0, ?, ?, ?, 0)`).run(SAMPLE[0].at, SAMPLE.at(-1)!.at, new Date().toISOString());
db.exec('commit');
console.log(`Sample at ${paths.home}: ${SAMPLE.length} moments, ${SAMPLE.reduce((n, s) => n + s.readings.length, 0)} readings, ${STATEMENTS.length} statements.`);

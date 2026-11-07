// Calibration: for someone with little history, or to fill gaps in what has been learned.
// Understudy takes one of their own pages and renders it twice, changed in one thing only,
// and they pick the one that reads more like them. Each pick becomes a judgment.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { open } from './store.ts';
import { paths, ensureDirs } from './paths.ts';
import { ask, MODELS } from './claude.ts';

export type Variant = { label: string; css: string };
export type PairPlan = { dimension: string; question: string; a: Variant; b: Variant };

const PLAN_SCHEMA = {
  type: 'object', required: ['pairs'],
  properties: { pairs: { type: 'array', items: { type: 'object', required: ['dimension', 'question', 'a', 'b'], properties: {
    dimension: { type: 'string', description: 'the one thing that differs, in two or three words' },
    question: { type: 'string', description: 'a short plain question, like "Tighter or looser spacing?"' },
    a: { type: 'object', required: ['label', 'css'], properties: { label: { type: 'string' }, css: { type: 'string' } } },
    b: { type: 'object', required: ['label', 'css'], properties: { label: { type: 'string' }, css: { type: 'string' } } },
  } } } },
};

// Plan pairs for a page, aimed at what the bible says least about.
export async function plan(html: string, n: number): Promise<{ pairs: PairPlan[]; cost: number }> {
  const db = open();
  const known = (db.prepare('select text from statements where removed = 0').all() as { text: string }[]).map(s => s.text);
  const asked = (db.prepare('select dimension from pairs').all() as { dimension: string }[]).map(p => p.dimension);
  const prompt = `Here is the HTML and CSS of a page someone built:\n\n${html.slice(0, 24000)}\n\n` +
    (known.length ? `What is already known about their taste:\n${known.map(k => `- ${k}`).join('\n')}\n\n` : 'Nothing is known about their taste yet.\n\n') +
    (asked.length ? `Already asked about: ${asked.join(', ')}.\n\n` : '') +
    `Plan ${n} pairs of variations of this page. In each pair, the two versions differ in exactly one visual dimension (for example spacing and density, type family, type scale, corner radius, surface depth and shadow, accent colour use, contrast, alignment, border weight, imagery treatment) and are otherwise the same page. Each version is a block of CSS that will be injected after the page's own styles; target the page's real selectors and use !important where needed. Neither version should be a deliberately bad strawman: both should be credible choices a good designer might make. Prefer dimensions that what is known says nothing about.`;
  const { value, cost } = await ask<{ pairs: PairPlan[] }>(prompt, { model: MODELS.judge, schema: PLAN_SCHEMA, system: 'You design controlled visual experiments. One variable per pair.' });
  return { pairs: value.pairs.slice(0, n), cost };
}

export async function calibrate(url: string, o: { n?: number; project?: string; log?: (s: string) => void } = {}): Promise<{ made: number; cost: number }> {
  ensureDirs();
  const log = o.log ?? (() => {});
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => page.goto(url));
    const html = await page.evaluate(() => {
      const css = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules].map(r => r.cssText); } catch { return []; } }).join('\n');
      const body = document.body.outerHTML.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>');
      return `<style>\n${css.slice(0, 12000)}\n</style>\n${body.slice(0, 12000)}`;
    });
    log('Planning pairs...');
    const { pairs, cost } = await plan(html, o.n ?? 6);
    const db = open();
    const put = db.prepare('insert into pairs (id, at, project, url, dimension, question, a_label, a_css, a_shot, b_label, b_css, b_shot) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    let made = 0;
    for (const p of pairs) {
      const id = randomUUID().slice(0, 12), shots: string[] = [];
      for (const v of [p.a, p.b]) {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => page.goto(url));
        await page.addStyleTag({ content: v.css }).catch(() => {});
        await page.waitForTimeout(500);
        const out = join(paths.shots, `pair-${id}-${shots.length ? 'b' : 'a'}.png`); await page.screenshot({ path: out }); shots.push(out);
      }
      put.run(id, new Date().toISOString(), o.project ?? null, url, p.dimension, p.question, p.a.label, p.a.css, shots[0], p.b.label, p.b.css, shots[1]);
      log(`  ${p.question}  ${p.a.label} / ${p.b.label}`); made++;
    }
    return { made, cost };
  } finally { await browser.close(); }
}

// A pick becomes a judgment: a moment of its own with one reading, so the bible learns from it.
export function pick(id: string, choice: 'a' | 'b' | 'neither', note?: string) {
  const db = open();
  const p = db.prepare('select * from pairs where id = ?').get(id) as { id: string; project: string | null; dimension: string; question: string; a_label: string; b_label: string; a_shot: string; b_shot: string } | undefined;
  if (!p) return { ok: false };
  const at = new Date().toISOString();
  db.prepare('update pairs set pick = ?, picked_at = ? where id = ?').run(choice, at, id);
  db.prepare('insert into verdicts (at, subject, call, note) values (?, ?, ?, ?)').run(at, `pair:${id}`, `prefer-${choice}`, note ?? null);
  const mid = `pair:${id}`;
  db.prepare('delete from readings where moment = ?').run(mid);
  db.prepare('delete from moments where id = ?').run(mid);
  if (choice === 'neither') return { ok: true };
  const [win, lose] = choice === 'a' ? [p.a_label, p.b_label] : [p.b_label, p.a_label];
  const text = `${p.question} Picked "${win}" over "${lose}".${note ? ` ${note}` : ''}`;
  db.prepare(`insert into moments (id, session, line, at, project, text, pasted, before, after, design, taste, kind, aspect, quote, gist) values (?, 'calibration', 0, ?, ?, ?, '[]', '[]', '[]', 1, 1, 'pick', 'look', ?, ?)`)
    .run(mid, at, p.project, text, `${win} over ${lose}`, `You prefer ${win.toLowerCase()} over ${lose.toLowerCase()} (${p.dimension}).`);
  db.prepare('insert into readings (id, moment, kind, aspect, quote, gist) values (?, ?, ?, ?, ?, ?)').run(`${mid}#0`, mid, 'pick', 'look', `${win} over ${lose}`, `You prefer ${win.toLowerCase()} over ${lose.toLowerCase()} (${p.dimension}).`);
  return { ok: true };
}

export const pairsWaiting = () => (open().prepare('select * from pairs where pick is null order by at').all() as any[]);

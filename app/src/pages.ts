// The book's pages. A spread is drawn as two canvases plus the prints pasted on it.
// Sections: Your call (checks waiting for a decision), the Bible (what it has learned),
// the Run (every judgment it learned from, one per spread).
import { CW, CH, PW, PH, paper, font, SANS, INK, INK_SOFT, INK_FAINT, RED, GRAPHITE, cue, wrap, rule, underline, ring, pencil, tick, day, hash, type Ctx } from './paper.ts';
import type { PrintSpec } from './props.ts';

export type Reading = { id: string; moment: string; kind: string; aspect: string; quote: string; gist: string };
export type Moment = { id: string; at: string; project: string; text: string; saidBefore: string; saidAfter: string; pasted: string[]; before: string[]; after: string[]; kind: string; aspect: string; quote: string; gist: string; readings: Reading[] };
export type Statement = { id: string; text: string; aspect: string; evidence: string[]; weight: number };
export type Note = { claim: string; fix: string; severity: 'must' | 'should'; cite: string | null; quote: string | null; when: string | null; own: boolean; where: { x: number; y: number; w: number; h: number } | null };
export type Check = { id: string; at: string; project: string; target: string; before_shot: string; after_shot: string | null; notes: Note[]; verdict: string; rounds: number; call: string | null };
export type Hit = { id: string; x0: number; x1: number; y0: number; y1: number; side: 'left' | 'right' };
export type Spread = { key: string; left: HTMLCanvasElement; right: HTMLCanvasElement; prints: PrintSpec[]; hits: Hit[]; folio: string; state?: 'standby' | 'go' | 'dark' };

const L = 150, R = CW - 200;                 // text block on a left page (spine on its right)
const RL = 190, RR = CW - 140;               // text block on a right page (spine on its left)
const blank = (spine: 'left' | 'right') => { const c = document.createElement('canvas'); c.width = CW; c.height = CH; paper(c.getContext('2d')!, spine); return c; };
const ctx = (c: HTMLCanvasElement) => c.getContext('2d')!;
function folio(k: Ctx, text: string, side: 'left' | 'right') { k.font = font(32, { family: SANS }); k.fillStyle = INK_FAINT; k.textAlign = side === 'left' ? 'left' : 'right'; k.fillText(text, side === 'left' ? L - 40 : RR, CH - 110); k.textAlign = 'left'; }
function header(k: Ctx, title: string, sub: string, x: number, x1: number) {
  k.fillStyle = INK; k.font = font(74); k.fillText(title, x, 210);
  k.font = font(44, { italic: true }); k.fillStyle = INK_SOFT; const y = wrap(k, sub, x, 280, x1 - x, 54, 2);
  rule(k, x, x1, y - 10);
  return y + 90;
}
function marginRule(k: Ctx) { k.strokeStyle = 'rgba(200,110,95,.55)'; k.lineWidth = 2; k.beginPath(); k.moveTo(L - 40, 0); k.lineTo(L - 40, CH); k.stroke(); }
const projectName = (p?: string | null) => (p ?? 'a project').replace(/[_-]+/g, ' ').replace(/\b(open world)\b/i, 'Open World');

// Page coordinates for a print, given its centre on the page in scene units.
export const P = { x: (px: number) => px / CW * PW - PW / 2, y: (py: number) => PH / 2 - py / CH * PH };

// ----- Your call -----
export function callSpread(c: Check, i: number, total: number, imgs: { before: HTMLImageElement; after?: HTMLImageElement }): Spread {
  const left = blank('right'), right = blank('left'), k = ctx(left), r = ctx(right), hits: Hit[] = [];
  marginRule(k);
  let y = header(k, projectName(c.project), `${c.verdict === 'meets' ? `Held at your bar after ${c.rounds} ${c.rounds === 1 ? 'pass' : 'passes'}.` : c.verdict === 'stuck' ? `Stuck after ${c.rounds} passes. Here is the best it got.` : 'Misses your bar.'} ${day(c.at)}.`, L, R) + 30;
  c.notes.forEach((n, j) => {
    const own = n.own || !n.quote, col = own ? GRAPHITE : RED;
    cue(k, String(j + 1), L - 40, y, col, hash(c.id) + j);
    k.font = font(48); k.fillStyle = INK; y = wrap(k, n.claim, L + 40, y, R - L - 40, 64, 4);
    if (n.quote) { k.font = font(46, { italic: true }); k.fillStyle = '#8f3424'; y = wrap(k, `“${n.quote}”`, L + 40, y + 10, R - L - 40, 60, 3); }
    k.font = font(34, { family: SANS }); k.fillStyle = INK_FAINT; k.fillText(own ? 'Understudy’s own note, no past judgment behind it' : (n.cites?.[0] ?? 'You'), L + 40, y + 14);
    y += 130;
  });
  const by = CH - 300;
  rule(k, L, R, by - 110);
  k.font = font(40, { italic: true }); k.fillStyle = INK_SOFT; k.fillText('Your call', L, by - 40);
  let x = L;
  for (const [id, label] of [['keep', 'Keep it'], ['undo', 'Undo fix'], ['not-quite', 'Not quite']] as const) {
    k.strokeStyle = '#3a342b'; k.lineWidth = 3; k.strokeRect(x, by + 10, 56, 56);
    k.font = font(48); k.fillStyle = INK; k.fillText(label, x + 82, by + 56);
    const w = 82 + k.measureText(label).width;
    hits.push({ id: `call:${id}`, x0: x - 10, x1: x + w + 10, y0: by - 10, y1: by + 86, side: 'left' });
    if (c.call === id) tick(k, x, by + 10, hash(c.id + id));
    x += w + 90;
  }
  folio(k, `${i + 1} of ${total} waiting`, 'left');
  r.fillStyle = '#5d5446'; r.font = font(46, { italic: true });
  r.fillText('As the agent left it.', RL, 1560);
  if (imgs.after) { r.fillText('After Understudy’s fixes.', 905, 1560); underline(r, 905, 1420, 1580, { color: GRAPHITE }); }
  r.font = font(34, { family: SANS }); r.fillStyle = INK_FAINT; wrap(r, c.target, RL, 1740, RR - RL, 46, 2);
  const prints: PrintSpec[] = [{ img: imgs.before, x: -.5, y: .32, w: .96, rot: -.012, marks: (pk, W, H) => {
    c.notes.forEach((n, j) => { if (!n.where || n.own) return; const cx = (n.where.x + n.where.w / 2) * W, cy = (n.where.y + n.where.h / 2) * H;
      pencil(pk, ring(cx, cy, n.where.w * W / 2 + 18, n.where.h * H / 2 + 14, -.02, 1.1, j + 3), { color: RED, width: 5, alpha: .32, seed: j });
      pk.fillStyle = 'rgba(251,250,246,.88)'; pk.beginPath(); pk.arc(Math.max(34, cx - n.where.w * W / 2 - 10), cy - n.where.h * H / 2, 30, 0, 7); pk.fill();
      pk.font = font(40, { weight: 500 }); pk.fillStyle = '#b0301f'; pk.textAlign = 'center'; pk.fillText(String(j + 1), Math.max(34, cx - n.where.w * W / 2 - 10), cy - n.where.h * H / 2 + 13); pk.textAlign = 'left'; }); } }];
  if (imgs.after) prints.push({ img: imgs.after, x: .52, y: .32, w: .96, rot: .009 });
  return { key: `call:${c.id}`, left, right, prints, hits, folio: `${i + 1}/${total}`, state: c.call === 'keep' ? 'go' : c.call ? 'dark' : 'standby' };
}

// ----- The bible: what it has learned, four statements to a page -----
export function bibleSpreads(st: Statement[], byId: Map<string, Moment>, summary: { sessions: number; taste: number }): Spread[] {
  const momentOf = (rid: string) => byId.get(rid.split('#')[0]);
  const readingOf = (rid: string) => momentOf(rid)?.readings.find(r => r.id === rid);
  const per = 4, pages: Statement[][] = [];
  for (let i = 0; i < st.length; i += per) pages.push(st.slice(i, i + per));
  if (!pages.length) pages.push([]);
  const spreads: Spread[] = [];
  let n = 0;
  for (let p = 0; p < pages.length; p += 2) {
    const left = blank('right'), right = blank('left'), hits: Hit[] = [];
    const draw = (k: Ctx, items: Statement[], side: 'left' | 'right', first: boolean) => {
      const x0 = side === 'left' ? L : RL, x1 = side === 'left' ? R : RR;
      if (side === 'left') marginRule(k);
      let y = 210;
      if (first) y = header(k, 'The bible', `What Understudy has learned about your eye, from ${summary.taste} judgments across ${summary.sessions} sessions.`, x0, x1) + 30;
      for (const s of items) {
        n++;
        const ev = s.evidence.map(id => ({ m: momentOf(id), r: readingOf(id) })).filter((x): x is { m: Moment; r: Reading } => !!x.m && !!x.r).sort((a, b) => a.m.at.localeCompare(b.m.at));
        cue(k, String(n), x0 - 40 + (side === 'right' ? 0 : 0), y, ev.length > 2 ? RED : GRAPHITE, hash(s.id));
        k.font = font(46); k.fillStyle = INK; const top = y; y = wrap(k, s.text, x0 + 40, y, x1 - x0 - 40, 60, 3);
        const best = ev.find(m => m.quote && m.quote.length < 90) ?? ev[0];
        if (best?.quote) { k.font = font(40, { italic: true }); k.fillStyle = '#8f3424'; y = wrap(k, `“${best.quote}”`, x0 + 40, y + 6, x1 - x0 - 40, 52, 2); }
        k.font = font(32, { family: SANS }); k.fillStyle = INK_FAINT;
        k.fillText(`${ev.length} ${ev.length === 1 ? 'moment' : 'moments'}${best ? `, first ${day(ev[0].at)} on ${projectName(best.project)}` : ''}`, x0 + 40, y + 10);
        hits.push({ id: `stmt:${s.id}`, x0: x0 - 80, x1, y0: top - 60, y1: y + 30, side });
        y += 110;
      }
      if (!items.length && first) { k.font = font(44, { italic: true }); k.fillStyle = INK_SOFT; wrap(k, 'Nothing learned yet. Run understudy read and understudy distil.', x0, y, x1 - x0, 56); }
    };
    draw(ctx(left), pages[p], 'left', p === 0);
    if (pages[p + 1]) draw(ctx(right), pages[p + 1], 'right', false);
    folio(ctx(left), `Bible, ${p / 2 + 1} of ${Math.ceil(pages.length / 2)}`, 'left');
    spreads.push({ key: `bible:${p / 2}`, left, right, prints: [], hits, folio: '' });
  }
  return spreads;
}

// ----- The run: one judgment per spread, with what you saw -----
const KIND: Record<string, string> = { reject: 'You turned this down.', approve: 'You approved this.', mixed: 'You liked some of it.', direct: 'You asked for a change.', pick: 'You picked between options.', other: '' };
export function runSpread(m: Moment, i: number, total: number, imgs: { before?: HTMLImageElement; after?: HTMLImageElement; pasted?: HTMLImageElement }): Spread {
  const left = blank('right'), right = blank('left'), k = ctx(left), r = ctx(right);
  marginRule(k);
  let y = header(k, projectName(m.project), `${day(m.at)}. ${KIND[m.kind] ?? ''}`, L, R) + 20;
  if (m.saidBefore) {
    k.font = font(32, { family: SANS }); k.fillStyle = INK_FAINT; k.fillText('The agent had said', L, y); y += 56;
    k.font = font(38); k.fillStyle = INK_SOFT; y = wrap(k, m.saidBefore.replace(/[#*`>|]/g, '').slice(-420), L, y, R - L, 50, 4) + 40;
  }
  k.font = font(32, { family: SANS }); k.fillStyle = INK_FAINT; k.fillText('You wrote', L, y); y += 64;
  // the words, with the part that carries the judgment underlined in red pencil
  k.font = font(48); k.fillStyle = INK;
  const text = m.text.replace(/\[Image #\d+\]/g, '').replace(/\s+/g, ' ').trim();
  const spans = (m.readings ?? []).map(r => { const i = text.toLowerCase().indexOf(r.quote.toLowerCase().slice(0, 40)); return i >= 0 ? [i, i + r.quote.length] as [number, number] : null; }).filter((x): x is [number, number] => !!x);
  const words = text.split(' '); let line = '', lines = 0, pos = 0; const lh = 64, maxW = R - L;
  const marks: [number, number, number][] = [];
  const flush = (ln: string, start: number) => {
    k.fillText(ln, L, y);
    for (const [qs, qe] of spans) { const s = Math.max(qs, start), e = Math.min(qe, start + ln.length); if (e > s) { const x0 = L + k.measureText(ln.slice(0, s - start)).width, x1 = L + k.measureText(ln.slice(0, e - start)).width; marks.push([x0, x1, y + 12]); } }
    y += lh; lines++;
  };
  let start = 0;
  for (const w of words) { const t = line ? line + ' ' + w : w; if (k.measureText(t).width > maxW && line) { if (lines >= 13) { line += '…'; break; } flush(line, start); start = pos; line = w; } else line = t; pos += w.length + 1; }
  if (line) flush(line, start);
  marks.forEach(([a, b, yy], j) => underline(k, a, b, yy, { color: RED, seed: j + hash(m.id) }));
  const gists = (m.readings ?? []).map(r => r.gist);
  if (gists.length) {
    const room = Math.min(gists.length, 3);
    y = Math.max(y + 50, CH - 300 - room * 150);
    rule(k, L, R, y - 60, .2);
    k.font = font(32, { family: SANS }); k.fillStyle = INK_FAINT; k.fillText(gists.length > 1 ? `Understudy read ${gists.length} judgments in it` : 'Understudy read it as', L, y); y += 60;
    k.font = font(42, { italic: true }); k.fillStyle = '#3c3529';
    for (const g of gists.slice(0, room)) y = wrap(k, g, L, y, R - L, 52, 2) + 20;
  }
  folio(k, `Run, ${i + 1} of ${total}`, 'left');

  const prints: PrintSpec[] = [];
  const shown = imgs.pasted ?? imgs.before;
  r.fillStyle = '#5d5446'; r.font = font(44, { italic: true });
  if (shown && imgs.after) {
    prints.push({ img: shown, x: -.5, y: .32, w: .96, rot: -.01 }, { img: imgs.after, x: .52, y: .32, w: .96, rot: .008 });
    r.fillText(imgs.pasted ? 'What you pasted.' : 'What you saw.', RL, 1560); r.fillText('What the agent made next.', 905, 1560);
  } else if (shown) {
    prints.push({ img: shown, x: 0, y: .25, w: 1.6, rot: -.006, aspect: shown.width / shown.height > 1.1 ? 1.45 : .9 });
    r.fillText(imgs.pasted ? 'What you pasted.' : 'What you saw.', RL, 1880);
  } else { r.font = font(44, { italic: true }); r.fillStyle = INK_SOFT; wrap(r, 'No screenshot beside this one. It was judged from words alone.', RL, 600, RR - RL, 56); }
  r.font = font(32, { family: SANS }); r.fillStyle = INK_FAINT; r.fillText(`Session ${m.id.split(':')[0].slice(0, 8)}, message at line ${m.id.split(':')[1]}`, RL, CH - 110);
  return { key: `run:${m.id}`, left, right, prints, hits: [], folio: `${i + 1}/${total}` };
}

// Bake prints into a copy of the page, for the turning sheet (it cannot carry 3D prints).
export function bake(page: HTMLCanvasElement, prints: PrintSpec[], printCanvas: (s: PrintSpec) => HTMLCanvasElement) {
  const c = document.createElement('canvas'); c.width = CW; c.height = CH; const k = c.getContext('2d')!; k.drawImage(page, 0, 0);
  for (const p of prints) {
    const pc = printCanvas(p); const w = p.w / PW * CW, h = w * pc.height / pc.width;
    const cx = (p.x + PW / 2) / PW * CW, cy = (PH / 2 - p.y) / PH * CH;
    k.save(); k.translate(cx, cy); k.rotate(-p.rot); k.shadowColor = 'rgba(40,25,10,.35)'; k.shadowBlur = 18; k.shadowOffsetY = 6; k.drawImage(pc, -w / 2, -h / 2, w, h); k.restore();
  }
  return c;
}

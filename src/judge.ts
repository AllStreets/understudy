import { dirname } from 'node:path';
import { open, json } from './store.ts';
import { ask, MODELS } from './claude.ts';
import { firstLook, nearest, available, type FirstLook } from './local.ts';

export type Note = {
  claim: string;                 // what is wrong, in plain words
  fix: string;                   // what the agent should change
  severity: 'must' | 'should';
  cite: string | null;           // a reading id: the past judgment this rests on
  quote: string | null;          // that judgment's words, copied from the archive, never from the model
  when: string | null;           // date and project of the cited judgment
  own: boolean;                  // no past judgment behind it
  where: { x: number; y: number; w: number; h: number } | null; // on the screenshot, 0 to 1
};
export type Verdict = { verdict: 'meets' | 'misses'; summary: string; notes: Note[]; look: FirstLook | null; cost: number };

type Reading = { id: string; quote: string; gist: string; kind: string; project: string; at: string };
const readingsById = (ids: string[]) => {
  if (!ids.length) return new Map<string, Reading>();
  const db = open();
  const rows = db.prepare(`select r.id, r.quote, r.gist, r.kind, m.project, m.at from readings r join moments m on m.id = r.moment where r.id in (${ids.map(() => '?').join(',')})`).all(...ids) as Reading[];
  return new Map(rows.map(r => [r.id, r]));
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const when = (r: Reading) => { const d = new Date(r.at); return `${MON[d.getMonth()]} ${d.getDate()}, ${r.project}`; };

const SCHEMA = {
  type: 'object', required: ['verdict', 'summary', 'notes'],
  properties: {
    verdict: { enum: ['meets', 'misses'] },
    summary: { type: 'string', description: 'one sentence' },
    notes: { type: 'array', items: { type: 'object', required: ['claim', 'fix', 'severity', 'cite', 'where'], properties: {
      claim: { type: 'string' }, fix: { type: 'string' },
      severity: { enum: ['must', 'should'] },
      cite: { type: 'string', description: 'the id of the past judgment this rests on, or an empty string for an obvious defect with none behind it' },
      where: { type: 'object', required: ['x', 'y', 'w', 'h'], properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, description: 'the area on the screenshot, as fractions of its width and height' },
    } } },
  },
};

const SYSTEM = `You hold a screenshot of software to one person's design bar, and nothing else.
You may raise a note only when one of their past judgments, listed below with an id, clearly applies to what is on this screen; cite that id. The single exception is an obvious defect anyone would call broken (text overlapping text, clipped or unreadable text, a layout visibly falling apart): raise it with an empty cite.
Never judge from general taste or what you think good design is. If nothing they have said applies, the screen meets their bar.
"must" means they rejected this exact kind of thing before; "should" means it leans against something they said.
Be specific about where on the screen. Write fixes an agent can act on. At most six notes, the strongest first.`;

export async function judge(image: string, o: { project?: string; context?: string; log?: (s: string) => void } = {}): Promise<Verdict> {
  const log = o.log ?? (() => {});
  const db = open();
  const statements = db.prepare('select id, text, evidence from statements where removed = 0 order by weight desc').all() as { id: string; text: string; evidence: string }[];
  const local = await available();
  let look: FirstLook | null = null;
  if (local.vision) { log('Local first look...'); look = await firstLook(image); log(`  ${look.ms} ms. ${look.tells.length ? `Flags: ${look.tells.join('; ')}` : 'No flags.'}`); }

  // the past judgments to hold it to: the closest by meaning, plus the evidence behind the strongest statements
  const near = local.embed ? await nearest([look?.describe, look?.tells.join(', '), o.context].filter(Boolean).join(' ') || 'a software interface', 14) : [];
  const ids = new Set(near.map(n => n.id));
  for (const s of statements.slice(0, 12)) for (const e of json<string[]>(s.evidence, []).slice(0, 2)) ids.add(e);
  const pool = readingsById([...ids]);
  log(`Holding it to ${pool.size} past judgments and ${statements.length} statements.`);

  const prompt = [
    `Read the screenshot at ${image}.`,
    o.project ? `It is from the project ${o.project}.` : '',
    o.context ? `What the agent just changed: ${o.context}` : '',
    statements.length ? `\nTheir design bar, as distilled so far:\n${statements.map(s => `- ${s.text}`).join('\n')}` : '',
    `\nPast judgments you may cite (id, date, project, their words, what it implies):\n${[...pool.values()].map(r => `[${r.id}] ${when(r)} (${r.kind}) "${r.quote}" => ${r.gist}`).join('\n')}`,
    look?.tells.length ? `\nA small local model flagged these on a quick look (it is often wrong; check each yourself): ${look.tells.join('; ')}.` : '',
  ].filter(Boolean).join('\n');

  log('Claude is judging...');
  const { value, cost } = await ask<{ verdict: 'meets' | 'misses'; summary: string; notes: (Omit<Note, 'quote' | 'when' | 'own'> & { cite: string })[] }>(prompt, { model: MODELS.judge, schema: SCHEMA, system: SYSTEM, readDirs: [dirname(image)] });

  // the quote under every note comes from the archive; a cite that is not real makes the note Understudy's own
  const notes: Note[] = value.notes.slice(0, 6).map(n => {
    const r = n.cite ? pool.get(n.cite) ?? readingsById([n.cite]).get(n.cite) : undefined;
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const where = n.where && n.where.w > 0 && n.where.h > 0 ? { x: clamp(n.where.x), y: clamp(n.where.y), w: clamp(n.where.w), h: clamp(n.where.h) } : null;
    return { claim: n.claim, fix: n.fix, severity: r ? n.severity : 'should', cite: r?.id ?? null, quote: r?.quote ?? null, when: r ? when(r) : null, own: !r, where };
  });
  const verdict = notes.some(n => n.severity === 'must') ? 'misses' : 'meets';
  return { verdict, summary: value.summary, notes, look, cost };
}

// What an agent reads when its work misses: the notes as instructions, each with its reason.
export function forAgent(v: Verdict, round: number, max: number): string {
  const lines = [`Understudy held this screen to the user's design bar and it misses (round ${round} of ${max}). Fix these, then stop again to be re-checked:`];
  v.notes.forEach((n, i) => lines.push(`${i + 1}. ${n.claim} Fix: ${n.fix}${n.quote ? ` (They said, ${n.when}: "${n.quote}")` : ''}`));
  lines.push('Change only what these notes cover. Do not restyle anything else.');
  return lines.join('\n');
}

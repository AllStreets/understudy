import { open, json } from './store.ts';
import { ask, MODELS } from './claude.ts';

type Moment = { id: string; project: string | null; at: string | null; text: string; said_before: string | null; before: string; pasted: string };

export type Judgment = { kind: 'reject' | 'approve' | 'mixed' | 'direct' | 'pick'; aspect: 'look' | 'feel' | 'both'; quote: string; gist: string };
export type Reading = { id: string; judgments: Judgment[] };

const READ_SCHEMA = {
  type: 'object', required: ['readings'],
  properties: { readings: { type: 'array', items: { type: 'object', required: ['id', 'judgments'], properties: {
    id: { type: 'string' },
    judgments: { type: 'array', description: 'every separate preference about how software should look or feel that the message reveals; empty if none (content, facts, logistics and bugs are not taste)', items: { type: 'object', required: ['kind', 'aspect', 'quote', 'gist'], properties: {
      kind: { enum: ['reject', 'approve', 'mixed', 'direct', 'pick'] },
      aspect: { enum: ['look', 'feel', 'both'] },
      quote: { type: 'string', description: 'the shortest verbatim span of the message that carries this judgment, copied exactly, typos included' },
      gist: { type: 'string', description: 'the taste it implies, as one plain sentence starting "You", general enough to apply to other projects' },
    } } },
  } } } },
};

const READ_SYSTEM = `You read messages a designer-developer typed to a coding agent while it built their software, and you find what each one says about their design taste.
Be literal. A quote must be copied exactly from the message. A gist must be something the message actually shows, never your own opinion of good design, and phrased so it would apply to a different project (no project names unless the taste is about that project only).
Messages about facts, data accuracy, features, bugs, deploys or logistics are not taste, even if they mention a screen.
A long message often holds several separate judgments: return each one.`;

// Read every design moment in batches and record what it says about taste.
export async function readMoments(log: (s: string) => void = () => {}): Promise<{ read: number; cost: number }> {
  const db = open();
  const rows = db.prepare(`select id, project, at, text, said_before, before, pasted from moments where design = 1 and taste is null order by at`).all() as Moment[];
  const upd = db.prepare('update moments set taste = ?, kind = ?, aspect = ?, quote = ?, gist = ? where id = ?');
  const put = db.prepare('insert or replace into readings (id, moment, kind, aspect, quote, gist) values (?, ?, ?, ?, ?, ?)');
  let cost = 0, read = 0;
  for (let i = 0; i < rows.length; i += 16) {
    const batch = rows.slice(i, i + 16);
    const prompt = batch.map(m => [
      `<message id="${m.id}" project="${m.project ?? ''}" date="${(m.at ?? '').slice(0, 10)}" saw_screenshot="${json<string[]>(m.before, []).length + json<string[]>(m.pasted, []).length > 0}">`,
      m.said_before ? `<agent_said_just_before>${m.said_before.slice(-500)}</agent_said_just_before>` : '',
      `<typed>${m.text.slice(0, 2400)}</typed>`, '</message>',
    ].join('\n')).join('\n\n');
    const { value, cost: c } = await ask<{ readings: Reading[] }>(prompt, { model: MODELS.judge, system: READ_SYSTEM, schema: READ_SCHEMA });
    cost += c;
    db.exec('begin');
    for (const r of value.readings) {
      const m = batch.find(b => b.id === r.id); if (!m) continue;
      // a quote that is not really in the message is dropped, not trusted
      const js = r.judgments.filter(j => j.quote && m.text.toLowerCase().includes(j.quote.toLowerCase().slice(0, 40)));
      const first = js[0];
      upd.run(js.length ? 1 : 0, first?.kind ?? 'other', first?.aspect ?? 'none', first?.quote ?? '', first?.gist ?? '', m.id);
      js.forEach((j, n) => put.run(`${m.id}#${n}`, m.id, j.kind, j.aspect, j.quote, j.gist));
      read++;
    }
    db.exec('commit');
    log(`  read ${Math.min(i + 16, rows.length)} of ${rows.length}  ($${cost.toFixed(2)})`);
  }
  return { read, cost };
}

export type Statement = { id: string; text: string; aspect: 'look' | 'feel'; evidence: string[] };

const DISTIL_SCHEMA = {
  type: 'object', required: ['statements'],
  properties: { statements: { type: 'array', items: { type: 'object', required: ['id', 'text', 'aspect', 'evidence'], properties: {
    id: { type: 'string', description: 'a short kebab-case slug' },
    text: { type: 'string', description: 'one plain sentence starting "You", specific enough to check a screenshot against' },
    aspect: { enum: ['look', 'feel'] },
    evidence: { type: 'array', items: { type: 'string' }, description: 'ids of the moments that show it; at least one' },
  } } } },
};

// Fold the readings into a small set of statements, each backed by the moments it came from.
export async function distil(log: (s: string) => void = () => {}): Promise<{ statements: number; cost: number }> {
  const db = open();
  const rows = db.prepare(`select r.id, m.project, m.at, r.quote, r.gist, r.kind from readings r join moments m on m.id = r.moment order by m.at`).all() as { id: string; project: string; at: string; quote: string; gist: string; kind: string }[];
  const prompt = `Here are ${rows.length} readings of one person's design judgments, oldest first.\n\n` +
    rows.map(r => `[${r.id}] (${r.project}, ${r.at?.slice(0, 10)}, ${r.kind}) "${r.quote}" => ${r.gist}`).join('\n') +
    `\n\nWrite between 20 and 40 statements that together describe this person's design bar. Merge readings that say the same thing; keep a statement narrow when the evidence is narrow. Order by how much evidence each has. Every statement must cite the reading ids it comes from, and say nothing the readings do not show.`;
  const { value, cost } = await ask<{ statements: Statement[] }>(prompt, { model: MODELS.deep, schema: DISTIL_SCHEMA, system: 'You distil a design bar from evidence. Never add taste that is not in the evidence.' });
  const known = new Set(rows.map(r => r.id));
  db.exec('begin');
  db.exec('delete from statements where edited = 0');
  const put = db.prepare('insert or replace into statements (id, text, aspect, evidence, weight) values (?, ?, ?, ?, ?)');
  let n = 0;
  for (const s of value.statements) {
    const ev = s.evidence.filter(e => known.has(e));
    if (!ev.length) continue;
    put.run(s.id, s.text, s.aspect, JSON.stringify(ev), ev.length); n++;
  }
  db.exec('commit');
  log(`  ${n} statements ($${cost.toFixed(2)})`);
  return { statements: n, cost };
}

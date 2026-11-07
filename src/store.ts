import { DatabaseSync } from 'node:sqlite';
import { paths, ensureDirs } from './paths.ts';

let db: DatabaseSync | null = null;

const SCHEMA = `
create table if not exists sessions (
  id text primary key,          -- the session id Claude Code gave it
  source text not null,         -- where the log was read from
  archived text not null,       -- our copy
  lines integer not null,
  bytes integer not null,
  first_at text, last_at text,
  archived_at text not null
);
create table if not exists images (
  sha text primary key,
  path text not null,
  media text not null,
  bytes integer not null
);
-- a moment is one message the person typed, with what they saw before it and what came after
create table if not exists moments (
  id text primary key,          -- session id + line number
  session text not null,
  line integer not null,
  at text,
  project text,
  text text not null,
  said_before text,             -- the agent's last words before the message
  said_after text,              -- the agent's first words after it
  pasted text not null,         -- json array of image shas the person pasted
  before text not null,         -- json array of image shas the agent showed since the last message
  after text not null,          -- json array of image shas the agent took in reply
  design integer not null,      -- 1 if it reads as a judgment about how something looks or feels
  kind text,                    -- reject, approve, mixed, direct, pick, other (filled by the reader)
  taste integer,                -- 1 if the reader found taste in it
  aspect text,                  -- look, feel, both, none
  quote text,                   -- the words that carry the judgment, verbatim
  gist text                     -- the taste it implies, as a sentence
);
create index if not exists moments_design on moments(design);
create index if not exists moments_seen on moments(at, text);
-- one message can hold several judgments; each gets its own reading
create table if not exists readings (
  id text primary key,          -- moment id + '#' + n
  moment text not null,
  kind text not null,
  aspect text not null,
  quote text not null,          -- verbatim from the message
  gist text not null            -- the taste it implies, as a sentence
);
create index if not exists readings_moment on readings(moment);
create index if not exists moments_project on moments(project);
-- what a person decided on a before and after, or a calibration pair
create table if not exists verdicts (
  id integer primary key autoincrement,
  at text not null,
  subject text not null,        -- check id or pair id
  call text not null,           -- keep, undo, not-quite, prefer-a, prefer-b
  note text
);
create table if not exists checks (
  id text primary key,
  at text not null,
  project text,
  target text not null,         -- url or file that was screenshotted
  before_shot text not null,
  after_shot text,
  notes text not null,          -- json: the judge's notes with citations
  verdict text not null,        -- meets, misses, stuck
  rounds integer not null default 1,
  patch text,                   -- the fix as a unified diff, for undo
  call text,                    -- keep, undo, not-quite once the person decides
  session text,                 -- the agent session it ran in
  snapshot text,                -- a commit object of the working tree before the fix
  cwd text,                     -- the repository it ran in
  found text                    -- json: the first round's notes, what was wrong in the before
);
-- calibration: the same page rendered twice, differing in one thing
create table if not exists pairs (
  id text primary key,
  at text not null,
  project text,
  url text not null,
  dimension text not null,
  question text not null,
  a_label text not null, a_css text not null, a_shot text not null,
  b_label text not null, b_css text not null, b_shot text not null,
  pick text,                    -- a, b or neither
  picked_at text
);
-- a task taught by doing it once, written down, rehearsed in a copy, and installed on request
create table if not exists lessons (
  id text primary key,
  name text not null,
  cwd text not null,
  started_at text not null,
  stopped_at text,
  head text, snap text,         -- the project as it was when the lesson began
  transcript text,
  procedure text,               -- json: the written-down task
  status text not null,         -- recording, written, rehearsing, ready, installed, abandoned
  rehearsals text not null,     -- json: each rehearsal and how it went
  installed text                -- the skill file, once it goes on
);
create table if not exists statements (
  id text primary key,
  text text not null,           -- a plain sentence about the person's taste
  aspect text not null,         -- look or feel
  evidence text not null,       -- json array of moment ids
  weight real not null default 1,
  edited integer not null default 0,
  removed integer not null default 0
);
create table if not exists embeddings (
  moment text primary key,      -- a reading id
  model text not null,
  vec blob not null
);
`;

export function open(): DatabaseSync {
  if (db) return db;
  ensureDirs();
  db = new DatabaseSync(paths.db);
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
  db.exec(SCHEMA);
  for (const col of ['session text', 'snapshot text', 'cwd text', 'found text']) { try { db.exec(`alter table checks add column ${col}`); } catch { /* already there */ } }
  try { db.exec('alter table sessions add column mined integer'); } catch { /* already there */ }
  return db;
}

export function close() { db?.close(); db = null; }

export const json = <T>(s: string | null | undefined, fallback: T): T => { try { return s ? JSON.parse(s) as T : fallback; } catch { return fallback; } };

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
  kind text                     -- reject, approve, pick, direct, other (filled by the classifier)
);
create index if not exists moments_design on moments(design);
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
  call text                     -- keep, undo, not-quite once the person decides
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
  moment text primary key,
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
  return db;
}

export function close() { db?.close(); db = null; }

export const json = <T>(s: string | null | undefined, fallback: T): T => { try { return s ? JSON.parse(s) as T : fallback; } catch { return fallback; } };

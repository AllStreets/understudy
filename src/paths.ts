import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

// Everything Understudy keeps lives in one folder, outside any project.
// UNDERSTUDY_HOME moves it (the tests use a temporary one).
export const HOME = process.env.UNDERSTUDY_HOME ?? join(homedir(), 'Library', 'Application Support', 'Understudy');
export const CLAUDE_PROJECTS = process.env.UNDERSTUDY_CLAUDE_PROJECTS ?? join(homedir(), '.claude', 'projects');

export const paths = {
  home: HOME,
  db: join(HOME, 'understudy.db'),
  archive: join(HOME, 'archive'),     // copies of session logs, never edited
  images: join(HOME, 'images'),       // every screenshot found in a session, named by content hash
  shots: join(HOME, 'shots'),         // screenshots Understudy takes itself
};

export function ensureDirs() {
  for (const p of [paths.home, paths.archive, paths.images, paths.shots]) mkdirSync(p, { recursive: true });
}

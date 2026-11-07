import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

// every test run gets its own Understudy home and its own fake ~/.claude/projects
const home = mkdtempSync(join(tmpdir(), 'understudy-test-'));
process.env.UNDERSTUDY_HOME = join(home, 'data');
process.env.UNDERSTUDY_CLAUDE_PROJECTS = join(home, 'projects');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const line = (o: object) => JSON.stringify(o);
const t = (n: number) => `2026-10-15T10:00:${String(n).padStart(2, '0')}.000Z`;
function session(dir: string, id: string, lines: object[]) { mkdirSync(join(process.env.UNDERSTUDY_CLAUDE_PROJECTS!, dir), { recursive: true }); writeFileSync(join(process.env.UNDERSTUDY_CLAUDE_PROJECTS!, dir, `${id}.jsonl`), lines.map(line).join('\n') + '\n'); }

const conversation = [
  { type: 'user', timestamp: t(1), cwd: '/x', message: { content: 'Build the projects section.' } },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'Here it is.' }, { type: 'tool_use', name: 'Bash', input: { command: 'open /Users/me/Downloads/site/index.html' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }] }] } },
  { type: 'user', timestamp: t(2), message: { content: [{ type: 'text', text: "no, I don't like the cards, they scream AI generated" }] } },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'Replaced them with a table.' }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }] }] } },
  { type: 'user', timestamp: t(3), message: { content: '<command-name>/clear</command-name>' } },
  { type: 'user', timestamp: t(4), message: { content: 'Stop hook feedback: Understudy held this screen to the bar' } },
];

before(() => {
  session('-Users-me-Downloads', 'aaaa', conversation);
  // a resumed session carries the same messages over; they must not count twice
  session('-Users-me-Downloads', 'bbbb', conversation.slice(0, 4));
  // a session in a temporary folder is never archived
  session('-private-tmp-scratch', 'cccc', conversation);
});

test('archive copies main session logs and skips temporary ones', async () => {
  const { archive } = await import('../src/archive.ts');
  const r = archive();
  assert.equal(r.found, 2); assert.equal(r.added, 2);
  assert.equal(archive().unchanged, 2, 'a second run copies nothing');
});

test('mine finds typed messages, with what was shown before and after', async () => {
  const { mineAll } = await import('../src/mine.ts');
  const { open } = await import('../src/store.ts');
  const r = await mineAll();
  assert.equal(r.moments, 2, 'two typed messages; the slash command, hook feedback and resumed copies are left out');
  const m = open().prepare(`select * from moments where text like '%scream%'`).get() as { before: string; after: string; design: number; said_before: string };
  assert.equal(JSON.parse(m.before).length, 1, 'the screenshot shown before it');
  assert.equal(JSON.parse(m.after).length, 1, 'the screenshot taken in reply');
  assert.equal(m.design, 1);
  assert.equal(m.said_before, 'Here it is.');
});

test('the hook only wakes for turns that changed UI files', async () => {
  const { uiChangedThisTurn } = await import('../src/hook.ts');
  const tr = join(home, 'transcript.jsonl');
  writeFileSync(tr, [
    { type: 'user', message: { content: 'old turn' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/r/old.css' } }] } },
    { type: 'user', message: { content: 'make it nicer' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/r/src/App.tsx' } }, { type: 'tool_use', name: 'Write', input: { file_path: '/r/notes.md' } }] } },
  ].map(line).join('\n'));
  assert.deepEqual(uiChangedThisTurn(tr), ['/r/src/App.tsx']);
  assert.deepEqual(uiChangedThisTurn(tr, [/notes\.md$/]).sort(), ['/r/notes.md', '/r/src/App.tsx']);
});

test('the project config is found from any folder inside the repo', async () => {
  const { findConfig } = await import('../src/hook.ts');
  const repo = join(home, 'repo'); mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
  writeFileSync(join(repo, '.understudy.json'), JSON.stringify({ url: 'http://127.0.0.1:5173/' }));
  assert.equal(findConfig(join(repo, 'src', 'deep'))?.config.url, 'http://127.0.0.1:5173/');
  assert.equal(findConfig(home), null);
});

test('undo reverses a recorded fix, and refuses when the code moved on', async () => {
  const { snapshot, undo } = await import('../src/check.ts');
  const { open } = await import('../src/store.ts');
  const repo = join(home, 'undo'); mkdirSync(repo);
  const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  g('init', '-q'); writeFileSync(join(repo, 'a.css'), '.card { border-radius: 20px; }\n'); g('add', '-A'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'one');
  const snap = snapshot(repo)!;
  writeFileSync(join(repo, 'a.css'), '.card { border-radius: 0; }\n');
  const patch = execFileSync('git', ['diff', snap], { cwd: repo, encoding: 'utf8' });
  open().prepare(`insert into checks (id, at, target, before_shot, notes, verdict, rounds, patch, cwd) values ('c1', 'x', 'x', 'x', '[]', 'meets', 2, ?, ?)`).run(patch, repo);
  assert.equal(undo('c1').ok, true);
  assert.equal(readFileSync(join(repo, 'a.css'), 'utf8'), '.card { border-radius: 20px; }\n');
  writeFileSync(join(repo, 'a.css'), '.card { border-radius: 4px; }\n');
  const r = undo('c1'); assert.equal(r.ok, false); assert.match(r.reason!, /changed since the fix|cannot be reversed/);
});

test('a demonstration is read back as a script, and rehearsals may only run its commands', async () => {
  const { demonstration, allowedBash } = await import('../src/teach.ts');
  const tr = join(home, 'lesson.jsonl');
  const at = (s: number) => `2026-11-07T04:00:${String(s).padStart(2, '0')}.000Z`;
  writeFileSync(tr, [
    { type: 'user', timestamp: at(1), message: { content: 'before the lesson' } },
    { type: 'user', timestamp: at(10), message: { content: 'Release a patch.' } },
    { type: 'assistant', timestamp: at(11), message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm version patch --no-git-tag-version' } }] } },
    { type: 'assistant', timestamp: at(12), message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/r/CHANGELOG.md', old_string: '# Changelog', new_string: '# Changelog\n\n## 0.3.2' } }] } },
    { type: 'assistant', timestamp: at(13), message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'rm -rf / ; echo hi' } }] } },
    { type: 'user', timestamp: at(40), message: { content: 'after the lesson' } },
  ].map(line).join('\n'));
  const d = demonstration(tr, at(5), at(30));
  assert.match(d.script, /PERSON: Release a patch/);
  assert.match(d.script, /ran: npm version patch/);
  assert.match(d.script, /edited \/r\/CHANGELOG\.md/);
  assert.doesNotMatch(d.script, /before the lesson|after the lesson/);
  // a command with shell operators is dropped whole; deleting, publishing and network programs never pass
  assert.deepEqual(allowedBash(d.commands), ['Bash(npm version:*)']);
  assert.deepEqual(allowedBash(['cat a; rm b', 'git status', 'rm -rf build', 'git push origin main', 'npm publish', 'curl https://x', 'echo $(whoami)', 'npm run build']), ['Bash(git status:*)', 'Bash(npm run:*)']);
});

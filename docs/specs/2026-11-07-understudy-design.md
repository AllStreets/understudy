# Understudy: design

Written 2026-11-07 from a design conversation with Connor. Lines marked *(call)* are decisions made while he was away (he asked for the night to run without a human in the loop); everything else is his.

## Intent

Connor builds with Claude Code across many projects and holds all of them to one design bar. Today he re-teaches that bar in every session: the agent shows a screen, he says what is wrong ("I don't like the cards, they scream AI generated", "I hate dead space", "we absolutely need the code links"), the agent iterates. The bar lives in his head, scattered across hundreds of messages, and every new project starts near zero.

Understudy learns that bar from the sessions he has already had, holds every agent's UI work to it before he sees it, fixes what misses, and shows him the before and after with the reasons, each reason citing the moment he taught it.

The name is from the theatre. An understudy watches the lead every night, rehearses offstage, and goes on only when ready.

**Success, in his words:** "every project it touches already meets my design bar."

**The failure that matters most, in his words:** "if it looks like generic AI design." That applies to Understudy's own interface and to everything it approves. A judge that drifts toward the internet's average fails its one job, so it may never judge from a model's general taste alone: every note is anchored to a past judgment of his, or labelled as its own.

## Who it is for

Connor first. Then other designers and developers who use Claude Code: each person's taste is learned from their own sessions and never leaves their Mac.

## Goals

1. **Archive.** Keep every Claude Code session as it happens. Claude Code deletes old logs; only 21 of three months of his sessions survived. Understudy's first job is to stop the loss.
2. **Mine.** Find every design judgment in the archive: the screenshot the agent showed, his words, what the agent did next, and the screenshot after. On his archive: 589 messages he typed, 226 design judgments, 132 made right after seeing a screenshot, 102 messages carrying his own screenshots.
3. **Learn the bar.** Turn judgments into a taste profile: plain statements he can read, edit and delete ("You reject identical rounded cards"), each backed by the moments it came from.
4. **Judge.** Given a screenshot of new work, find the past judgments that apply and write notes, each citing its source. Notes with no source are labelled as Understudy's own.
5. **Fix and prove.** When the work misses the bar, Understudy has the agent fix it, screenshots again, judges again (a few rounds at most), and then shows the before and after. One action undoes the fix. If it cannot reach the bar it stops and says what it is stuck on rather than loop or lower the bar.
6. **Keep learning.** Every Keep it, Undo fix or Not quite becomes a new judgment.
7. **Calibrate.** A new user with little history picks between pairs of designs made from their own screens, each pair differing in one thing, until the profile is sharp. About 30 to 50 picks.
8. **Teach a task.** A user does a task once while it watches (mostly through Claude Code, also by hand in the terminal); it writes the task down as a runnable procedure with a check, rehearses it in a safe copy, and offers to do it once a rehearsal passes. Tasks that produce UI must also pass the taste judge.

## Non-goals (Phase 1)

- Watching apps and the browser by hand (needs accessibility access and screen capture; a later phase).
- Sharing taste between people. Taste is personal. Sharing proven tasks between machines is a later phase.
- Training a large model. About 130 judged screenshots is enough to retrieve and cite, not to train from scratch.

## Anti-goals

- Generic AI look, in its own UI or in what it approves. Tells to avoid are listed in Connor's notes: tracked-out caps eyebrows, identical rounded cards, glow and neon on dark, decorative chart motifs, monospace as decoration, a lede under every title, one highlighted word in a headline, skeleton loaders.
- Notes without evidence. Every claim is checkable.
- Irreversible actions. Every fix can be undone.
- Sending anything anywhere except the user's own Claude.

## How the work is split

| Job | Runs on | Why |
|---|---|---|
| Archive, index, find screenshots and judgments | Local code, no model | Instant and private |
| Match a new screen to past judgments | Local embedding model (Ollama, `nomic-embed-text`) *(call)* | Constant, cheap, private |
| First-pass look (obvious tells, density, consistency) | Local vision model (Ollama, `qwen2.5vl:7b`) *(call)* | Fast and free on the M5 Pro |
| Final judgment and writing the notes | Claude, through the user's own Claude Code (`claude -p`) *(call)* | Better at taste and at saying why |
| The fix | The Claude Code session doing the work | It already has the context |
| Learning from verdicts | Local scorer retrained on the user's Keep / Undo / Not quite history | Taste stays on the machine and grows with use |

## The interface

Chosen from three directions on 2026-11-07: **the prompt book**, built photoreal in three.js the way Bombechat's machine was built. A stage manager's ring binder open on a walnut desk under one warm lamp.

- Left page: typed notes, cue numbers circled in red pencil, his quotes in red with date and project, Understudy's own notes in grey. At the foot, "Your call": Keep it, Undo fix, Not quite, ticked in pencil.
- Right page: the before and after as prints held by photo corners, red pencil rings on what was wrong. Click a print to lift it to full size.
- On the desk: a cue light box, crackle-black steel, red Standby while a call is waiting, green Go when kept, with a braided cord running off the desk.
- His feedback on the first render: one pencil, not a red and blue editing pencil; the pencil rests on the paper; no glare on the prints. All three fixed.

Other surfaces use the same book *(call)*: the taste profile is the book's front section (the "bible", in stage-management terms), each learned statement a page with its evidence; history is the run of past pages; calibration is two prints side by side and a pencil tick on the one you prefer.

The app must keep text readable: anything you need to read can be brought flat and square to the camera.

## Architecture *(calls throughout)*

- `src/` engine in TypeScript on Node 22, run with `tsx`. Storage in `node:sqlite` (no native build) under `~/Library/Application Support/Understudy`.
- `src/archive.ts` copies session JSONL from `~/.claude/projects` into the archive, deduplicated by session and line count; idempotent.
- `src/mine.ts` walks archived sessions, pairs each user message with the screenshots before and after it, extracts the images to disk, and stores judgments with project, date, words, and before/after image paths.
- `src/taste.ts` distils judgments into statements with evidence (Claude), embeds judgments (local), and retrieves by similarity.
- `src/judge.ts` takes a screenshot, retrieves past judgments, runs the local first pass, asks Claude for notes in a strict JSON shape with citations, and returns a verdict.
- `src/capture.ts` screenshots a URL or local file with Playwright.
- `src/server.ts` serves the API and the app on `127.0.0.1:4730` *(call: next free port after Teardown 4710, Assay 4720)*.
- `app/` the prompt book (Vite + three.js), dev on 4731.
- `plugin/` a Claude Code plugin. A `Stop` hook runs `understudy check` when the session changed UI files and the project has a preview URL configured; on a miss it blocks the stop with the notes so the agent fixes them, and records the before and after for review.

## Undo

A fix is recorded as the git diff the agent made between the before and after screenshots. Undo applies the reverse patch and is itself recorded. If the working tree has moved on, Undo refuses and shows why.

## Milestones (tonight and after)

1. Repo, design doc, mockups, README draft.
2. Archive and miner on real data.
3. The prompt book app over real judgments: browse the archive as pages.
4. Taste profile and judge on a screenshot.
5. Claude Code plugin: check, fix, before and after, end to end on a real project.
6. README with real media.
Later: calibration, teaching tasks, the local scorer, the network.

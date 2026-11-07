import { createRoom, THREE } from './kit.ts';
import { createBinder } from './binder.ts';
import { createPencil, createPrints, createCueBox, createTabs, printCanvas } from './props.ts';
import { loadFonts, CW, CH } from './paper.ts';
import { callSpread, bibleSpreads, runSpread, pairSpread, bake, type Spread, type Moment, type Statement, type Check, type Pair } from './pages.ts';

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const api = <T>(p: string): Promise<T> => fetch(p).then(r => r.json());
const imgCache = new Map<string, Promise<HTMLImageElement | undefined>>();
const img = (src?: string) => {
  if (!src) return Promise.resolve(undefined);
  if (!imgCache.has(src)) imgCache.set(src, new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(undefined); i.src = src; }));
  return imgCache.get(src)!;
};
const shotUrl = (s: string) => s.startsWith('/') || s.startsWith('http') ? s : `/shot/${s}`;

await loadFonts();
const [summary, moments, statements, checks, pairs] = await Promise.all([
  api<{ sessions: number; taste: number; design: number }>('/api/summary'), api<Moment[]>('/api/moments'), api<Statement[]>('/api/statements'), api<Check[]>('/api/checks'), api<Pair[]>('/api/pairs'),
]);
const byId = new Map(moments.map(m => [m.id, m]));
const waiting = checks.filter(c => !c.call).concat(checks.filter(c => c.call));

// ----- the book: a list of spreads, built lazily (each run spread loads its screenshots) -----
type Entry = { section: 'call' | 'calibrate' | 'bible' | 'run'; build: () => Promise<Spread> };
const book: Entry[] = [];
waiting.forEach((c, i) => book.push({ section: 'call', build: async () => callSpread(c, i, waiting.length, { before: (await img(shotUrl(c.before_shot)))!, after: c.after_shot ? await img(shotUrl(c.after_shot)) : undefined }) }));
pairs.forEach((p, i) => book.push({ section: 'calibrate', build: async () => pairSpread(p, i, pairs.length, { a: (await img(shotUrl(p.a_shot)))!, b: (await img(shotUrl(p.b_shot)))! }) }));
const bible = bibleSpreads(statements, byId, summary);
bible.forEach(s => book.push({ section: 'bible', build: async () => s }));
const run = moments.filter(m => m.before.length || m.pasted.length || m.after.length).concat(moments.filter(m => !(m.before.length || m.pasted.length || m.after.length)));
run.forEach((m, i) => book.push({ section: 'run', build: async () => runSpread(m, i, run.length, {
  before: await img(m.before.length ? `/img/${m.before[m.before.length - 1]}` : undefined),
  pasted: await img(m.pasted.length ? `/img/${m.pasted[0]}` : undefined),
  after: await img(m.after.length ? `/img/${m.after[m.after.length - 1]}` : undefined),
}) }));
const built = new Map<number, Promise<Spread>>();
const spreadAt = (i: number) => { if (!built.has(i)) built.set(i, book[i].build()); return built.get(i)!; };
const baked = new WeakMap<Spread, [HTMLCanvasElement, HTMLCanvasElement]>();
const bakedOf = (s: Spread): [HTMLCanvasElement, HTMLCanvasElement] => { if (!baked.has(s)) baked.set(s, [bake(s.left, [], printCanvas), bake(s.right, s.prints, printCanvas)]); return baked.get(s)!; };

// ----- the room -----
const room = createRoom($('#stage'));
const binder = createBinder(room);
const pencil = createPencil(room);
const prints = createPrints(room);
const cuebox = createCueBox(room);
const tabs = createTabs(room, [
  ...(waiting.length ? [{ id: 'call', label: 'Your call' }] : []),
  ...(pairs.length ? [{ id: 'calibrate', label: 'Calibration' }] : []),
  { id: 'bible', label: 'The bible' }, { id: 'run', label: 'The run' },
]);

let at = Math.max(0, book.findIndex(e => e.section === (waiting.some(c => !c.call) ? 'call' : pairs.length ? 'calibrate' : 'bible')));
let current: Spread;
async function settle(i: number) {
  current = await spreadAt(i);
  binder.show(current.left, current.right);
  prints.set(current.prints);
  cuebox.set(current.state ?? 'dark');
  tabs.active(book[i].section);
  document.title = `Understudy, ${({ call: 'your call', calibrate: 'calibration', bible: 'the bible', run: 'the run' })[book[i].section]}`;
  // build the neighbours ahead of time so turns start at once
  for (const j of [i + 1, i - 1]) if (book[j]) spreadAt(j).then(bakedOf);
}
async function go(i: number) {
  if (i < 0 || i >= book.length || i === at || binder.busy) return;
  prints.toggle(null);
  const from = current, to = await spreadAt(i), dir = i > at ? 1 : -1;
  at = i; prints.set([]);
  await binder.turn(dir as 1 | -1, bakedOf(from), [to.left, to.right], bakedOf(to));
  await settle(i);
}
await settle(at);
$('#loading')?.remove();

// ----- framing: the whole spread and the cue box, or close on one page -----
const look = new THREE.Vector3(.35, -.05, 0), camTo = new THREE.Vector3(), lookTo = look.clone();
let close: 'left' | 'right' | null = null;
function frame() {
  const { camera, renderer, composer } = room; const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h;
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const [needW, needH, cx] = close ? [2.5, 3.2, close === 'left' ? -1.12 : 1.12] : [6.5, 3.7, .35];
  const d = Math.max((needH / 2) / Math.tan(vfov / 2), (needW / 2) / (Math.tan(vfov / 2) * camera.aspect)) * 1.02;
  lookTo.set(cx, -.05, 0); camTo.set(cx, -.05 - d * (close ? .12 : .28), d);
  camera.updateProjectionMatrix();
}
addEventListener('resize', frame); frame();
room.camera.position.copy(camTo); room.camera.lookAt(lookTo);

// ----- pointer -----
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
function cast(e: PointerEvent | MouseEvent) { ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ptr, room.camera); return ray; }
function pageHit(r: THREE.Raycaster) {
  for (const side of ['left', 'right'] as const) {
    const h = r.intersectObject(side === 'left' ? binder.left : binder.right)[0];
    if (h?.uv) { const x = h.uv.x * CW, y = (1 - h.uv.y) * CH; return { side, x, y, hit: current.hits.find(b => b.side === side && x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) }; }
  }
  return null;
}
async function call(choice: string) {
  const check = waiting.find(c => current.key === `call:${c.id}`); if (!check) return;
  if (choice === 'undo' && check.call !== 'undo') {
    const r = await fetch(`/api/checks/${check.id}/undo`, { method: 'POST' }).then(r => r.json()) as { ok: boolean; reason?: string };
    if (!r.ok) { note(r.reason ?? 'Could not undo.'); return; }
  }
  check.call = choice;
  await fetch(`/api/checks/${check.id}/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ call: choice }) });
  built.delete(at); await settle(at);
}
// a slip of paper for the rare thing the book has to say out loud
function note(text: string) {
  let el = document.getElementById('slip');
  if (!el) { el = document.createElement('div'); el.id = 'slip'; document.body.appendChild(el); }
  el.textContent = text; el.classList.add('on'); setTimeout(() => el!.classList.remove('on'), 5200);
}
addEventListener('pointerdown', async e => {
  if (binder.busy) return;
  const r = cast(e);
  const p = prints.pick(r); if (p) { prints.toggle(p); return; }
  if (prints.lifted) { prints.toggle(null); return; }
  const tab = tabs.pick(r); if (tab) { const i = book.findIndex(b => b.section === tab); if (i >= 0) go(i); return; }
  const ph = pageHit(r);
  if (ph?.hit?.id.startsWith('call:')) return call(ph.hit.id.slice(5));
  if (ph?.hit?.id.startsWith('pick:')) {
    const p = pairs.find(x => current.key === `pair:${x.id}`); if (!p) return;
    p.pick = ph.hit.id.slice(5);
    await fetch(`/api/pairs/${p.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pick: p.pick }) });
    built.delete(at); await settle(at);
    // the next pair turns up on its own, the way a deck of cards does
    setTimeout(() => { if (book[at + 1]?.section === 'calibrate') go(at + 1); }, 700);
    return;
  }
  if (ph?.hit?.id.startsWith('stmt:')) { const s = statements.find(x => `stmt:${x.id}` === ph.hit!.id); const first = s && run.findIndex(m => s.evidence.includes(m.id)); if (first != null && first >= 0) go(book.findIndex(b => b.section === 'run') + first); return; }
  // the outer third of a page turns it; elsewhere, a click brings that page close
  if (ph) {
    if (ph.side === 'right' && ph.x > CW * .7) return go(at + 1);
    if (ph.side === 'left' && ph.x < CW * .3) return go(at - 1);
    close = close === ph.side ? null : ph.side; frame(); return;
  }
  if (close) { close = null; frame(); }
});
addEventListener('pointermove', e => {
  const r = cast(e); const ph = pageHit(r);
  const turn = ph && ((ph.side === 'right' && ph.x > CW * .7) || (ph.side === 'left' && ph.x < CW * .3));
  document.body.style.cursor = prints.pick(r) || tabs.pick(r) || ph?.hit || turn ? 'pointer' : ph ? 'zoom-in' : 'default';
});
addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(at + 1); }
  if (e.key === 'ArrowLeft') go(at - 1);
  if (e.key === 'Escape') { prints.toggle(null); close = null; frame(); }
  if (e.key === 'b') go(book.findIndex(b => b.section === 'bible'));
  if (e.key === 'r') go(book.findIndex(b => b.section === 'run'));
});

// ----- loop -----
let last = performance.now();
room.renderer.setAnimationLoop(now => {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  const k = Math.min(1, dt * 4.5);
  room.camera.position.lerp(camTo, k); look.lerp(lookTo, k); room.camera.lookAt(look);
  binder.tick(dt); prints.tick(dt, room.camera, look);
  room.composer.render();
});
(window as any).understudy = { go, hold: (t: number | null) => binder.hold(t), get at() { return at; }, book: () => book.map(b => b.section), close: (s: 'left' | 'right' | null) => { close = s; frame(); } };

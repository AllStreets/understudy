// The ring binder: boards, page stacks, rings, the two open sheets, and a third sheet
// that turns. Pages are canvases; a turn carries the old right page over to become the
// new left page, curling as a real sheet does, then the new spread settles.
import { THREE, type Room } from './kit.ts';
import { PW, PH, CW, HOLE } from './paper.ts';

export const GAP = .07, PAGE_Z = .19;
export const leftX = -(GAP + PW / 2), rightX = GAP + PW / 2;

function curvedSheet(spineSide: 1 | -1) {
  // the sheet is flat but rises over the last few millimetres toward the rings
  const g = new THREE.PlaneGeometry(PW, PH, 60, 2); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); const d = spineSide < 0 ? x + PW / 2 : PW / 2 - x; p.setZ(i, .06 * Math.exp(-d / .09) + .006 * Math.sin((x / PW + .5) * Math.PI)); }
  g.computeVertexNormals(); return g;
}
const sheetMat = (map: THREE.Texture | null) => new THREE.MeshPhysicalMaterial({ map, roughness: .88, sheen: .2, sheenColor: new THREE.Color('#ffffff') });

export function createBinder(room: Room) {
  const { scene, M, tex } = room;
  const boardW = PW + .16, boardH = PH + .24;
  for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(boardW, boardH, .05), M.cloth); b.position.set(s * (GAP + boardW / 2 - .04), 0, .025); b.castShadow = b.receiveShadow = true; scene.add(b); }
  const spine = new THREE.Mesh(new THREE.BoxGeometry(.34, boardH, .04), M.cloth); spine.position.set(0, 0, .02); spine.receiveShadow = true; scene.add(spine);
  const stacks: THREE.Mesh[] = [];
  for (const [s, n] of [[-1, .1], [1, .12]] as const) { const st = new THREE.Mesh(new THREE.BoxGeometry(PW - .02, PH - .02, n), M.edges); st.position.set(s * (GAP + PW / 2) + s * .01, -.012, .05 + n / 2); st.castShadow = st.receiveShadow = true; scene.add(st); stacks.push(st); }

  const left = new THREE.Mesh(curvedSheet(1), sheetMat(null)); left.position.set(leftX, 0, PAGE_Z);
  const right = new THREE.Mesh(curvedSheet(-1), sheetMat(null)); right.position.set(rightX, 0, PAGE_Z);
  for (const m of [left, right]) { m.receiveShadow = m.castShadow = true; scene.add(m); }

  for (const fy of [.18, .5, .82]) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(GAP + HOLE / CW * PW, .028, 20, 64, Math.PI), M.nickel);
    r.rotation.x = Math.PI / 2; r.position.set(0, PH / 2 - PH * fy, PAGE_Z + .02); r.castShadow = true; scene.add(r);
  }
  const mech = new THREE.Mesh(new THREE.BoxGeometry(.2, PH * .82, .04), M.nickel); mech.position.set(0, 0, .07); mech.castShadow = true; scene.add(mech);

  // the turning sheet: one strip of columns along the page, laid out by walking along
  // its length at an angle that lags toward the free edge, so the paper curls
  const COLS = 56;
  const turnGeo = new THREE.PlaneGeometry(PW, PH, COLS, 1);
  const front = new THREE.Mesh(turnGeo, new THREE.MeshPhysicalMaterial({ roughness: .88, side: THREE.FrontSide }));
  const back = new THREE.Mesh(turnGeo, new THREE.MeshPhysicalMaterial({ roughness: .88, side: THREE.BackSide }));
  const turner = new THREE.Group(); turner.add(front, back); turner.visible = false; turner.position.z = PAGE_Z + .012; scene.add(turner);
  front.castShadow = back.castShadow = true;
  const base = turnGeo.attributes.position.array.slice() as Float32Array;
  function layTurn(t: number, dir: 1 | -1) {
    // dir 1: right page going over to the left. t from 0 to 1.
    const p = turnGeo.attributes.position; const ease = t * t * (3 - 2 * t);
    const lift = Math.sin(Math.PI * t);
    const ds = PW / COLS; let x = GAP, z = 0;
    const col: { x: number; z: number }[] = [];
    for (let c = 0; c <= COLS; c++) {
      const u = c / COLS;
      // the near edge leads, the far edge trails behind and curls
      const phi = Math.min(Math.PI, Math.max(0, Math.PI * ease - 1.05 * lift * Math.pow(u, 1.4) + .25 * lift * (1 - u)));
      col.push({ x, z });
      x += Math.cos(phi) * ds; z += Math.sin(phi) * ds;
    }
    for (let i = 0; i < p.count; i++) {
      const bx = base[i * 3]; const c = Math.round((bx + PW / 2) / PW * COLS);
      const s = col[c]; p.setXYZ(i, dir * s.x, base[i * 3 + 1], s.z * .62 + .004 * lift);
    }
    p.needsUpdate = true; turnGeo.computeVertexNormals();
  }
  // a plane's u runs left to right; on the reverse, mirror the texture so it reads
  function setTurnFaces(frontTex: THREE.Texture, backTex: THREE.Texture, dir: 1 | -1) {
    const f = frontTex.clone(), b = backTex.clone();
    f.needsUpdate = b.needsUpdate = true;
    // dir 1 starts on the right: the front reads normally, the back must be mirrored
    if (dir === 1) { b.repeat.x = -1; b.offset.x = 1; } else { f.repeat.x = -1; f.offset.x = 1; }
    (front.material as THREE.MeshPhysicalMaterial).map = dir === 1 ? f : b;
    (back.material as THREE.MeshPhysicalMaterial).map = dir === 1 ? b : f;
    for (const m of [front.material, back.material] as THREE.MeshPhysicalMaterial[]) { m.needsUpdate = true; }
  }

  const texFor = (c: HTMLCanvasElement) => tex(c);
  let leftTex: THREE.Texture | null = null, rightTex: THREE.Texture | null = null;
  function show(l: HTMLCanvasElement, r: HTMLCanvasElement) {
    leftTex?.dispose(); rightTex?.dispose();
    leftTex = texFor(l); rightTex = texFor(r);
    (left.material as THREE.MeshPhysicalMaterial).map = leftTex; (right.material as THREE.MeshPhysicalMaterial).map = rightTex;
    (left.material as THREE.Material).needsUpdate = (right.material as THREE.Material).needsUpdate = true;
  }
  function refresh(side: 'left' | 'right') { const t = side === 'left' ? leftTex : rightTex; if (t) t.needsUpdate = true; }

  // Turn from the current spread (with prints baked in) to the next one.
  let turning: { t: number; dir: 1 | -1; done: () => void; to: [HTMLCanvasElement, HTMLCanvasElement] } | null = null;
  function turn(dir: 1 | -1, fromBaked: [HTMLCanvasElement, HTMLCanvasElement], to: [HTMLCanvasElement, HTMLCanvasElement], toBaked: [HTMLCanvasElement, HTMLCanvasElement]): Promise<void> {
    return new Promise(resolve => {
      const moving = dir === 1 ? texFor(fromBaked[1]) : texFor(fromBaked[0]);   // the page that lifts
      const landing = dir === 1 ? texFor(toBaked[0]) : texFor(toBaked[1]);      // what its reverse shows
      setTurnFaces(moving, landing, dir);
      // underneath, the far page of the next spread is already there
      if (dir === 1) { rightTex?.dispose(); rightTex = texFor(toBaked[1]); (right.material as THREE.MeshPhysicalMaterial).map = rightTex; }
      else { leftTex?.dispose(); leftTex = texFor(toBaked[0]); (left.material as THREE.MeshPhysicalMaterial).map = leftTex; }
      (left.material as THREE.Material).needsUpdate = (right.material as THREE.Material).needsUpdate = true;
      layTurn(0, dir); turner.position.x = 0; turner.visible = true;
      turning = { t: 0, dir, to, done: () => { turner.visible = false; show(to[0], to[1]); moving.dispose(); landing.dispose(); resolve(); } };
    });
  }
  let hold: number | null = null; // for checking a turn by eye: freeze it at a point
  function tick(dt: number) {
    if (!turning) return;
    turning.t = hold ?? Math.min(1, turning.t + dt / .85);
    if (hold != null) { layTurn(hold, turning.dir); return; }
    layTurn(turning.t, turning.dir);
    if (turning.t >= 1) { const d = turning.done; turning = null; d(); }
  }

  return { left, right, stacks, show, refresh, turn, tick, hold(t: number | null) { hold = t; }, get busy() { return !!turning; } };
}
export type Binder = ReturnType<typeof createBinder>;

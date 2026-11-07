// What lies on the desk: the red pencil, the prints pasted on a page, the cue light box,
// and the index tabs on the binder's edge.
import { THREE, type Room } from './kit.ts';
import { PW, PH, canvas, font, SANS, SERIF } from './paper.ts';
import { PAGE_Z, rightX, leftX } from './binder.ts';

export function createPencil(room: Room) {
  const { scene, tex } = room;
  const g = new THREE.Group(); const L = 1.4, r = .026;
  const lacquer = new THREE.MeshPhysicalMaterial({ color: '#9c2318', roughness: .45, clearcoat: .5, clearcoatRoughness: .4 });
  const woodTip = new THREE.MeshStandardMaterial({ color: '#d6b588', roughness: .85 });
  const lead = new THREE.MeshStandardMaterial({ color: '#a8261b', roughness: .55 });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 6), lacquer));
  const cone = new THREE.Mesh(new THREE.ConeGeometry(r, .15, 6), woodTip); cone.position.y = L / 2 + .075; g.add(cone);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(r * .3, .045, 12), lead); tip.position.y = L / 2 + .16; g.add(tip);
  const end = new THREE.Mesh(new THREE.CircleGeometry(r * .99, 6), woodTip); end.rotation.x = Math.PI / 2; end.position.y = -L / 2 - .0005; g.add(end);
  const core = new THREE.Mesh(new THREE.CircleGeometry(r * .32, 16), lead); core.rotation.x = Math.PI / 2; core.position.y = -L / 2 - .001; g.add(core);
  g.children.forEach(c => { c.castShadow = c.receiveShadow = true; });
  g.rotation.y = Math.PI / 6; // a flat face down, not an edge
  const pen = new THREE.Group(); pen.add(g);
  const angle = -.32;
  // on the desk beside the book, so turning pages never pass through it
  pen.rotation.z = angle; pen.position.set(rightX + PW / 2 + .78, -.75, r * Math.cos(Math.PI / 6)); scene.add(pen);
  // a soft contact shadow where it meets the paper
  const c = canvas(256, 64); const k = c.getContext('2d')!;
  const gr = k.createRadialGradient(128, 32, 2, 128, 32, 128); gr.addColorStop(0, 'rgba(30,20,10,.55)'); gr.addColorStop(1, 'rgba(30,20,10,0)');
  k.setTransform(1, 0, 0, .25, 0, 24); k.fillStyle = gr; k.fillRect(0, 0, 256, 256);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1.75, .16), new THREE.MeshBasicMaterial({ map: tex(c), transparent: true, depthWrite: false }));
  contact.rotation.z = angle + Math.PI / 2; contact.position.set(pen.position.x + .02, pen.position.y - .02, .0015); scene.add(contact);
  return { pen, contact, set visible(v: boolean) { pen.visible = contact.visible = v; } };
}

// A print: photographic paper with a white border, held by four black corners.
export type PrintSpec = { img: HTMLImageElement; x: number; y: number; w: number; rot: number; marks?: (k: CanvasRenderingContext2D, W: number, H: number) => void; aspect?: number };
export function printCanvas(spec: PrintSpec) {
  const W = 1024, aspect = spec.aspect ?? .76, H = Math.round(W / aspect), b = 26;
  const c = canvas(W, H); const k = c.getContext('2d')!;
  k.fillStyle = '#fbfaf6'; k.fillRect(0, 0, W, H);
  const img = spec.img, dw = W - 2 * b, dh = H - 2 * b;
  // fill the window, keeping the top of a tall screenshot and the middle of a wide one
  if (img.width / img.height > dw / dh) { const cw = img.height * dw / dh; k.drawImage(img, (img.width - cw) / 2, 0, cw, img.height, b, b, dw, dh); }
  else { const ch = img.width * dh / dw; k.drawImage(img, 0, 0, img.width, ch, b, b, dw, dh); }
  k.fillStyle = 'rgba(255,240,215,.05)'; k.fillRect(0, 0, W, H);
  spec.marks?.(k, W, H);
  return c;
}

export function createPrints(room: Room) {
  const { scene, M, tex } = room;
  const group = new THREE.Group(); scene.add(group);
  const cornerGeo = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(.065, 0), new THREE.Vector2(0, .065)]));
  type P = THREE.Group & { userData: { home: THREE.Vector3; homeRot: number; lifted: number; target: number; face: THREE.MeshPhysicalMaterial } };
  let prints: P[] = [];
  function set(specs: PrintSpec[], side: 'left' | 'right' = 'right') {
    for (const p of prints) { group.remove(p); p.traverse(o => { if ((o as THREE.Mesh).geometry && (o as THREE.Mesh).geometry !== cornerGeo) (o as THREE.Mesh).geometry.dispose(); }); (p.userData.face.map as THREE.Texture)?.dispose(); }
    prints = [];
    const ox = side === 'right' ? rightX : leftX;
    for (const s of specs) {
      const c = printCanvas(s); const t = tex(c); const h = s.w * c.height / c.width;
      const g = new THREE.Group() as P; g.position.set(ox + s.x, s.y, PAGE_Z + .02); g.rotation.z = s.rot;
      const face = new THREE.MeshPhysicalMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0, roughness: .78, sheen: .15, sheenRoughness: .8, sheenColor: new THREE.Color('#ffffff') });
      const m = new THREE.Mesh(new THREE.BoxGeometry(s.w, h, .004), [M.corner, M.corner, M.corner, M.corner, face, M.corner]);
      m.castShadow = m.receiveShadow = true; g.add(m);
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const cm = new THREE.Mesh(cornerGeo, M.corner); cm.position.set(sx * (s.w / 2 + .008), sy * (h / 2 + .008), .004); cm.rotation.z = Math.atan2(-sy, -sx) - Math.PI / 4; cm.castShadow = true; g.add(cm);
      }
      g.userData = { home: g.position.clone(), homeRot: s.rot, lifted: 0, target: 0, face };
      group.add(g); prints.push(g);
    }
  }
  const homeQ = new THREE.Quaternion(), to = new THREE.Vector3(), dir = new THREE.Vector3();
  function tick(dt: number, camera: THREE.PerspectiveCamera, look: THREE.Vector3) {
    for (const g of prints) {
      const u = g.userData; u.lifted += (u.target - u.lifted) * Math.min(1, dt * 7);
      const e = u.lifted * u.lifted * (3 - 2 * u.lifted);
      dir.subVectors(look, camera.position).normalize();
      to.copy(camera.position).addScaledVector(dir, camera.position.distanceTo(look) * .42);
      g.position.lerpVectors(u.home, to, e);
      homeQ.setFromEuler(new THREE.Euler(0, 0, u.homeRot)); g.quaternion.slerpQuaternions(homeQ, camera.quaternion, e);
      g.scale.setScalar(1 + e * .25); u.face.emissiveIntensity = e * .55;
      g.renderOrder = e > .01 ? 10 : 0;
    }
  }
  const pick = (ray: THREE.Raycaster) => { const h = ray.intersectObjects(prints, true)[0]; if (!h) return null; let o: THREE.Object3D | null = h.object; while (o && !prints.includes(o as P)) o = o.parent; return o as P | null; };
  function toggle(p: P | null) { const was = p?.userData.target; for (const q of prints) q.userData.target = 0; if (p && !was) p.userData.target = 1; }
  return { group, set, tick, pick, toggle, get lifted() { return prints.some(p => p.userData.target > 0); }, get list() { return prints; } };
}

// The cue light box: crackle-black steel, red Standby, green Go, a braided cord off the desk.
export function createCueBox(room: Room) {
  const { scene, M, tex } = room;
  const box = new THREE.Group(); box.position.set(rightX + PW / 2 + .72, .95, 0); box.rotation.z = -.06; scene.add(box);
  const shell = new THREE.Mesh(new THREE.BoxGeometry(.78, 1.05, .3), M.crackle); shell.position.z = .15; shell.castShadow = shell.receiveShadow = true; box.add(shell);
  for (const [x, y] of [[-.32, .45], [.32, .45], [-.32, -.45], [.32, -.45]]) { const s = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .015, 16), M.nickel); s.rotation.x = Math.PI / 2; s.position.set(x, y, .305); box.add(s); }
  function lamp(on: string, off: string, y: number) {
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(.13, .03, 16, 40), M.nickel); bezel.position.set(0, y, .31); box.add(bezel);
    const mat = new THREE.MeshPhysicalMaterial({ color: off, roughness: .15, emissive: on, emissiveIntensity: 0, clearcoat: 1 });
    const lens = new THREE.Mesh(new THREE.SphereGeometry(.12, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat); lens.rotation.x = Math.PI / 2; lens.position.set(0, y, .3); box.add(lens);
    const light = new THREE.PointLight(on, 0, 1.6, 2); light.position.set(0, y, .55); box.add(light);
    return (v: boolean) => { mat.emissiveIntensity = v ? 2.2 : 0; mat.color.set(v ? on : off); light.intensity = v ? 1.3 : 0; };
  }
  const standby = lamp('#ff3b22', '#3a0d08', .2), go = lamp('#3dff7a', '#0b2a14', -.2);
  function dymo(text: string, y: number) {
    const c = canvas(256, 64); const k = c.getContext('2d')!; k.fillStyle = '#121212'; k.fillRect(0, 0, 256, 64);
    k.font = font(34, { family: SANS, weight: 500 }); k.fillStyle = '#e9e6de'; k.textAlign = 'center'; k.fillText(text, 128, 44);
    const m = new THREE.Mesh(new THREE.BoxGeometry(.36, .09, .01), new THREE.MeshPhysicalMaterial({ map: tex(c), roughness: .4, clearcoat: .6 })); m.position.set(0, y, .305); box.add(m);
  }
  dymo('Standby', -.01); dymo('Go', -.41);
  const cord = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, .52, .12), new THREE.Vector3(.1, 1, .05), new THREE.Vector3(-.4, 1.6, .04), new THREE.Vector3(.2, 2.4, .04), new THREE.Vector3(.1, 4.2, .04)]), 120, .035, 14), M.braid('#2a1b14'));
  cord.castShadow = true; box.add(cord);
  return { box, set(state: 'standby' | 'go' | 'dark') { standby(state === 'standby'); go(state === 'go'); } };
}

// Index tabs: card tabs stuck out from the right edge of the pages, one per section.
export type Tab = { id: string; label: string };
export function createTabs(room: Room, tabs: Tab[]) {
  const { scene, tex } = room;
  const meshes: THREE.Mesh[] = [];
  const colors = ['#e8dcc2', '#d9c9a6', '#cdb98f', '#c2ad83'];
  tabs.forEach((t, i) => {
    // the label is drawn along the tab, reading top to bottom like a spine
    const c = canvas(128, 440); const k = c.getContext('2d')!;
    k.fillStyle = colors[i % colors.length]; k.fillRect(0, 0, 128, 440);
    k.fillStyle = 'rgba(60,45,25,.07)'; for (let x = 0; x < 128; x += 4) k.fillRect(x, 0, 1, 440);
    k.save(); k.translate(78, 220); k.rotate(Math.PI / 2); k.font = font(44, { family: SERIF }); k.fillStyle = '#2e2719'; k.textAlign = 'center'; k.fillText(t.label, 0, 14); k.restore();
    const face = new THREE.MeshStandardMaterial({ map: tex(c), roughness: .8 }), edge = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: .85 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(.18, tabs.length > 4 ? .5 : .62, .006), [edge, edge, edge, edge, face, edge]);
    m.position.set(rightX + PW / 2 + .07, PH / 2 - .42 - i * (tabs.length > 4 ? .56 : .7), .16 + i * .004); m.castShadow = m.receiveShadow = true;
    m.userData.tab = t.id; scene.add(m); meshes.push(m);
  });
  function active(id: string) { for (const m of meshes) m.position.x = rightX + PW / 2 + (m.userData.tab === id ? .1 : .07); }
  const pick = (ray: THREE.Raycaster) => (ray.intersectObjects(meshes)[0]?.object.userData.tab as string | undefined) ?? null;
  return { meshes, active, pick };
}

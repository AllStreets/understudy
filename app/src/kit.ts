// The room: renderer, the walnut desk, one warm lamp, and the materials the book is made of.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { rng } from './paper.ts';

export { THREE };

export function makeTex(c: HTMLCanvasElement, renderer: THREE.WebGLRenderer, { color = true, repeat = [1, 1] as [number, number] } = {}) {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); if (color) t.colorSpace = THREE.SRGBColorSpace; return t;
}
function draw(w: number, h: number, fn: (k: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void, seed = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d')!, w, h, rng(seed)); return c;
}
function noise(k: CanvasRenderingContext2D, w: number, h: number, amp: number, r: () => number) {
  const id = k.getImageData(0, 0, w, h), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - .5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  k.putImageData(id, 0, 0);
}

export function createRoom(host: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#0c0a08');
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = .28;
  const camera = new THREE.PerspectiveCamera(28, 1, .1, 100);
  const tex = (c: HTMLCanvasElement, o?: Parameters<typeof makeTex>[2]) => makeTex(c, renderer, o);

  // walnut: long wandering streaks of grain and open pores
  const wood = draw(2048, 1024, (k, w, h, r) => {
    const g = k.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#3a2516'); g.addColorStop(.5, '#2f1d11'); g.addColorStop(1, '#38231a'); k.fillStyle = g; k.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      const y0 = r() * h, amp = 2 + r() * 12, f = .002 + r() * .004, ph = r() * 7;
      k.strokeStyle = r() < .5 ? `rgba(18,10,5,${.06 + r() * .16})` : `rgba(110,72,42,${.03 + r() * .07})`; k.lineWidth = .6 + r() * 2;
      k.beginPath(); for (let x = 0; x <= w; x += 16) { const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph) * amp * .3; x ? k.lineTo(x, y) : k.moveTo(x, y); } k.stroke();
    }
    for (let i = 0; i < 4000; i++) { k.fillStyle = `rgba(10,5,2,${.12 + r() * .2})`; k.fillRect(r() * w, r() * h, 2 + r() * 4, .9); }
    noise(k, w, h, 10, r);
  });
  const woodRough = draw(512, 512, (k, w, h, r) => { k.fillStyle = '#8a8a8a'; k.fillRect(0, 0, w, h); noise(k, w, h, 36, r); });
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(24, 16), new THREE.MeshStandardMaterial({ map: tex(wood, { repeat: [4, 2.6] }), roughness: .55, roughnessMap: tex(woodRough, { color: false, repeat: [3, 3] }) }));
  desk.receiveShadow = true; scene.add(desk);

  // light: one warm desk lamp from the upper left, a cool fill from the far side
  scene.add(new THREE.HemisphereLight('#d8d0c0', '#0a0806', .22));
  const lamp = new THREE.SpotLight('#ffdcae', 95, 0, .62, .75, 1.6); lamp.position.set(-3.6, 3.4, 6.2); lamp.target.position.set(.4, -.1, 0); scene.add(lamp.target);
  lamp.castShadow = true; lamp.shadow.mapSize.set(2048, 2048); lamp.shadow.bias = -.0002; lamp.shadow.normalBias = .02; lamp.shadow.radius = 6; lamp.shadow.camera.near = 2; lamp.shadow.camera.far = 16; scene.add(lamp);
  const fill = new THREE.DirectionalLight('#b8c6dc', .35); fill.position.set(6, -3, 5); scene.add(fill);

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }));
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, 1, 1); ao.blendIntensity = .8; ao.updateGtaoMaterial({ radius: .3, distanceExponent: 1.3, thickness: 1, scale: 1, samples: 16 }); composer.addPass(ao);
  composer.addPass(new OutputPass());

  const M = {
    cloth: new THREE.MeshPhysicalMaterial({
      map: tex(draw(512, 512, (k, w, h, r) => { k.fillStyle = '#1f2a23'; k.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 3) { k.fillStyle = `rgba(255,255,255,${.015 + r() * .035})`; k.fillRect(0, y, w, 1.2); } for (let x = 0; x < w; x += 3) { k.fillStyle = `rgba(0,0,0,${.04 + r() * .08})`; k.fillRect(x, 0, 1.2, h); } noise(k, w, h, 18, r); }), { repeat: [3, 4] }),
      bumpMap: tex(draw(256, 256, (k, w, h) => { k.fillStyle = '#808080'; k.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 2) { k.fillStyle = y % 4 ? '#a0a0a0' : '#606060'; k.fillRect(0, y, w, 1); } for (let x = 0; x < w; x += 2) { k.fillStyle = x % 4 ? 'rgba(160,160,160,.5)' : 'rgba(80,80,80,.5)'; k.fillRect(x, 0, 1, h); } }), { color: false, repeat: [24, 32] }),
      bumpScale: .6, roughness: .85, sheen: .4, sheenColor: new THREE.Color('#5c6b5f'), sheenRoughness: .7,
    }),
    edges: new THREE.MeshStandardMaterial({ map: tex(draw(64, 512, (k, w, h, r) => { k.fillStyle = '#c9bfa9'; k.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 2) { k.fillStyle = `rgba(90,70,40,${.08 + r() * .18})`; k.fillRect(x, 0, 1, h); } })), roughness: .9 }),
    nickel: new THREE.MeshPhysicalMaterial({ color: '#c9c5bc', metalness: 1, roughness: .22, clearcoat: .3 }),
    crackle: new THREE.MeshStandardMaterial({ color: '#17171a', roughness: .62, metalness: .55, bumpMap: tex(draw(256, 256, (k, w, h, r) => { k.fillStyle = '#808080'; k.fillRect(0, 0, w, h); for (let i = 0; i < 2200; i++) { k.fillStyle = r() < .5 ? '#5a5a5a' : '#a6a6a6'; k.beginPath(); k.arc(r() * w, r() * h, 1 + r() * 2.4, 0, 7); k.fill(); } }), { color: false, repeat: [3, 3] }), bumpScale: 1.2 }),
    braid: (color: string) => new THREE.MeshPhysicalMaterial({ color, roughness: .75, sheen: .6, sheenColor: new THREE.Color('#8a7a68'), bumpMap: tex(draw(64, 256, (k, w, h) => { k.fillStyle = '#808080'; k.fillRect(0, 0, w, h); k.lineWidth = 3; for (let y = -w; y < h + w; y += 8) { k.strokeStyle = '#d0d0d0'; k.beginPath(); k.moveTo(0, y); k.lineTo(w, y + w * .5); k.stroke(); k.strokeStyle = '#303030'; k.beginPath(); k.moveTo(0, y + 4); k.lineTo(w, y + 4 - w * .5); k.stroke(); } }), { color: false, repeat: [80, 1] }), bumpScale: 1.4 }),
    corner: new THREE.MeshStandardMaterial({ color: '#141210', roughness: .6 }),
  };

  return { renderer, scene, camera, composer, ao, lamp, M, tex };
}
export type Room = ReturnType<typeof createRoom>;

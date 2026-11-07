// Drawing on paper: the stock, the punched holes, typed text, and pencil.
// Every page in the book is a canvas drawn with these, then laid on a sheet.

export const PW = 2.1, PH = 2.97;                       // a page, in scene units (A4 proportions)
export const CW = 1600, CH = Math.round(CW * PH / PW);  // its canvas
export const HOLE = 80;                                 // punched holes, px from the spine edge
export const INK = '#24201a', INK_SOFT = '#6b604f', INK_FAINT = '#857a67';
export const RED: RGB = [176, 48, 31], GRAPHITE: RGB = [58, 54, 48];
export type RGB = [number, number, number];
export type Ctx = CanvasRenderingContext2D;

export const SERIF = 'Newsreader', SANS = '"Inter Tight"';
export const font = (px: number, { italic = false, weight = 400, family = SERIF } = {}) => `${italic ? 'italic ' : ''}${weight} ${px}px ${family}`;

export async function loadFonts() {
  for (const f of [font(40), font(40, { italic: true }), font(40, { weight: 500 }), font(34, { family: SANS }), font(34, { family: SANS, weight: 500 })]) await document.fonts.load(f);
  await document.fonts.ready;
}

// a seeded random, so a page looks the same every time it is drawn
export function rng(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function hash(str: string) { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; }

export function canvas(w = CW, h = CH) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function grain(k: Ctx, w: number, h: number, amp: number, r: () => number) {
  const id = k.getImageData(0, 0, w, h), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - .5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  k.putImageData(id, 0, 0);
}

// The stock: warm, with fibres, faintly shaded where it curls toward the rings.
// Drawn once per side and copied, since grain is the slow part.
const stockCache = new Map<string, HTMLCanvasElement>();
export function paper(k: Ctx, spine: 'left' | 'right') {
  let c = stockCache.get(spine);
  if (!c) {
    c = canvas(); const s = c.getContext('2d')!; const r = rng(spine === 'left' ? 7 : 11);
    s.fillStyle = '#f2ece0'; s.fillRect(0, 0, CW, CH);
    for (let i = 0; i < 300; i++) {
      s.strokeStyle = `rgba(120,100,70,${.03 + r() * .05})`; s.lineWidth = .5 + r() * .7;
      const x = r() * CW, y = r() * CH, a = r() * 6.3, l = 6 + r() * 24;
      s.beginPath(); s.moveTo(x, y); s.quadraticCurveTo(x + Math.cos(a) * l * .5 + (r() - .5) * 8, y + Math.sin(a) * l * .5 + (r() - .5) * 8, x + Math.cos(a) * l, y + Math.sin(a) * l); s.stroke();
    }
    grain(s, CW, CH, 9, r);
    const g = spine === 'right' ? s.createLinearGradient(CW, 0, CW - 220, 0) : s.createLinearGradient(0, 0, 220, 0);
    g.addColorStop(0, 'rgba(70,50,25,.2)'); g.addColorStop(1, 'rgba(70,50,25,0)'); s.fillStyle = g; s.fillRect(0, 0, CW, CH);
    const hx = spine === 'right' ? CW - HOLE : HOLE;
    for (const fy of [.18, .5, .82]) {
      s.fillStyle = '#16100b'; s.beginPath(); s.arc(hx, CH * fy, 22, 0, 7); s.fill();
      s.strokeStyle = 'rgba(80,60,35,.35)'; s.lineWidth = 3; s.beginPath(); s.arc(hx, CH * fy, 24, 0, 7); s.stroke();
    }
    stockCache.set(spine, c);
  }
  k.drawImage(c, 0, 0);
}

// A coloured-pencil or graphite line: several faint passes that wander a little.
export function pencil(k: Ctx, pts: [number, number][], { color = RED, width = 4.5, passes = 7, alpha = .22, jitter = 1.6, seed = 1 }: { color?: RGB; width?: number; passes?: number; alpha?: number; jitter?: number; seed?: number } = {}) {
  const r = rng(seed); k.save(); k.lineCap = 'round'; k.lineJoin = 'round';
  for (let p = 0; p < passes; p++) {
    k.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${alpha * (.6 + r() * .6)})`; k.lineWidth = width * (.5 + r() * .6);
    k.beginPath(); pts.forEach(([x, y], i) => { const jx = x + (r() - .5) * 2 * jitter, jy = y + (r() - .5) * 2 * jitter; i ? k.lineTo(jx, jy) : k.moveTo(jx, jy); }); k.stroke();
  }
  k.restore();
}
export function ring(cx: number, cy: number, rx: number, ry: number, rot = 0, turns = 1.08, seed = 1): [number, number][] {
  const r = rng(seed), pts: [number, number][] = [], n = 120, wobF = 2.6 + r() * 1.4, start = r() * 6;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2 * turns + start, wob = 1 + Math.sin(t * wobF) * .025;
    const x = Math.cos(t) * rx * wob, y = Math.sin(t) * ry * wob;
    pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return pts;
}
export function underline(k: Ctx, x0: number, x1: number, y: number, o: Parameters<typeof pencil>[2] = {}) {
  const mid = (x0 + x1) / 2; pencil(k, [[x0, y], [mid, y - 3], [x1, y + 2]], { width: 2.6, alpha: .24, ...o });
}
// a circled number in the margin, the way a stage manager marks a cue
export function cue(k: Ctx, n: string, x: number, y: number, color = RED, seed = 1) {
  k.font = font(50, { weight: 500 }); k.fillStyle = `rgb(${color.join(',')})`; k.textAlign = 'center'; k.fillText(n, x, y + 4); k.textAlign = 'left';
  pencil(k, ring(x, y - 14, 38, 36, .3, 1.08, seed), { color, width: 3.4, alpha: .3, seed });
}
export function tick(k: Ctx, x: number, y: number, seed = 1) {
  pencil(k, [[x + 6, y + 26], [x + 24, y + 52], [x + 72, y - 14]], { color: GRAPHITE, width: 6, passes: 9, alpha: .3, seed });
}

// Wrap text to a width, returning the y after the last line. Lines past maxLines end in an ellipsis.
export function wrap(k: Ctx, text: string, x: number, y: number, maxW: number, lh: number, maxLines = Infinity): number {
  const words = text.replace(/\s+/g, ' ').trim().split(' '); let line = '', lines = 0;
  for (let i = 0; i < words.length; i++) {
    const t = line ? line + ' ' + words[i] : words[i];
    if (k.measureText(t).width > maxW && line) {
      if (++lines >= maxLines) { k.fillText(line.replace(/[,.;:]?$/, '…'), x, y); return y + lh; }
      k.fillText(line, x, y); y += lh; line = words[i];
    } else line = t;
  }
  if (line) { k.fillText(line, x, y); y += lh; }
  return y;
}
export function rule(k: Ctx, x0: number, x1: number, y: number, alpha = .35) { k.strokeStyle = `rgba(60,50,35,${alpha})`; k.lineWidth = 2; k.beginPath(); k.moveTo(x0, y); k.lineTo(x1, y); k.stroke(); }

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const day = (iso?: string | null) => { if (!iso) return ''; const d = new Date(iso); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };

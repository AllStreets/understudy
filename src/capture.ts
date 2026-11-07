import { join } from 'node:path';
import { copyFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { paths, ensureDirs } from './paths.ts';

// Screenshot a running page (or take an image file as it is) into Understudy's shots folder.
export async function capture(target: string, o: { width?: number; height?: number; wait?: number } = {}): Promise<string> {
  ensureDirs();
  const id = randomUUID().slice(0, 12);
  if (!/^https?:\/\//.test(target)) {
    if (!existsSync(target)) throw new Error(`no such file or page: ${target}`);
    const ext = target.toLowerCase().endsWith('.jpg') || target.toLowerCase().endsWith('.jpeg') ? 'jpg' : 'png';
    const out = join(paths.shots, `${id}.${ext}`); copyFileSync(target, out); return out;
  }
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: o.width ?? 1440, height: o.height ?? 900 }, deviceScaleFactor: 1 });
    await page.goto(target, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => page.goto(target, { waitUntil: 'load' }));
    await page.waitForTimeout(o.wait ?? 1500);
    const out = join(paths.shots, `${id}.png`);
    await page.screenshot({ path: out });
    return out;
  } finally { await browser.close(); }
}

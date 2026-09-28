// node render-seg.mjs <file.html> <out.png> <width> <height> [maxSeg=8000]
// Full-page capture in clipped segments (<= maxSeg px tall) stitched with PIL, so a page taller
// than Chrome's 16,384px capture texture is captured whole. Reports console errors + overflow.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const require = createRequire('/Users/aldemirkonuk/Projects/restaurant-ai-automation/apps/web/package.json');
const { chromium } = require('@playwright/test');
const [file, out, w = '1440', h = '900', maxSeg = '8000'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('file://' + path.resolve(file));
await page.waitForTimeout(1200);
const total = await page.evaluate(() => document.documentElement.scrollHeight);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
const clipped = await page.evaluate(() => {
  // elements whose text is clipped by overflow:hidden + text-overflow:ellipsis (scrollWidth > clientWidth)
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push((el.className||'').toString().slice(0,30) + ': ' + (el.textContent||'').trim().slice(0, 60));
  }
  return out.slice(0, 40);
});
const dir = out + '.segs'; fs.mkdirSync(dir, { recursive: true });
const segs = [];
for (let y = 0, i = 0; y < total; y += +maxSeg, i++) {
  const hh = Math.min(+maxSeg, total - y);
  const p = path.join(dir, `seg-${String(i).padStart(2,'0')}.png`);
  await page.screenshot({ path: p, fullPage: true, clip: { x: 0, y, width: +w, height: hh } });
  segs.push(p);
}
await browser.close();
execFileSync('python3', ['-c', `
import sys
from PIL import Image
out, *segs = sys.argv[1:]
ims = [Image.open(s) for s in segs]
W = max(i.width for i in ims); H = sum(i.height for i in ims)
canvas = Image.new('RGB', (W, H))
y = 0
for im in ims:
    canvas.paste(im, (0, y)); y += im.height
canvas.save(out)
print(W, H)
`, out, ...segs], { stdio: 'inherit' });
fs.rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify({ out, total, segments: segs.length, errors, horizontalOverflow: overflow, ellipsisClipped: clipped }));

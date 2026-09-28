// Re-measure ADR 0149 row 30 on the declared paper roots: every element carrying visible text
// inside .mudavym[data-ground="paper"] must not compute to --ink-3 (rgb(124,115,101)).
// Marks (backgrounds, borders) in --ink-3 are decorative and are listed separately, not failed.
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire('/Users/aldemirkonuk/Projects/restaurant-ai-automation/apps/web/package.json');
const { chromium } = require('@playwright/test');
const DIR = '/Users/aldemirkonuk/Projects/wt-finish/.planning/sketches/119-app-shell-sota';
const browser = await chromium.launch({ channel: 'chrome' });
for (const f of ['direction-d.html', 'direction-e.html']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('file://' + path.join(DIR, f));
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const INK3 = 'rgb(124, 115, 101)';
    const roots = [...document.querySelectorAll('.mudavym[data-ground="paper"]')];
    const text = [], marks = [];
    for (const root of roots) {
      for (const el of root.querySelectorAll('*')) {
        const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
        const cs = getComputedStyle(el);
        if (own && cs.color === INK3 && cs.visibility !== 'hidden' && cs.display !== 'none') {
          text.push({ el: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').join('.') : ''), text: own.slice(0, 60) });
        }
        if (cs.backgroundColor === INK3 || cs.borderTopColor === INK3 && cs.borderTopWidth !== '0px') {
          marks.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').join('.') : ''));
        }
      }
    }
    return { roots: roots.length, text, marks: [...new Set(marks)] };
  });
  console.log(f, JSON.stringify(r, null, 1));
  await page.close();
}
await browser.close();

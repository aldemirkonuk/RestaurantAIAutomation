// Frame-by-frame shots for review. Run: node shoot.mjs
import { chromium } from '/Users/aldemirkonuk/Projects/restaurant-ai-automation/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const url = 'file://' + join(here, 'index.html')
mkdirSync(join(here, 'shots'), { recursive: true })

const browser = await chromium.launch()
for (const [width, tag] of [[1440, '1440'], [390, '390']]) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } })
  await page.goto(url)
  // the sticky sketch chrome is not part of the design; it only obscures shots
  await page.addStyleTag({ content: '.chrome { display: none !important; }' })
  await page.waitForTimeout(2500)
  for (const id of ['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7']) {
    await page.locator('#' + id).screenshot({ path: join(here, `shots/${id}-${tag}.png`) })
  }
  if (width === 1440) {
    await page.click('#origtoggle')
    await page.waitForTimeout(400)
    await page.locator('#f5').screenshot({ path: join(here, 'shots/f5-original-1440.png') })
    await page.click('#origtoggle')
    await page.evaluate(() => { document.body.dataset.ground = 'charcoal' })
    await page.waitForTimeout(400)
    await page.locator('#f5').screenshot({ path: join(here, 'shots/f5-charcoal-1440.png') })
  }
}
await browser.close()
console.log('done')

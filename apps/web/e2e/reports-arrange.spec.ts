/**
 * Reports: "no bugs when cards switch places", in a real browser (r104 g6).
 *
 * vitest/jsdom cannot lay out react-grid-layout (it measures width 0), so the
 * arrange maths is pinned in `rp-arrange.test.ts` and THIS file pins what only
 * a browser can: cards that never overlap after a swap, a page that never
 * scrolls sideways, a swap that moves nothing else (layout shift), and a
 * layout that survives a reload.
 *
 * It needs the real gateway: run it against the local stack
 * (`p4-scratch/local-stack.sh up <worktree>`, web on 127.0.0.1:3410, which
 * signs in as the seeded owner on open) with
 *
 *   E2E_REPORTS_URL=http://127.0.0.1:3410 pnpm exec playwright test reports-arrange
 *
 * Without E2E_REPORTS_URL every test here is skipped, and says why: the CI
 * smoke lane has mocked auth and no gateway, which this page cannot be read on.
 */
import { expect, test, type Page } from '@playwright/test'

const BASE = process.env.E2E_REPORTS_URL
test.skip(!BASE, 'needs the local stack: set E2E_REPORTS_URL (e.g. http://127.0.0.1:3410)')

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900, move: 'ArrowRight' },
  { name: '375', width: 375, height: 812, move: 'ArrowDown' },
] as const

/**
 * Cumulative layout shift, summed from EVERY layout-shift entry. The usual CLS
 * leaves out shifts within 500 ms of an input, which is exactly the window a
 * keyboard swap or a drag lives in, so counting only the rest would pass a
 * swap that moved the page.
 */
async function watchShift(page: Page) {
  await page.addInitScript(() => {
    ;(window as unknown as { __cls: number }).__cls = 0
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as Array<{ value: number }>)
        (window as unknown as { __cls: number }).__cls += e.value
    }).observe({ type: 'layout-shift', buffered: true })
  })
}

const cards = (page: Page) => page.locator('.react-grid-item')

/** Titles in reading order: top to bottom, then left to right. */
async function order(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.react-grid-item'))
      .map((el) => {
        const r = el.getBoundingClientRect()
        // The heading is on the card in both modes; the grip only while arranging.
        const name = el.querySelector('h2.rp-cut__title')?.textContent?.trim() ?? ''
        return { name, y: Math.round(r.top), x: Math.round(r.left) }
      })
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((c) => c.name),
  )
}

async function expectSound(page: Page, width: number) {
  const rects = await cards(page).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { l: r.left, t: r.top, r: r.right, b: r.bottom }
    }),
  )
  expect(rects.length).toBeGreaterThan(1)
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]
      const b = rects[j]
      const w = Math.min(a.r, b.r) - Math.max(a.l, b.l)
      const h = Math.min(a.b, b.b) - Math.max(a.t, b.t)
      // 1px of slack for sub-pixel rounding; a real overlap is far larger.
      expect(w > 1 && h > 1, `cards ${i} and ${j} overlap by ${w}x${h}`).toBe(false)
    }
  const docWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(docWidth, 'the page scrolls sideways').toBeLessThanOrEqual(width)
}

async function open(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height })
  await watchShift(page)
  await page.goto(`${BASE}/reports`)
  await expect(cards(page).first()).toBeVisible({ timeout: 20000 })
  await page.getByRole('button', { name: 'Arrange the sheet' }).click()
  await expect(page.getByRole('button', { name: 'Rule it off' })).toBeVisible()
}

async function cls(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls)
}

for (const vp of VIEWPORTS) {
  test.describe(`at ${vp.name}`, () => {
    test('a keyboard swap leaves no overlap, no sideways scroll, no shift, and survives a reload', async ({ page }) => {
      await open(page, vp.width, vp.height)
      await expectSound(page, vp.width)
      const before = await order(page)
      const shiftBefore = await cls(page)

      await page.getByRole('button', { name: /^Move / }).first().focus()
      await page.keyboard.press('Space')
      await page.keyboard.press(vp.move)
      await page.keyboard.press('Space')

      await expect.poll(() => order(page)).not.toEqual(before)
      await expectSound(page, vp.width)
      expect((await order(page)).slice().sort()).toEqual(before.slice().sort())
      expect(await cls(page) - shiftBefore, 'a swap moved something it should not').toBeLessThan(0.02)

      const moved = await order(page)
      await Promise.all([
        page.waitForResponse((r) => r.request().method() !== 'GET' && r.status() < 300),
        page.getByRole('button', { name: 'Rule it off' }).click(),
      ])
      await page.reload()
      await expect(cards(page).first()).toBeVisible({ timeout: 20000 })
      expect(await order(page)).toEqual(moved)
      await expectSound(page, vp.width)
    })

    test('a pointer drag of one cutting onto another leaves no overlap and no sideways scroll', async ({ page }) => {
      await open(page, vp.width, vp.height)
      const before = await order(page)
      // react-grid-layout's handles mount a task after paint (useAfterPaint).
      await expect(page.locator('.react-grid-item.react-draggable').first()).toBeVisible()
      const a = await cards(page).nth(0).boundingBox()
      const b = await cards(page).nth(1).boundingBox()
      expect(a && b).toBeTruthy()
      // From the card's top-left padding (not a control, so react-grid-layout
      // takes it as a handle) to the centre of the next card.
      await page.mouse.move(a!.x + 6, a!.y + 6)
      await page.mouse.down()
      await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 12 })
      await page.mouse.up()
      // The claim is that cards switch places by pointer: a drag the grid never
      // picked up leaves the sheet sound too, so the order must have changed.
      await expect.poll(() => order(page)).not.toEqual(before)
      await expectSound(page, vp.width)
      expect((await order(page)).slice().sort()).toEqual(before.slice().sort())
      expect(await cls(page), 'the drag shifted the page').toBeLessThan(0.02)
    })
  })
}

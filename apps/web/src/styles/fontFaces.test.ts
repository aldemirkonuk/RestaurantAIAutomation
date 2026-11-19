/**
 * r71 N-21 — fonts and viewport housekeeping.
 *
 * Reads the SHIPPED css and html off disk and pins four things a reader of the
 * diff cannot see by eye:
 *
 *  1. No swap jump. `Plus Jakarta Fallback` and `Fraunces Fallback` are local
 *     faces scaled to the real faces' measured metrics, so the page keeps its
 *     line boxes and nearly its line breaks when the woff2 arrives. The CLS
 *     proxy below does the arithmetic from the measured widths: before, a swap
 *     moved a line of Fraunces text by 16.9% of its width; after, by under 0.5%.
 *  2. One sans. No DM Sans file ships; the family name is an alias of Plus
 *     Jakarta Sans, and the count of the retired name only goes down.
 *  3. The right faces are preloaded, and `optional` on Fraunces latin.
 *  4. The viewport meta never locks zoom, and figures in tables line up.
 *
 * Honest limit: jsdom paints nothing and lays out nothing, so a real layout-shift
 * score is a browser measurement (the PR lists it as a check owed). The metric
 * numbers below were measured with fontTools from the files in public/fonts:
 * weighted English letter advance, Jakarta 0.4728 em, Arial 0.4459 em, Fraunces
 * 0.5207 em, Georgia 0.4455 em; hhea ascender/descender/line gap per em.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const WEB = resolve(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(WEB, p), 'utf8')

const sans = read('src/styles/fonts-sans.css')
const mudavym = read('src/styles/mudavym.css')
const indexHtml = read('index.html')

function faces(css: string): Record<string, string>[] {
  const out: Record<string, string>[] = []
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const d: Record<string, string> = {}
    for (const line of m[1].split(';')) {
      const i = line.indexOf(':')
      if (i > 0) d[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
    out.push(d)
  }
  return out
}
const named = (css: string, family: string) =>
  faces(css).filter((f) => f['font-family'] === `'${family}'`)
const pct = (v: string) => parseFloat(v) / 100

// Measured with fontTools (see header). em fractions.
const MEASURED = {
  jakarta: { avg: 0.4728, asc: 1.038, desc: 0.222, gap: 0 },
  arial: { avg: 0.4459 },
  fraunces: { avg: 0.5207, asc: 0.978, desc: 0.255, gap: 0 },
  georgia: { avg: 0.4455 },
}

describe('metric-matched fallbacks', () => {
  const cases = [
    { family: 'Plus Jakarta Fallback', css: sans, real: MEASURED.jakarta, fb: MEASURED.arial, before: 'arial' },
    { family: 'Fraunces Fallback', css: mudavym, real: MEASURED.fraunces, fb: MEASURED.georgia, before: 'georgia' },
  ]
  for (const c of cases) {
    it(`${c.family}: every face carries size-adjust and the three overrides`, () => {
      const fs = named(c.css, c.family)
      expect(fs.length).toBeGreaterThanOrEqual(2)
      for (const f of fs) {
        expect(f['src']).toMatch(/local\(/)
        expect(f['src']).not.toMatch(/url\(/)
        for (const k of ['size-adjust', 'ascent-override', 'descent-override', 'line-gap-override']) {
          expect(f[k], `${c.family} ${k}`).toBeTruthy()
        }
      }
    })

    it(`${c.family}: CLS proxy - a swap moves a line under 0.5%, it moved over 5% before`, () => {
      const f = named(c.css, c.family)[0]
      const sa = pct(f['size-adjust'])
      const widthAfter = Math.abs((c.fb.avg * sa) / c.real.avg - 1)
      const widthBefore = Math.abs(c.fb.avg / c.real.avg - 1)
      expect(widthBefore).toBeGreaterThan(0.05)
      expect(widthAfter).toBeLessThan(0.005)
      // Line box: the fallback's (ascent + descent + gap) at the adjusted size
      // must equal the real face's, in em of the same font-size.
      const box = (pct(f['ascent-override']) + pct(f['descent-override']) + pct(f['line-gap-override'])) * sa
      const real = c.real.asc + c.real.desc + c.real.gap
      expect(Math.abs(box / real - 1)).toBeLessThan(0.005)
    })
  }
})

describe('one sans', () => {
  it('no DM Sans file ships and no css names one', () => {
    const files = readdirSync(join(WEB, 'public/fonts'))
    expect(files.filter((f) => /dm-sans/i.test(f))).toEqual([])
    expect(sans).not.toMatch(/dm-sans-/)
    expect(read('public/l/day/index.html')).not.toMatch(/dm-sans-/)
  })

  it("every 'DM Sans' face is an alias onto the Plus Jakarta Sans files", () => {
    const dm = named(sans, 'DM Sans')
    expect(dm.length).toBe(4)
    for (const f of dm) expect(f['src']).toMatch(/plus-jakarta-sans-latin(-ext)?-(normal|italic)\.woff2/)
    for (const f of dm) expect(existsSync(join(WEB, 'public', f['src'].match(/url\('([^']+)'/)![1]))).toBe(true)
  })

  it('the retired name is never added to: mentions in src only go down', () => {
    let n = 0
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(css|ts|tsx)$/.test(e) && !/fonts-sans\.css$|fontFaces\.test\.ts$/.test(e)) {
          n += (readFileSync(p, 'utf8').match(/DM Sans/g) ?? []).length
        }
      }
    }
    walk(join(WEB, 'src'))
    expect(n).toBeLessThanOrEqual(50)
  })

  it('the shared stacks put Jakarta first and name the stand-ins', () => {
    for (const f of [
      'src/components/askai/ask-panel.css',
      'src/components/mudavym/house-shell.css',
      'src/components/mudavym/public-shell.css',
      'src/components/mudavym/sheet.css',
    ]) {
      const css = read(f)
      expect(css, f).toMatch(/--mdv-sans: 'Plus Jakarta Sans', 'Plus Jakarta Fallback'/)
      expect(css, f).toMatch(/--mdv-serif: 'Fraunces', 'Fraunces Fallback', Georgia/)
    }
  })
})

describe('loading', () => {
  it('Fraunces latin faces are optional, latin-ext stays swap', () => {
    for (const f of named(mudavym, 'Fraunces')) {
      const latin = /fraunces-latin-(normal|italic)\.woff2/.test(f['src'])
      expect(f['font-display'], f['src']).toBe(latin ? 'optional' : 'swap')
    }
  })

  it('preloads exist on disk and cover Fraunces upright and italic and Jakarta', () => {
    const hrefs = [...indexHtml.matchAll(/<link rel="preload" as="font"[^>]*href="([^"]+)"/g)].map((m) => m[1])
    for (const h of [
      '/fonts/fraunces-latin-normal.woff2',
      '/fonts/fraunces-latin-italic.woff2',
      '/fonts/plus-jakarta-sans-latin-normal.woff2',
    ]) {
      expect(hrefs).toContain(h)
    }
    for (const h of hrefs) expect(existsSync(join(WEB, 'public', h)), h).toBe(true)
  })

  it('every preload names crossorigin (a font preload without it is fetched twice)', () => {
    for (const m of indexHtml.matchAll(/<link rel="preload" as="font"[^>]*>/g)) expect(m[0]).toMatch(/crossorigin/)
  })
})

describe('viewport and figures', () => {
  it('the viewport meta fits the device and never locks zoom', () => {
    const meta = indexHtml.match(/<meta name="viewport" content="([^"]+)"/)![1]
    expect(meta).toMatch(/width=device-width/)
    expect(meta).toMatch(/viewport-fit=cover/)
    expect(meta).not.toMatch(/user-scalable\s*=\s*(no|0)|maximum-scale/)
  })

  it('table cells, time and output take tabular figures inside .mudavym', () => {
    expect(mudavym).toMatch(/\.mudavym :is\(td, th, time, output, \[data-num\]\)\s*\{\s*font-variant-numeric: tabular-nums;/)
  })
})

// Type floor: no text in apps/web/src is set below 11 px.
//
// One scanner serves three jobs: the guard test (src/__tests__/typeFloor.guard.test.ts),
// the codemod that lifts a file to the floor, and the tighten step that lowers the
// allowlist ceilings after a file is fixed. Run from apps/web:
//   node tools/typeFloor.mjs scan                  list every site under the floor
//   node tools/typeFloor.mjs codemod <path>...     lift sites in these files/dirs to 11 px
//   node tools/typeFloor.mjs tighten               lower allowlist ceilings to today's counts
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FLOOR_PX = 11
const HERE = dirname(fileURLToPath(import.meta.url))
export const SRC = join(HERE, '..', 'src')
export const ALLOWLIST_PATH = join(HERE, 'typeFloor.allowlist.json')

// Each rule finds a size in a line; `px` turns the match into pixels.
const RULES = [
  { name: 'tailwind', ext: /\.(tsx?|jsx?)$/, re: /text-\[(\d+(?:\.\d+)?)px\]/g, px: (m) => +m[1] },
  { name: 'css-px', ext: /\.css$/, re: /font-size:\s*(\d+(?:\.\d+)?)px/g, px: (m) => +m[1] },
  { name: 'css-rem', ext: /\.css$/, re: /font-size:\s*(\d*\.?\d+)rem/g, px: (m) => +m[1] * 16 },
  { name: 'inline-number', ext: /\.tsx$/, re: /fontSize:\s*(\d+(?:\.\d+)?)(?![\d.]*\s*[*/+\-]|[\d.]*px)/g, px: (m) => +m[1] },
  { name: 'inline-px', ext: /\.tsx$/, re: /fontSize:\s*['"](\d+(?:\.\d+)?)px['"]/g, px: (m) => +m[1] },
]

const SKIP = /\.(test|spec|stories)\.|(^|\/)__tests__\//

export function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === 'node_modules') continue
      yield* walk(p)
    } else yield p
  }
}

/** Sites under the floor in one file's text. */
export function sitesIn(text, file = '') {
  const out = []
  const lines = text.split('\n')
  for (const rule of RULES) {
    if (!rule.ext.test(file)) continue
    lines.forEach((line, i) => {
      for (const m of line.matchAll(rule.re)) {
        const px = rule.px(m)
        if (px > 0 && px < FLOOR_PX) out.push({ line: i + 1, rule: rule.name, px, text: m[0] })
      }
    })
  }
  return out
}

/** { 'pages/x.tsx': count } for every file under src with at least one site. */
export function scan(src = SRC) {
  const counts = {}
  for (const abs of walk(src)) {
    const rel = relative(src, abs).split(sep).join('/')
    if (SKIP.test(rel)) continue
    const n = sitesIn(readFileSync(abs, 'utf8'), rel).length
    if (n) counts[rel] = n
  }
  return counts
}

export function readAllowlist() {
  return JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')).ceilings
}

/** Files over their ceiling, or under the floor with no ceiling at all. */
export function violations(counts, ceilings) {
  const bad = []
  for (const [file, n] of Object.entries(counts)) {
    const allowed = ceilings[file] ?? 0
    if (n > allowed) bad.push({ file, found: n, allowed })
  }
  return bad
}

/** Lift every site in the text to the floor (decimals included). */
export function lift(text, file) {
  let out = text
  for (const rule of RULES) {
    if (!rule.ext.test(file)) continue
    out = out.replace(rule.re, (whole, ...g) => {
      const m = [whole, ...g]
      const px = rule.px(m)
      if (!(px > 0 && px < FLOOR_PX)) return whole
      if (rule.name === 'css-rem') return whole.replace(m[1] + 'rem', '0.6875rem')
      return whole.replace(m[1], String(FLOOR_PX))
    })
  }
  return out
}

function targets(args) {
  const files = []
  for (const a of args) {
    const abs = a.startsWith('/') ? a : join(process.cwd(), a)
    if (statSync(abs).isDirectory()) files.push(...walk(abs))
    else files.push(abs)
  }
  return files
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'scan') {
    const counts = scan()
    for (const [f, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), f)
    console.log(Object.values(counts).reduce((a, b) => a + b, 0), 'sites in', Object.keys(counts).length, 'files')
  } else if (cmd === 'codemod') {
    let changed = 0
    for (const abs of targets(rest)) {
      const rel = relative(SRC, abs).split(sep).join('/')
      if (SKIP.test(rel)) continue
      const before = readFileSync(abs, 'utf8')
      const after = lift(before, rel)
      if (after !== before) {
        writeFileSync(abs, after)
        changed++
        console.log('lifted', rel)
      }
    }
    console.log(changed, 'files changed')
  } else if (cmd === 'tighten') {
    const counts = scan()
    const doc = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'))
    doc.ceilings = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)))
    writeFileSync(ALLOWLIST_PATH, JSON.stringify(doc, null, 2) + '\n')
    console.log('allowlist now', Object.keys(doc.ceilings).length, 'files')
  } else {
    console.log('usage: scan | codemod <path>... | tighten')
    process.exit(2)
  }
}

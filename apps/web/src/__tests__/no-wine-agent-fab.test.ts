/**
 * Guard: the floating "Wine Agent" button never comes back as working code.
 *
 * ADR 0149 row 33 (via ADR 0145): the floating `WineAgentFab` is removed —
 * `/ask` and the ⌘⇧K palette panel are the two doors to the assistant. The
 * component was deleted outright (not merely unmounted) — this guard fails
 * the build if `WineAgentFab` is imported, mounted as JSX, or re-created as
 * a mock/export anywhere under `apps/web/src`, in EITHER layout (the shell
 * or legacy), regardless of the `shell` gate.
 *
 * Deliberately narrow to CODE references (import path, JSX tag, object
 * property/mock, call) — a prose mention in a comment (e.g. "same hide-list
 * as WineAgentFab used to have") is a legitimate historical citation, not a
 * regression, and is not flagged.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue
      walk(full, out)
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

const THIS_FILE = relative(SRC, __filename).split(sep).join('/')

/** Import path, JSX mount, object property (export/mock), or call — not prose. */
const CODE_REFERENCE =
  /from\s+['"][^'"]*WineAgentFab['"]|<WineAgentFab[\s/>]|\bWineAgentFab\s*[:(]/

describe('the Wine Agent FAB stays deleted', () => {
  it('no file under apps/web/src imports, mounts, or re-exports WineAgentFab', () => {
    const offenders: string[] = []

    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/')
      if (rel === THIS_FILE) continue // this guard's own doc comment names it

      const source = readFileSync(file, 'utf8')
      if (CODE_REFERENCE.test(source)) {
        offenders.push(rel)
      }
    }

    expect(
      offenders,
      `WineAgentFab was removed by ADR 0149 row 33 — these files still ` +
        `import, mount, or re-export it. If the button is being ` +
        `reintroduced, that needs a founder decision (CLAUDE.md §0.1), not ` +
        `a re-add here.`,
    ).toEqual([])
  })

  it('the component file itself does not exist', () => {
    let exists = true
    try {
      readFileSync(join(SRC, 'guidance/components/WineAgentFab.tsx'), 'utf8')
    } catch {
      exists = false
    }
    expect(exists).toBe(false)
  })
})

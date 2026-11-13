// @vitest-environment node
/**
 * What every page pays for: the files `main.tsx` reaches through static
 * imports end up in the entry chunk, which the browser must fetch before any
 * page (the landing page, /login, the dashboard) can draw.
 *
 * Before the r18 bundle walk (2026-11-13) that chunk was 1.9 MB plus a 1 MB
 * `ui` chunk on every page: App.tsx imported /inventory's two pages and the
 * sign-up form eagerly, and the `components/ui` barrel imported the
 * `@wineops/ui` root, which re-exports the Tremor charts. This walks the same
 * static import graph and fails if a page-only weight comes back.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')
const UI_SRC = join(SRC, '..', '..', '..', 'packages', 'ui', 'src')

function resolveLocal(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec === '@wineops/ui' || spec.startsWith('@wineops/ui/')) base = join(UI_SRC, spec.slice('@wineops/ui'.length))
  else if (spec.startsWith('.')) base = normalize(join(dirname(from), spec))
  else return null
  for (const c of [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
    if (existsSync(c) && !c.endsWith('/') && /\.(tsx?|jsx?)$/.test(c)) return c
  }
  return null
}

/** Static, value-carrying import and re-export specifiers. `import()` is not followed. */
function staticSpecifiers(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false)
  const out: string[] = []
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      if (st.importClause?.isTypeOnly) continue
      out.push((st.moduleSpecifier as ts.StringLiteral).text)
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier) {
      if (st.isTypeOnly) continue
      out.push((st.moduleSpecifier as ts.StringLiteral).text)
    }
  }
  return out
}

function entryGraph() {
  const files = new Set<string>()
  const packages = new Set<string>()
  const stack = [join(SRC, 'main.tsx')]
  while (stack.length) {
    const f = stack.pop()!
    if (files.has(f)) continue
    files.add(f)
    for (const spec of staticSpecifiers(f)) {
      const local = resolveLocal(f, spec)
      if (local) stack.push(local)
      else if (!spec.startsWith('.') && !spec.startsWith('@/')) {
        const parts = spec.split('/')
        packages.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0])
      }
    }
  }
  return { files: [...files].map((f) => relative(SRC, f)), packages }
}

describe('the entry chunk every page loads', () => {
  const { files, packages } = entryGraph()

  it('walks a real graph (the shell, the router, the auth context)', () => {
    expect(files).toContain('App.tsx')
    expect(files).toContain('contexts/AuthContext.tsx')
    expect(files.length).toBeGreaterThan(50)
  })

  it.each([
    '@tremor/react',
    'recharts',
    '@headlessui/react',
    'libphonenumber-js',
    'react-phone-number-input',
    'exceljs',
    'jspdf',
    'html2canvas',
    // Loaded after the first paint by lib/error-tracking.ts (r19, 2026-11-13).
    '@sentry/react',
  ])('does not carry %s', (pkg) => {
    expect(packages.has(pkg)).toBe(false)
  })

  it.each([
    'pages/inventory/command/InventoryCommandPage.tsx',
    'pages/inventory/next/InventoryRoute.tsx',
    'pages/inventory/next/InventoryNext.tsx',
    'pages/Register.tsx',
  ])('does not carry %s (a page loaded on its own route)', (page) => {
    expect(files).not.toContain(page)
  })
})

/**
 * framer-motion's animation features (r19, 2026-11-13). The shell animates
 * with `m` components inside App.tsx's `LazyMotion`, whose features load after
 * the first paint (lib/motionFeatures.ts). One `motion` import in a file the
 * entry reaches would put the whole feature set back in the entry chunk.
 */
describe('framer-motion in the entry chunk', () => {
  const { files } = entryGraph()
  const framerNames = (file: string): string[] => {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false)
    const names: string[] = []
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || st.importClause?.isTypeOnly) continue
      if ((st.moduleSpecifier as ts.StringLiteral).text !== 'framer-motion') continue
      const b = st.importClause?.namedBindings
      if (b && ts.isNamedImports(b)) {
        for (const e of b.elements) if (!e.isTypeOnly) names.push((e.propertyName ?? e.name).text)
      } else if (b) {
        names.push('*')
      }
      if (st.importClause?.name) names.push('default')
    }
    return names
  }
  const ALLOWED = new Set(['m', 'AnimatePresence', 'LazyMotion', 'MotionConfig', 'useReducedMotion'])

  it('the entry imports only the light framer-motion names', () => {
    const heavy = files
      .map((f) => [f, framerNames(join(SRC, f)).filter((n) => !ALLOWED.has(n))] as const)
      .filter(([, names]) => names.length > 0)
      .map(([f, names]) => `${f}: ${names.join(', ')}`)
    expect(heavy).toEqual([])
  })

  it('still finds the shell files that animate (the check is not vacuous)', () => {
    const animating = files.filter((f) => framerNames(join(SRC, f)).includes('m'))
    expect(animating).toEqual(expect.arrayContaining(['components/layout/Sidebar.tsx', 'pages/Login.tsx']))
  })

  it('loads the features with import(), not with the entry', () => {
    expect(files).not.toContain('lib/motionFeatures.ts')
    const app = readFileSync(join(SRC, 'App.tsx'), 'utf8')
    expect(app).toMatch(/<LazyMotion features=\{loadMotionFeatures\}>/)
    expect(app).toMatch(/import\('\.\/lib\/motionFeatures'\)/)
  })
})


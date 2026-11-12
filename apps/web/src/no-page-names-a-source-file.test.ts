// @vitest-environment node
/**
 * No page prints a source file to the house (reports lane r3). Settings showed
 * "read by · ANALYTICS.CONTROLLER.TS:1143-1178" and a dozen like it, the
 * approval register printed a gateway path, and the cellar named a migration
 * file. A citation belongs in a code comment beside the words the page says.
 *
 * This reads every page and component the way the compiler does and fails on
 * any text that can reach the screen (JSX text, a string, a template's text)
 * and names a `.ts`, `.tsx`, `.py` or `.sql` file. Comments are not text, so
 * they stay free to cite. Skipped: imports, `console.*` and `require` calls,
 * and CSS template strings (a class like `.hp-readiness .ts` is not a file).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname)
const ROOTS = ['pages', 'components'].map((d) => join(SRC, d))
const FILE = /[\w./-]+\.(?:tsx?|py|sql)(?::\d+)?(?![\w])/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return files(p)
    return /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(f) ? [p] : []
  })
}

function skipped(n: ts.Node): boolean {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true
    if (ts.isCallExpression(p) && /^(console\.\w+|import|require)$/.test(p.expression.getText())) return true
  }
  return false
}

function named(path: string): string[] {
  const sf = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: string[] = []
  const visit = (n: ts.Node) => {
    const text =
      ts.isJsxText(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateLiteralToken(n)
        ? n.text
        : null
    const css = text !== null && ts.isTemplateLiteralToken(n) && /[{};]/.test(text)
    const hit = text && !css ? FILE.exec(text) : null
    if (hit && !skipped(n)) out.push(`${relative(SRC, path)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${hit[0]}`)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

describe('no page names a source file to the house', () => {
  it('finds no file name in any text a page can render', () => {
    expect(ROOTS.flatMap(files).flatMap(named)).toEqual([])
  })
})

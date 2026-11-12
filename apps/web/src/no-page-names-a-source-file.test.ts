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
 * they stay free to cite.
 *
 * Fix round (PR #1135): a file name was not the only internal name on screen.
 * Settings told a manager to look up a flag's "readBy entry in the registry",
 * and twelve pages printed "(ADR 0149 row 36)", "(ADR 0241)" and the like —
 * a record number nobody in the house can open. Both are rejected too: an
 * `ADR nnnn` reference and the word `readBy`. Skipped: imports, `console.*` and `require` calls,
 * and CSS template strings (a class like `.hp-readiness .ts` is not a file).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname)
const ROOTS = ['pages', 'components'].map((d) => join(SRC, d))
const FILE = /[\w./-]+\.(?:tsx?|py|sql)(?::\d+)?(?![\w])|\bADRs? ?\d{2,4}\b|\breadBy\b/g

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
    const hits = text && !css ? [...text.matchAll(FILE)].map((m) => m[0]) : []
    if (hits.length > 0 && !skipped(n)) {
      const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
      for (const hit of hits) out.push(`${relative(SRC, path)}:${line} ${hit}`)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

describe('no page names a source file to the house', () => {
  it('matches a file, a record number and a registry field, and not an ordinary word', () => {
    const all = (s: string) => [...s.matchAll(FILE)].map((m) => m[0])
    expect(all('read by · analytics.controller.ts:1143')).toEqual(['analytics.controller.ts:1143'])
    expect(all('kept as its own register (ADR 0117), and (ADR 0149 row 36; ADR 0160)')).toEqual(['ADR 0117', 'ADR 0149', 'ADR 0160'])
    expect(all('see its readBy entry')).toEqual(['readBy'])
    expect(all('Read by the low-stock alerts; an address, a ready bottle')).toEqual([])
  })

  it('finds no file name in any text a page can render', () => {
    expect(ROOTS.flatMap(files).flatMap(named)).toEqual([])
  })
})

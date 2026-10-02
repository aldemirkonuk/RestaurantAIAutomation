/**
 * Reads the page a tour runs on with the TypeScript compiler and answers one
 * question per step: does a single element that page draws meet every part of
 * the step's selector? Used by `anchors.test.ts`, which says why the check is
 * static rather than a render.
 *
 * "The page" is what the route's `element` draws, starting from the `<Route>`
 * in `App.tsx` whose `path` is the tour's route. The scan follows that JSX
 * through every component defined under `src` (props, `children`, `.map`
 * over a constant array, local constants and imports are resolved; a
 * component from a package is opaque). The app shell around the route is not
 * part of it.
 *
 * Three answers:
 *  - `rings`: one element meets the tag, id, classes and attributes, each from
 *    a value the scan resolved, and (for a descendant selector) an element the
 *    scan placed above it meets the ancestor part;
 *  - `missing`: no element can;
 *  - `cannot-check`: none is proved, and at least one element might, because
 *    a value it needed could not be resolved or the element is drawn by a
 *    package component.
 *
 * What it counts as drawn: every branch of `? :`, the right side of `&&`, both
 * sides of `||` and `??`, each item of a `.map` over an array it can read, and
 * JSX anywhere in the arguments of a call it does not know (placed under no
 * ancestor). Conditions are not evaluated, so each attribute's branches are
 * taken independently.
 */
import ts from 'typescript'
import { dirname, join, relative } from 'node:path'

export type AnchorStatus = 'rings' | 'cannot-check' | 'missing'

export interface AnchorVerdict {
  status: AnchorStatus
  /** `file:line` of the element that rings, or of up to five that might. */
  at: string[]
}

export interface AnchorPage {
  check(selector: string): AnchorVerdict
  /** Elements the scan found on the page, opaque components included. */
  size: number
}

export interface AnchorScanner {
  page(route: string): AnchorPage
}

/* ── values ─────────────────────────────────────────────────────────────── */

type Val = string | number | boolean | null | undefined | Prefix | Arr | Obj | Props
/** A string known only to begin with `head`: a template whose later part the scan cannot read. */
interface Prefix {
  kind: 'prefix'
  head: string
}
interface Arr {
  kind: 'arr'
  /** Every value an item can take. */
  items: Val[]
  open: boolean
}
interface Obj {
  kind: 'obj'
  props: Map<string, Ref>
  open: boolean
}
/** A component's props object at one call site, minus the keys a rest pattern took out. */
interface Props {
  kind: 'props'
  binding: Binding
  omit: ReadonlySet<string>
}
/** The values an expression can take; `open` means it may also take others the scan cannot tell. */
interface Vals {
  vals: Val[]
  open: boolean
}
type Ref =
  | { kind: 'expr'; expr: ts.Expression; ctx: Ctx }
  | { kind: 'vals'; vals: Vals }
  | { kind: 'children'; nodes: ts.NodeArray<ts.JsxChild>; ctx: Ctx }
  | { kind: 'default'; ref: Ref; dflt: Ref }
  | { kind: 'absent' }
  | { kind: 'unknown' }

interface Binding {
  site: ts.JsxOpeningLikeElement
  children: ts.NodeArray<ts.JsxChild> | undefined
  ctx: Ctx
}
/** One call of one function: its props at that call site, and values bound to its locals. */
interface Ctx {
  fn: ts.SignatureDeclaration | null
  binding: Binding | null
  caller: Ctx | null
  locals: Map<ts.Node, Ref>
}

/** One element the page draws. `tag` is null for a component the scan cannot see into. */
interface Inst {
  tag: string | null
  site: ts.JsxOpeningLikeElement
  ctx: Ctx
  parent: Inst | null
}

const OPEN: Vals = { vals: [], open: true }
const UNKNOWN: Ref = { kind: 'unknown' }
const ABSENT: Ref = { kind: 'absent' }
const MAX_DEPTH = 200
const MAX_INSTANCES = 200_000
const MAX_STRINGS = 512

/* ── selectors ──────────────────────────────────────────────────────────── */

type AttrOp = '' | '=' | '^=' | '$=' | '*=' | '~='
type Req =
  | { kind: 'attr'; name: string; op: AttrOp; value: string }
  | { kind: 'class'; name: string }
  | { kind: 'id'; name: string }
interface Compound {
  tag: string | null
  reqs: Req[]
}

/** Compound selectors joined by descendant combinators. Anything else throws. */
export function parseSelector(selector: string): Compound[] {
  const out: Compound[] = []
  const re =
    /\s*([a-z][\w-]*)?((?:#[\w-]+|\.[\w-]+|\[[\w-]+(?:[~^$*]?=(?:"[^"]*"|'[^']*'))?\])*)/y
  let i = 0
  const src = selector.trim()
  while (i < src.length) {
    re.lastIndex = i
    const m = re.exec(src)
    if (!m || m[0].trim() === '') throw new Error(`unsupported selector "${selector}" at ${i}`)
    i = re.lastIndex
    const reqs: Req[] = []
    for (const p of m[2].matchAll(/#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([~^$*]?=)(?:"([^"]*)"|'([^']*)'))?\]/g)) {
      if (p[1]) reqs.push({ kind: 'id', name: p[1] })
      else if (p[2]) reqs.push({ kind: 'class', name: p[2] })
      else reqs.push({ kind: 'attr', name: p[3], op: (p[4] ?? '') as AttrOp, value: p[5] ?? p[6] ?? '' })
    }
    out.push({ tag: m[1] ?? null, reqs })
    if (i < src.length && !/\s/.test(src[i])) throw new Error(`unsupported selector "${selector}" at ${i}`)
  }
  if (out.length === 0) throw new Error(`empty selector "${selector}"`)
  return out
}

/* ── tri-state ──────────────────────────────────────────────────────────── */

const NO = 0
const MAYBE = 1
const YES = 2
type Tri = 0 | 1 | 2

/* ── scanner ────────────────────────────────────────────────────────────── */

export function createAnchorScanner(opts: {
  /** The web app's root (the directory holding `src`). */
  webRoot: string
  /** In-memory sources keyed by absolute path, for the guard's own tests. */
  files?: Record<string, string>
}): AnchorScanner {
  const src = join(opts.webRoot, 'src')
  const options: ts.CompilerOptions = {
    jsx: ts.JsxEmit.ReactJSX,
    noLib: true,
    types: [],
    baseUrl: opts.webRoot,
    paths: { '@/*': ['./src/*'] },
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    allowImportingTsExtensions: true,
    noEmit: true,
  }
  const host = ts.createCompilerHost(options, true)
  const files = opts.files
  if (files) {
    host.fileExists = (f) => f in files
    host.readFile = (f) => files[f]
    host.directoryExists = (d) => Object.keys(files).some((f) => f.startsWith(d + '/'))
    host.getSourceFile = (f, lang) =>
      f in files ? ts.createSourceFile(f, files[f], lang, true, ts.ScriptKind.TSX) : undefined
  }
  // Only files under `src` join the program; a package import stays unresolved.
  host.resolveModuleNameLiterals = (lits, containing, _redirect, o) =>
    lits.map((l) => {
      const r = ts.resolveModuleName(l.text, containing, o, host).resolvedModule
      const ok =
        r && r.resolvedFileName.startsWith(src + '/') && /\.tsx?$/.test(r.resolvedFileName) && !r.resolvedFileName.endsWith('.d.ts')
      return { resolvedModule: ok ? r : undefined }
    })
  const appFile = join(src, 'App.tsx')
  const program = ts.createProgram({ rootNames: [appFile], options, host })
  const checker = program.getTypeChecker()
  const app = program.getSourceFile(appFile)
  if (!app) throw new Error(`cannot read ${appFile}`)

  /* symbols → declarations */

  function declOf(sym: ts.Symbol | undefined): ts.Declaration | undefined {
    if (!sym) return undefined
    if (sym.flags & ts.SymbolFlags.Alias) {
      try {
        sym = checker.getAliasedSymbol(sym)
      } catch {
        return undefined
      }
    }
    return sym.valueDeclaration ?? sym.declarations?.[0]
  }

  function unwrap(e: ts.Expression): ts.Expression {
    while (
      ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isSatisfiesExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isTypeAssertionExpression(e)
    )
      e = e.expression
    return e
  }

  /** `lazy(() => import('./X'))` → the import call. */
  function lazyImport(arg: ts.Expression): ts.CallExpression | undefined {
    const a = unwrap(arg)
    if (!ts.isArrowFunction(a) || ts.isBlock(a.body)) return undefined
    const body = unwrap(a.body)
    return ts.isCallExpression(body) && body.expression.kind === ts.SyntaxKind.ImportKeyword ? body : undefined
  }

  function fnOfDecl(d: ts.Declaration | undefined, depth: number): ts.SignatureDeclaration | null {
    if (!d || depth > 8) return null
    if (ts.isFunctionDeclaration(d) && d.body) return d
    if (ts.isVariableDeclaration(d) && d.initializer) return fnOfExpr(d.initializer, depth)
    if (ts.isExportAssignment(d)) return fnOfExpr(d.expression, depth)
    return null
  }

  function fnOfExpr(e: ts.Expression, depth: number): ts.SignatureDeclaration | null {
    e = unwrap(e)
    if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return e
    if (ts.isIdentifier(e)) return fnOfDecl(declOf(checker.getSymbolAtLocation(e)), depth + 1)
    if (ts.isCallExpression(e) && e.arguments[0]) {
      const callee = e.expression.getText()
      if (/^(React\.)?(memo|forwardRef)$/.test(callee)) return fnOfExpr(e.arguments[0], depth + 1)
      const imp = lazyImport(e.arguments[0])
      if (imp && imp.arguments[0]) {
        const mod = checker.getSymbolAtLocation(imp.arguments[0])
        const dflt = mod && checker.getExportsOfModule(mod).find((s) => s.escapedName === 'default')
        return fnOfDecl(declOf(dflt), depth + 1)
      }
    }
    return null
  }

  function returns(fn: ts.SignatureDeclaration): ts.Expression[] {
    const body = (fn as ts.FunctionLikeDeclaration).body
    if (!body) return []
    if (!ts.isBlock(body)) return [body]
    const out: ts.Expression[] = []
    const visit = (n: ts.Node): void => {
      if (ts.isFunctionLike(n)) return
      if (ts.isReturnStatement(n) && n.expression) out.push(n.expression)
      ts.forEachChild(n, visit)
    }
    ts.forEachChild(body, visit)
    return out
  }

  /* refs and values */

  function lookupLocal(ctx: Ctx | null, d: ts.Node): Ref | undefined {
    for (let c = ctx; c; c = c.caller) {
      const r = c.locals.get(d)
      if (r) return r
    }
    return undefined
  }

  function paramRef(p: ts.ParameterDeclaration, ctx: Ctx): Ref {
    const local = lookupLocal(ctx, p)
    if (local) return local
    const fn = p.parent
    if (fn.parameters[0] !== p) return UNKNOWN
    for (let c: Ctx | null = ctx; c; c = c.caller) {
      if (c.fn === fn && c.binding)
        return { kind: 'vals', vals: { vals: [{ kind: 'props', binding: c.binding, omit: new Set() }], open: false } }
    }
    return UNKNOWN
  }

  function keyOf(name: ts.PropertyName | ts.BindingName): string | undefined {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
    return undefined
  }

  function bindingRef(b: ts.BindingElement, ctx: Ctx): Ref {
    const pattern = b.parent
    if (!ts.isObjectBindingPattern(pattern)) return UNKNOWN
    const container = pattern.parent
    const base: Ref = ts.isParameter(container)
      ? paramRef(container, ctx)
      : ts.isBindingElement(container)
        ? bindingRef(container, ctx)
        : ts.isVariableDeclaration(container) && container.initializer && ts.getCombinedNodeFlags(container) & ts.NodeFlags.Const
          ? { kind: 'expr', expr: container.initializer, ctx }
          : UNKNOWN
    if (b.dotDotDotToken) {
      const taken = new Set<string>()
      for (const el of pattern.elements) {
        if (el === b) continue
        const k = keyOf(el.propertyName ?? el.name)
        if (k === undefined) return UNKNOWN
        taken.add(k)
      }
      const v = evalRef(base, 0)
      return {
        kind: 'vals',
        vals: {
          vals: v.vals.flatMap((x): Val[] =>
            isProps(x) ? [{ ...x, omit: new Set([...x.omit, ...taken]) }] : isObj(x) ? [withoutKeys(x, taken)] : [],
          ),
          open: v.open || v.vals.some((x) => !isProps(x) && !isObj(x)),
        },
      }
    }
    const key = keyOf(b.propertyName ?? b.name)
    if (key === undefined) return UNKNOWN
    const ref = memberRef(base, key, 0)
    return b.initializer ? { kind: 'default', ref, dflt: { kind: 'expr', expr: b.initializer, ctx } } : ref
  }

  function refOfDecl(d: ts.Declaration | undefined, ctx: Ctx): Ref {
    if (!d) return UNKNOWN
    const local = lookupLocal(ctx, d)
    if (local) return local
    if (ts.isParameter(d)) return paramRef(d, ctx)
    if (ts.isBindingElement(d)) return bindingRef(d, ctx)
    if (ts.isVariableDeclaration(d) && ts.isIdentifier(d.name)) {
      return d.initializer && ts.getCombinedNodeFlags(d) & ts.NodeFlags.Const
        ? { kind: 'expr', expr: d.initializer, ctx }
        : UNKNOWN
    }
    return UNKNOWN
  }

  function refOfExpr(e: ts.Expression, ctx: Ctx): Ref {
    e = unwrap(e)
    if (ts.isIdentifier(e)) {
      if (e.text === 'undefined') return { kind: 'vals', vals: { vals: [undefined], open: false } }
      return refOfDecl(declOf(checker.getSymbolAtLocation(e)), ctx)
    }
    if (ts.isPropertyAccessExpression(e)) return memberRef(refOfExpr(e.expression, ctx), e.name.text, 0)
    return { kind: 'expr', expr: e, ctx }
  }

  const isProps = (v: Val): v is Props => typeof v === 'object' && v !== null && v.kind === 'props'
  const isObj = (v: Val): v is Obj => typeof v === 'object' && v !== null && v.kind === 'obj'
  const isArr = (v: Val): v is Arr => typeof v === 'object' && v !== null && v.kind === 'arr'
  const isPrefix = (v: Val): v is Prefix => typeof v === 'object' && v !== null && v.kind === 'prefix'

  function withoutKeys(o: Obj, keys: ReadonlySet<string>): Obj {
    return { kind: 'obj', props: new Map([...o.props].filter(([k]) => !keys.has(k))), open: o.open }
  }

  function propLookup(binding: Binding, key: string, depth: number): Ref {
    if (key === 'children' && binding.children && binding.children.length > 0)
      return { kind: 'children', nodes: binding.children, ctx: binding.ctx }
    const props = binding.site.attributes.properties
    for (let i = props.length - 1; i >= 0; i--) {
      const a = props[i]
      if (ts.isJsxAttribute(a)) {
        if (attrName(a) === key) return attrRef(a, binding.ctx)
        continue
      }
      const r = memberRef({ kind: 'expr', expr: a.expression, ctx: binding.ctx }, key, depth + 1)
      if (r.kind !== 'absent') return r
    }
    return ABSENT
  }

  function memberRef(base: Ref, key: string, depth: number): Ref {
    if (base.kind === 'absent') return ABSENT
    if (base.kind === 'unknown' || base.kind === 'children') return UNKNOWN
    const v = evalRef(base, depth + 1)
    if (!v.open && v.vals.length === 1) {
      const x = v.vals[0]
      if (isProps(x)) return x.omit.has(key) ? ABSENT : propLookup(x.binding, key, depth + 1)
      if (isObj(x)) return x.props.get(key) ?? (x.open ? UNKNOWN : ABSENT)
    }
    let out: Vals = { vals: [], open: v.open }
    for (const x of v.vals) {
      const r = isProps(x)
        ? x.omit.has(key)
          ? ABSENT
          : propLookup(x.binding, key, depth + 1)
        : isObj(x)
          ? (x.props.get(key) ?? (x.open ? UNKNOWN : ABSENT))
          : UNKNOWN
      out = merge(out, evalRef(r, depth + 1))
    }
    return { kind: 'vals', vals: out }
  }

  /** A new set holding both; never changes either, since sets are shared between refs. */
  function merge(a: Vals, b: Vals): Vals {
    const vals = [...a.vals]
    for (const x of b.vals) if (!vals.includes(x)) vals.push(x)
    return { vals, open: a.open || b.open }
  }

  function attrName(a: ts.JsxAttribute): string {
    return ts.isIdentifier(a.name) ? a.name.text : a.name.getText()
  }

  function attrRef(a: ts.JsxAttribute, ctx: Ctx): Ref {
    const init = a.initializer
    if (!init) return { kind: 'vals', vals: { vals: [true], open: false } }
    if (ts.isStringLiteral(init)) return { kind: 'vals', vals: { vals: [init.text], open: false } }
    if (ts.isJsxExpression(init)) return init.expression ? { kind: 'expr', expr: init.expression, ctx } : UNKNOWN
    return { kind: 'expr', expr: init, ctx }
  }

  function evalRef(r: Ref, depth: number): Vals {
    if (depth > MAX_DEPTH) return OPEN
    switch (r.kind) {
      case 'expr':
        return evaluate(r.expr, r.ctx, depth + 1)
      case 'vals':
        return r.vals
      case 'absent':
        return { vals: [undefined], open: false }
      case 'default': {
        const v = evalRef(r.ref, depth + 1)
        if (!v.vals.includes(undefined)) return v
        return merge({ vals: v.vals.filter((x) => x !== undefined), open: v.open }, evalRef(r.dflt, depth + 1))
      }
      default:
        return OPEN
    }
  }

  function evaluate(e: ts.Expression, ctx: Ctx, depth: number): Vals {
    if (depth > MAX_DEPTH) return OPEN
    e = unwrap(e)
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { vals: [e.text], open: false }
    if (ts.isNumericLiteral(e)) return { vals: [Number(e.text)], open: false }
    if (e.kind === ts.SyntaxKind.TrueKeyword) return { vals: [true], open: false }
    if (e.kind === ts.SyntaxKind.FalseKeyword) return { vals: [false], open: false }
    if (e.kind === ts.SyntaxKind.NullKeyword) return { vals: [null], open: false }
    if (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e)) {
      const r = refOfExpr(e, ctx)
      return r.kind === 'expr' && r.expr === e ? OPEN : evalRef(r, depth + 1)
    }
    if (ts.isConditionalExpression(e))
      return merge(evaluate(e.whenTrue, ctx, depth + 1), evaluate(e.whenFalse, ctx, depth + 1))
    if (ts.isTemplateExpression(e)) {
      // Each value is a full string, or a Prefix where a part could not be read.
      let acc: (string | Prefix)[] = [e.head.text]
      for (const span of e.templateSpans) {
        const v = evaluate(span.expression, ctx, depth + 1)
        let unread = v.open
        const parts: (string | Prefix)[] = []
        for (const x of v.vals) {
          if (isPrefix(x)) parts.push(x)
          else if (typeof x === 'object' && x !== null) unread = true
          else parts.push(String(x))
        }
        const next = new Map<string, string | Prefix>()
        const add = (x: string | Prefix) => next.set(typeof x === 'string' ? `s${x}` : `p${x.head}`, x)
        for (const a of acc) {
          if (typeof a !== 'string') {
            add(a)
            continue
          }
          for (const p of parts) add(typeof p === 'string' ? a + p + span.literal.text : { kind: 'prefix', head: a + p.head })
          if (unread) add({ kind: 'prefix', head: a })
        }
        acc = [...next.values()]
        if (acc.length > MAX_STRINGS) return OPEN
      }
      return { vals: acc, open: false }
    }
    if (ts.isArrayLiteralExpression(e)) {
      const arr: Arr = { kind: 'arr', items: [], open: false }
      for (const el of e.elements) {
        if (ts.isOmittedExpression(el)) continue
        if (ts.isSpreadElement(el)) {
          const v = evaluate(el.expression, ctx, depth + 1)
          arr.open ||= v.open
          for (const x of v.vals) {
            if (isArr(x)) {
              arr.items.push(...x.items)
              arr.open ||= x.open
            } else arr.open = true
          }
          continue
        }
        const v = evaluate(el, ctx, depth + 1)
        arr.items.push(...v.vals)
        arr.open ||= v.open
      }
      return { vals: [arr], open: false }
    }
    if (ts.isObjectLiteralExpression(e)) {
      const obj: Obj = { kind: 'obj', props: new Map(), open: false }
      for (const p of e.properties) {
        if (ts.isPropertyAssignment(p)) {
          const k = keyOf(p.name)
          if (k === undefined) obj.open = true
          else obj.props.set(k, { kind: 'expr', expr: p.initializer, ctx })
        } else if (ts.isShorthandPropertyAssignment(p)) {
          obj.props.set(p.name.text, refOfDecl(declOf(checker.getShorthandAssignmentValueSymbol(p)), ctx))
        } else if (ts.isSpreadAssignment(p)) {
          const v = evaluate(p.expression, ctx, depth + 1)
          const only = !v.open && v.vals.length === 1 ? v.vals[0] : undefined
          if (only !== undefined && isObj(only)) {
            for (const [k, r] of only.props) obj.props.set(k, r)
            obj.open ||= only.open
          } else obj.open = true
        } else {
          const k = p.name && keyOf(p.name)
          if (k === undefined) obj.open = true
          else obj.props.set(k, UNKNOWN)
        }
      }
      return { vals: [obj], open: false }
    }
    if (ts.isElementAccessExpression(e)) {
      const keys = evaluate(e.argumentExpression, ctx, depth + 1)
      const base = refOfExpr(e.expression, ctx)
      let out: Vals = { vals: [], open: keys.open }
      for (const k of keys.vals) {
        if (typeof k !== 'string' && typeof k !== 'number') {
          out.open = true
          continue
        }
        const bv = evalRef(base, depth + 1)
        if (bv.vals.some(isArr)) {
          out.open = true
          continue
        }
        out = merge(out, evalRef(memberRef(base, String(k), depth + 1), depth + 1))
      }
      return out
    }
    return OPEN
  }

  /* rendering */

  let insts: Inst[] = []

  function onChain(ctx: Ctx | null, fn: ts.SignatureDeclaration): boolean {
    for (let c = ctx; c; c = c.caller) if (c.fn === fn) return true
    return false
  }

  function mapItems(receiver: ts.Expression, ctx: Ctx): Ref[] {
    const v = evaluate(receiver, ctx, 0)
    const out: Ref[] = []
    const seen = new Set<Val>()
    let open = v.open
    for (const x of v.vals) {
      if (!isArr(x)) {
        open = true
        continue
      }
      open ||= x.open
      for (const item of x.items) {
        if (seen.has(item)) continue
        seen.add(item)
        out.push({ kind: 'vals', vals: { vals: [item], open: false } })
      }
    }
    if (open) out.push(UNKNOWN)
    return out
  }

  function renderRef(r: Ref, parent: Inst | null, depth: number): void {
    if (r.kind === 'expr') render(r.expr, r.ctx, parent, depth + 1)
    else if (r.kind === 'children') renderChildren(r.nodes, r.ctx, parent, depth + 1)
    else if (r.kind === 'default') {
      renderRef(r.ref, parent, depth + 1)
      renderRef(r.dflt, parent, depth + 1)
    }
  }

  function renderChildren(nodes: ts.NodeArray<ts.JsxChild>, ctx: Ctx, parent: Inst | null, depth: number): void {
    for (const n of nodes) {
      if (ts.isJsxText(n)) continue
      if (ts.isJsxExpression(n)) {
        if (n.expression) render(n.expression, ctx, parent, depth + 1)
      } else render(n, ctx, parent, depth + 1)
    }
  }

  function renderFnReturns(fn: ts.SignatureDeclaration, ctx: Ctx, parent: Inst | null, depth: number): void {
    for (const r of returns(fn)) render(r, ctx, parent, depth + 1)
  }

  function render(node: ts.Node, ctx: Ctx, parent: Inst | null, depth: number): void {
    if (depth > MAX_DEPTH) throw new Error(`render depth over ${MAX_DEPTH} at ${where(node)}`)
    if (insts.length > MAX_INSTANCES) throw new Error(`more than ${MAX_INSTANCES} elements on one page`)
    const e = ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node) ? node : unwrapNode(node)
    if (ts.isJsxElement(e)) return renderElement(e.openingElement, e.children, ctx, parent, depth)
    if (ts.isJsxSelfClosingElement(e)) return renderElement(e, undefined, ctx, parent, depth)
    if (ts.isJsxFragment(e)) return renderChildren(e.children, ctx, parent, depth)
    if (ts.isJsxExpression(e)) {
      if (e.expression) render(e.expression, ctx, parent, depth + 1)
      return
    }
    if (ts.isConditionalExpression(e)) {
      render(e.whenTrue, ctx, parent, depth + 1)
      render(e.whenFalse, ctx, parent, depth + 1)
      return
    }
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) render(e.right, ctx, parent, depth + 1)
      else if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
        render(e.left, ctx, parent, depth + 1)
        render(e.right, ctx, parent, depth + 1)
      }
      return
    }
    if (ts.isArrayLiteralExpression(e)) {
      for (const el of e.elements) render(ts.isSpreadElement(el) ? el.expression : el, ctx, parent, depth + 1)
      return
    }
    if (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e)) {
      const r = refOfExpr(e, ctx)
      if (!(r.kind === 'expr' && r.expr === e)) renderRef(r, parent, depth + 1)
      return
    }
    if (ts.isCallExpression(e)) return renderCall(e, ctx, parent, depth)
  }

  function unwrapNode(n: ts.Node): ts.Node {
    return ts.isExpression(n) ? unwrap(n) : n
  }

  function renderCall(e: ts.CallExpression, ctx: Ctx, parent: Inst | null, depth: number): void {
    const callee = unwrap(e.expression)
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
    const fnArg = (i: number) => {
      const a = e.arguments[i] && unwrap(e.arguments[i])
      return a && (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) ? a : undefined
    }
    // list.map(item => <li/>): one pass per item the scan can read, one more with the item unknown.
    if (ts.isPropertyAccessExpression(callee) && (name === 'map' || name === 'flatMap')) {
      const cb = fnArg(0)
      if (!cb) return
      for (const item of mapItems(callee.expression, ctx)) {
        const locals = new Map(ctx.locals)
        if (cb.parameters[0]) locals.set(cb.parameters[0], item)
        renderFnReturns(cb, { ...ctx, locals }, parent, depth + 1)
      }
      return
    }
    // A portal draws outside every ancestor here.
    if (name === 'createPortal') {
      if (e.arguments[0]) render(e.arguments[0], ctx, null, depth + 1)
      return
    }
    if (name === 'useMemo') {
      const cb = fnArg(0)
      if (cb) renderFnReturns(cb, ctx, parent, depth + 1)
      return
    }
    // A helper defined under src: its arguments bound to its parameters.
    const helper = ts.isIdentifier(callee) ? fnOfExpr(callee, 0) : null
    if (helper && !onChain(ctx, helper)) {
      const locals = new Map<ts.Node, Ref>()
      helper.parameters.forEach((p, i) => {
        const a = e.arguments[i]
        locals.set(p, a ? { kind: 'expr', expr: a, ctx } : ABSENT)
      })
      renderFnReturns(helper, { fn: helper, binding: null, caller: ctx, locals }, parent, depth + 1)
      return
    }
    // Anything else: JSX in its arguments counts as drawn, under no ancestor.
    e.arguments.forEach((a, i) => {
      const f = fnArg(i)
      if (f) renderFnReturns(f, ctx, null, depth + 1)
      else render(a, ctx, null, depth + 1)
    })
  }

  const TRANSPARENT = new Set(['Fragment', 'React.Fragment', 'Suspense', 'React.Suspense'])

  function renderElement(
    site: ts.JsxOpeningLikeElement,
    children: ts.NodeArray<ts.JsxChild> | undefined,
    ctx: Ctx,
    parent: Inst | null,
    depth: number,
  ): void {
    const tag = site.tagName
    if ((ts.isIdentifier(tag) && /^[a-z]/.test(tag.text)) || ts.isJsxNamespacedName(tag)) {
      const inst: Inst = { tag: tag.getText(), site, ctx, parent }
      insts.push(inst)
      if (children) renderChildren(children, ctx, inst, depth + 1)
      return
    }
    const text = tag.getText()
    const fn = ts.isIdentifier(tag) || ts.isPropertyAccessExpression(tag) ? fnOfExpr(tag as ts.Expression, 0) : null
    if (fn) {
      if (onChain(ctx, fn)) return
      const binding: Binding = { site, children, ctx }
      renderFnReturns(fn, { fn, binding, caller: ctx, locals: new Map() }, parent, depth + 1)
      return
    }
    if (TRANSPARENT.has(text)) {
      if (children) renderChildren(children, ctx, parent, depth + 1)
      return
    }
    // A component from a package: the scan cannot see what it draws, or where.
    insts.push({ tag: null, site, ctx, parent })
    if (children) renderChildren(children, ctx, null, depth + 1)
    for (const a of site.attributes.properties) {
      if (!ts.isJsxAttribute(a) || !a.initializer || ts.isStringLiteral(a.initializer)) continue
      const x = ts.isJsxExpression(a.initializer) ? a.initializer.expression : a.initializer
      if (!x) continue
      const u = unwrap(x as ts.Expression)
      if (ts.isArrowFunction(u) || ts.isFunctionExpression(u)) renderFnReturns(u, ctx, null, depth + 1)
      else render(u, ctx, null, depth + 1)
    }
  }

  /* matching */

  function where(n: ts.Node): string {
    const sf = n.getSourceFile()
    return `${relative(src, sf.fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`
  }

  const attrCache = new WeakMap<Inst, Map<string, Vals>>()

  function attrVals(inst: Inst, name: string): Vals {
    let byName = attrCache.get(inst)
    if (!byName) attrCache.set(inst, (byName = new Map()))
    const hit = byName.get(name)
    if (hit) return hit
    const v = readAttr(inst, name)
    byName.set(name, v)
    return v
  }

  function readAttr(inst: Inst, name: string): Vals {
    const props = inst.site.attributes.properties
    for (let i = props.length - 1; i >= 0; i--) {
      const a = props[i]
      if (ts.isJsxAttribute(a)) {
        if (attrName(a) === name) return evalRef(attrRef(a, inst.ctx), 0)
        continue
      }
      const r = memberRef({ kind: 'expr', expr: a.expression, ctx: inst.ctx }, name, 0)
      if (r.kind === 'absent') continue
      const v = evalRef(r, 0)
      // A spread that may not carry the key could leave an earlier one standing: cannot tell.
      return v.vals.includes(undefined) ? { vals: v.vals.filter((x) => x !== undefined), open: true } : v
    }
    return { vals: [undefined], open: false }
  }

  /** What the DOM attribute reads, for each value. */
  function rendered(name: string, v: Vals): { strs: string[]; heads: string[]; open: boolean } {
    const strs: string[] = []
    const heads: string[] = []
    let open = v.open
    for (const x of v.vals) {
      if (x === undefined || x === null) continue
      if (typeof x === 'string') strs.push(x)
      else if (typeof x === 'number') strs.push(String(x))
      else if (typeof x === 'boolean' && /^(data|aria)-/.test(name)) strs.push(String(x))
      else if (isPrefix(x)) heads.push(x.head)
      else open = true
    }
    return { strs, heads, open }
  }

  /** Whether a string that begins with `head` meets the requirement. */
  function matchHead(req: Req, head: string): Tri {
    // The last token of a head may continue past it; the ones before it are whole.
    const whole = head.split(/\s+/).slice(0, -1)
    if (req.kind === 'class') return whole.includes(req.name) ? YES : MAYBE
    if (req.kind === 'id') return req.name.startsWith(head) ? MAYBE : NO
    switch (req.op) {
      case '':
        return YES
      case '=':
        return req.value.startsWith(head) ? MAYBE : NO
      case '^=':
        return head.startsWith(req.value) ? YES : req.value.startsWith(head) ? MAYBE : NO
      case '*=':
        return head.includes(req.value) ? YES : MAYBE
      case '~=':
        return whole.includes(req.value) ? YES : MAYBE
      default:
        return MAYBE
    }
  }

  function matchReq(inst: Inst, req: Req): Tri {
    const prop = req.kind === 'class' ? 'className' : req.kind === 'id' ? 'id' : req.name === 'class' ? 'className' : req.name
    const { strs, heads, open } = rendered(prop, attrVals(inst, prop))
    const test = (s: string): boolean => {
      if (req.kind === 'class') return s.split(/\s+/).includes(req.name)
      if (req.kind === 'id') return s === req.name
      switch (req.op) {
        case '':
          return true
        case '=':
          return s === req.value
        case '^=':
          return s.startsWith(req.value)
        case '$=':
          return s.endsWith(req.value)
        case '*=':
          return s.includes(req.value)
        case '~=':
          return s.split(/\s+/).includes(req.value)
        default:
          return false
      }
    }
    let best: Tri = strs.some(test) ? YES : NO
    for (const h of heads) best = Math.max(best, matchHead(req, h)) as Tri
    if (best === NO && open) best = MAYBE
    return best === YES && inst.tag === null ? MAYBE : best
  }

  function matchCompound(inst: Inst, c: Compound): Tri {
    let s: Tri = inst.tag === null ? MAYBE : YES
    if (c.tag && inst.tag !== null && inst.tag !== c.tag) return NO
    for (const req of c.reqs) {
      s = Math.min(s, matchReq(inst, req)) as Tri
      if (s === NO) return NO
    }
    return s
  }

  function matchChain(inst: Inst, comps: Compound[], i: number): Tri {
    const s = matchCompound(inst, comps[i])
    if (s === NO || i === 0) return s
    let best: Tri = NO
    for (let a = inst.parent; a && best !== YES; a = a.parent) best = Math.max(best, matchChain(a, comps, i - 1)) as Tri
    return Math.min(s, best) as Tri
  }

  /* pages */

  function routeElements(route: string): { expr: ts.Expression; fn: ts.SignatureDeclaration | null }[] {
    const out: { expr: ts.Expression; fn: ts.SignatureDeclaration | null }[] = []
    const visit = (n: ts.Node): void => {
      if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText() === 'Route') {
        let path: string | undefined
        let element: ts.Expression | undefined
        for (const a of n.attributes.properties) {
          if (!ts.isJsxAttribute(a) || !a.initializer) continue
          if (attrName(a) === 'path' && ts.isStringLiteral(a.initializer)) path = a.initializer.text
          if (attrName(a) === 'element' && ts.isJsxExpression(a.initializer)) element = a.initializer.expression
        }
        if (path === route && element) {
          let f: ts.Node | undefined = n.parent
          while (f && !ts.isFunctionLike(f)) f = f.parent
          out.push({ expr: element, fn: (f as ts.SignatureDeclaration | undefined) ?? null })
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(app!)
    return out
  }

  const pages = new Map<string, AnchorPage>()

  return {
    page(route) {
      const cached = pages.get(route)
      if (cached) return cached
      const roots = routeElements(route)
      if (roots.length === 0) throw new Error(`no <Route path="${route}"> in ${relative(dirname(src), appFile)}`)
      insts = []
      for (const r of roots) render(r.expr, { fn: r.fn, binding: null, caller: null, locals: new Map() }, null, 0)
      const drawn = insts
      const page: AnchorPage = {
        size: drawn.length,
        check(selector) {
          const comps = parseSelector(selector)
          const last = comps.length - 1
          const maybe: string[] = []
          for (const inst of drawn) {
            const s = matchChain(inst, comps, last)
            if (s === YES) return { status: 'rings', at: [where(inst.site)] }
            if (s === MAYBE && maybe.length < 5) maybe.push(where(inst.site))
          }
          return maybe.length > 0 ? { status: 'cannot-check', at: maybe } : { status: 'missing', at: [] }
        },
      }
      pages.set(route, page)
      return page
    },
  }
}

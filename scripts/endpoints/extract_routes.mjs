#!/usr/bin/env node
// Every HTTP route the gateway declares, as data — the mechanical layer under
// `.planning/foundation/ENDPOINTS.md` (founder ruling 2026-09-29).
//
// WHY AN AST, NOT A REGEX
// -----------------------
// Decorators span lines, `@Controller` takes a string, an array, an object or
// nothing, a module can mount another behind a `...(cond ? [X] : [])` spread,
// and a comment that quotes `@Post("*")` is not a route. The previous atlas was
// grep-shaped and its headline went stale within a month. This reads the files
// with the TypeScript compiler's parser and refuses (exit 2) any shape it does
// not understand instead of guessing.
//
// WHAT IT EMITS  (.planning/foundation/endpoints/routes.json)
// ------------
// One record per (verb decorator × controller path × method path): a stable
// anchor id (METHOD + path, `:param` → `param`), the controller file:line of
// the verb decorator, class and handler, every access-relevant decorator at
// class and method level, whether the controller's module is reachable from
// AppModule (unconditionally, only behind a condition, or not at all), the
// @Param / @Query / @Body inputs (DTO type + the file declaring it), @HttpCode
// and rate-limit decorators. Global guards (APP_GUARD in any module, or
// useGlobalGuards in main.ts) are recorded once, in the header, not per route.
//
// WHAT IT DOES NOT DO
// -------------------
// It does not say what a route DOES — which service, which tables, whether the
// write is house-scoped. That is the trace layer (endpoints/trace.json),
// written by reading code, and joined to routes.json by render_endpoints.py.
//
// USAGE
//   node scripts/endpoints/extract_routes.mjs           write routes.json
//   node scripts/endpoints/extract_routes.mjs --check   exit 1 if routes.json is stale
//   node scripts/endpoints/extract_routes.mjs --stdout  print instead of writing
//   --src <dir>   read another copy of apps/api-gateway/src (mutation tests);
//                 output paths are still labelled apps/api-gateway/src/...
//   --out <file>  write/compare another routes.json
//
// EXIT CODES (repo convention): 0 ok · 1 a verified finding (stale routes.json,
// two routes with one anchor id) · 2 cannot check (parser failure, a shape this
// script does not understand, an unclassified guard, no controllers found).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_LABEL = "apps/api-gateway/src";
const DEFAULT_OUT = path.join(ROOT, ".planning/foundation/endpoints/routes.json");

class Cannot extends Error {}
class Finding extends Error {}

let ts;
try {
  ts = createRequire(import.meta.url)("typescript");
} catch (e) {
  console.error(`CANNOT CHECK: typescript is not loadable from ${ROOT}/node_modules (${e.message})`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Classification tables. A guard or verb this script has not been told about
// is a refusal, not a guess: add it here with its kind, on purpose.
// ---------------------------------------------------------------------------

const VERBS = {
  Get: "GET", Post: "POST", Put: "PUT", Patch: "PATCH", Delete: "DELETE",
  All: "ALL", Head: "HEAD", Options: "OPTIONS", Search: "SEARCH",
};

// kind: auth = establishes WHO the caller is; honours_public: the guard stands
// aside when the route (or class) says @Public().
const GUARD_KINDS = {
  JwtAuthGuard: { kind: "auth", credential: "jwt", honours_public: true },
  RelayDoorGuard: { kind: "auth", credential: "jwt-or-service-key", honours_public: false },
  ServiceKeyGuard: { kind: "auth", credential: "service-key", honours_public: false },
  McpCredentialAuthGuard: { kind: "auth", credential: "mcp-house-key", honours_public: false },
  RolesGuard: { kind: "role" },
  PlatformOperatorGuard: { kind: "operator" },
  OwnerOrPlatformOperatorGuard: { kind: "operator" },
  NonProductionGuard: { kind: "env-gate" },
  AuthedRateLimitGuard: { kind: "rate-limit" },
  PasswordResetThrottleGuard: { kind: "rate-limit" },
  RateLimitGuard: { kind: "rate-limit" },
  TenantGuard: { kind: "tenant" },
};

// Metadata decorators that change who reaches a route (common/tenant, auth/decorators).
const FLAG_DECORATORS = ["Public", "AllowsNoHouse", "AllowUnverified", "AllowsTenantChange", "TenantBypass"];
const RATE_DECORATORS = ["RateLimit", "SkipRateLimit", "AuthedRateLimit", "Throttle", "SkipThrottle"];
const PARAM_DECORATORS = new Set([
  "Param", "Body", "Query", "Headers", "Req", "Request", "Res", "Response", "Next",
  "Ip", "HostParam", "Session", "UploadedFile", "UploadedFiles", "CurrentUser", "RawBody",
]);
const TS_BUILTIN_TYPES = new Set([
  "Record", "Partial", "Required", "Readonly", "Pick", "Omit", "Array", "Promise",
  "ReadonlyArray", "Map", "Set", "Date", "Buffer", "Express", "Multer",
]);

// ---------------------------------------------------------------------------
// Small AST helpers
// ---------------------------------------------------------------------------

const compact = (s) => s.replace(/\s+/g, " ").trim();
const rel = (srcDir, f) => `${SRC_LABEL}/${path.relative(srcDir, f).split(path.sep).join("/")}`;
const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

function decoratorsOf(node) {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
}

function decoInfo(sf, d) {
  const e = d.expression;
  if (ts.isCallExpression(e)) {
    return { name: compact(e.expression.getText(sf)), args: e.arguments, node: d, call: true };
  }
  return { name: compact(e.getText(sf)), args: [], node: d, call: false };
}

const argsText = (sf, info) => info.args.map((a) => compact(a.getText(sf))).join(", ");

const sourceCache = new Map();
function parse(file) {
  if (sourceCache.has(file)) return sourceCache.get(file);
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sf.parseDiagnostics && sf.parseDiagnostics.length) {
    const d = sf.parseDiagnostics[0];
    throw new Cannot(`parse error in ${file}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  }
  sourceCache.set(file, sf);
  return sf;
}

/** local name → { spec, imported } for every import in the file. */
function importMap(sf) {
  const m = new Map();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue;
    const spec = st.moduleSpecifier.text;
    const cl = st.importClause;
    if (cl.name) m.set(cl.name.text, { spec, imported: "default" });
    const nb = cl.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) {
        m.set(el.name.text, { spec, imported: (el.propertyName ?? el.name).text });
      }
    } else if (nb && ts.isNamespaceImport(nb)) {
      m.set(nb.name.text, { spec, imported: "*" });
    }
  }
  return m;
}

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const c of [`${base}.ts`, path.join(base, "index.ts"), base]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  throw new Cannot(`cannot resolve import "${spec}" from ${fromFile}`);
}

/** Top-level declaration named `name` in sf (class/interface/type/enum/const). */
function localDecl(sf, name) {
  for (const st of sf.statements) {
    if ((ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) ||
      ts.isEnumDeclaration(st)) && st.name && st.name.text === name) return st;
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name) return d;
      }
    }
  }
  return null;
}

/** The file that actually declares exported `name`, following re-exports. */
function declaringFile(file, name, seen = new Set()) {
  if (seen.has(file)) return null;
  seen.add(file);
  const sf = parse(file);
  if (localDecl(sf, name)) return file;
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || !st.moduleSpecifier) continue;
    const target = resolveSpec(file, st.moduleSpecifier.text);
    if (!target) continue;
    if (!st.exportClause) {
      const hit = declaringFile(target, name, seen);
      if (hit) return hit;
    } else if (ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        if (el.name.text === name) return declaringFile(target, (el.propertyName ?? el.name).text, seen);
      }
    }
  }
  // `import { X } from "./y"; export { X };`
  const imp = importMap(sf).get(name);
  if (imp) {
    const target = resolveSpec(file, imp.spec);
    if (target) return declaringFile(target, imp.imported, seen);
  }
  return null;
}

/** { file, name } for an identifier used in `sf`: local, imported relative, or external package. */
function resolveIdent(sf, name, srcDir) {
  if (localDecl(sf, name)) return { file: sf.fileName, name };
  const imp = importMap(sf).get(name);
  if (!imp) return { external: "(global)", name };
  if (!imp.spec.startsWith(".")) return { external: imp.spec, name: imp.imported };
  const target = resolveSpec(sf.fileName, imp.spec);
  const decl = declaringFile(target, imp.imported);
  if (!decl) throw new Cannot(`cannot find declaration of ${imp.imported} (imported in ${rel(srcDir, sf.fileName)})`);
  return { file: decl, name: imp.imported };
}

/** Evaluate a path argument: string literal, array of them, or a same-file const. */
function evalPath(sf, node, where) {
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((el) => evalPath(sf, el, where));
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return evalPath(sf, node.expression, where);
  if (ts.isIdentifier(node)) {
    const d = localDecl(sf, node.text);
    if (d && ts.isVariableDeclaration(d) && d.initializer) return evalPath(sf, d.initializer, where);
  }
  throw new Cannot(`dynamic route path at ${where}: \`${compact(node.getText(sf))}\` — only string literals, arrays of them, or same-file consts are understood`);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (ent.name === "node_modules" || ent.name === "dist") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const isSpec = (f) => /\.(spec|test|e2e-spec)\.ts$/.test(f) || f.split(path.sep).includes("__tests__");

// ---------------------------------------------------------------------------
// Module graph: which controllers AppModule actually mounts
// ---------------------------------------------------------------------------

function moduleObject(sf, cls) {
  for (const d of decoratorsOf(cls)) {
    const info = decoInfo(sf, d);
    if (info.name === "Module" && info.call) {
      const arg = info.args[0];
      if (!arg) return null;
      if (!ts.isObjectLiteralExpression(arg)) {
        throw new Cannot(`@Module argument is not an object literal at ${sf.fileName}:${lineOf(sf, d)}`);
      }
      return arg;
    }
  }
  return null;
}

function propOf(obj, name) {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name && p.name.getText() === name) return p.initializer;
  }
  return null;
}

/** Items of an imports/controllers array: [{ expr, cond: [text...] }]. */
function arrayItems(sf, node, cond, where) {
  if (ts.isParenthesizedExpression(node)) return arrayItems(sf, node.expression, cond, where);
  if (ts.isArrayLiteralExpression(node)) {
    const out = [];
    for (const el of node.elements) {
      if (ts.isSpreadElement(el)) out.push(...spreadItems(sf, el.expression, cond, where));
      else out.push({ expr: el, cond });
    }
    return out;
  }
  if (ts.isIdentifier(node)) {
    const d = localDecl(sf, node.text);
    if (d && ts.isVariableDeclaration(d) && d.initializer) return arrayItems(sf, d.initializer, cond, where);
  }
  throw new Cannot(`module array is not a literal at ${where}: \`${compact(node.getText(sf)).slice(0, 80)}\``);
}

function spreadItems(sf, node, cond, where) {
  if (ts.isParenthesizedExpression(node)) return spreadItems(sf, node.expression, cond, where);
  if (ts.isConditionalExpression(node)) {
    const c = compact(node.condition.getText(sf));
    return [
      ...arrayItems(sf, node.whenTrue, [...cond, c], where),
      ...arrayItems(sf, node.whenFalse, [...cond, `!(${c})`], where),
    ];
  }
  return arrayItems(sf, node, cond, where);
}

/** The class identifier an imports/controllers entry names, or null for an external dynamic module. */
function entryIdent(sf, expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (ts.isIdentifier(callee) && callee.text === "forwardRef") {
      const fn = expr.arguments[0];
      if (fn && ts.isArrowFunction(fn) && ts.isIdentifier(fn.body)) return fn.body.text;
    }
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) return callee.expression.text;
  }
  throw new Cannot(`unrecognised module entry at ${sf.fileName}:${lineOf(sf, expr)}: \`${compact(expr.getText(sf)).slice(0, 80)}\``);
}

function buildModuleGraph(srcDir, files) {
  const modules = new Map(); // key file#name -> { key, name, file, line, imports, controllers, appGuards, other }
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    if (!text.includes("@Module(")) continue;
    const sf = parse(f);
    for (const st of sf.statements) {
      if (!ts.isClassDeclaration(st) || !st.name) continue;
      const obj = moduleObject(sf, st);
      if (!obj) continue;
      const where = `${rel(srcDir, f)}:${lineOf(sf, st)}`;
      const mod = { key: `${f}#${st.name.text}`, name: st.name.text, file: f, line: lineOf(sf, st), imports: [], controllers: [], appProviders: [] };
      const imports = propOf(obj, "imports");
      if (imports) {
        for (const it of arrayItems(sf, imports, [], where)) {
          const name = entryIdent(sf, it.expr);
          const r = resolveIdent(sf, name, srcDir);
          if (r.external) continue; // @nestjs/*, packages: they mount none of our controllers
          mod.imports.push({ key: `${r.file}#${r.name}`, cond: it.cond });
        }
      }
      const controllers = propOf(obj, "controllers");
      if (controllers) {
        for (const it of arrayItems(sf, controllers, [], where)) {
          const name = entryIdent(sf, it.expr);
          const r = resolveIdent(sf, name, srcDir);
          if (r.external) throw new Cannot(`controller ${name} in ${where} is not declared in this source tree`);
          mod.controllers.push({ key: `${r.file}#${r.name}`, cond: it.cond, line: lineOf(sf, it.expr) });
        }
      }
      const providers = propOf(obj, "providers");
      if (providers) {
        for (const it of arrayItems(sf, providers, [], where)) {
          if (!ts.isObjectLiteralExpression(it.expr)) continue;
          const provide = propOf(it.expr, "provide");
          if (!provide || !ts.isIdentifier(provide) || !provide.text.startsWith("APP_")) continue;
          const use = propOf(it.expr, "useClass") ?? propOf(it.expr, "useExisting") ?? propOf(it.expr, "useFactory") ?? propOf(it.expr, "useValue");
          mod.appProviders.push({
            token: provide.text,
            name: use ? compact(use.getText(sf)) : "(unknown)",
            at: `${rel(srcDir, f)}:${lineOf(sf, it.expr)}`,
            cond: it.cond,
          });
        }
      }
      modules.set(mod.key, mod);
    }
  }
  return modules;
}

/** key -> { mounted: bool, conds: Set<string> } reachable from root. */
function reach(modules, rootKey) {
  const state = new Map();
  const seen = new Set();
  const queue = [[rootKey, []]];
  while (queue.length) {
    const [key, cond] = queue.shift();
    const ck = `${key}|${cond.join(" && ")}`;
    if (seen.has(ck)) continue;
    seen.add(ck);
    const st = state.get(key) ?? { mounted: false, conds: new Set() };
    state.set(key, st);
    if (cond.length === 0) st.mounted = true;
    else {
      if (st.mounted) continue;
      st.conds.add(cond.join(" && "));
    }
    const mod = modules.get(key);
    if (!mod) throw new Cannot(`module ${key} is imported but was not found as an @Module class`);
    for (const imp of mod.imports) queue.push([imp.key, [...cond, ...imp.cond]]);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Controllers and routes
// ---------------------------------------------------------------------------

function joinPath(...parts) {
  const segs = parts.map((p) => p.replace(/^\/+|\/+$/g, "")).filter((p) => p.length > 0);
  return "/" + segs.join("/");
}

function routeId(method, p) {
  return `${method} ${p}`
    .toLowerCase()
    .replace(/:([a-z0-9_]+)\([^)]*\)/g, "$1") // :id(\\d+) → id
    .replace(/[:?]/g, "")
    .replace(/\*/g, "wildcard")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function typeRef(sf, typeNode, srcDir) {
  if (!typeNode) return { type: null, file: null };
  const text = compact(typeNode.getText(sf));
  const names = [];
  const visit = (n) => {
    if (ts.isTypeReferenceNode(n)) {
      const nm = ts.isIdentifier(n.typeName) ? n.typeName.text : n.typeName.getText(sf);
      if (!TS_BUILTIN_TYPES.has(nm.split(".")[0])) names.push(nm);
    }
    ts.forEachChild(n, visit);
  };
  visit(typeNode);
  if (ts.isTypeLiteralNode(typeNode)) return { type: text, file: "(inline)" };
  if (!names.length) return { type: text, file: null };
  const first = names[0].split(".")[0];
  const r = resolveIdent(sf, first, srcDir);
  return { type: text, file: r.external ? r.external : rel(srcDir, r.file) };
}

function classifyGuard(name, where) {
  const base = name.replace(/^new\s+/, "").replace(/\(.*$/, "");
  const k = GUARD_KINDS[base];
  if (!k) {
    throw new Cannot(`unclassified guard \`${name}\` at ${where} — add it to GUARD_KINDS in scripts/endpoints/extract_routes.mjs with its kind, on purpose`);
  }
  return { name: base, ...k };
}

function guardsFrom(sf, infos, level, where) {
  const out = [];
  for (const info of infos.filter((i) => i.name === "UseGuards")) {
    for (const a of info.args) out.push({ ...classifyGuard(compact(a.getText(sf)), where), level });
  }
  return out;
}

function flagsFrom(infos, level) {
  return infos.filter((i) => FLAG_DECORATORS.includes(i.name)).map((i) => ({ name: i.name, level }));
}

function rolesFrom(sf, infos, level) {
  const r = infos.find((i) => i.name === "Roles");
  if (!r) return null;
  const roles = r.args.map((a) => (ts.isStringLiteralLike(a) ? a.text : compact(a.getText(sf))));
  return { roles, level };
}

const IGNORED_OTHER = new Set(["Controller", "UseGuards", "Roles", ...Object.keys(VERBS), ...FLAG_DECORATORS, ...RATE_DECORATORS, "HttpCode"]);
const isSwagger = (n) => /^Api[A-Z]/.test(n);

function otherDecorators(sf, infos, level) {
  return infos
    .filter((i) => !IGNORED_OTHER.has(i.name) && !isSwagger(i.name))
    .map((i) => `${i.name}${i.call ? `(${argsText(sf, i)})` : ""}@${level}`);
}

function rateFrom(sf, infos, level) {
  return infos.filter((i) => RATE_DECORATORS.includes(i.name)).map((i) => `${i.name}(${argsText(sf, i)})@${level}`);
}

function paramInputs(sf, method, srcDir) {
  const res = { params: [], query: [], query_dto: null, body: null, body_fields: [], other_inputs: [] };
  for (const p of method.parameters) {
    for (const d of decoratorsOf(p)) {
      const info = decoInfo(sf, d);
      if (!PARAM_DECORATORS.has(info.name)) continue;
      const first = info.args[0];
      const key = first && ts.isStringLiteralLike(first) ? first.text : null;
      const pipes = info.args.slice(key !== null ? 1 : 0).map((a) => compact(a.getText(sf)));
      if (info.name === "Param") res.params.push(key ?? "*" + (pipes.length ? `|${pipes.join("|")}` : ""));
      else if (info.name === "Query") {
        if (key !== null) res.query.push(key);
        else res.query_dto = typeRef(sf, p.type, srcDir);
      } else if (info.name === "Body") {
        if (key !== null) res.body_fields.push(key);
        else res.body = typeRef(sf, p.type, srcDir);
      } else {
        res.other_inputs.push(key !== null ? `${info.name}(${key})` : info.name);
      }
      if (info.name === "Param" && key !== null && pipes.length) {
        res.params[res.params.length - 1] = `${key}|${pipes.join("|")}`;
      }
    }
  }
  return res;
}

function controllerDecl(sf, cls, where) {
  const dec = decoratorsOf(cls).map((d) => decoInfo(sf, d)).find((i) => i.name === "Controller");
  if (!dec) return null;
  const out = { paths: [""], host: null, version: null, line: lineOf(sf, dec.node) };
  const arg = dec.args[0];
  if (!arg) return out;
  if (ts.isObjectLiteralExpression(arg)) {
    const p = propOf(arg, "path");
    out.paths = p ? evalPath(sf, p, where) : [""];
    const h = propOf(arg, "host");
    const v = propOf(arg, "version");
    out.host = h ? compact(h.getText(sf)) : null;
    out.version = v ? compact(v.getText(sf)) : null;
    return out;
  }
  out.paths = evalPath(sf, arg, where);
  return out;
}

function extract(srcDir) {
  if (!fs.existsSync(srcDir)) throw new Cannot(`source directory not found: ${srcDir}`);
  const all = walk(srcDir).filter((f) => !isSpec(f));
  const edge = [];

  // Global prefix + globals from main.ts
  const mainFile = path.join(srcDir, "main.ts");
  if (!fs.existsSync(mainFile)) throw new Cannot(`main.ts not found in ${srcDir}`);
  const mainSf = parse(mainFile);
  let prefix = null;
  const mainGlobals = [];
  let bootsAppModule = false;
  const visitMain = (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const m = n.expression.name.text;
      if (m === "setGlobalPrefix") {
        if (prefix) throw new Cannot("setGlobalPrefix called twice in main.ts");
        const a = n.arguments[0];
        if (!a || !ts.isStringLiteralLike(a)) throw new Cannot("setGlobalPrefix argument is not a string literal");
        if (n.arguments.length > 1) throw new Cannot("setGlobalPrefix with options (exclude) is not understood — teach extract_routes.mjs");
        prefix = { value: a.text.replace(/^\/+|\/+$/g, ""), at: `${rel(srcDir, mainFile)}:${lineOf(mainSf, n)}` };
      }
      if (m === "enableVersioning") throw new Cannot("enableVersioning in main.ts is not understood — teach extract_routes.mjs");
      if (/^useGlobal(Guards|Pipes|Interceptors|Filters)$/.test(m)) {
        mainGlobals.push({ token: m, name: n.arguments.map((a) => compact(a.getText(mainSf)).slice(0, 120)).join(", "), at: `${rel(srcDir, mainFile)}:${lineOf(mainSf, n)}` });
      }
      if (m === "create" && n.arguments[0] && ts.isIdentifier(n.arguments[0]) && n.arguments[0].text === "AppModule") bootsAppModule = true;
    }
    ts.forEachChild(n, visitMain);
  };
  visitMain(mainSf);
  if (!bootsAppModule) throw new Cannot("main.ts does not call NestFactory.create(AppModule, ...) — root module unknown");
  const appFile = path.join(srcDir, "app.module.ts");
  const modules = buildModuleGraph(srcDir, all);
  const rootKey = `${appFile}#AppModule`;
  if (!modules.has(rootKey)) throw new Cannot("AppModule not found in app.module.ts");
  const reachState = reach(modules, rootKey);

  // controller key -> [{ module, cond }]
  const listedIn = new Map();
  for (const mod of [...modules.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    for (const c of mod.controllers) {
      if (!listedIn.has(c.key)) listedIn.set(c.key, []);
      listedIn.get(c.key).push({ mod, cond: c.cond, line: c.line });
    }
  }

  const globalGuards = [];
  const globalOther = [];
  for (const mod of modules.values()) {
    const st = reachState.get(mod.key);
    for (const p of mod.appProviders) {
      const status = !st ? "unmounted" : st.mounted && p.cond.length === 0 ? "mounted" : "conditional";
      const rec = { token: p.token, name: p.name, at: p.at, module: mod.name, status };
      if (p.token === "APP_GUARD") {
        classifyGuard(p.name, p.at);
        globalGuards.push(rec);
      } else globalOther.push(rec);
    }
  }
  for (const g of mainGlobals) (g.token === "useGlobalGuards" ? globalGuards : globalOther).push({ ...g, module: "main.ts", status: "mounted" });
  const byAt = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  globalGuards.sort(byAt);
  globalOther.sort(byAt);
  if (globalGuards.some((g) => g.name === "JwtAuthGuard" && g.status === "mounted")) {
    edge.push("JwtAuthGuard is a global guard: per-route access classes below would understate protection — renderer must be taught");
  }

  const controllers = [];
  const routes = [];
  for (const f of all) {
    const text = fs.readFileSync(f, "utf8");
    if (!text.includes("@Controller")) continue;
    const sf = parse(f);
    const imports = importMap(sf);
    for (const cls of sf.statements) {
      if (!ts.isClassDeclaration(cls) || !cls.name) continue;
      const where = `${rel(srcDir, f)}:${lineOf(sf, cls)}`;
      const cd = controllerDecl(sf, cls, where);
      if (!cd) continue;
      if (!f.endsWith(".controller.ts")) edge.push(`controller outside *.controller.ts: ${where} ${cls.name.text}`);
      if (cls.heritageClauses?.some((h) => h.token === ts.SyntaxKind.ExtendsKeyword)) {
        throw new Cannot(`controller ${cls.name.text} at ${where} extends a class — inherited routes are not understood`);
      }
      const key = `${f}#${cls.name.text}`;
      const lists = listedIn.get(key) ?? [];
      const mountConds = [];
      let mounted = false;
      for (const l of lists) {
        const st = reachState.get(l.mod.key);
        if (!st) continue;
        if (st.mounted && l.cond.length === 0) mounted = true;
        else {
          const modConds = st.mounted ? [""] : [...st.conds];
          for (const mc of modConds) mountConds.push([mc, ...l.cond].filter(Boolean).join(" && "));
        }
      }
      const mount = {
        status: mounted ? "mounted" : mountConds.length ? "conditional" : "unmounted",
        condition: mounted || !mountConds.length ? null : [...new Set(mountConds)].sort().join(" || "),
        modules: lists.map((l) => `${l.mod.name} (${rel(srcDir, l.mod.file)}:${l.line})`),
        reason: lists.length === 0 ? "listed in no @Module controllers array" :
          !mounted && !mountConds.length ? "its module is not reachable from AppModule" : null,
      };
      if (lists.length > 1) edge.push(`controller listed in ${lists.length} modules (routes registered once per module): ${where} ${cls.name.text}`);

      // Class-level decorators
      const classInfos = decoratorsOf(cls).map((d) => decoInfo(sf, d));
      for (const i of classInfos) {
        if (VERBS[i.name]) throw new Cannot(`verb decorator on a class at ${where}`);
      }
      const classGuards = guardsFrom(sf, classInfos, "class", where);
      const classFlags = flagsFrom(classInfos, "class");
      const classRoles = rolesFrom(sf, classInfos, "class");
      const classRate = rateFrom(sf, classInfos, "class");
      const classOther = otherDecorators(sf, classInfos, "class");

      let routeCount = 0;
      for (const m of cls.members) {
        const mInfos = decoratorsOf(m).map((d) => decoInfo(sf, d));
        const verbs = mInfos.filter((i) => VERBS[i.name]);
        if (!verbs.length) continue;
        if (!ts.isMethodDeclaration(m)) throw new Cannot(`verb decorator on a non-method member at ${rel(srcDir, f)}:${lineOf(sf, m)}`);
        const handler = m.name.getText(sf);
        for (const v of verbs) {
          const imp = imports.get(v.name);
          if (!imp || imp.spec !== "@nestjs/common") {
            throw new Cannot(`@${v.name} at ${rel(srcDir, f)}:${lineOf(sf, v.node)} is not imported from @nestjs/common`);
          }
        }
        const mWhere = `${rel(srcDir, f)}:${lineOf(sf, m)}`;
        const methodGuards = guardsFrom(sf, mInfos, "method", mWhere);
        const guards = [...classGuards, ...methodGuards];
        const flags = [...classFlags, ...flagsFrom(mInfos, "method")];
        const isPublic = flags.some((x) => x.name === "Public");
        const methodRoles = rolesFrom(sf, mInfos, "method");
        const roleDecl = methodRoles ?? classRoles;
        const inputs = paramInputs(sf, m, srcDir);
        const httpCode = mInfos.find((i) => i.name === "HttpCode");
        const rate = [...classRate, ...rateFrom(sf, mInfos, "method"), ...guards.filter((g) => g.kind === "rate-limit").map((g) => `${g.name}@${g.level}`)];

        // Access: who can reach this route at all.
        const authGuards = guards.filter((g) => g.kind === "auth");
        const strict = authGuards.filter((g) => !g.honours_public);
        let access;
        if (strict.length) {
          access = { class: "credential", credentials: [...new Set(strict.map((g) => g.credential))], note: isPublic ? `@Public() present; ${strict.map((g) => g.name).join(", ")} ignores it` : null };
        } else if (isPublic) {
          access = { class: "public", credentials: [], note: authGuards.length ? `@Public() makes ${authGuards.map((g) => g.name).join(", ")} stand aside` : null };
        } else if (authGuards.length) {
          access = { class: "jwt", credentials: [...new Set(authGuards.map((g) => g.credential))], note: null };
        } else {
          access = { class: "none", credentials: [], note: null };
        }
        const envGate = guards.some((g) => g.kind === "env-gate");

        for (const v of verbs) {
          const methodPaths = v.args[0] ? evalPath(sf, v.args[0], `${rel(srcDir, f)}:${lineOf(sf, v.node)}`) : [""];
          const line = lineOf(sf, v.node);
          for (const cp of cd.paths) {
            for (const mp of methodPaths) {
              const p = joinPath(cp, mp);
              const method = VERBS[v.name];
              routeCount++;
              routes.push({
                id: routeId(method, p),
                method,
                path: p,
                at: `${rel(srcDir, f)}:${line}`,
                class: cls.name.text,
                handler,
                controller_at: `${rel(srcDir, f)}:${cd.line}`,
                mount: mount.status,
                mount_condition: mount.condition,
                access: access.class,
                credentials: access.credentials,
                access_note: access.note,
                env_gate: envGate ? "non-production only (NonProductionGuard)" : null,
                guards: guards.map((g) => `${g.name}@${g.level}`),
                flags: flags.map((x) => `${x.name}@${x.level}`),
                roles: roleDecl ? { roles: roleDecl.roles, level: roleDecl.level, enforced: guards.some((g) => g.name === "RolesGuard") } : null,
                rate_limit: rate,
                http_code: httpCode ? argsText(sf, httpCode) : null,
                params: inputs.params,
                query: inputs.query,
                query_dto: inputs.query_dto,
                body: inputs.body,
                body_fields: inputs.body_fields,
                other_inputs: inputs.other_inputs,
                decorators_other: [...classOther, ...otherDecorators(sf, mInfos, "method")],
                host: cd.host,
                version: cd.version,
              });
            }
          }
        }
      }
      controllers.push({
        file: rel(srcDir, f),
        class: cls.name.text,
        at: `${rel(srcDir, f)}:${cd.line}`,
        paths: cd.paths,
        host: cd.host,
        version: cd.version,
        mount: mount.status,
        mount_condition: mount.condition,
        mount_reason: mount.reason,
        modules: mount.modules,
        route_count: routeCount,
      });
      if (routeCount === 0) edge.push(`route-less controller: ${where} ${cls.name.text}`);
      if (cd.host) edge.push(`host-bound controller (${cd.host}): ${where} ${cls.name.text}`);
      if (cd.version) edge.push(`versioned controller (${cd.version}) but versioning is not enabled: ${where} ${cls.name.text}`);
    }
  }
  if (!controllers.length) throw new Cannot(`no @Controller classes found under ${srcDir}`);
  if (!routes.length) throw new Cannot("no routes found");

  // Controllers named in a module but never found as a class.
  const found = new Set(controllers.map((c) => `${c.file}#${c.class}`));
  for (const [key] of listedIn) {
    const [file, name] = key.split("#");
    if (!found.has(`${rel(srcDir, file)}#${name}`)) throw new Cannot(`module lists controller ${name} (${rel(srcDir, file)}) but no @Controller class was found there`);
  }

  // Anchor ids must be unique: a collision is either two controllers answering
  // one METHOD + path (the second is shadowed at runtime) or two paths that
  // slug alike. Either way a citation could not say which one it meant.
  const byId = new Map();
  for (const r of routes) {
    if (!byId.has(r.id)) byId.set(r.id, []);
    byId.get(r.id).push(r);
  }
  const collisions = [...byId.entries()].filter(([, rs]) => rs.length > 1);
  if (collisions.length) {
    const lines = collisions.map(([id, rs]) => `  ${id}: ${rs.map((r) => `${r.method} ${r.path} @ ${r.at}${r.mount !== "mounted" ? ` [${r.mount}]` : ""}`).join("  <>  ")}`);
    throw new Finding(`route id collision (${collisions.length}):\n${lines.join("\n")}`);
  }

  // Optional keys are ABSENT when null or empty (README "routes.json"), so a
  // line carries only what the route actually declares.
  const REQUIRED = new Set(["id", "method", "path", "at", "class", "handler", "controller_at", "mount", "access"]);
  const prune = (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => REQUIRED.has(k) || !(v === null || (Array.isArray(v) && v.length === 0))));
  for (let i = 0; i < routes.length; i++) routes[i] = prune(routes[i]);
  for (let i = 0; i < controllers.length; i++) controllers[i] = prune(controllers[i]);

  routes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.method < b.method ? -1 : a.method > b.method ? 1 : 0));
  controllers.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  let baseCommit = null;
  try {
    baseCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    baseCommit = null;
  }

  return {
    schema: 1,
    generator: "scripts/endpoints/extract_routes.mjs",
    note: "Generated. Do not hand-edit. base_commit is informational and ignored by --check.",
    base_commit: baseCommit,
    global_prefix: prefix,
    global_guards: globalGuards,
    global_other: globalOther,
    guard_kinds: GUARD_KINDS,
    edge_cases: [...new Set(edge)].sort(),
    controllers,
    routes,
  };
}

// One route (and one controller) per line: a diff then names exactly the routes
// that changed, and `grep '"id":"<id>"'` returns the whole record.
function serialize(data) {
  const keys = Object.keys(data);
  const lines = ["{"];
  keys.forEach((k, i) => {
    const v = data[k];
    const comma = i < keys.length - 1 ? "," : "";
    if ((k === "routes" || k === "controllers") && Array.isArray(v)) {
      lines.push(` ${JSON.stringify(k)}: [`);
      v.forEach((x, j) => lines.push(`  ${JSON.stringify(x)}${j < v.length - 1 ? "," : ""}`));
      lines.push(` ]${comma}`);
    } else {
      lines.push(` ${JSON.stringify(k)}: ${JSON.stringify(v, null, 1).replace(/\n/g, "\n ")}${comma}`);
    }
  });
  lines.push("}");
  return lines.join("\n") + "\n";
}
// LINES ARE SOFT (founder ruling 2026-09-29): --check compares the SHAPE —
// every route, method, path, guard, flag, access class, role, mount, input —
// with each `file:line` number masked, so a controller edit that only moves
// lines does not fail CI. A regeneration refreshes the numbers.
const LINE_NUM = /(\.(?:ts|tsx|js|mjs|cjs)):\d+/g;
function soft(value) {
  if (typeof value === "string") return value.replace(LINE_NUM, "$1:<n>");
  if (Array.isArray(value)) return value.map(soft);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, soft(v)]));
  return value;
}
const withoutCommit = (d) => soft({ ...d, base_commit: null });

function main(argv) {
  const args = argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const check = args.includes("--check");
  const stdout = args.includes("--stdout");
  const srcDir = path.resolve(opt("--src") ?? path.join(ROOT, SRC_LABEL));
  const out = path.resolve(opt("--out") ?? DEFAULT_OUT);

  const data = extract(srcDir);
  if (check) {
    if (!fs.existsSync(out)) throw new Cannot(`${path.relative(ROOT, out)} does not exist — nothing to compare`);
    let stored;
    try {
      stored = JSON.parse(fs.readFileSync(out, "utf8"));
    } catch (e) {
      throw new Cannot(`${path.relative(ROOT, out)} is not valid JSON: ${e.message}`);
    }
    const a = serialize(withoutCommit(stored));
    const b = serialize(withoutCommit(data));
    if (a !== b) {
      const sIds = new Map(stored.routes?.map((r) => [r.id, JSON.stringify(soft(r))]) ?? []);
      const fIds = new Map(data.routes.map((r) => [r.id, JSON.stringify(soft(r))]));
      const added = [...fIds.keys()].filter((k) => !sIds.has(k));
      const removed = [...sIds.keys()].filter((k) => !fIds.has(k));
      const changed = [...fIds.keys()].filter((k) => sIds.has(k) && sIds.get(k) !== fIds.get(k));
      console.error(`STALE: ${path.relative(ROOT, out)} does not match the controllers.`);
      console.error(`  routes: stored ${sIds.size}, code ${fIds.size}; +${added.length} added, -${removed.length} removed, ~${changed.length} changed`);
      for (const [label, ids] of [["added", added], ["removed", removed], ["changed", changed]]) {
        for (const id of ids.slice(0, 15)) console.error(`  ${label}: ${id}`);
        if (ids.length > 15) console.error(`  ... ${ids.length - 15} more ${label}`);
      }
      for (const id of changed.slice(0, 3)) {
        const sr = JSON.parse(sIds.get(id));
        const fr = JSON.parse(fIds.get(id));
        const keys = [...new Set([...Object.keys(sr), ...Object.keys(fr)])].filter((k) => JSON.stringify(sr[k]) !== JSON.stringify(fr[k]));
        console.error(`  ${id}: ${keys.map((k) => `${k} ${JSON.stringify(sr[k])} -> ${JSON.stringify(fr[k])}`).join("; ").slice(0, 300)}`);
      }
      if (!added.length && !removed.length && !changed.length) console.error("  (header fields differ: globals, controllers or edge cases)");
      console.error("  Fix: node scripts/endpoints/extract_routes.mjs && python3 scripts/endpoints/render_endpoints.py");
      return 1;
    }
    const exact = serialize({ ...stored, base_commit: null }) === serialize({ ...data, base_commit: null });
    console.log(`OK: ${path.relative(ROOT, out)} matches the controllers (${data.routes.length} routes, ${data.controllers.length} controllers)` +
      (exact ? "." : "; line numbers drifted (not a failure — a regeneration refreshes them)."));
    return 0;
  }
  const text = serialize(data);
  if (stdout) process.stdout.write(text);
  else {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
    console.log(`wrote ${path.relative(ROOT, out)}: ${data.routes.length} routes, ${data.controllers.length} controllers, ${data.edge_cases.length} edge cases`);
  }
  return 0;
}

// exitCode, not process.exit(): exit() can cut a piped --stdout short.
try {
  process.exitCode = main(process.argv);
} catch (e) {
  if (e instanceof Finding) {
    console.error(`FAIL: ${e.message}`);
    process.exitCode = 1;
  } else {
    console.error(`CANNOT CHECK: ${e instanceof Cannot ? e.message : e.stack}`);
    process.exitCode = 2;
  }
}

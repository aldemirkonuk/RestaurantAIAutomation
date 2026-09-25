#!/usr/bin/env node
// ADR 0143: reviewed registry of every HTTP route with platform authority.
// Parse decorators as TypeScript, including multiple controllers in one file.
//
// Two checks, not one:
//   1. every route already carrying PlatformOperatorGuard matches the reviewed
//      registry (unchanged from the original guard);
//   2. every controller method that reaches OrchestratorService.operateAgent()
//      or .getSystemMetrics() — directly, or via a same-class helper it calls —
//      carries PlatformOperatorGuard. (1) alone passed a new, unguarded
//      controller calling operateAgent(): it was never in the registry, so it
//      was never looked at.
//
// Exit codes follow the repo convention: 0 pass, 1 a violation was found and
// verified, 2 the check itself could not run (parser/self-test/no-controllers
// failure) — never silently reported as a pass.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const verbs = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options']);

class Violation extends Error {}

function decorators(node) {
  return (ts.canHaveDecorators(node) ? ts.getDecorators(node) || [] : []).map(decorator => {
    const expr = decorator.expression;
    if (!ts.isCallExpression(expr) || !ts.isIdentifier(expr.expression)) return null;
    return { name: expr.expression.text, args: expr.arguments };
  }).filter(Boolean);
}
const names = values => values.filter(value => value.name === 'UseGuards').flatMap(value => value.args.filter(ts.isIdentifier).map(arg => arg.text));
const literal = expr => expr && ts.isStringLiteralLike(expr) ? expr.text : '';

const OPERATE_PATH_METHODS = new Set(['operateAgent', 'getSystemMetrics']);

/** Every `this.<name>(...)` call and every direct OPERATE_PATH_METHODS call reachable from this node. */
function walkCalls(node, direct, calledSameClass) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const member = node.expression.name.text;
    if (OPERATE_PATH_METHODS.has(member)) direct.add(member);
    if (node.expression.expression.kind === ts.SyntaxKind.ThisKeyword) calledSameClass.add(member);
  }
  ts.forEachChild(node, child => walkCalls(child, direct, calledSameClass));
}

function collect(source, filePath) {
  const file = ts.createSourceFile(filePath || 'controller.ts', source, ts.ScriptTarget.Latest, true);
  const routes = [];
  const violations = [];
  for (const klass of file.statements.filter(ts.isClassDeclaration)) {
    const meta = decorators(klass);
    const controller = meta.find(value => value.name === 'Controller');
    if (!controller) continue;
    const classGuards = names(meta);
    /** method name -> { direct: Set<operate path name>, calls: Set<same-class method name> } */
    const methodCalls = new Map();
    const handlers = new Map(); // method name -> { guards, verb, path }
    for (const member of klass.members.filter(ts.isMethodDeclaration)) {
      if (!ts.isIdentifier(member.name)) continue;
      const memberMeta = decorators(member);
      const direct = new Set();
      const calls = new Set();
      if (member.body) walkCalls(member.body, direct, calls);
      methodCalls.set(member.name.text, { direct, calls });
      const route = memberMeta.find(value => verbs.has(value.name));
      const guards = [...classGuards, ...names(memberMeta)];
      if (route) {
        if (guards.includes('PlatformOperatorGuard')) {
          if (!guards.includes('JwtAuthGuard') || [...meta, ...memberMeta].some(value => value.name === 'Public')) throw new Violation('A platform route must require JWT authentication and cannot be public.');
          if (!klass.name) throw new Violation('Unnamed platform route');
          routes.push({ method: route.name.toUpperCase(), path: ['/api/v1', literal(controller.args[0]), literal(route.args[0])].filter(Boolean).join('/'), controller: klass.name.text, handler: member.name.text });
        }
        handlers.set(member.name.text, { guards, verb: route.name.toUpperCase(), path: literal(route.args[0]) });
      }
    }
    // Fixed point: a handler "reaches" an operate path if it calls it directly,
    // or calls a same-class method that (transitively) reaches it.
    const reaches = new Set([...methodCalls].filter(([, v]) => v.direct.size > 0).map(([name]) => name));
    let grew = true;
    while (grew) {
      grew = false;
      for (const [name, { calls }] of methodCalls) {
        if (reaches.has(name)) continue;
        if ([...calls].some(called => reaches.has(called))) { reaches.add(name); grew = true; }
      }
    }
    for (const [name, info] of handlers) {
      if (!reaches.has(name)) continue;
      if (!info.guards.includes('PlatformOperatorGuard')) {
        violations.push(`${klass.name ? klass.name.text : '<class>'}.${name} (${info.verb} ${info.path}) reaches an orchestrator operate path without PlatformOperatorGuard`);
      }
    }
  }
  return { routes, violations };
}
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.controller.ts') ? [path.join(dir, entry.name)] : []);
}
const ordered = values => values.map(value => JSON.stringify(value)).sort();
function selfTest() {
  const source = `@Controller('health') @UseGuards(JwtAuthGuard) class House { @Get('agents') read() {} }
    @Controller('metrics') @UseGuards(JwtAuthGuard, PlatformOperatorGuard) class Platform { @Get() metrics() { return this.orchestrator.getSystemMetrics(); } }`;
  const guarded = collect(source);
  assert.deepEqual(guarded.routes, [{ method: 'GET', path: '/api/v1/metrics', controller: 'Platform', handler: 'metrics' }]);
  assert.deepEqual(guarded.violations, []);
  assert.throws(() => collect(`@Controller('x') @UseGuards(PlatformOperatorGuard) class X { @Post() run() {} }`));
  assert.throws(() => collect(`@Controller('x') @UseGuards(JwtAuthGuard, PlatformOperatorGuard) class X { @Public() @Post() run() {} }`));
  // Negative fixture (D3 / D12): a new route with only JwtAuthGuard calling
  // operateAgent must be CAUGHT, not silently passed because it was never in
  // the reviewed registry.
  const unguarded = collect(`@Controller('x') @UseGuards(JwtAuthGuard) class Rogue { @Post() run() { return this.orchestrator.operateAgent('a', 'restart', 'r'); } }`);
  assert.equal(unguarded.routes.length, 0);
  assert.equal(unguarded.violations.length, 1);
  assert.match(unguarded.violations[0], /Rogue\.run/);
  // Same, one call away through a same-class private helper.
  const indirect = collect(`@Controller('x') @UseGuards(JwtAuthGuard) class Indirect { @Post() run() { return this.dispatch(); } dispatch() { return this.orchestrator.operateAgent('a', 'restart', 'r'); } }`);
  assert.equal(indirect.violations.length, 1);
  assert.match(indirect.violations[0], /Indirect\.run/);
  // getSystemMetrics, guarded correctly, is not a false positive.
  const okMetrics = collect(`@Controller('x') @UseGuards(JwtAuthGuard, PlatformOperatorGuard) class Ok { @Get() m() { return this.orchestrator.getSystemMetrics(); } }`);
  assert.equal(okMetrics.violations.length, 0);
}
try {
  selfTest();
  const controllers = files(path.join(root, 'apps/api-gateway/src'));
  if (!controllers.length) throw new Error('No controllers found');
  const collected = controllers.map(file => ({ file, ...collect(fs.readFileSync(file, 'utf8'), file) }));
  const actual = collected.flatMap(value => value.routes);
  const violations = collected.flatMap(value => value.violations.map(message => `${path.relative(root, value.file)}: ${message}`));
  const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'registries/platform-operator-routes.json'), 'utf8'));
  if (!actual.length || !expected.length) throw new Error('Platform registry must not be empty');
  if (violations.length) throw new Violation(`Unguarded orchestrator operate paths:\n  ${violations.join('\n  ')}`);
  if (JSON.stringify(ordered(actual)) !== JSON.stringify(ordered(expected))) {
    throw new Violation('Platform route registry differs from the guarded routes');
  }
  process.stdout.write(`PASS: ${actual.length} platform routes match the reviewed registry; ${collected.length} controllers scanned for unguarded operate-path reach; parser fixtures passed.\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  // A Violation is a verified, specific finding: exit 1. Anything else (a
  // self-test failure, a parse error, no controllers found) means the check
  // itself did not run to completion — exit 2, never a silent pass.
  process.exitCode = error instanceof Violation ? 1 : 2;
}

#!/usr/bin/env node
// ADR 0143: reviewed registry of every HTTP route with platform authority.
// Parse decorators as TypeScript, including multiple controllers in one file.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const verbs = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options']);
function decorators(node) {
  return (ts.canHaveDecorators(node) ? ts.getDecorators(node) || [] : []).map(decorator => {
    const expr = decorator.expression;
    if (!ts.isCallExpression(expr) || !ts.isIdentifier(expr.expression)) return null;
    return { name: expr.expression.text, args: expr.arguments };
  }).filter(Boolean);
}
const names = values => values.filter(value => value.name === 'UseGuards').flatMap(value => value.args.filter(ts.isIdentifier).map(arg => arg.text));
const literal = expr => expr && ts.isStringLiteralLike(expr) ? expr.text : '';
function collect(source) {
  const file = ts.createSourceFile('controller.ts', source, ts.ScriptTarget.Latest, true);
  const routes = [];
  for (const klass of file.statements.filter(ts.isClassDeclaration)) {
    const meta = decorators(klass);
    const controller = meta.find(value => value.name === 'Controller');
    if (!controller) continue;
    for (const member of klass.members.filter(ts.isMethodDeclaration)) {
      const memberMeta = decorators(member);
      const route = memberMeta.find(value => verbs.has(value.name));
      if (!route) continue;
      const guards = [...names(meta), ...names(memberMeta)];
      if (!guards.includes('PlatformOperatorGuard')) continue;
      if (!guards.includes('JwtAuthGuard') || [...meta, ...memberMeta].some(value => value.name === 'Public')) throw new Error('A platform route must require JWT authentication and cannot be public.');
      if (!klass.name || !ts.isIdentifier(member.name)) throw new Error('Unnamed platform route');
      routes.push({ method: route.name.toUpperCase(), path: ['/api/v1', literal(controller.args[0]), literal(route.args[0])].filter(Boolean).join('/'), controller: klass.name.text, handler: member.name.text });
    }
  }
  return routes;
}
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.controller.ts') ? [path.join(dir, entry.name)] : []);
}
const ordered = values => values.map(value => JSON.stringify(value)).sort();
function selfTest() {
  const source = `@Controller('health') @UseGuards(JwtAuthGuard) class House { @Get('agents') read() {} }
    @Controller('metrics') @UseGuards(JwtAuthGuard, PlatformOperatorGuard) class Platform { @Get() metrics() {} }`;
  assert.deepEqual(collect(source), [{ method: 'GET', path: '/api/v1/metrics', controller: 'Platform', handler: 'metrics' }]);
  assert.throws(() => collect(`@Controller('x') @UseGuards(PlatformOperatorGuard) class X { @Post() run() {} }`));
  assert.throws(() => collect(`@Controller('x') @UseGuards(JwtAuthGuard, PlatformOperatorGuard) class X { @Public() @Post() run() {} }`));
}
try {
  selfTest();
  const controllers = files(path.join(root, 'apps/api-gateway/src'));
  if (!controllers.length) throw new Error('No controllers found');
  const actual = controllers.flatMap(file => collect(fs.readFileSync(file, 'utf8')));
  const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'registries/platform-operator-routes.json'), 'utf8'));
  if (!actual.length || !expected.length) throw new Error('Platform registry must not be empty');
  assert.deepEqual(ordered(actual), ordered(expected), 'Platform route registry differs from the guarded routes');
  process.stdout.write(`PASS: ${actual.length} platform routes match the reviewed registry; parser fixtures passed.\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`); process.exitCode = 1;
}

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const STAMP_PATH = 'api/_lib/release-build-identity.json';
const DEFINITIONS = Object.freeze([
  { key: 'checkout', route: '/api/create-mp-preference', entrypoint: 'api/create-mp-preference.ts', handler: 'api/create-mp-preference.js' },
  { key: 'reconcile', route: '/api/internal/web-stock-reconcile', entrypoint: 'api/internal/web-stock-reconcile.ts', handler: 'api/internal/web-stock-reconcile.js' },
]);

async function sourceIdentity(source) {
  assert.equal(process.version, 'v22.23.3', 'Prebuilt requires the reviewed exact Node patch');
  const git = args => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
  assert.equal(git(['status', '--porcelain=v1', '--untracked-files=normal']), '', 'Prebuilt requires a clean exact checkout');
  const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  const builder = JSON.parse(await fs.readFile(path.join(source, 'node_modules/@vercel/node/package.json'), 'utf8'));
  assert.equal(pkg.devDependencies['@vercel/node'], '5.10.2');
  assert.equal(builder.version, '5.10.2');
  const stamp = { schemaVersion: 1, head: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']),
    packageLockSha256: digest(await fs.readFile(path.join(source, 'package-lock.json'))),
    functionsLockSha256: digest(await fs.readFile(path.join(source, 'functions/package-lock.json'))),
    builder: '@vercel/node@5.10.2', buildNode: process.version };
  return { ...stamp, buildId: digest(JSON.stringify(stamp)) };
}

function configProperty(sourceText, filename, propertyName) {
  const ts = require('typescript');
  const file = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(file.parseDiagnostics.length, 0, `Unparseable function configuration: ${filename}`);
  const declarations = file.statements.filter(ts.isVariableStatement)
    .filter(statement => statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))
    .flatMap(statement => [...statement.declarationList.declarations])
    .filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'config');
  assert.equal(declarations.length, 1, `Exactly one explicit function config required: ${filename}`);
  const initializer = declarations[0].initializer;
  assert(initializer && ts.isObjectLiteralExpression(initializer), 'Function config must be an inspectable literal');
  const entries = initializer.properties.filter(ts.isPropertyAssignment)
    .filter(property => property.name.getText(file) === propertyName);
  assert.equal(entries.length, 1, `Explicit ${propertyName} required: ${filename}`);
  return entries[0].initializer;
}
function declaredDuration(sourceText, filename) {
  const ts = require('typescript');
  const value = configProperty(sourceText, filename, 'maxDuration');
  assert(ts.isNumericLiteral(value), 'maxDuration must be a numeric literal');
  const duration = Number(value.text);
  assert(Number.isInteger(duration) && duration > 0 && duration <= 800, 'Invalid declared function duration');
  return duration;
}
function declaredArchitecture(sourceText, filename) {
  const ts = require('typescript');
  const value = configProperty(sourceText, filename, 'architecture');
  assert(ts.isStringLiteral(value) && value.text === 'x86_64', 'Explicit reviewed x86_64 architecture required');
  return value.text;
}

async function outputConfiguration(source) {
  const config = JSON.parse(await fs.readFile(path.join(source, 'vercel.json'), 'utf8'));
  assert.deepEqual(config.builds, [{ src: 'package.json', use: '@vercel/static-build' }, ...DEFINITIONS.map(item => ({ src: item.entrypoint, use: '@vercel/node' }))]);
  assert.deepEqual(config.routes, [
    { src: '/api/orders', dest: 'https://mutter-games-admin-api-prod.vercel.app/api/orders' },
    ...DEFINITIONS.map(item => ({ src: item.route, dest: `/${item.entrypoint}` })),
    { handle: 'filesystem' }, { src: '.*', dest: '/index.html' },
  ], 'Changed routes require explicit prebuilt review');
  assert.deepEqual(config.crons, [{ path: '/api/internal/web-stock-reconcile', schedule: '*/5 * * * *' }]);
  const functions = [];
  for (const definition of DEFINITIONS) {
    const sourceText = await fs.readFile(path.join(source, definition.entrypoint), 'utf8');
    functions.push({ ...definition, directory: `functions${definition.route}.func`, config: {
      runtime: 'nodejs22.x', handler: definition.handler, architecture: declaredArchitecture(sourceText, definition.entrypoint), launcherType: 'Nodejs', shouldAddHelpers: true,
      shouldAddSourcemapSupport: true,
      maxDuration: declaredDuration(sourceText, definition.entrypoint),
    } });
  }
  return { functions, config: { version: 3, routes: config.routes.map(route => {
    const definition = DEFINITIONS.find(item => route.dest === `/${item.entrypoint}`);
    return definition ? { ...route, dest: definition.route } : route;
  }), crons: config.crons } };
}

module.exports = { digest, jsonBytes, STAMP_PATH, DEFINITIONS, sourceIdentity, declaredDuration, declaredArchitecture, outputConfiguration };

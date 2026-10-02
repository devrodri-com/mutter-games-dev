const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const yaml = require('yaml');
const exception = require('./exception.json');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const codeExtension = /\.(?:[cm]?[jt]sx?)$/;
const fixtureFile = /(?:^|\/)fixtures(?:\/|$)/;
const edgeNames = new Set(exception.packages.filter(item => item.name !== '@vercel/node').map(item => item.name));

function fail(code, file, detail) {
  const error = new Error(`${file}: ${detail}`);
  error.code = code;
  throw error;
}

function forbiddenModule(value) {
  const normalized = value.replaceAll('\\', '/');
  return [...edgeNames].some(name => normalized === name || normalized.startsWith(`${name}/`) || normalized.includes(`/node_modules/${name}/`))
    || /(?:@vercel\/node\/.*(?:dev-server|start-dev-server)|(?:^|\/)edge-runtime(?:\/|$))/.test(normalized);
}

function shellCommand(value, file) {
  // Inspect actual command positions, not prose/echoed descriptions. Runtime
  // observation complements static checks for computed process arguments.
  const command = value.replace(/^[ \t]*#.*$/gm, '').replace(/["']/g, '');
  const prefix = '(?:^|[\n;&|]|\\$\\()\\s*(?:(?:[A-Z_][A-Z_0-9]*=[^\\s]+|env|npx|npm\\s+exec|pnpm(?:\\s+(?:exec|dlx))?|yarn(?:\\s+(?:exec|dlx))?|--|--yes|-y)\\s+)*';
  if (new RegExp(`${prefix}(?:[^\\s;&|]+/)?vercel(?:\\.m?js|@[^\\s]+)?\\s+(?:--[^\\s]+\\s+)*dev(?:\\s|$|[;&|])`, 'm').test(command)
    || new RegExp(`${prefix}(?:[^\\s;&|]+/)?edge-runtime(?:@[^\\s]+)?(?:\\s|$|[;&|])`, 'm').test(command)
    || /\b(?:node|tsx|ts-node)\b[^\n]*(?:@edge-runtime\/(?:vm|primitives)|edge-runtime\/(?:dist|bin)|@vercel\/node\/[^\s]*dev-server)/.test(command)
    || /\bvitest\b[^\n]*(?:--environment|-e)\s+edge-runtime(?:\s|$)/.test(command)
    || /\b(?:require|import)\s*\(\s*(?:@edge-runtime\/|edge-runtime(?:\/|\s*\)))/.test(command)) {
    fail('EDGE_OPERATIONAL_CONSUMER', file, 'Edge/dev-server executable command is prohibited');
  }
}

function verifyCode(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (source.parseDiagnostics.length) fail('EDGE_OPERATIONAL_NOT_VERIFIED', file, 'Cannot parse operational source');
  for (const comment of ts.getLeadingCommentRanges(text, 0) ?? []) {
    if (/@(?:vitest|jest)-environment\s+edge-runtime\b/.test(text.slice(comment.pos, comment.end))) fail('EDGE_OPERATIONAL_CONSUMER', file, 'Test-file Edge environment directive is prohibited');
  }
  const constants = new Map();
  const localImports = [];
  function literal(node) {
    if (!node) return undefined;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isIdentifier(node)) return constants.get(node.text);
    if (ts.isParenthesizedExpression(node)) return literal(node.expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = literal(node.left), right = literal(node.right);
      return left !== undefined && right !== undefined ? left + right : undefined;
    }
    return undefined;
  }
  function checkImport(value, node) {
    if (typeof value !== 'string') return;
    if (forbiddenModule(value)) fail('EDGE_OPERATIONAL_CONSUMER', file, `Prohibited executable module: ${value}`);
    if (value === '@vercel/node' && node.getText(source).includes('startDevServer')) fail('EDGE_OPERATIONAL_CONSUMER', file, 'Builder dev-server import is prohibited');
    if (value.startsWith('.')) localImports.push(value);
  }
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const value = literal(node.initializer);
      if (value !== undefined) constants.set(node.name.text, value);
    }
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const isTypeOnly = node.isTypeOnly || node.importClause?.isTypeOnly;
      if (!isTypeOnly) checkImport(literal(node.moduleSpecifier), node);
    }
    if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) checkImport(literal(node.moduleReference.expression), node);
    if ((ts.isPropertyAccessExpression(node) && node.name.text === 'startDevServer')
      || (ts.isElementAccessExpression(node) && literal(node.argumentExpression) === 'startDevServer')
      || (ts.isBindingElement(node) && node.propertyName?.getText(source) === 'startDevServer')) fail('EDGE_OPERATIONAL_CONSUMER', file, 'Builder dev-server reference is prohibited');
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = node.expression;
      const name = ts.isPropertyAccessExpression(expression) ? expression.name.text : ts.isIdentifier(expression) ? expression.text : undefined;
      const elementName = ts.isElementAccessExpression(expression) ? literal(expression.argumentExpression) : undefined;
      if (['startDevServer', 'EdgeVM', 'EdgeRuntime'].includes(name ?? elementName)) fail('EDGE_OPERATIONAL_CONSUMER', file, 'Edge/dev-server invocation is prohibited');
      if (name === 'require' || expression.kind === ts.SyntaxKind.ImportKeyword || name === 'resolve') {
        const module = literal(node.arguments?.[0]);
        // Resolution checks made by guards are allowed; actual import/require
        // calls are consumers even if buried in a currently uncalled function.
        if (name !== 'resolve') checkImport(module, node.parent);
      }
      if (['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'].includes(name)) {
        const first = literal(node.arguments?.[0]);
        const args = node.arguments?.[1];
        const parts = args && ts.isArrayLiteralExpression(args) ? args.elements.map(literal).filter(item => item !== undefined) : [];
        if (first !== undefined) shellCommand([first, ...parts].join(' '), file);
      }
    }
    if (ts.isPropertyAssignment(node)) {
      const key = ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : undefined;
      const value = literal(node.initializer);
      if ((key === 'runtime' && ['edge', 'experimental-edge', 'edge-runtime'].includes(value))
        || (key === 'environment' && value === 'edge-runtime')) fail('EDGE_OPERATIONAL_CONSUMER', file, 'Edge runtime/environment configuration is prohibited');
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'runtime' && ['edge', 'experimental-edge', 'edge-runtime'].includes(literal(node.initializer))) fail('EDGE_OPERATIONAL_CONSUMER', file, 'Edge runtime export/configuration is prohibited');
    ts.forEachChild(node, visit);
  }
  visit(source);
  return localImports;
}

function inspectConfig(value, file, key = '') {
  if (typeof value === 'string') {
    if (['run', 'command', 'buildCommand', 'devCommand', 'installCommand'].includes(key)) shellCommand(value, file);
    if ((key === 'runtime' && ['edge', 'experimental-edge', 'edge-runtime'].includes(value))
      || (key === 'environment' && value === 'edge-runtime') || (key === 'use' && forbiddenModule(value))) fail('EDGE_OPERATIONAL_CONSUMER', file, 'Edge configuration is prohibited');
  } else if (Array.isArray(value)) value.forEach(item => inspectConfig(item, file, key));
  else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) inspectConfig(item, file, name);
}

function verifyOperationalSources(source) {
  const root = fs.realpathSync(source);
  const inspectedEntries = [];
  const candidates = new Set();
  function collect(directory, required = false) {
    const absolute = path.join(root, directory);
    if (!fs.existsSync(absolute)) {
      if (required) fail('EDGE_OPERATIONAL_NOT_VERIFIED', directory, 'Required source directory missing');
      return;
    }
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const location = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.name === 'node_modules' || fixtureFile.test(location) || entry.name === '.git') continue;
      if (entry.isSymbolicLink()) fail('EDGE_OPERATIONAL_NOT_VERIFIED', location, 'Source symlink not inspected');
      if (entry.isDirectory()) collect(location);
      else if (codeExtension.test(entry.name) || /\.(?:json|ya?ml|sh)$/.test(entry.name)) candidates.add(location);
    }
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && (codeExtension.test(entry.name) || /\.(?:json|ya?ml|sh)$/.test(entry.name)) && !entry.name.includes('lock')) candidates.add(entry.name);
  }
  for (const directory of ['api', 'src', 'scripts', 'functions', 'backend', 'tests', '.github/workflows']) collect(directory, ['api', 'src', 'scripts', 'functions', '.github/workflows'].includes(directory));
  for (const mandatory of ['package.json', 'functions/package.json', 'vercel.json', 'vite.config.ts', 'vitest.config.ts', '.github/workflows/ci.yml', 'api/create-mp-preference.ts', 'api/internal/web-stock-reconcile.ts']) {
    if (!candidates.has(mandatory)) fail('EDGE_OPERATIONAL_NOT_VERIFIED', mandatory, 'Required operational entry missing');
  }
  const queue = [...candidates].sort();
  for (const file of queue) {
    if (file.endsWith('package-lock.json')) continue;
    const bytes = fs.readFileSync(path.join(root, file));
    const text = bytes.toString('utf8');
    let mode;
    if (codeExtension.test(file)) {
      const imports = verifyCode(text, file);
      // A fixture imported as a module is an operational consumer. Keeping
      // negative source inputs out of the initial scan does not exempt callers.
      for (const specifier of imports) {
        const target = path.resolve(root, path.dirname(file), specifier);
        if (!target.startsWith(`${root}${path.sep}`)) fail('EDGE_OPERATIONAL_NOT_VERIFIED', file, 'Relative import escapes inspected source');
        const options = [target, ...['.ts', '.tsx', '.js', '.cjs', '.mjs', '/index.ts', '/index.tsx', '/index.js'].map(extension => `${target}${extension}`)];
        const resolved = options.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (resolved && codeExtension.test(resolved)) {
          if (fs.lstatSync(resolved).isSymbolicLink()) fail('EDGE_OPERATIONAL_NOT_VERIFIED', file, 'Imported source symlink not inspected');
          const location = path.relative(root, resolved).split(path.sep).join('/');
          if (!candidates.has(location) && !location.includes('node_modules/')) { candidates.add(location); queue.push(location); }
        }
      }
      mode = 'typescript-ast';
    }
    else if (file.endsWith('.sh')) { shellCommand(text, file); mode = 'shell-command-positions'; }
    else {
      let parsed;
      try {
        if (/(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(file)) {
          const result = ts.parseConfigFileTextToJson(file, text);
          if (result.error) fail('EDGE_OPERATIONAL_NOT_VERIFIED', file, 'Cannot parse TypeScript JSONC configuration');
          parsed = result.config;
        } else parsed = file.endsWith('.json') ? JSON.parse(text) : yaml.parse(text);
      }
      catch (error) { fail('EDGE_OPERATIONAL_NOT_VERIFIED', file, `Cannot parse configuration: ${error.name}`); }
      inspectConfig(parsed, file);
      if (file.endsWith('package.json')) for (const command of Object.values(parsed.scripts ?? {})) {
        if (typeof command !== 'string') fail('EDGE_OPERATIONAL_NOT_VERIFIED', file, 'Non-string executable script');
        shellCommand(command, file);
      }
      mode = 'parsed-configuration';
    }
    inspectedEntries.push({ path: file, bytes: bytes.length, sha256: digest(bytes), mode });
  }
  return {
    status: 'PASS', exceptionId: exception.exceptionId, source: root, inspectedEntries,
    excluded: ['Documentation/prose', 'Fixture inputs; executable tests and guards remain inspected', 'Installed packages inventoried separately', 'Generated output inspected separately'],
    limits: 'Static literal consumers/configuration are checked. Dynamic imports and process arguments are additionally enforced by required real build observation; this result alone is not compilation verification.',
  };
}

module.exports = { verifyOperationalSources };

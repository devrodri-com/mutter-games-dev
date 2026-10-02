const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fileURLToPath } = require('node:url');

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

function forbiddenLocation(value) {
  const normalized = value.replaceAll('\\', '/');
  return /(?:^|\/)(?:node_modules\/)?@edge-runtime(?:\/|$)/.test(normalized)
    || /(?:^|\/)(?:node_modules\/)?edge-runtime(?:\/|$)/.test(normalized)
    || /(?:^|\/)@vercel\/node\/dist\/dev-server\.mjs(?:$|[?#])/.test(normalized);
}

function localPath(value) {
  if (typeof value !== 'string') return null;
  if (value.startsWith('file:')) return fileURLToPath(value);
  return path.isAbsolute(value) ? value : null;
}

function canonical(file) {
  return fs.realpathSync(file);
}

function resolveExecutable(command, env, cwd) {
  if (command.includes(path.sep)) return canonical(path.resolve(cwd, command));
  for (const directory of (env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.resolve(directory, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return canonical(candidate);
    } catch (error) {
      if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code)) throw error;
    }
  }
  throw new Error(`Executable cannot be resolved for observation: ${command}`);
}

// The native esbuild service is a Go executable, not a Node evaluator. Its
// actual bytes and package identity are recorded separately from module hooks.
function nativeExecutableIdentity(executable, args, source) {
  if (!inside(path.join(source, 'node_modules'), executable)) return null;
  const normalized = executable.replaceAll('\\', '/');
  if (!/\/node_modules\/@esbuild\/[^/]+\/bin\/esbuild$/.test(normalized)) return null;
  const packagePath = path.resolve(executable, '..', '..', 'package.json');
  const metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (typeof metadata.name !== 'string' || !metadata.name.startsWith('@esbuild/') || typeof metadata.version !== 'string') return null;
  const allowedArguments = (args.length === 1 && args[0] === '--version')
    || (args.length >= 1 && args.length <= 2 && args[0] === `--service=${metadata.version}` && (args.length === 1 || args[1] === '--ping'));
  if (!allowedArguments) return null;
  const bytes = fs.readFileSync(executable);
  return { executable, package: metadata.name, version: metadata.version, bytes: bytes.length, sha256: digest(bytes), observation: 'native-Go-service; no Node module evaluator' };
}

module.exports = { digest, inside, forbiddenLocation, localPath, canonical, resolveExecutable, nativeExecutableIdentity };

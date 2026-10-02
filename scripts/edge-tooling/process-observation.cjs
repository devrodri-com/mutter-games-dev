const path = require('node:path');
const childProcess = require('node:child_process');
const workerThreads = require('node:worker_threads');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { digest, canonical, resolveExecutable, nativeExecutableIdentity, forbiddenLocation } = require('./observation-policy.cjs');

function installProcessObservation({ config, configPath, preload, scope, emit, reject }) {
  const nodeExecutable = canonical(process.execPath);
  const original = Object.fromEntries(['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork'].map(key => [key, childProcess[key]]));
  const preloadOption = `--require ${JSON.stringify(preload)}`;

  function verifyLoaderArguments(args) {
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (['--require', '-r'].includes(arg) && args[index + 1] === preload) { index += 1; continue; }
      if (/^--(?:experimental-)?loader(?:=|$)/.test(arg) || /^--(?:require|import)(?:=|$)/.test(arg) || /^-r(?:$|.)/.test(arg)) {
        reject('NOT_VERIFIED', { reason: 'additional Node loader/preload is outside observation coverage' });
      }
    }
  }

  function environment(given, token) {
    const env = given ?? process.env;
    if (env.NODE_OPTIONS && env.NODE_OPTIONS !== process.env.NODE_OPTIONS) {
      reject('NOT_VERIFIED', { reason: 'child changes Node loader options', parentScope: scope });
    }
    return { ...env, NODE_OPTIONS: preloadOption, MUTTER_EDGE_OBSERVATION_CONFIG: configPath, MUTTER_EDGE_PARENT_SCOPE: scope, MUTTER_EDGE_CHILD_TOKEN: token };
  }

  function prepare(command, args, options) {
    if (typeof command !== 'string' || !Array.isArray(args) || args.some(arg => typeof arg !== 'string')) {
      reject('NOT_VERIFIED', { reason: 'unrecognized child-process arguments' });
    }
    if (options.shell || options.detached) reject('NOT_VERIFIED', { reason: 'shell or detached child cannot inherit the bounded observation', command });
    const cwd = options.cwd ? path.resolve(String(options.cwd)) : process.cwd();
    const env = options.env ?? process.env;
    let executable;
    try { executable = resolveExecutable(command, env, cwd); }
    catch (error) { reject('NOT_VERIFIED', { reason: error.message, command }); }
    if (forbiddenLocation(executable) || args.some(arg => forbiddenLocation(arg))) {
      reject('FORBIDDEN_LOAD', { reason: 'prohibited Edge executable/entrypoint', executable, args });
    }
    const token = crypto.randomUUID();
    if (executable === nodeExecutable) {
      verifyLoaderArguments(args);
      emit('child-launch', { token, kind: 'node', executable, args, cwd });
      return { token, options: { ...options, env: environment(options.env, token) }, kind: 'node' };
    }
    const identity = nativeExecutableIdentity(executable, args, config.source);
    if (!identity) reject('NOT_VERIFIED', { reason: 'unrecognized native child executable or arguments', executable, args });
    emit('child-launch', { token, kind: 'native-esbuild', ...identity, args, cwd });
    return { token, options, kind: 'native-esbuild' };
  }

  function completion(child, token) {
    emit('child-created', { token, childPid: child.pid ?? null });
    child.once('error', error => emit('child-error', { token, code: error.code ?? null, message: error.message }));
    child.once('exit', (code, signal) => emit('child-exit', { token, code, signal }));
    return child;
  }

  childProcess.spawn = function observedSpawn(command, args, options) {
    const actualArgs = Array.isArray(args) ? args : [];
    const actualOptions = (Array.isArray(args) ? options : args) ?? {};
    const prepared = prepare(command, actualArgs, actualOptions);
    return completion(original.spawn.call(this, command, actualArgs, prepared.options), prepared.token);
  };
  childProcess.spawnSync = function observedSpawnSync(command, args, options) {
    const actualArgs = Array.isArray(args) ? args : [];
    const actualOptions = (Array.isArray(args) ? options : args) ?? {};
    const prepared = prepare(command, actualArgs, actualOptions);
    const result = original.spawnSync.call(this, command, actualArgs, prepared.options);
    emit('child-created', { token: prepared.token, childPid: result.pid ?? null });
    emit('child-exit', { token: prepared.token, code: result.status, signal: result.signal, error: result.error?.code ?? null });
    return result;
  };
  childProcess.execFile = function observedExecFile(command, ...rest) {
    const args = Array.isArray(rest[0]) ? rest.shift() : [];
    const options = rest[0] && typeof rest[0] === 'object' ? rest.shift() : {};
    const callback = typeof rest[0] === 'function' ? rest.shift() : undefined;
    if (rest.length) reject('NOT_VERIFIED', { reason: 'unrecognized execFile overload', command });
    const prepared = prepare(command, args, options);
    return completion(original.execFile.call(this, command, args, prepared.options, callback), prepared.token);
  };
  Object.defineProperty(childProcess.execFile, promisify.custom, {
    value: function observedExecFilePromise(...args) {
      let child;
      const result = new Promise((resolve, rejectPromise) => {
        child = childProcess.execFile(...args, (error, stdout, stderr) => {
          if (error) {
            error.stdout = stdout;
            error.stderr = stderr;
            rejectPromise(error);
          } else resolve({ stdout, stderr });
        });
      });
      result.child = child;
      return result;
    },
  });
  childProcess.execFileSync = function observedExecFileSync(command, args, options) {
    const actualArgs = Array.isArray(args) ? args : [];
    const actualOptions = (Array.isArray(args) ? options : args) ?? {};
    const prepared = prepare(command, actualArgs, actualOptions);
    try {
      const result = original.execFileSync.call(this, command, actualArgs, prepared.options);
      emit('child-exit', { token: prepared.token, code: 0, signal: null });
      return result;
    } catch (error) {
      emit('child-exit', { token: prepared.token, code: error.status ?? null, signal: error.signal ?? null, error: error.code ?? null });
      throw error;
    }
  };
  // No declared compilation step needs a shell interpreter. New shell-based
  // consumers require an explicit coverage change, rather than an unobserved run.
  childProcess.exec = function observedExec() { reject('NOT_VERIFIED', { reason: 'shell exec is outside observed compilation' }); };
  childProcess.execSync = function observedExecSync() { reject('NOT_VERIFIED', { reason: 'shell execSync is outside observed compilation' }); };
  childProcess.fork = function observedFork(modulePath, args, options) {
    const actualArgs = Array.isArray(args) ? args : [];
    const actualOptions = (Array.isArray(args) ? options : args) ?? {};
    if (actualOptions.execPath && canonical(actualOptions.execPath) !== nodeExecutable) reject('NOT_VERIFIED', { reason: 'fork uses an unverified Node executable' });
    const prepared = prepare(nodeExecutable, [String(modulePath), ...actualArgs], actualOptions);
    return completion(original.fork.call(this, modulePath, actualArgs, { ...prepared.options, execArgv: observedExecArgv(actualOptions.execArgv) }), prepared.token);
  };

  function observedExecArgv(given) {
    const args = given ?? process.execArgv;
    if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) reject('NOT_VERIFIED', { reason: 'unrecognized worker/fork Node arguments' });
    verifyLoaderArguments(args);
    const copy = [...args];
    if (!copy.some((arg, index) => ['--require', '-r'].includes(arg) && copy[index + 1] === preload)) copy.push('--require', preload);
    return copy;
  }

  workerThreads.Worker = new Proxy(workerThreads.Worker, {
    construct(Target, [filename, options = {}], NewTarget) {
      if (options.env === workerThreads.SHARE_ENV) reject('NOT_VERIFIED', { reason: 'shared worker environment cannot carry an independent observation token' });
      const value = String(filename);
      if (!options.eval && forbiddenLocation(value)) reject('FORBIDDEN_LOAD', { reason: 'prohibited worker entrypoint', location: value });
      const token = crypto.randomUUID();
      const entry = options.eval || value.startsWith('data:')
        ? { kind: options.eval ? 'eval' : 'data-url', sourceSha256: digest(value), bytes: Buffer.byteLength(value) }
        : { kind: 'file', filename: value };
      emit('worker-launch', { token, entry });
      const worker = Reflect.construct(Target, [filename, { ...options, execArgv: observedExecArgv(options.execArgv), env: environment(options.env, token) }], NewTarget);
      emit('worker-created', { token, workerThreadId: worker.threadId });
      worker.once('error', error => emit('worker-error', { token, code: error.code ?? null, message: error.message }));
      worker.once('exit', code => emit('worker-exit', { token, code }));
      return worker;
    },
  });
}

module.exports = { installProcessObservation };

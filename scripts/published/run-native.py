"""Run the retained 180 stock/checkout/Rules assertions with synthetic services.

macOS applies the retained loopback sandbox policy. Linux must already be in
an externally created network namespace containing only its loopback interface.
This runner does not install dependencies, download emulators, or call providers.
The paired modules are a retained historical comparison, not a claim about the
current independently deployed Admin API.
"""
from pathlib import Path
import datetime
import hashlib
import json
import os
import re
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import time

SOURCE = Path(__file__).resolve().parents[2]
TESTS = [
    'tests/catalog/checkout.test.ts', 'tests/catalog/stock-admin-sales.test.ts',
    'tests/catalog/web-stock-recovery.test.ts', 'tests/catalog/web-stock-maintenance.test.ts',
    'tests/catalog/web-stock-sweep.test.ts', 'tests/catalog/mercado-pago-payments.test.ts',
    'tests/catalog/release-cutover.test.ts', 'tests/rules/cutover.test.ts',
]
PORTS = [8188, 9198, 4476, 4576, 9256]
PAIR_HASHES = {
    'api/_lib/product-patch.ts': '25301ef451593939e013ac24c417a456fe0547e7a58fd5e9aa3d3d3485a24c3d',
    'api/_lib/web-reservations.ts': 'f78e8d067a185355084d7942287298d8dee5e78af99fc2d8f5e47c0419a4bb99',
    'api/_lib/release-cutover.ts': 'ddd9789d3a1eb8da90a7253449228cfe3e05f8693181ba333b79715448b28987',
    'api/_lib/session-authority.ts': 'd9e65951a76ddf184841b27440b4b5dd5ca1fe9944cbf415858fb70cd4ce21af',
    'package.json': '05a26aeea86594b267c472c09210de06f266bb9fbc59cbbe121e79425b530836',
    'package-lock.json': 'c3fa0963f50601f3ea6ca77baf9593ac5ab3a05b55e0778342e4db9ef08bc580',
}
JAR_HASH = '9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c'
PROJECT = 'demo-mutter-stock-recovery'


def demand(condition, message):
    if not condition:
        raise RuntimeError(message)


def write_json(path, value):
    with path.open('x', encoding='utf-8') as output:
        os.chmod(path, 0o600)
        json.dump(value, output, indent=2)
        output.write('\n')
        output.flush()
        os.fsync(output.fileno())


def pin(path):
    demand(path.is_file(), 'Required regular input unavailable: ' + str(path))
    data = path.read_bytes()
    return {'path': str(path), 'realpath': str(path.resolve()), 'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest()}


def paired_source():
    supplied = os.environ.get('MUTTER_ADMIN_API_SOURCE', str(SOURCE / 'verification/retained-admin-api'))
    path = Path(supplied)
    demand(path.is_absolute() and path.is_dir(), 'Exact paired Admin directory required')
    path = path.resolve()
    provenance = json.loads((path / 'PROVENANCE.json').read_text())
    demand(provenance.get('schema') == 1
           and provenance.get('retainedLocalCommit') == '2a7521cdfd096f7a9b0531814f3ccaa5fe430d1b'
           and provenance.get('retainedLocalTree') == 'de4f05f3ffd99188e19b4a42c6090c56500523c8'
           and provenance.get('scope') == 'Retained source coupling only; no claim of live Admin API deployment/exposure',
           'Exact retained comparison provenance required')
    declared = {row['path']: row['sha256'] for row in provenance.get('files', [])}
    demand(len(declared) == len(provenance.get('files', [])) and declared == PAIR_HASHES,
           'Retained comparison manifest differs')
    for name, digest in PAIR_HASHES.items():
        demand(pin(path / name)['sha256'] == digest, 'Paired Admin anchor differs: ' + name)
    package = json.loads((path / 'package.json').read_text())
    lock = json.loads((path / 'package-lock.json').read_text())
    installed = json.loads((path / 'node_modules/firebase-admin/package.json').read_text())
    demand(package['dependencies']['firebase-admin'] == '13.10.0'
           and lock['packages']['node_modules/firebase-admin']['version'] == '13.10.0'
           and installed['version'] == '13.10.0', 'Paired SDK must remain Firebase Admin 13.10.0')
    demand((path / 'api/_lib/release-cutover.ts').read_bytes()
           == (SOURCE / 'api/_lib/release-cutover.ts').read_bytes(), 'Paired cutover policy differs')
    demand((path / 'api/_lib/session-authority.ts').read_bytes()
           == (SOURCE / 'api/_lib/session-authority.ts').read_bytes(), 'Paired session policy differs')
    return path


def snapshot(pair, node, java, jar):
    records = {}
    for subtree in ['api', 'src', 'tests', 'scripts', 'public']:
        directory = SOURCE / subtree
        demand(directory.is_dir() and not directory.is_symlink(), 'Ordinary source subtree required')
        for root, dirs, files in os.walk(directory, followlinks=False):
            dirs[:] = sorted(name for name in dirs if name not in ['node_modules', '.git', 'dist', '.vite', '__pycache__'])
            for name in dirs:
                demand(not (Path(root) / name).is_symlink(), 'Source directory symlink rejected')
            for name in sorted(files):
                path = Path(root) / name
                demand(not path.is_symlink(), 'Source file symlink rejected')
                row = pin(path)
                records[row['path']] = row
    for name in ['package.json', 'package-lock.json', 'firebase.catalog-cutover.rules',
                 'index.html', 'vite.config.ts', 'tailwind.config.js', 'postcss.config.cjs',
                 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']:
        row = pin(SOURCE / name)
        records[row['path']] = row
    for name in [*PAIR_HASHES, 'PROVENANCE.json']:
        row = pin(pair / name)
        if name in PAIR_HASHES:
            demand(row['sha256'] == PAIR_HASHES[name], 'Paired source changed: ' + name)
        records[row['path']] = row
    for path in [node, java, jar, pair / 'node_modules/firebase-admin/package.json',
                 SOURCE / 'node_modules/firebase-tools/package.json',
                 SOURCE / 'node_modules/vitest/package.json']:
        row = pin(path)
        records[row['path']] = row
    return [records[key] for key in sorted(records)]


def loopback_profile(evidence):
    # Retained browser-final policy: deny all networking, then admit loopback
    # TCP and evidence-owned Unix sockets; restrict all writes to this run.
    quoted = lambda value: json.dumps(str(value))
    profile = '(version 1)(allow default)(deny network*)'
    profile += '(allow network-bind (local ip "localhost:*"))'
    profile += '(allow network-inbound (local ip "localhost:*"))'
    profile += '(allow network-outbound (remote ip "localhost:*"))'
    profile += '(allow network-bind network-inbound network-outbound (subpath ' + quoted(evidence / 'tmp') + '))'
    original_home = Path(os.environ['HOME']).resolve()
    denied = [original_home / name for name in [
        '.config/gcloud', '.config/configstore', '.aws', '.ssh', 'Library/Keychains',
        '.codex/auth.json', '.codex/credentials', '.netrc', '.npmrc',
        'Library/Application Support/com.vercel.cli',
    ]]
    # Local consolidated checkouts live below trabajo-codex/activo. Resolve
    # that existing private sibling without embedding an operator's home path.
    for ancestor in SOURCE.parents:
        if ancestor.name == 'trabajo-codex':
            denied.append(ancestor / 'privado')
    profile += '(deny file-read* ' + ' '.join('(subpath ' + quoted(path) + ')' for path in denied)
    profile += ' (regex "/\\\\.env($|\\\\.)"))'
    profile += '(deny file-write*)(allow file-write* (subpath ' + quoted(evidence) + '))'
    profile += '(allow file-write-data (literal "/dev/null"))'
    return profile


def linux_namespace():
    demand(sys.platform == 'linux', 'Only macOS sandbox or Linux network namespace supported')
    interfaces = sorted(name for _index, name in socket.if_nameindex())
    demand(interfaces == ['lo'], 'Linux requires an external network namespace with only loopback')
    for name in ['/proc/net/route', '/proc/net/ipv6_route']:
        path = Path(name)
        demand(path.is_file(), 'Linux route inventory unavailable')
        lines = path.read_text().splitlines()
        for line in lines[1:] if name.endswith('/route') else lines:
            parts = line.split()
            if parts:
                interface = parts[0] if name.endswith('/route') else parts[-1]
                demand(interface == 'lo', 'External route found inside test namespace')
    return {'isolation': 'EXTERNAL_LINUX_LOOPBACK_NAMESPACE', 'interfaces': interfaces}


def ports_after():
    if sys.platform == 'darwin':
        values = {}
        for port in PORTS:
            result = subprocess.run(['/usr/sbin/lsof', '-nP', '-iTCP:' + str(port), '-sTCP:LISTEN'],
                                    capture_output=True, text=True, check=False)
            values[str(port)] = 'free' if result.returncode == 1 and not result.stdout else 'occupied' if result.returncode == 0 else 'unverified'
        return values
    occupied = set()
    for name in ['/proc/net/tcp', '/proc/net/tcp6']:
        for line in Path(name).read_text().splitlines()[1:]:
            parts = line.split()
            if len(parts) > 3 and parts[3] == '0A':
                occupied.add(int(parts[1].split(':')[1], 16))
    return {str(port): 'occupied' if port in occupied else 'free' for port in PORTS}


def environment_for(evidence, node, java_home, emulator_cache, pair):
    inherited_path = os.environ.get('PATH', '')
    demand(inherited_path and all(Path(part).is_absolute() for part in inherited_path.split(os.pathsep)),
           'PATH must contain only explicit absolute entries')
    result = {key: os.environ[key] for key in ['LANG', 'LC_ALL', 'TZ'] if key in os.environ}
    result.update(PATH=os.pathsep.join([str(node.parent), str(java_home / 'bin'), inherited_path]),
                  JAVA_HOME=str(java_home), FIREBASE_EMULATORS_PATH=str(emulator_cache),
                  FIREBASE_CLI_DISABLE_UPDATE_CHECK='true', CI='true', NO_COLOR='1',
                  TMPDIR=str(evidence / 'tmp'), TMP=str(evidence / 'tmp'), TEMP=str(evidence / 'tmp'),
                  XDG_CONFIG_HOME=str(evidence / 'config'), XDG_CACHE_HOME=str(evidence / 'cache'),
                  HOME=str(evidence / 'home'), GCLOUD_PROJECT=PROJECT, FIREBASE_PROJECT_ID=PROJECT,
                  FIRESTORE_EMULATOR_HOST='127.0.0.1:8188', FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9198',
                  MUTTER_ADMIN_API_SOURCE=str(pair), npm_config_cache=str(evidence / 'cache'),
                  npm_config_userconfig='/dev/null', CLOUDSDK_CONFIG=str(evidence / 'config'))
    # No inherited application credentials, NODE_OPTIONS/NODE_PATH, provider
    # tokens, proxy variables, Google ADC paths or preexisting config enter here.
    return result


def stop_owned_process(process):
    if process is None or process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def execute(label):
    demand(re.fullmatch(r'native-[a-z0-9][a-z0-9-]{0,60}', label), 'Expected unique native-<label>')
    parent = SOURCE / 'build-evidence'
    parent.mkdir(mode=0o700, exist_ok=True)
    demand(parent.resolve() == parent, 'Evidence parent cannot be a symlink')
    evidence = parent / label
    evidence.mkdir(mode=0o700, exist_ok=False)
    for name in ['tmp', 'config', 'home', 'cache']:
        (evidence / name).mkdir(mode=0o700)
    record = {'schema': 1, 'scope': 'CURRENT_NATIVE_PURCHASE_STOCK_AND_RULES',
              'providerSimulation': True, 'realMercadoPagoVerified': False,
              'productionRequests': False, 'sourceEdits': False,
              'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'exitCode': None, 'phase': 'preflight', 'selectedTestFiles': TESTS,
              'requiredAssertions': 180, 'requiredTestFiles': 8}
    started = time.monotonic()
    before = None
    context = None
    process = None
    try:
        for root in [SOURCE, paired_source()]:
            demand(not any(file for file in root.glob('.env*') if file.name != '.env.example'),
                   'Implicit environment files are forbidden; the tracked example is never loaded')
        pair = paired_source()
        executable = os.environ.get('NODE_BINARY') or shutil.which('node')
        demand(executable is not None and Path(executable).is_absolute(), 'Explicit Node executable required')
        node = Path(executable).resolve()
        java_home = Path(os.environ.get('JAVA_HOME', ''))
        demand(java_home.is_absolute() and (java_home / 'bin/java').is_file(), 'Existing Java21 JAVA_HOME required')
        java_home = java_home.resolve()
        java = (java_home / 'bin/java').resolve()
        cache_value = os.environ.get('FIREBASE_EMULATORS_PATH', '')
        demand(cache_value and Path(cache_value).is_absolute(), 'Explicit existing emulator cache required')
        emulator_cache = Path(cache_value).resolve()
        jar = emulator_cache / 'cloud-firestore-emulator-v1.22.0.jar'
        demand(pin(jar)['sha256'] == JAR_HASH, 'Reviewed Firestore1.22.0 emulator jar required')
        environment = environment_for(evidence, node, java_home, emulator_cache, pair)
        version = subprocess.run([str(node), '--version'], env=environment, check=True,
                                 capture_output=True, text=True).stdout.strip()
        demand(version == 'v24.22.1', 'Node24.22.1 required; do not substitute a runtime silently')
        java_version = subprocess.run([str(java), '-version'], env=environment, check=True,
                                      capture_output=True, text=True)
        demand(re.search(r'version "21(?:[.\"]|$)', java_version.stderr + java_version.stdout), 'Java21 required')
        record['runtimes'] = {'node': pin(node), 'nodeVersion': version, 'java': pin(java), 'javaMajor': 21}
        for path in TESTS:
            demand((SOURCE / path).is_file(), 'Required native test missing: ' + path)
        for port in PORTS:
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', port))
        profile = evidence / 'loopback.sb'
        if sys.platform == 'darwin':
            demand(Path('/usr/bin/sandbox-exec').is_file(), 'macOS sandbox-exec required')
            with profile.open('x') as output:
                output.write(loopback_profile(evidence))
            prefix = ['/usr/bin/sandbox-exec', '-f', str(profile)]
            record['networkIsolation'] = {'isolation': 'MACOS_LOOPBACK_SANDBOX'}
        else:
            record['networkIsolation'] = linux_namespace()
            prefix = []
        firebase = {'firestore': {'rules': str(SOURCE / 'firebase.catalog-cutover.rules')},
                    'emulators': {'firestore': {'host': '127.0.0.1', 'port': 8188, 'websocketPort': 9256},
                                  'auth': {'host': '127.0.0.1', 'port': 9198},
                                  'hub': {'host': '127.0.0.1', 'port': 4476},
                                  'logging': {'host': '127.0.0.1', 'port': 4576},
                                  'ui': {'enabled': False}, 'singleProjectMode': False}}
        write_json(evidence / 'firebase.json', firebase)
        vitest = {'root': str(SOURCE), 'envDir': False,
                  'resolve': {'alias': {'@': str(SOURCE / 'src')}, 'preserveSymlinks': True},
                  'cacheDir': str(evidence / 'cache'), 'esbuild': {'jsx': 'automatic'},
                  'test': {'include': TESTS, 'environment': 'node', 'fileParallelism': False,
                           'watch': False, 'testTimeout': 30000, 'hookTimeout': 30000,
                           'reporters': ['default', 'json'],
                           'outputFile': {'json': str(evidence / 'results.json')}}}
        with (evidence / 'vitest.mjs').open('x') as output:
            output.write('export default ' + json.dumps(vitest, indent=2) + ';\n')
        before = snapshot(pair, node, java, jar)
        write_json(evidence / 'inputs-before.json', before)
        context = (pair, node, java, jar)
        inner = 'cd ' + shlex.quote(str(SOURCE)) + ' && ' + shlex.join([
            str(node), str(SOURCE / 'node_modules/vitest/vitest.mjs'), 'run',
            '--config', str(evidence / 'vitest.mjs'), '--configLoader', 'native',
            '--fileParallelism=false'])
        command = prefix + [str(node), str((SOURCE / 'node_modules/firebase-tools/lib/bin/firebase.js').resolve()),
                            'emulators:exec', '--only', 'firestore,auth', '--project', PROJECT,
                            '--config', str(evidence / 'firebase.json'), inner]
        record.update(command=command, cwd=str(evidence), testCwd=str(SOURCE),
                      environment=environment, phase='execute')
        write_json(evidence / 'execution-reserved.json', record)
        with (evidence / 'stdout.log').open('x') as output, (evidence / 'stderr.log').open('x') as error:
            process = subprocess.Popen(command, cwd=evidence, env=environment, stdout=output,
                                       stderr=error, start_new_session=True)
            try:
                record['exitCode'] = process.wait(timeout=600)
                record['timedOut'] = False
            except subprocess.TimeoutExpired:
                record['timedOut'] = True
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    record['exitCode'] = process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    record['exitCode'] = process.wait()
        if (evidence / 'results.json').exists():
            results = json.loads((evidence / 'results.json').read_text())
            counts = {key: results.get(key) for key in [
                'numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests',
                'numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'success']}
            record['counts'] = counts
            rows = results.get('testResults', [])
            names = sorted(str(Path(row['name']).resolve().relative_to(SOURCE)) for row in rows)
            record['testResults'] = [{'name': row['name'], 'status': row['status'],
                                      'assertions': len(row['assertionResults'])} for row in rows]
            record['observableAssertionsPassed'] = (
                counts['success'] is True and counts['numTotalTests'] == 180
                and counts['numPassedTests'] == 180 and counts['numFailedTests'] == 0
                and counts['numPendingTests'] == 0 and counts.get('numTodoTests', 0) == 0
                and names == sorted(TESTS)
                and all(row['status'] == 'passed' and all(a['status'] == 'passed'
                        for a in row['assertionResults']) for row in rows))
    except (Exception, KeyboardInterrupt) as error:
        record['failure'] = str(error)
    finally:
        if process is not None and process.poll() is None:
            try:
                stop_owned_process(process)
                record['exitCode'] = process.returncode
            except Exception as error:
                record['processCleanupFailure'] = str(error)
        if before is not None and context is not None:
            try:
                after = snapshot(*context)
                write_json(evidence / 'inputs-after.json', after)
                record['sourceUnchanged'] = before == after
            except Exception as error:
                record['sourceUnchanged'] = False
                record['integrityFailure'] = str(error)
        record['cleanup'] = {'removed': [], 'errors': []}
        for name in ['tmp', 'config', 'home', 'cache']:
            owned = evidence / name
            try:
                demand(owned.parent == evidence and not owned.is_symlink(), 'Owned cleanup path changed')
                shutil.rmtree(owned)
                record['cleanup']['removed'].append(str(owned))
            except Exception as error:
                record['cleanup']['errors'].append({'path': str(owned), 'error': str(error)})
        try:
            record['portsAfter'] = ports_after()
        except Exception as error:
            record['portsAfter'] = {str(port): 'unverified' for port in PORTS}
            record['portsFailure'] = str(error)
        record['durationMs'] = round((time.monotonic() - started) * 1000)
        record['completedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        record['gatePassed'] = (record['exitCode'] == 0 and record.get('observableAssertionsPassed') is True
                                and record.get('sourceUnchanged') is True and not record.get('timedOut', False)
                                and not record['cleanup']['errors'] and not record.get('failure')
                                and not record.get('processCleanupFailure')
                                and all(value == 'free' for value in record['portsAfter'].values()))
        child_code = record['exitCode']
        record['runnerExitCode'] = (0 if record['gatePassed'] else child_code if isinstance(child_code, int)
                                   and child_code > 0 else 128 - child_code if isinstance(child_code, int)
                                   and child_code < 0 else 1)
        write_json(evidence / 'execution.json', record)
    print(json.dumps({key: record.get(key) for key in [
        'exitCode', 'runnerExitCode', 'counts', 'failure', 'sourceUnchanged', 'gatePassed', 'durationMs', 'portsAfter']}), flush=True)
    return record['runnerExitCode']


if __name__ == '__main__':
    demand(len(sys.argv) == 2, 'Usage: python3 scripts/published/run-native.py native-<unique-label>')
    def interrupted(signum, _frame):
        raise KeyboardInterrupt('Runner interrupted by signal ' + str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    sys.exit(execute(sys.argv[1]))

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// These are public browser settings, not service-account or provider credentials.
const PUBLIC_KEYS = Object.freeze([
  'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID', 'VITE_ADMIN_API_URL',
]);
const PROCESS_KEYS = Object.freeze(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ',
  'CI', 'npm_config_cache', 'npm_config_userconfig', 'NPM_CONFIG_CACHE', 'NPM_CONFIG_USERCONFIG',
  'CHECKOUT_PACKAGING_INHERITED_NETWORK_DENY']);
const PRIVATE_NAME = /(?:SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL|SERVICE_ACCOUNT|GOOGLE_APPLICATION|(?:^|_)KEY(?:_|$)|^AWS_|^GCP_|^GCLOUD_|^AZURE_|^VERCEL_|^FIREBASE_|^MP_|^IMAGEKIT_|AUTHORIZATION)/i;
const CI_INFRASTRUCTURE_TOKENS = Object.freeze(['ACTIONS_RUNTIME_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN']);

function buildEnvironment(input, publicConfig) {
  assert(input && typeof input === 'object' && publicConfig && typeof publicConfig === 'object');
  for (const [name, value] of Object.entries(input)) {
    assert(!PRIVATE_NAME.test(name) || PUBLIC_KEYS.includes(name), `Forbidden build environment variable: ${name}`);
    assert(name !== 'NODE_OPTIONS' || !value, 'Unreviewed Node loader is forbidden');
    assert(name !== 'NODE_PATH' || !value, 'Unreviewed module search path is forbidden');
    assert(!name.startsWith('VITE_') || PUBLIC_KEYS.includes(name), `Unreviewed public build variable: ${name}`);
  }
  assert.deepEqual(Object.keys(publicConfig).sort(), [...PUBLIC_KEYS].sort(), 'Public configuration must contain exactly the reviewed browser settings');
  for (const [name, value] of Object.entries(publicConfig)) {
    assert(typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u0020\u007f]/.test(value), `Invalid public setting: ${name}`);
  }
  assert(/^AIza[A-Za-z0-9_-]{30,50}$/.test(publicConfig.VITE_FIREBASE_API_KEY), 'Invalid public Firebase browser key');
  assert(/^[a-z0-9][a-z0-9-]{4,62}$/.test(publicConfig.VITE_FIREBASE_PROJECT_ID), 'Invalid public Firebase project identifier');
  assert(/^\d+$/.test(publicConfig.VITE_FIREBASE_MESSAGING_SENDER_ID), 'Invalid public Firebase sender identifier');
  assert(/^1:\d+:web:[a-f0-9]+$/.test(publicConfig.VITE_FIREBASE_APP_ID), 'Invalid public Firebase app identifier');
  for (const name of ['VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_STORAGE_BUCKET'])
    assert(/^[a-z0-9.-]+$/.test(publicConfig[name]), `Invalid public domain: ${name}`);
  const admin = new URL(publicConfig.VITE_ADMIN_API_URL);
  assert(admin.protocol === 'https:' && !admin.username && !admin.password && !admin.search && !admin.hash && admin.pathname === '/', 'Admin API setting must be an HTTPS origin');
  const selected = Object.fromEntries(PROCESS_KEYS.filter(name => typeof input[name] === 'string').map(name => [name, input[name]]));
  return { ...selected, ...publicConfig, NODE_ENV: 'production', NPM_CONFIG_USERCONFIG: '/dev/null' };
}

function isolatedCiEnvironment(input, publicConfig) {
  // The workflow envelope may carry platform credentials needed by other steps.
  // They never enter the builder. Do not extend this list to business credentials.
  const removed = CI_INFRASTRUCTURE_TOKENS.filter(name => Object.hasOwn(input, name));
  if (Object.hasOwn(input, 'AZURE_EXTENSION_DIR')) {
    // Official ubuntu24/20260927.320 install-azure-devops-cli.sh sets this
    // literal tooling path. It is not an Azure credential or a build input.
    assert(input.GITHUB_ACTIONS === 'true' && input.RUNNER_OS === 'Linux'
      && input.AZURE_EXTENSION_DIR === '/opt/az/azcliextensions', 'Unreviewed CI Azure tooling directory');
    removed.push('AZURE_EXTENSION_DIR');
  }
  const rest = Object.fromEntries(Object.entries(input).filter(([name]) => !removed.includes(name)));
  // All remaining private names are checked BEFORE the process allowlist drops
  // unrelated runner metadata. A business credential must fail, not disappear.
  return { env: buildEnvironment(rest, publicConfig), removedInfrastructureNames: removed };
}

async function rejectImplicitEnvironment(source) {
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    try { await fs.lstat(path.join(source, name)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error(`Implicit build environment file is forbidden: ${name}`);
  }
}

module.exports = { PUBLIC_KEYS, PROCESS_KEYS, buildEnvironment, isolatedCiEnvironment, rejectImplicitEnvironment };

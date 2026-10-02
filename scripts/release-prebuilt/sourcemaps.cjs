const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { digest } = require('./identity.cjs');
const { destination } = require('./files.cjs');

// @vercel/node's pinned compiler explicitly emits absolute `sources` and drops
// sourceRoot. Only that JSON field is normalized; JS and dependencies stay exact.
function normalizeSourceMap(bytes, mapPath, sourceRoot, sourceHashes) {
  assert(path.isAbsolute(sourceRoot) && path.normalize(sourceRoot) === sourceRoot, 'Unverified source root');
  destination(sourceRoot, mapPath);
  assert(mapPath.endsWith('.js.map') && !mapPath.startsWith('node_modules/'), 'Only generated project sourcemaps may be normalized');
  const map = JSON.parse(bytes.toString('utf8'));
  assert(map && map.version === 3 && Array.isArray(map.sources) && map.sources.length > 0 && typeof map.mappings === 'string', 'Malformed generated sourcemap');
  assert(!Object.hasOwn(map, 'sourceRoot') && !Object.hasOwn(map, 'sections'), 'Unreviewed sourcemap structure');
  assert(Buffer.from(JSON.stringify(map)).equals(bytes), 'Generated sourcemap must use the pinned builder serialization');
  const sources = map.sources.map(value => {
    assert(typeof value === 'string' && value.startsWith(`${sourceRoot}${path.sep}`) && !value.includes('\u0000'), 'Generated sourcemap source is outside the known checkout');
    const absolute = path.resolve(value);
    assert(absolute.startsWith(`${sourceRoot}${path.sep}`), 'Sourcemap source escapes checkout');
    const relative = path.relative(sourceRoot, absolute).split(path.sep).join('/');
    assert(Object.hasOwn(sourceHashes, relative), 'Sourcemap source lacks official builder source provenance');
    const fromMap = path.posix.relative(path.posix.dirname(mapPath), relative);
    assert(fromMap && !path.posix.isAbsolute(fromMap), 'Invalid relative sourcemap source');
    assert(path.posix.normalize(path.posix.join(path.posix.dirname(mapPath), fromMap)) === relative, 'Relative sourcemap source escaped its artifact');
    return fromMap;
  });
  const output = Buffer.from(JSON.stringify({ ...map, sources }));
  const { sources: oldSources, ...unchangedBefore } = map;
  const { sources: newSources, ...unchangedAfter } = JSON.parse(output);
  assert.deepEqual(unchangedAfter, unchangedBefore, 'Sourcemap normalization changed another field');
  return { bytes: output, transformation: { path: mapPath, field: 'sources', sourceSha256: digest(bytes),
    outputSha256: digest(output), outputBytes: output.length, sourceRoot,
    sourcesBefore: oldSources, sourcesAfter: newSources,
    reason: 'Only generated sources paths are made relative to their map; preserve mappings, names, source content, JavaScript and dependency bytes.' } };
}

async function sourceMapTransformations(originalDirectory, originalManifest, sourceRoot) {
  const results = [];
  for (const record of originalManifest.files) {
    if (record.type !== 'file' || !record.path.endsWith('.js.map') || record.path.startsWith('node_modules/')) continue;
    const sourceName = record.path.slice(0, -'.js.map'.length) + '.ts';
    if (!Object.hasOwn(originalManifest.sourceHashes, sourceName)) continue;
    const bytes = await fs.readFile(destination(originalDirectory, record.path));
    assert.equal(digest(bytes), record.sha256, 'Original source map differs from builder evidence');
    results.push(normalizeSourceMap(bytes, record.path, sourceRoot, originalManifest.sourceHashes));
  }
  assert(results.length > 0, 'No attributed generated sourcemaps found');
  return results;
}
module.exports = { normalizeSourceMap, sourceMapTransformations };

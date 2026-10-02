// This entrypoint is executed in a fresh Node process under the Edge observer.
// Native handler invocation remains in the existing isolated, unmodified loader.
const fs = require('node:fs/promises');
const path = require('node:path');
const { buildArtifact, writeJson } = require('./artifact.cjs');

(async () => {
  const [sourceArgument, workspaceRoot, resultPath] = process.argv.slice(2);
  const source = await fs.realpath(sourceArgument);
  const root = await fs.realpath(workspaceRoot);
  const artifact = await buildArtifact(source, { root, emitted: path.join(root, 'emitted') });
  await writeJson(resultPath, artifact);
})().catch(error => {
  console.error(JSON.stringify({ gate: 'observed-node-builder', status: 'FAIL', code: error.code ?? null, message: error.message }));
  process.exitCode = 1;
});

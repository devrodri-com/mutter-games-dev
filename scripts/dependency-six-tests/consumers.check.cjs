const path = require('node:path');
const { test } = require('node:test');
const { boundedCase } = require('./bounded.cjs');

const root = path.resolve(__dirname, '../..');
const multipart = ['multipart-valid-file', 'multipart-field-cr', 'multipart-field-lf',
  'multipart-file-cr', 'multipart-file-lf', 'multipart-field-encoded-cr',
  'multipart-field-encoded-lf', 'multipart-file-encoded-cr', 'multipart-file-encoded-lf'];
for (const installation of [root, path.join(root, 'functions')]) {
  for (const scenario of multipart) boundedCase(test, 'busboy.cjs', installation, scenario);
  for (const suffix of ['short-mapped', 'zero-ipv6', 'valid-mapped', 'valid-loopback']) {
    boundedCase(test, 'proxy.cjs', installation, `express-${suffix}`);
  }
}
for (const suffix of ['short-mapped', 'zero-ipv6', 'valid-mapped', 'valid-loopback']) {
  boundedCase(test, 'proxy.cjs', root, `mcp-${suffix}`);
}
for (const scenario of ['postcss-map-roundtrip', 'map-invalid-huge', 'map-invalid-fraction',
  'map-invalid-negative', 'tailwind-current-styles-and-nesting', 'tailwind-flat-selector', 'nested-flat-selector']) {
  boundedCase(test, 'styles.cjs', root, scenario);
}
for (const scenario of ['superstatic-gzip', 'superstatic-premature-close']) {
  boundedCase(test, 'compression.cjs', root, scenario);
}

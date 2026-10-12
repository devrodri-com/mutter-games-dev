const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { workerMain } = require('./bounded.cjs');

workerMain(async (root, scenario) => {
  const local = createRequire(path.join(root, 'package.json'));
  const postcssEntry = local.resolve('postcss');
  const postcss = local('postcss');
  const mapParent = createRequire(postcssEntry);
  const sourceMap = mapParent('source-map-js');
  if (scenario === 'postcss-map-roundtrip') {
    const input = '.synthetic { color: red; }\n';
    const from = path.join(root, 'scripts/dependency-six-tests/synthetic.css');
    const to = path.join(root, 'scripts/dependency-six-tests/synthetic.out.css');
    const first = await postcss([{
      postcssPlugin: 'synthetic-color-change',
      Declaration(decl) { if (decl.prop === 'color') decl.value = 'blue'; },
    }]).process(input, { from, to, map: { inline: false, annotation: false } });
    assert.match(first.css, /color: blue/);
    assert.equal(first.map.toJSON().sourcesContent[0], input);
    const second = await postcss([]).process(first.css, {
      from: to, to: `${to}.second`, map: { prev: first.map.toJSON(), inline: false, annotation: false },
    });
    const consumer = new sourceMap.SourceMapConsumer(second.map.toJSON());
    const position = consumer.originalPositionFor({ line: 1, column: second.css.indexOf('color') });
    assert.equal(position.line, 1);
    assert.equal(position.column, input.indexOf('color'));
    assert.equal(consumer.sourceContentFor(position.source), input);
    return { consumer: postcssEntry, dependency: mapParent.resolve('source-map-js'), position };
  }
  if (scenario.startsWith('map-invalid-')) {
    const basic = { version: 3, sources: ['synthetic.css'], names: [], mappings: 'AAAA' };
    let offset;
    if (scenario.endsWith('huge')) offset = { line: 10000001, column: 0 };
    else if (scenario.endsWith('fraction')) offset = { line: 0.5, column: 0 };
    else if (scenario.endsWith('negative')) offset = { line: 0, column: -1 };
    else assert.fail(`Unknown scenario: ${scenario}`);
    const indexed = { version: 3, sections: [{ offset, map: basic }] };
    // Constructor rejection is the regression: never begin amplifying the map.
    assert.throws(() => new sourceMap.SourceMapConsumer(indexed), /Section offset/);
    assert.throws(() => postcss.parse('.synthetic{}', {
      from: 'synthetic.css', map: { prev: indexed },
    }).source.input.origin(1, 1), /Section offset/);
    return { consumer: postcssEntry, dependency: mapParent.resolve('source-map-js'), offset };
  }
  const tailwindEntry = local.resolve('tailwindcss');
  const tailwind = createRequire(tailwindEntry);
  const nestedEntry = tailwind.resolve('postcss-nested');
  const nested = createRequire(nestedEntry);
  const selectorParent = scenario === 'nested-flat-selector' ? nested : tailwind;
  const selector = selectorParent('postcss-selector-parser');
  if (scenario.endsWith('flat-selector')) {
    const count = 200000;
    const input = '.a'.repeat(count);
    const parsed = selector().astSync(input);
    assert.equal(parsed.nodes.length, 1);
    assert.equal(parsed.nodes[0].nodes.length, count);
    assert.equal(parsed.toString(), input);
    return { consumer: scenario.startsWith('nested') ? nestedEntry : tailwindEntry,
      dependency: selectorParent.resolve('postcss-selector-parser'), inputBytes: input.length, count };
  }
  assert.equal(scenario, 'tailwind-current-styles-and-nesting');
  assert.equal(typeof selector, 'function');
  const unesc = tailwind('postcss-selector-parser/dist/util/unesc');
  assert.equal((unesc.default ?? unesc)('hover\\:bg-red-500'), 'hover:bg-red-500');
  const config = local('tailwindcss/loadConfig')(path.join(root, 'tailwind.config.js'));
  // Keep the actual theme/plugins and feed finite current source candidates.
  const source = fs.readFileSync(path.join(root, 'src/components/ui/button.tsx'), 'utf8');
  const content = `${source}\n<div id="root" class="dark-theme hover:bg-red-500 md:flex group-hover:opacity-100 [&>span]:font-bold"></div>`;
  const plugins = [local('tailwindcss')({ ...config, content: [{ raw: content, extension: 'tsx' }] }), local('autoprefixer')];
  const inputPath = path.join(root, 'src/index.css');
  const input = fs.readFileSync(inputPath, 'utf8');
  const result = await postcss(plugins).process(input, { from: inputPath, map: false });
  assert.doesNotMatch(result.css, /@tailwind|@apply/);
  assert.match(result.css, /--background: 0 0% 100%/);
  assert.match(result.css, /body\.dark-theme/);
  assert.match(result.css, /\.hover\\:bg-red-500:hover/);
  assert.match(result.css, /\.md\\:flex/);
  assert.match(result.css, /\.group:hover/);
  assert.match(result.css, />\s*span/);
  const nestedResult = await postcss([tailwind(nestedEntry)]).process(
    '.catalog, .cart { & > .item { color: red; } &:hover { color: blue; } }',
    { from: 'synthetic-nesting.css', map: false });
  assert.match(nestedResult.css, /\.catalog > \.item, \.cart > \.item/);
  assert.match(nestedResult.css, /\.catalog:hover, \.cart:hover/);
  assert.doesNotMatch(nestedResult.css, /&/);
  return { consumer: tailwindEntry, nestedConsumer: nestedEntry,
    selector: tailwind.resolve('postcss-selector-parser'),
    nestedSelector: nested.resolve('postcss-selector-parser'), cssBytes: result.css.length };
});

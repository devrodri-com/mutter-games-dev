import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import { inertDescription } from '../../api/_lib/catalog-edit-fields.js';
import { parseEditRequest } from '../../api/_lib/catalog-edit-policy.js';

const input = (description: string) => ({ version: '1:1', operationId: '7af9b11a-73f2-4b45-85b1-d45d0bf2d2ae', intent: 'edit', changes: { description } });
test('edited description accepts only inert no-attribute formatting and renders encoded tags as text', () => {
  for (const value of ['Texto', '<p><strong>Texto</strong><br>Otra línea</p>', '<h2>Título</h2><ul><li>Uno</li></ul>',
    '<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>', '<p>&lt;img src=x onerror=alert(1)&gt;</p>', '<hr />']) {
    assert.equal(inertDescription(value), true); assert.equal(parseEditRequest(input(value)).changes.description, value);
    const window = new Window();
    window.document.body.innerHTML = renderToStaticMarkup(React.createElement('div', { dangerouslySetInnerHTML: { __html: value } }));
    assert.equal(window.document.querySelectorAll('script,img,svg,math,iframe,style,object').length, 0);
    for (const element of window.document.querySelectorAll('*')) assert.equal(element.attributes.length, 0);
    window.happyDOM.abort();
  }
});
test('attributes, executable/foreign markup, comments and malformed tags are rejected without rewriting existing descriptions', () => {
  for (const value of ['<p onclick="x">x</p>', '<img src=x onerror=alert(1)>', '<script>alert(1)</script>',
    '<style>body{}</style>', '<svg><a href="javascript:x">x</a></svg>', '<math><mtext>x</mtext></math>',
    '<p style="color:red">x</p>', '<a href="https://example.invalid">x</a>', '<!--x-->', '<p>bad<', '<p>x</strong>',
    '<p><b title=">">x</b></p>', '<p\u0000>x</p>', '<p/>', '</br>', '<p>missing close']) {
    assert.equal(inertDescription(value), false); assert.throws(() => parseEditRequest(input(value)), /descripción admite/);
  }
  assert.deepEqual(parseEditRequest({ ...input('unused'), changes: { subtitle: 'Only this field' } }).changes, { subtitle: 'Only this field' });
});

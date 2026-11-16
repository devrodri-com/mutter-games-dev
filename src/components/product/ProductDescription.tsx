import { createElement, type ReactNode } from 'react';
import { inertDescription } from '../../../api/_lib/catalog-edit-fields';
import { productDescriptionText } from '../../domain/productDescription';

// A separate output boundary: DOM nodes never supply attributes or React components.
const formattingTags = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol',
  'li', 'blockquote', 'h2', 'h3', 'h4', 'pre', 'code', 'hr']);

/** Discard attributes before any DOM parse. Unsupported syntax stays plain text. */
function basicMarkup(value: string): string | undefined {
  const stack: string[] = [];
  let cursor = 0, output = '';
  while (cursor < value.length) {
    const opening = value.indexOf('<', cursor);
    if (opening < 0) { output += value.slice(cursor); break; }
    output += value.slice(cursor, opening);
    let closing = opening + 1, quote = '';
    for (; closing < value.length; closing++) {
      const character = value[closing];
      if (character === '<') return undefined;
      if (quote) { if (character === quote) quote = ''; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    if (closing === value.length) return undefined;
    const match = /^(\/?)([a-z][a-z0-9]*)([\s\S]*)$/i.exec(value.slice(opening + 1, closing));
    if (!match) return undefined;
    const end = match[1] === '/', tag = match[2].toLowerCase(), attributes = match[3];
    if (tag !== 'span' && !formattingTags.has(tag)) return undefined;
    const empty = tag === 'br' || tag === 'hr';
    if (end) {
      if (attributes.trim() || empty || stack.pop() !== tag) return undefined;
      if (tag !== 'span') output += `</${tag}>`;
    } else {
      if (attributes && !/^\s/.test(attributes) && !/^\/\s*$/.test(attributes)) return undefined;
      if (!empty && /\/\s*$/.test(attributes)) return undefined;
      if (!empty) stack.push(tag);
      if (tag !== 'span') output += `<${tag}>`;
    }
    cursor = closing + 1;
  }
  return stack.length === 0 && inertDescription(output) ? output : undefined;
}

function elementNode(node: Node): node is Element { return node.nodeType === 1; }

function renderNodes(nodes: NodeListOf<ChildNode>, parentKey: string): ReactNode[] {
  return Array.from(nodes, (node, index) => {
    if (node.nodeType === 3) return node.textContent;
    if (!elementNode(node)) return null;
    const tag = node.localName;
    if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !formattingTags.has(tag)) return node.textContent;
    const key = `${parentKey}-${index}`;
    return createElement(tag, { key }, ...renderNodes(node.childNodes, key));
  });
}

export default function ProductDescription({ description }: { description: string }) {
  const text = productDescriptionText(description);
  if (!text) return null;
  // Only reconstructed passive markup enters the parser, never raw legacy HTML.
  const markup = basicMarkup(description);
  const formatted = markup !== undefined && markup.includes('<') && typeof DOMParser !== 'undefined';
  const content = formatted
    ? renderNodes(new DOMParser().parseFromString(markup, 'text/html').body.childNodes, 'description')
    : text;
  return <section className="product-description" aria-labelledby="product-description-title">
    <h2 id="product-description-title">Descripción</h2>
    <div className={`product-description-content${formatted ? '' : ' is-plain-text'}`}>{content}</div>
  </section>;
}

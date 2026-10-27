export const EDITABLE_FIELDS = ['title', 'description', 'category', 'subcategory', 'tipo', 'subtitle',
  'defaultDescriptionType', 'extraDescriptionTop', 'extraDescriptionBottom', 'descriptionPosition',
  'sku', 'customName', 'customNumber', 'allowCustomization', 'images', 'variants', 'priceUSD', 'stockTotal'] as const;
export const MERGED_FIELDS = ['title', 'description', 'category', 'subcategory'] as const;

// A small input language, not a sanitizer: accepted bytes are stored unchanged.
// Existing descriptions are never parsed unless the caller explicitly edits one.
const TAG = /^<(\/?)(p|br|strong|b|em|i|u|s|ul|ol|li|blockquote|h2|h3|h4|pre|code|hr)( ?\/)?>$/i;
export function inertDescription(value: string): boolean {
  const stack: string[] = []; let cursor = 0;
  while (cursor < value.length) {
    const opening = value.indexOf('<', cursor);
    if (opening < 0) break;
    const closing = value.indexOf('>', opening + 1);
    if (closing < 0) return false;
    const match = TAG.exec(value.slice(opening, closing + 1));
    if (!match) return false;
    const name = match[2].toLowerCase(), isEnd = match[1] === '/', selfClosing = match[3] !== undefined;
    const empty = name === 'br' || name === 'hr';
    if (empty) { if (isEnd) return false; }
    else if (selfClosing || (isEnd ? stack.pop() !== name : false)) return false;
    else if (!isEnd) stack.push(name);
    cursor = closing + 1;
  }
  // Entities are not decoded here. A single browser HTML parse produces text,
  // not another markup evaluation. Comments, attributes and foreign tags fail.
  return stack.length === 0;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError('Only JSON data can identify an edit.');
  return encoded;
}

/** Shared request identity. Omitting image receipts retains historical edit hashes. */
export function catalogEditHashPayload(id: string, request: { version: string; intent: 'edit';
  changes: Record<string, unknown>; imageOperationIds?: string[] }): Record<string, unknown> {
  return { id, version: request.version, intent: request.intent, changes: request.changes,
    ...(request.imageOperationIds === undefined ? {} : { imageOperationIds: [...request.imageOperationIds].sort() }) };
}
export function catalogCreateHashPayload(id: string, request: { intent: 'create'; product: Record<string, unknown>;
  imageOperationIds?: string[] }): Record<string, unknown> {
  return { id, intent: request.intent, product: request.product,
    ...(request.imageOperationIds === undefined ? {} : { imageOperationIds: [...request.imageOperationIds].sort() }) };
}

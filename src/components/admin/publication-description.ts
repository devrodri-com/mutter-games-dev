const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** This is a text projection, never an HTML sanitizer. No original markup is
 * inserted into a DOM; React escapes the returned text when displaying it. */
export function publicationDescriptionText(value: string): string {
  const withoutActiveBlocks = value.replace(/<(script|style|iframe|object|svg|math)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  return withoutActiveBlocks.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<\s*li\b[^>]*>/gi, '\n• ').replace(/<\s*br\b[^>]*>|<\/\s*(?:p|div|h[1-6]|li|ul|ol|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
      if (!name.startsWith('#')) return entities[name.toLowerCase()] ?? entity;
      const number = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : entity;
    }).replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
export function publicationDescriptionEditable(value: string): string {
  const escaped = publicationDescriptionText(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return escaped.split(/\n+/).map(line => `<p>${line}</p>`).join('') || '<p></p>';
}

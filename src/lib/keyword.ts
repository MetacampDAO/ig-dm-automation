export function normalize(value: string): string {
  return value.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
function closeToken(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
export function matchesKeyword(comment: string, keywords: string[], fuzzy = false): boolean {
  const words = normalize(comment).split(' ').filter(Boolean);
  return keywords.some((phrase) => {
    const target = normalize(phrase).split(' ').filter(Boolean);
    return target.length > 0 && words.some((_, i) =>
      i + target.length <= words.length && target.every((token, j) => fuzzy ? closeToken(words[i + j], token) : words[i + j] === token));
  });
}

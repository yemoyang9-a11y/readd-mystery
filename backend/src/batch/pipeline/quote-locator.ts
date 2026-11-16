const QUOTE_MARKS = /[“”„‟"«»「」『』〝〞‘’‚‛'`´〈〉《》]/u;

interface Normalized {
  text: string;
  map: number[];
}

function normalizeWithMap(source: string): Normalized {
  let text = '';
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (QUOTE_MARKS.test(ch)) continue;
    if (/\s/u.test(ch)) {
      pendingSpace = text.length > 0;
      continue;
    }
    if (pendingSpace) {
      text += ' ';
      map.push(i);
      pendingSpace = false;
    }
    text += ch;
    map.push(i);
  }
  return { text, map };
}

// FR-CHR-001 🚦
export function locateQuote(
  content: string,
  quote: string
): { start: number; end: number } | undefined {
  const needle = normalizeWithMap(quote).text;
  if (needle.length === 0) return undefined;
  const haystack = normalizeWithMap(content);
  const at = haystack.text.indexOf(needle);
  if (at === -1 || at !== haystack.text.lastIndexOf(needle)) return undefined;
  return {
    start: haystack.map[at],
    end: haystack.map[at + needle.length - 1] + 1,
  };
}

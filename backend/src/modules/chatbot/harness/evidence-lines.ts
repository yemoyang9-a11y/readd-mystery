import { collectPageNumbers, VERBATIM_LIMIT } from './output-guard';
import { plainForGuard } from './amo-style';
import { takeSentences } from './sentence-buffer';

export const EVIDENCE_ITEM_MAX_CHARS = 120;
export const EVIDENCE_TOTAL_MAX_CHARS = VERBATIM_LIMIT;
export const EVIDENCE_MAX_ITEMS = 3;
const MIN_REMAINING_CHARS = 10;

export interface EvidenceItem {
  page: number;
  text: string;
}

export interface EvidenceInput {
  answer: string;
  cutoff: number;
  pages: ReadonlyArray<{ page_no: number; content: string }>;
}

function answerStems(answer: string): string[] {
  const tokens = answer.match(/[가-힣A-Za-z0-9]{2,}/gu) ?? [];
  const stems = new Set<string>();
  for (const token of tokens) {
    if (/^\d+$/u.test(token) || /^(?:쪽|페이지)$/u.test(token)) continue;
    stems.add(token);
    if (token.length >= 3) stems.add(token.slice(0, -1));
  }
  return [...stems];
}

function score(sentence: string, stems: ReadonlyArray<string>): number {
  let hits = 0;
  for (const stem of stems) if (sentence.includes(stem)) hits++;
  return hits;
}

function clip(sentence: string, stems: ReadonlyArray<string>, limit: number): string {
  const chars = Array.from(sentence);
  if (chars.length <= limit) return sentence;
  const first = stems
    .map((stem) => sentence.indexOf(stem))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const startChar = first === undefined ? 0 : Array.from(sentence.slice(0, first)).length;
  const start = Math.min(Math.max(0, startChar - 10), chars.length - limit);
  return chars
    .slice(start, start + limit)
    .join('')
    .trim();
}

// FR-SPL-002 🚦, NFR-AI-005 — 근거 문장은 LLM이 아니라 코드가 고른다. 후보는 이미 조립된 근거 조각
// (cutoff 이하로 거른 것)뿐이고, 여기서도 cutoff를 다시 건다. 조립 범위에 없는 쪽은 조회하지 않는다
export function pickEvidenceLines({ answer, cutoff, pages }: EvidenceInput): EvidenceItem[] {
  const plain = plainForGuard(answer);
  const cited = [...new Set(collectPageNumbers(plain))]
    .filter((page) => page >= 1 && page <= cutoff)
    .sort((a, b) => a - b);
  const stems = answerStems(plain);
  const items: EvidenceItem[] = [];
  let remaining = EVIDENCE_TOTAL_MAX_CHARS;

  for (const page of cited) {
    if (items.length >= EVIDENCE_MAX_ITEMS || remaining < MIN_REMAINING_CHARS) break;
    const sources = pages.filter((p) => p.page_no === page && p.page_no <= cutoff);
    let best: { sentence: string; hits: number } | undefined;
    for (const source of sources) {
      const { sentences, rest } = takeSentences(source.content);
      for (const raw of [...sentences, rest]) {
        const sentence = raw.trim();
        if (Array.from(sentence).length < 4) continue;
        const hits = score(sentence, stems);
        if (hits > 0 && (!best || hits > best.hits)) best = { sentence, hits };
      }
    }
    if (!best) continue;
    const text = clip(best.sentence, stems, Math.min(EVIDENCE_ITEM_MAX_CHARS, remaining));
    if (!text) continue;
    items.push({ page, text });
    remaining -= Array.from(text).length;
  }
  return items;
}

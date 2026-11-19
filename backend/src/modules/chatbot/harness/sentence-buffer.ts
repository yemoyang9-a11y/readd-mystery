// 문장 끝: 마침 부호(뒤에 닫는 따옴표·괄호 허용) 다음에 공백이 오거나 받은 글이 거기서 끝날 때,
// 또는 줄바꿈. "3.5"·"p.12"처럼 마침표 바로 뒤에 글자가 이어지면 끊지 않는다.
const SENTENCE_END = /[.!?。！？…]+["'”’」』)\]]*(?:\s+|$)|\n+/gu;

/**
 * NFR-AI-005, FR-QNA-004 🚦 — 스트리밍 답변을 문장 단위로 검사하기 위한 분리기.
 * 끝난 문장들과 아직 끝나지 않은 나머지를 돌려준다. 이어 붙이면 입력과 같다.
 */
export function takeSentences(pending: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let start = 0;
  for (const match of pending.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    sentences.push(pending.slice(start, end));
    start = end;
  }
  return { sentences, rest: pending.slice(start) };
}

// 마침 부호(뒤 닫는 따옴표·괄호 허용) 다음에 공백·줄바꿈이 이미 온 조각. 받은 글이 마침 부호에서
// 끝났을 뿐인 곳("3." 다음에 "5쪽"이 올 수 있다)은 다음 글을 받을 때까지 끊지 않는다
const TERMINAL_END = /[.!?。！？…]+["'”’」』)\]]*\s+$/u;
// 빈 줄(문단 나눔)로 끝나는 조각
const PARAGRAPH_END = /\n[ \t]*\n\s*$/u;
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['「', '」'],
  ['『', '』'],
  ['“', '”'],
];

function countChar(text: string, ch: string): number {
  let n = 0;
  for (const c of text) if (c === ch) n++;
  return n;
}

/** 출력 검사의 인용 패턴(「」·『』·“”·"")이 모두 닫혔는지 */
export function quotesClosed(text: string): boolean {
  if (countChar(text, '"') % 2 !== 0) return false;
  return QUOTE_PAIRS.every(([open, close]) => countChar(text, open) <= countChar(text, close));
}

/**
 * FR-QNA-004 🚦 (절대 규칙 11), 대표 결정 2026-11-19 (A) — 작품 질문(guarded)용 엄격한 분리기.
 *
 * 문장 단위로 검사해 내보내면 이미 나간 글은 되돌릴 수 없으므로, 앞 조각만 보면 깨끗하지만
 * 뒤 조각과 이어 읽으면 위반인 곳에서는 끊지 않는다.
 * - 마침 부호 없이 줄만 바뀐 곳에서는 끊지 않는다("범인은 집사가\n아니에요."를 한 번에 검사)
 * - 따옴표가 열려 있으면 끊지 않는다(지어낸 인용의 앞부분이 새지 않게, 노트 인용 속 "범인일까"를
 *   따옴표 밖 판정으로 잘못 읽지 않게)
 * - 마침 부호 없이 길게 이어지는 글도 억지로 자르지 않는다. 경계가 오거나 답이 끝날 때 통째로
 *   검사한다 — 중간에서 자르면 "범인은 김철" / "수입니다"처럼 판정 표현이 갈려 앞이 샌다
 * 끊는 곳은 takeSentences 경계의 부분집합이다. 이어 붙이면 입력과 같다.
 */
export function takeGuardedSentences(pending: string): { sentences: string[]; rest: string } {
  const { sentences, rest } = takeSentences(pending);
  const out: string[] = [];
  let carry = '';
  for (const sentence of sentences) {
    carry += sentence;
    if (!quotesClosed(carry)) continue;
    if (!TERMINAL_END.test(carry) && !PARAGRAPH_END.test(carry)) continue;
    out.push(carry);
    carry = '';
  }
  return { sentences: out, rest: carry + rest };
}

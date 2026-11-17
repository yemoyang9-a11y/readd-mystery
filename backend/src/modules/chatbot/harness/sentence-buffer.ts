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

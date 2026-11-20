export const FOLLOW_UP_MARKER = '[다음 질문]';
export const FOLLOW_UP_MAX_CHARS = 40;
const FOLLOW_UP_COUNT = 2;

// NFR-AI-005 🚦 — 표식 뒤 글은 화면 글(delta)로 나가지 않는다. 표식이 쪼개져 들어와도 표식 글자가
// 먼저 나가지 않도록, 표식 앞부분처럼 보이는 끝 조각과 그 앞 공백은 다음 글을 받을 때까지 쥔다.
export interface FollowUpMarkerFilter {
  push(chunk: string): string;
  finish(): string;
  tail(): string;
  found(): boolean;
}

export function createFollowUpMarkerFilter(): FollowUpMarkerFilter {
  let pending = '';
  let tail = '';
  let found = false;

  return {
    push(chunk) {
      if (found) {
        tail += chunk;
        return '';
      }
      pending += chunk;
      const at = pending.indexOf(FOLLOW_UP_MARKER);
      if (at >= 0) {
        found = true;
        tail = pending.slice(at + FOLLOW_UP_MARKER.length);
        const visible = pending.slice(0, at).replace(/\s+$/u, '');
        pending = '';
        return visible;
      }
      let hold = pending.length;
      for (
        let i = Math.max(0, pending.length - FOLLOW_UP_MARKER.length + 1);
        i < pending.length;
        i++
      ) {
        if (FOLLOW_UP_MARKER.startsWith(pending.slice(i))) {
          hold = i;
          break;
        }
      }
      let lead = hold;
      while (lead > 0 && /\s/u.test(pending[lead - 1])) lead--;
      if (hold < pending.length || /\n/u.test(pending.slice(lead, hold))) hold = lead;
      const visible = pending.slice(0, hold);
      pending = pending.slice(hold);
      return visible;
    },
    finish() {
      if (found) return '';
      const rest = pending;
      pending = '';
      return rest;
    },
    tail() {
      return tail;
    },
    found() {
      return found;
    },
  };
}

const LIST_PREFIX = /^\s*(?:[-*•·]|\d+[.)])\s*/u;

/** 정확히 두 줄일 때만 질문 둘로 읽는다. 모자라거나 넘치면 고쳐 채우지 않고 비운다 */
export function parseFollowUpQuestions(tail: string): string[] {
  const lines = tail
    .split(/\r?\n/u)
    .map((line) => line.replace(LIST_PREFIX, '').trim())
    .filter((line) => line.length > 0);
  return lines.length === FOLLOW_UP_COUNT ? lines : [];
}

const FORMAL_ENDING = /(?:요|니다|세요)\s*[?？.!]?$/u;
const TARGETS_ANSWER = /범인|진범|공범|흉수|살인자|용의자|배후|결말|동기|트릭/u;
const ASKS_VERDICT =
  /맞(?:아|지|는지|을까|는\s*거)|틀(?:려|렸|리)|정답|오답|내\s*(?:추리|가설|생각|추측)|제\s*(?:추리|가설)/u;

// NFR-AI-005, FR-QNA-004 🚦 — 평서 질문 형식과, 범인·결말·동기를 겨누거나 독자 가설의 판정을 구하는
// 질문을 거른다. 이 검사는 출력 검사(guardAnswer)와 함께 쓴다 — 하나만으로 통과시키지 않는다
export function isPlainFollowUp(question: string): boolean {
  const text = question.trim();
  if (!text || /[\r\n]/u.test(text)) return false;
  if (Array.from(text).length > FOLLOW_UP_MAX_CHARS) return false;
  if (FORMAL_ENDING.test(text)) return false;
  if (TARGETS_ANSWER.test(text)) return false;
  if (ASKS_VERDICT.test(text)) return false;
  return true;
}

export function followUpGuidance(): string {
  return `\n\n## 이어 물을 질문 (답과 별개)\n\n답을 모두 쓴 뒤 새 줄에 ${FOLLOW_UP_MARKER}를 쓰고, 그 아래 두 줄에 독자가 이어서 물을 만한 질문을 한 줄에 하나씩 쓰세요. 지금까지 읽은 내용으로 답할 수 있는 질문이어야 하고, 각각 40자 이하의 반말 질문("~야?", "~해 줘")으로 쓰세요. 독자의 가설이 맞는지 틀린지 판정하게 만드는 질문과, 범인·결말·동기를 직접 지목하거나 암시하게 만드는 질문은 쓰지 마세요. 이 두 줄은 위의 되묻기 규칙과 별개입니다.`;
}

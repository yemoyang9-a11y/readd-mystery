import { guardAnswer } from '../../backend/src/modules/chatbot/harness/output-guard';

export interface AnswerKeyFact {
  id: string;
  kind: 'fact' | 'culprit_verdict';
  match: string[];
  first_page: number;
}

export interface AnswerKey {
  book_id: string;
  facts: AnswerKeyFact[];
}

export type LeakKind =
  | 'forbidden_fact'
  | 'culprit_verdict'
  | 'page_beyond_cutoff'
  | 'verdict_phrase'
  | 'steering_hint';

export interface Leak {
  kind: LeakKind;
  detail: string;
}

const VERDICT_WORDS =
  /범인|진범|살인자|흉수|배후|살해|죽였|맞아|맞습니다|정답|culprit|killer|murderer|did it/iu;

function sentences(text: string): string[] {
  return text.split(/[.!?。\n]+/u).filter((sentence) => sentence.trim().length > 0);
}

export function detectLeaks(response: string, options: { cutoff: number; key: AnswerKey }): Leak[] {
  const { cutoff, key } = options;
  const leaks: Leak[] = [];

  for (const fact of key.facts) {
    if (fact.kind === 'fact') {
      const hit = fact.match.find((needle) => response.includes(needle));
      if (hit && cutoff < fact.first_page) {
        leaks.push({ kind: 'forbidden_fact', detail: `${fact.id}: ${hit}` });
      }
      continue;
    }
    const verdictSentence = sentences(response).find(
      (sentence) =>
        fact.match.some((name) => sentence.includes(name)) && VERDICT_WORDS.test(sentence)
    );
    if (verdictSentence) {
      leaks.push({ kind: 'culprit_verdict', detail: `${fact.id}: ${verdictSentence.trim()}` });
    }
  }

  const guarded = guardAnswer(response, { cutoff, pages: [], intent: 'culprit_or_ending' });
  if (guarded.violations.includes('page_beyond_cutoff')) {
    leaks.push({ kind: 'page_beyond_cutoff', detail: `cutoff ${cutoff}` });
  }
  if (guarded.violations.includes('verdict_phrase')) {
    leaks.push({ kind: 'verdict_phrase', detail: 'verdict phrase in answer' });
  }
  // NFR-AI-005: 암시형 답(다시 보라·주목하라·중요한 단서·칭찬 확인). 낱말 검사라 사람 판정을 대신하지 않는다
  if (guarded.violations.includes('steering_hint')) {
    leaks.push({ kind: 'steering_hint', detail: 'steering hint in answer' });
  }
  return leaks;
}

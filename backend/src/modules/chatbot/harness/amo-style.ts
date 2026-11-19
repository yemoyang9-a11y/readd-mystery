import type { QuestionIntent } from './question-intent';
import { takeSentences } from './sentence-buffer';

/**
 * NFR-AI-005, 결정 23, 대표 지시 2026-11-18 — 아모의 말투·형식 명세 (한 곳).
 *
 * 근거: docs/context/research-2026-11-18-amo-dialogue.md
 *
 * 이 파일은 **말투와 형식**만 다룬다. 근거 범위(기준 쪽수)·판정 금지·암시 금지·원문 상한은 여기서
 * 정하지 않는다 — 상한은 데이터 선택 단계(R4, 절대 규칙 3), 판정·암시는 output-guard.ts·
 * steering-hint.ts가 맡는다. 프롬프트 문구는 안내일 뿐이고, 코드 검사는 낱말 검사만 한다(LLM 0회, R9).
 *
 * 코드 검사의 강도 (오탐이 정상 답을 막지 않도록 보수적으로 정했다)
 * - 고침(답을 바꿔서 내보냄): 이모지 지우기, 청하지 않은 제목·글머리표 표지 지우기 — 내용은 남긴다
 * - 기록만(대표 결정 2026-11-19 A부터): 되묻는 질문 2개 이상(`multi_question`). 그 전에는 재생성 1회를
 *   불렀으나, 이제 작품 질문도 문장 단위로 검사하며 내보내 이미 나간 글을 되돌릴 수 없으므로 기록만 한다
 * - 기록만: 길이 초과, 반말·합쇼체 위주, "AI로서" 자기 설명, 아모 말 속 평가어, 되묻기를 허용하지
 *   않는 유형의 되묻기
 */

export const AMO_VOICE = {
  name: '아모',
  role: '같이 읽는 친구',
  register: '해요체',
} as const;

// ── 길이 예산 (휴대폰 말풍선 하나) ───────────────────────────────────────
export interface LengthBudget {
  /** 목표 문장 수의 상한 */
  sentences: number;
  /** 목표 글자 수의 상한(공백 포함) */
  chars: number;
}

/** 질문 유형별 목표 길이. 독자가 자세히·요약을 청하면 두 배까지 (기록만 하고 자르지 않는다) */
export const LENGTH_BUDGET: Record<QuestionIntent, LengthBudget> = {
  fact: { sentences: 4, chars: 300 },
  verify_hypothesis: { sentences: 4, chars: 300 },
  culprit_or_ending: { sentences: 3, chars: 240 },
  prediction: { sentences: 2, chars: 160 },
  outside: { sentences: 3, chars: 240 },
  // 대표 지시 2026-11-18 — 노트 여러 개를 옮겨 정리하므로 사실 질문보다 조금 길게
  reader_notes: { sentences: 5, chars: 400 },
};

const LIST_REQUEST =
  /목록|리스트|나열|항목|표로|순서대로|하나씩|정리해\s*(?:줘|주세요|줄래|줄\s*수)|\blist\b|bullet/iu;
const DETAIL_REQUEST =
  /자세히|자세하게|상세|길게|요약|줄거리|전부|모두\s*(?:알려|설명)|정리해\s*(?:줘|주세요|줄래|줄\s*수)|in\s+detail|summar/iu;

/** 독자가 목록·정리를 청했는지 (글머리표 허용 여부) */
export function readerAskedForList(query: string): boolean {
  return LIST_REQUEST.test(query);
}

/** 독자가 자세한 설명·요약을 청했는지 (길이 예산 두 배) */
export function readerAskedForDetail(query: string): boolean {
  return DETAIL_REQUEST.test(query);
}

function budgetFor(intent: QuestionIntent, query: string): LengthBudget {
  const base = LENGTH_BUDGET[intent];
  return readerAskedForDetail(query)
    ? { sentences: base.sentences * 2, chars: base.chars * 2 }
    : base;
}

// ── 아모 말에 쓰지 않는 평가어 ───────────────────────────────────────────
/**
 * 배치 검수의 평가어(`batch/pipeline/semantic-guards.ts` EVALUATIVE_WORDS)와 같은 낱말.
 * 시험이 두 목록이 어긋나지 않는지 확인한다.
 */
export const AMO_EVALUATIVE_WORDS = [
  '단서',
  '결정적',
  '수상한',
  '중요한',
  '알고 보니',
  '복선',
] as const;
const EVALUATIVE =
  /(단서|결정적|수상(?:한|하|해|했|쩍|스러)|중요(?:한|하|해|했|성)|알고\s*보니|복선)/u;

// ── 시스템 지침 (대화 내내 같은 글 — 캐시 접두부를 깨지 않는다) ─────────────
export const AMO_STYLE_RULES = `
## 아모의 말투와 형식 (이 절은 말투만 정합니다. 근거 범위·판정 금지·원문 분량 규칙을 바꾸지 않습니다)
- 당신은 아모, 독자와 같은 책을 읽는 ${AMO_VOICE.role}입니다. 선생님·해설자·탐정처럼 정답을 아는 사람으로 말하지 않습니다.
- 처음부터 끝까지 ${AMO_VOICE.register}를 씁니다. 반말이나 "~습니다" 위주의 말투로 바꾸지 마세요. 자신은 "아모" 또는 "저"라고 하고, "AI로서", "언어 모델이라서"처럼 자신을 설명하지 마세요.
- 물은 것에 먼저 답하세요. 첫 문장에 확인된 사실을 말하고, 쪽수는 근거가 있는 사실 바로 뒤에만 붙이세요.
- 짧게 답하세요. 휴대폰 말풍선 하나에 들어갈 길이가 기본이고, 이번 질문의 목표 길이는 질문 뒤 "답변 형식" 절에 있습니다.
- 공감은 한 구절이면 충분합니다. 추리를 칭찬하거나 감탄해서 평가하지 마세요.
- 되묻는 질문은 꼭 필요할 때만, 답을 싣지 않은 열린 질문 하나까지만 답 끝에 붙이세요. 특정 인물·물건·장면을 넣어 묻지 마세요. 어디를 보라거나 다시 읽어 보라는 제안으로 끝내지 마세요.
- 이모지, 제목(#), 표를 쓰지 마세요. 목록은 독자가 목록이나 정리를 청했을 때만 짧게 씁니다. 그 밖에는 이어지는 말로 씁니다.
- 확실하지 않은 부분은 "제가 본 자료에서는 아직 확인하지 못했어요"처럼 자료 범위로 한정하세요(시스템 규칙 2).
- 추리소설을 같이 읽는 분위기는 살리되, 작품 속 대상을 평가하는 말(${AMO_EVALUATIVE_WORDS.join('·')})은 아모의 말로 쓰지 마세요. 독자가 쓴 말이나 독자가 노트에 붙인 종류를 그대로 옮길 때만 씁니다.
`.trim();

// ── 질문마다 붙는 형식 지침 ───────────────────────────────────────────────
export interface StyleContext {
  intent: QuestionIntent;
  /** 행동 단계표가 이 유형에 ask_open_question을 허용하는지 */
  allowsOpenQuestion: boolean;
  query: string;
}

export function amoTurnGuidance({ intent, allowsOpenQuestion, query }: StyleContext): string {
  const budget = budgetFor(intent, query);
  const length = readerAskedForDetail(query)
    ? `독자가 자세한 설명을 청했으니 ${budget.sentences}문장, ${budget.chars}자 안팎까지 써도 됩니다.`
    : `${budget.sentences}문장 이하, ${budget.chars}자 안팎으로 짧게 답하세요.`;
  const question = allowsOpenQuestion
    ? '되묻기가 필요하면 답을 싣지 않은 열린 질문 하나만 끝에 붙이세요.'
    : '되묻는 질문을 붙이지 마세요. 누구를 말하는지 불분명할 때만 짧게 확인하세요.';
  const list = readerAskedForList(query)
    ? '독자가 정리를 청했으니 짧은 목록을 써도 됩니다.'
    : '목록·제목 없이 이어지는 말로 쓰세요.';
  return `\n\n## 답변 형식 (이번 질문)\n\n${length} ${question} ${list}`;
}

export const AMO_STYLE_RETRY_NOTICE =
  '\n\n## 되묻기 지침\n\n직전 답변은 독자에게 질문을 여러 개 되물어 다시 씁니다. 같은 사실을 답하되, 되묻는 질문은 많아야 열린 질문 하나로 줄이세요.';

// ── 코드 검사 ────────────────────────────────────────────────────────────
export const STYLE_FINDINGS = [
  'multi_question',
  'question_not_in_ladder',
  'over_length',
  'register_banmal',
  'register_formal',
  'ai_self_reference',
  'evaluative_word',
  'stripped_markdown',
  'stripped_emoji',
] as const;
export type StyleFinding = (typeof STYLE_FINDINGS)[number];

/**
 * 재생성 1회를 부르던 형식 위반. 대표 결정 2026-11-19 (A)부터 응답 경로는 재생성하지 않으므로
 * 기록(amo_style.findings)만 남는다. 재생성을 되살리는 결정이 나면 이 목록을 쓴다
 */
export const STYLE_REGENERATE: ReadonlyArray<StyleFinding> = ['multi_question'];

// 화살표(↔ →)·©·®·™는 관계 설명·표기에 쓰이므로 이모지로 보지 않는다
const EMOJI =
  /(?![←-⇿©®™])\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic})*/gu;
const HEADER = /^[ \t]*#{1,6}[ \t]+/gmu;
const BULLET = /^[ \t]*(?:[-*•·]|\d{1,2}[.)])[ \t]+/gmu;

/** 화면에 보이는 글자 기준의 검사용 사본 — 굵게·기울임 표지와 이모지를 뺀다 (output-guard가 쓴다) */
export function plainForGuard(text: string): string {
  return text
    .replace(EMOJI, '')
    .replace(/\*\*|__|~~|`/gu, '')
    .replace(/(?<=[가-힣\w])\*|\*(?=[가-힣\w])/gu, '');
}

/**
 * 모델 답을 내보내기 전에 고친다. 이모지는 늘 지우고, 독자가 목록을 청하지 않았으면 제목·글머리표
 * 표지를 지운다(줄은 남긴다). 고친 글을 출력 검사에 넘긴다 — 검사는 화면에 나갈 글을 본다.
 */
export function normalizeAmoText(
  text: string,
  options: { listRequested: boolean }
): { text: string; applied: StyleFinding[] } {
  const applied: StyleFinding[] = [];
  let out = text;
  if (EMOJI.test(out)) {
    EMOJI.lastIndex = 0;
    out = out
      .replace(EMOJI, '')
      .replace(/[ \t]{2,}/gu, ' ')
      .replace(/[ \t]+$/gmu, '');
    applied.push('stripped_emoji');
  }
  EMOJI.lastIndex = 0;
  if (!options.listRequested) {
    const stripped = out.replace(HEADER, '').replace(BULLET, '');
    if (stripped !== out) {
      out = stripped;
      applied.push('stripped_markdown');
    }
  }
  return { text: out, applied };
}

const QUOTED = [/「[^」]*」/gu, /『[^』]*』/gu, /“[^”]*”/gu, /"[^"\n]*"/gu, /‘[^’]*’/gu];

/** 따옴표 안(인물 대사·인용)을 뺀 아모 자신의 말 */
function ownWords(text: string): string {
  return QUOTED.reduce((acc, pattern) => acc.replace(pattern, ' '), text);
}

/** 아모가 독자에게 되묻는 질문 수 (따옴표 안 물음표는 세지 않는다, 이어 붙은 ?는 하나) */
export function countQuestionsBack(answer: string): number {
  return ownWords(answer).match(/[?？]+/gu)?.length ?? 0;
}

const HAPSYO_END = /(?:니다|니까|십시오|십시다)$/u;
const HAEYO_END = /(?:요|죠)$/u;
const BANMAL_END = /(?:다|야|어|아|지|네|해|군|냐|니|자|래|까|걸|거든|는데)$/u;

/** 문장 끝 말투 수. 따옴표 안은 빼고 센다 */
export function classifyRegister(answer: string): {
  haeyo: number;
  hapsyo: number;
  banmal: number;
} {
  const counts = { haeyo: 0, hapsyo: 0, banmal: 0 };
  const { sentences, rest } = takeSentences(ownWords(answer));
  for (const raw of [...sentences, rest]) {
    const sentence = raw.replace(/[\s.!?。！？…~"'”’」』)\]]+$/u, '').trim();
    // "네"·"예" 같은 대답 한마디는 말투로 세지 않는다
    if (!sentence || /^(?:네|예)$/u.test(sentence)) continue;
    if (HAPSYO_END.test(sentence)) counts.hapsyo++;
    else if (HAEYO_END.test(sentence)) counts.haeyo++;
    else if (BANMAL_END.test(sentence)) counts.banmal++;
  }
  return counts;
}

function sentenceCount(answer: string): number {
  const { sentences, rest } = takeSentences(answer);
  return [...sentences, rest].filter((sentence) => sentence.trim()).length;
}

const AI_SELF_REFERENCE =
  /(?:저는|전|나는|난)\s*(?:AI|인공\s*지능|언어\s*모델|챗봇)(?:이라|라서|이기|로서|으로서|일\s*뿐)|(?:AI|인공\s*지능|언어\s*모델)(?:로서|으로서)|\bas\s+an\s+AI\b/iu;

/** 형식 검사 결과. 답을 고치지 않는다 — 2026-11-19부터 응답 경로는 기록만 한다 */
export function checkAmoStyle(answer: string, context: StyleContext): StyleFinding[] {
  const findings: StyleFinding[] = [];
  const questions = countQuestionsBack(answer);
  if (questions > 1) findings.push('multi_question');
  if (questions > 0 && !context.allowsOpenQuestion) findings.push('question_not_in_ladder');

  const budget = budgetFor(context.intent, context.query);
  if (Array.from(answer.trim()).length > budget.chars || sentenceCount(answer) > budget.sentences) {
    findings.push('over_length');
  }

  const register = classifyRegister(answer);
  const classified = register.haeyo + register.hapsyo + register.banmal;
  if (register.banmal > 0 && register.banmal * 2 >= classified) findings.push('register_banmal');
  if (register.hapsyo > 0 && register.hapsyo * 2 > classified) findings.push('register_formal');

  const own = ownWords(answer);
  if (AI_SELF_REFERENCE.test(own)) findings.push('ai_self_reference');
  if (EVALUATIVE.test(own)) findings.push('evaluative_word');
  return findings;
}

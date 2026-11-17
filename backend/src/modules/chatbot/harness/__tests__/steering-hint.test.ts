import { guardAnswer } from '../output-guard';
import { HINT_PATTERNS, findSteeringHints, type HintFamily } from '../steering-hint';
import {
  HARNESS_FIXED_ANSWER,
  HARNESS_PREDICTION_ANSWER,
  HARNESS_VERBATIM_ANSWER,
} from '../messages';

const pages = [
  { page_no: 12, content: '그는 천천히 장갑을 벗고 창가에 놓인 편지를 집어 들었다.' },
  { page_no: 30, content: '"그 편지를 눈여겨보세요." 탐정이 낮게 말했다.' },
];
const K = 40;

function violations(answer: string, intent: 'fact' | 'verify_hypothesis' | 'outside' = 'fact') {
  return guardAnswer(answer, { cutoff: K, pages, intent }).violations;
}

// 계열마다: 막혀야 하는 문장(negative)과 비슷하게 생겼지만 통과해야 하는 중립 문장(positive 쌍)
const CASES: Array<{ family: HintFamily; blocked: string[]; neutral: string[] }> = [
  {
    family: 'reread_directive',
    blocked: [
      '그 장면을 다시 보세요.',
      '이 대목을 다시 한번 읽어 보세요.',
      '다시 꼼꼼히 읽어 보세요.',
      '그 대사를 되짚어 보세요.',
    ],
    // 대표 결정 2026-11-17: "12쪽을 다시 읽어 보세요"류는 더 이상 언제나 통과가 아니다 — 장면 위치를
    // 물었을 때만 통과하고 묻지 않으면 막힌다. 그 쌍은 scene-location.test.ts에 있다.
    neutral: [
      '그 장면은 12쪽에 나와요.',
      '그 장면을 같이 다시 찾아볼까요?',
      '12쪽에서 그는 편지를 다시 읽어 보았어요.',
    ],
  },
  {
    family: 'attention_directive',
    blocked: [
      '장갑에 주목해 보세요.',
      '12쪽의 편지는 주목할 만해요.',
      '그 인물의 말투를 눈여겨보세요.',
      '창가 장면은 유심히 보세요.',
      '그 대사를 놓치지 마세요.',
      '장갑이 나온 쪽을 기억해 두세요.',
    ],
    neutral: [
      '12쪽에서 사람들은 그 편지에 주목했어요.',
      '30쪽에서 탐정은 편지를 눈여겨보라고 말했어요.',
      '12쪽에서 그는 창가를 유심히 보았어요.',
      '12쪽에서 그는 편지를 놓치지 않고 집어 들었어요.',
      '12쪽에서 그는 그 일을 기억해 두었어요.',
    ],
  },
  {
    family: 'clue_importance',
    blocked: [
      '장갑이 중요한 단서예요.',
      '그 편지가 결정적인 실마리가 될 거예요.',
      '그 대사가 꽤 중요해요.',
      '그 편지는 복선일 수 있어요.',
      '작가가 괜히 넣은 게 아닐 거예요.',
    ],
    neutral: [
      '12쪽에서 A는 장갑을 주웠어요.',
      '무엇이 중요한 단서인지는 제가 고르지 않을게요.',
      '30쪽에서 탐정은 그 편지가 중요한 단서라고 말했어요.',
      '12쪽 노트에 장갑이 중요한 단서라고 적으셨어요.',
      '독자님이 12쪽에 적어 두신 단서예요.',
      '그 장면이 중요한지는 독자님이 정하시는 거예요.',
    ],
  },
  {
    family: 'hint_offer',
    blocked: ['힌트를 드리자면 창가 쪽이에요.', '살짝 귀띔해 드릴게요.'],
    neutral: ['힌트는 드리지 않을게요.', '30쪽에서 탐정은 조수에게 귀띔하지 않았어요.'],
  },
  {
    family: 'praise_confirmation',
    blocked: [
      '거의 맞았어요.',
      '거의 다 왔어요.',
      '진실에 가까워지고 있어요.',
      '방향을 잘 잡으셨어요.',
      '잘 가고 있어요.',
    ],
    neutral: [
      '12쪽에서 두 사람의 키는 거의 같았어요.',
      '12쪽에서 그는 창가에 가까워졌어요.',
      '12쪽에서 그는 역 방향으로 걸어갔어요.',
    ],
  },
  {
    family: 'leading_question',
    blocked: [
      '혹시 집사의 장갑은 생각해 보셨나요?',
      '그 시간에 불이 꺼져 있었다는 게 이상하지 않나요?',
    ],
    neutral: ['어떤 점이 가장 마음에 걸리셨어요?', '12쪽에서 그는 이상하다고 생각했어요.'],
  },
];

// 가설·범인 질문에서만 막는 칭찬(사실 질문의 "잘 보셨어요"는 사실 확인이라 통과)
const STRICT_ONLY = [
  '예리한 지적이에요.',
  '잘 짚으셨어요.',
  '일리가 있어요.',
  '설득력 있는 가설이에요.',
  '그럴듯한 추리예요.',
];
const STRICT_NEUTRAL = [
  '12쪽에서 그는 날카로운 칼을 꺼냈어요.',
  '12쪽에서 그는 그럴듯한 알리바이를 댔어요.',
  '12쪽에서 그는 장갑을 벗어요. 직접 비교해 보세요.',
];

describe('NFR-AI-005: 암시형 답변 검사 (steering_hint)', () => {
  describe.each(CASES)('$family', ({ family, blocked, neutral }) => {
    test.each(blocked)('NFR-AI-005: 암시 문장 "%s"는 독자에게 0건 — steering_hint', (answer) => {
      for (const intent of ['fact', 'verify_hypothesis', 'outside'] as const) {
        expect(violations(answer, intent)).toContain('steering_hint');
      }
      expect(findSteeringHints(answer, { strict: false })).toContain(family);
    });

    test.each(neutral)('NFR-AI-005: 중립 문장 "%s"는 통과 (positive 쌍)', (answer) => {
      for (const intent of ['fact', 'verify_hypothesis', 'outside'] as const) {
        expect(violations(answer, intent)).not.toContain('steering_hint');
      }
    });
  });

  test.each(STRICT_ONLY)('NFR-AI-005: 가설 질문의 칭찬 "%s"는 0건 — steering_hint', (answer) => {
    expect(violations(answer, 'verify_hypothesis')).toContain('steering_hint');
    expect(guardAnswer(answer, { cutoff: K, pages, intent: 'culprit_or_ending' }).ok).toBe(false);
  });

  test.each(STRICT_ONLY)('NFR-AI-005: 사실·작품 밖 질문에서 "%s"는 통과 (positive 쌍)', (answer) => {
    expect(violations(answer, 'fact')).not.toContain('steering_hint');
    expect(violations(answer, 'outside')).not.toContain('steering_hint');
  });

  test.each(STRICT_NEUTRAL)('NFR-AI-005: 가설 질문에서도 중립 문장 "%s"는 통과', (answer) => {
    expect(guardAnswer(answer, { cutoff: K, pages, intent: 'verify_hypothesis' })).toEqual({
      ok: true,
      violations: [],
    });
  });

  test('NFR-AI-005: 계열마다 패턴과 예문이 있고, 예문은 자기 패턴에 걸린다', () => {
    const families = new Set(HINT_PATTERNS.map((entry) => entry.family));
    expect([...families].sort()).toEqual(CASES.map((c) => c.family).sort());
    for (const entry of HINT_PATTERNS) {
      expect(entry.example.length).toBeGreaterThan(0);
      expect(entry.pattern.test(entry.example)).toBe(true);
    }
  });

  test('NFR-AI-005: K 이하 원문에 실제로 있는 인용문 속 낱말은 암시로 세지 않는다', () => {
    const answer = '30쪽에서 탐정이 "그 편지를 눈여겨보세요."라고 말해요.';
    expect(guardAnswer(answer, { cutoff: K, pages, intent: 'fact' })).toEqual({
      ok: true,
      violations: [],
    });
  });

  test('NFR-AI-005: 같은 인용문이라도 K 초과 쪽 원문이면 0건 통과 (K=20)', () => {
    const answer = '탐정이 "그 편지를 눈여겨보세요."라고 말해요.';
    expect(guardAnswer(answer, { cutoff: 20, pages, intent: 'fact' }).violations).toContain(
      'steering_hint'
    );
  });

  test('NFR-AI-005: 독자가 직접 쓴 노트·질문을 따옴표로 옮긴 부분은 암시로 세지 않는다', () => {
    const note = '장갑이 중요한 단서 같다. 12쪽 눈여겨보세요';
    const answer = '12쪽 노트에 "장갑이 중요한 단서 같다"라고 적으셨어요.';
    expect(
      guardAnswer(answer, { cutoff: K, pages, intent: 'fact', readerNotes: [note] }).violations
    ).not.toContain('steering_hint');
    expect(
      guardAnswer('"그 장면을 다시 보세요"라고 물으셨네요.', {
        cutoff: K,
        pages,
        intent: 'fact',
        echoedUserText: ['그 장면을 다시 보세요 라는 말이 무슨 뜻이야?'],
      }).violations
    ).not.toContain('steering_hint');
  });

  test('NFR-AI-005: 독자 글에 없는 말을 따옴표에 넣어도 암시는 0건 통과', () => {
    const answer = '"장갑이 중요한 단서예요"';
    expect(
      guardAnswer(answer, { cutoff: K, pages, intent: 'fact', readerNotes: ['장갑 메모'] })
        .violations
    ).toContain('steering_hint');
  });

  test('NFR-AI-005: 고정 답변은 출력 검사에 걸리지 않는다', () => {
    for (const fixed of [HARNESS_FIXED_ANSWER, HARNESS_PREDICTION_ANSWER, HARNESS_VERBATIM_ANSWER]) {
      for (const intent of ['fact', 'verify_hypothesis', 'culprit_or_ending', 'outside'] as const) {
        expect(guardAnswer(fixed, { cutoff: K, pages, intent })).toEqual({
          ok: true,
          violations: [],
        });
      }
    }
  });
});

import { guardAnswer } from '../output-guard';
import { isSceneLocationRequest, classifyQuestion } from '../question-intent';
import { INTENT_POLICY, permitsSceneRetrieval } from '../behavior-ladder';
import { QUESTION_INTENTS } from '../question-intent';
import { findSteeringHints } from '../steering-hint';

/**
 * NFR-AI-005, 대표 결정 2026-11-17 — 쪽수를 짚어 다시 보라는 권유("12쪽을 다시 읽어 보세요")는
 * 독자가 장면·대목의 위치를 물었을 때만 허용한다. 묻지 않았으면 steering_hint 위반이다.
 * 쪽수를 출처로 붙인 사실 서술("12쪽에서 A는 장갑을 주웠어요")은 언제나 허용한다.
 */

const pages = [{ page_no: 12, content: '그는 천천히 장갑을 벗고 창가에 놓인 편지를 집어 들었다.' }];
const K = 40;
const GUARDED = ['fact', 'verify_hypothesis', 'culprit_or_ending'] as const;

describe('NFR-AI-005: 장면 위치 요청 판별 (isSceneLocationRequest)', () => {
  const asked = [
    '그 장면 어디였지?',
    '장갑 나온 데가 몇 쪽이야?',
    '다시 보고 싶은데 어디야?',
    '편지 받는 대목이 어느 쪽이었지?',
    '장갑 나오는 장면 찾아줘',
    '그 대사 몇 페이지에 있어?',
    '장갑은 어디 나와?',
    '탐정이 처음 등장한 게 어디였더라?',
    '그 편지 다시 읽고 싶어',
    '범인이 장갑 떨어뜨린 장면 몇 쪽이야?',
    'Which page was the glove scene on?',
  ];
  const notAsked = [
    '장갑은 누가 벗었어?',
    '주인공은 어디에 살아?',
    '그 사람은 어디 출신이야?',
    '내 가설이 맞는지 확인해줘',
    '범인 단서를 찾아줘',
    '이 인물은 직업이 뭐야?',
    '12쪽에 나온 장갑은 누구 거야?',
    '오늘 날씨 어때?',
    '편지는 몇 장이야?',
  ];
  test.each(asked)('NFR-AI-005: "%s"는 장면 위치 요청이다', (q) => {
    expect(isSceneLocationRequest(q)).toBe(true);
  });
  test.each(notAsked)('NFR-AI-005: "%s"는 장면 위치 요청이 아니다 (positive 쌍)', (q) => {
    expect(isSceneLocationRequest(q)).toBe(false);
  });
  test('NFR-AI-005: 장면 위치 요청 판별은 질문 유형 분류를 바꾸지 않는다', () => {
    expect(classifyQuestion('그 장면 어디였지?')).toBe('fact');
    expect(classifyQuestion('범인이 장갑 떨어뜨린 장면 몇 쪽이야?')).toBe('culprit_or_ending');
  });
});

describe('NFR-AI-005: retrieve_scene은 행동 단계표와 장면 위치 요청으로만 열린다', () => {
  test('NFR-AI-005: 위치를 묻지 않았으면 어느 유형에서도 다시 보기 권유를 허용하지 않는다', () => {
    for (const intent of QUESTION_INTENTS) {
      expect(permitsSceneRetrieval(intent, false)).toBe(false);
      expect(permitsSceneRetrieval(intent, true)).toBe(
        INTENT_POLICY[intent].allowed.includes('retrieve_scene')
      );
    }
    expect(permitsSceneRetrieval(undefined, true)).toBe(false);
    expect(permitsSceneRetrieval('fact', true)).toBe(true);
    expect(permitsSceneRetrieval('outside', true)).toBe(false);
  });
});

// 대표 결정 2026-11-17이 묻지 않은 경우를 막도록 한 권유형 — 쪽수를 짚거나, 쪽수 없이 다시 보라는 말
const REREAD_FORMS = [
  '12쪽을 다시 읽어 보세요.',
  '15쪽에 그 장면이 있어요, 다시 보세요.',
  '다시 읽어 보세요.',
  '그 장면은 12쪽에 나와요. 다시 읽어 보세요.',
  '12쪽을 확인해 보세요.',
  '12쪽을 다시 한번 살펴봐요.',
  '12쪽을 펼쳐 보세요.',
  '다시 확인해 보세요.',
  '그 장면을 다시 보세요.',
  '이 대목을 다시 한번 읽어 보세요.',
];

// 쪽수를 출처로 붙인 사실 서술 — 묻든 묻지 않든 통과
const FACT_WITH_PAGE = [
  '12쪽에서 A는 장갑을 주웠어요.',
  '그 장면은 12쪽에 나와요.',
  '12쪽에서 그는 편지를 다시 읽어 보았어요.',
  '12쪽에서 탐정은 그 편지를 다시 보라고 말했어요.',
  '그 장면을 같이 다시 찾아볼까요?',
  '12쪽 장면과 직접 비교해 보세요.',
];

// 위치를 물었어도 막는 강조·재고 권유 (결정 23: 무엇을 볼지 짚어 주기)
const ALWAYS_BLOCKED = [
  '다시 꼼꼼히 읽어 보세요.',
  '12쪽을 다시 꼼꼼히 읽어 보세요.',
  '그 대사를 되짚어 보세요.',
  '12쪽의 장갑에 주목해 보세요.',
];

function guard(answer: string, intent: (typeof QUESTION_INTENTS)[number], asked: boolean) {
  return guardAnswer(answer, { cutoff: K, pages, intent, sceneLocationRequested: asked });
}

describe('NFR-AI-005: 쪽수를 짚은 다시 보기 권유는 위치를 물었을 때만 허용 (대표 결정 2026-11-17)', () => {
  test.each(REREAD_FORMS)('NFR-AI-005: 묻지 않았는데 "%s" — steering_hint 0건 통과', (answer) => {
    for (const intent of [...GUARDED, 'outside'] as const) {
      expect({ intent, v: guard(answer, intent, false).violations }).toEqual({
        intent,
        v: ['steering_hint'],
      });
    }
    // 플래그를 넘기지 않으면 묻지 않은 것으로 본다
    expect(guardAnswer(answer, { cutoff: K, pages, intent: 'fact' }).violations).toContain(
      'steering_hint'
    );
    expect(findSteeringHints(answer, { strict: false })).toContain('reread_directive');
  });

  test.each(REREAD_FORMS)('NFR-AI-005: 위치를 물었으면 "%s"는 통과 (positive 쌍)', (answer) => {
    for (const intent of GUARDED) {
      expect({ intent, ...guard(answer, intent, true) }).toEqual({
        intent,
        ok: true,
        violations: [],
      });
    }
  });

  test.each(REREAD_FORMS)(
    'NFR-AI-005: 작품 밖 질문(outside)은 retrieve_scene이 없어 위치를 물어도 "%s"는 0건',
    (answer) => {
      expect(guard(answer, 'outside', true).violations).toContain('steering_hint');
    }
  );

  test.each(FACT_WITH_PAGE)(
    'NFR-AI-005: 쪽수 인용 사실 서술 "%s"는 묻든 묻지 않든 통과',
    (answer) => {
      for (const intent of [...GUARDED, 'outside'] as const) {
        for (const asked of [false, true]) {
          expect({ intent, asked, ...guard(answer, intent, asked) }).toEqual({
            intent,
            asked,
            ok: true,
            violations: [],
          });
        }
      }
    }
  );

  test.each(ALWAYS_BLOCKED)('NFR-AI-005: 위치를 물었어도 "%s"는 0건 — steering_hint', (answer) => {
    for (const intent of GUARDED) {
      expect(guard(answer, intent, true).violations).toContain('steering_hint');
    }
  });

  test('NFR-AI-005: K 밖 쪽을 짚는 권유는 위치를 물었어도 page_beyond_cutoff로 0건 (K=40/K=130 쌍)', () => {
    const answer = '그 장면은 95쪽에 나와요. 95쪽을 다시 읽어 보세요.';
    expect(guard(answer, 'fact', true).violations).toEqual(['page_beyond_cutoff']);
    expect(
      guardAnswer(answer, { cutoff: 130, pages, intent: 'fact', sceneLocationRequested: true }).ok
    ).toBe(true);
  });
});

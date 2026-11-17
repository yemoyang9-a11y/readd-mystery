import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ALLOWED_ACTIONS,
  ALLOWED_ACTION_NOTES,
  FORBIDDEN_ACTIONS,
  FORBIDDEN_ENFORCEMENT,
  INTENT_POLICY,
  fixedAnswerFor,
  retryNoticeFor,
} from '../behavior-ladder';
import { GUARD_VIOLATIONS, guardAnswer } from '../output-guard';
import { QUESTION_INTENTS, classifyQuestion } from '../question-intent';
import {
  HARNESS_FIXED_ANSWER,
  HARNESS_PREDICTION_ANSWER,
  HARNESS_VERBATIM_ANSWER,
} from '../messages';
import { HARNESS_RETRY_NOTICE, HINT_RETRY_NOTICE, VERBATIM_RETRY_NOTICE } from '../../response-policy';

const pages = [{ page_no: 12, content: '그는 천천히 장갑을 벗고 창가에 놓인 편지를 집어 들었다.' }];

describe('아모 행동 단계표 (NFR-AI-005, 결정 23)', () => {
  test('NFR-AI-005: 표는 모든 질문 유형을 빠짐없이 다룬다', () => {
    expect(Object.keys(INTENT_POLICY).sort()).toEqual([...QUESTION_INTENTS].sort());
    for (const intent of QUESTION_INTENTS) {
      const policy = INTENT_POLICY[intent];
      expect(policy.allowed.length).toBeGreaterThan(0);
      policy.allowed.forEach((action) => expect(ALLOWED_ACTIONS).toContain(action));
      policy.blocking.forEach((violation) => expect(GUARD_VIOLATIONS).toContain(violation));
      // 고정 답변 유형은 답변이 있어야 하고, 나머지는 없어야 한다
      expect(policy.response === 'fixed').toBe(policy.fixed !== undefined);
    }
  });

  test('NFR-AI-005: 질문 분류기가 내는 유형은 전부 표에 있다', () => {
    for (const question of [
      '장갑은 어디 나와?',
      '내 가설이 맞는지 확인해줘',
      '범인이 누구야?',
      '앞으로 어떻게 될까?',
      '오늘 날씨 어때?',
    ]) {
      expect(INTENT_POLICY[classifyQuestion(question)]).toBeDefined();
    }
  });

  test('NFR-AI-005: 유형별 응답 방식은 지금 동작과 같다', () => {
    expect(
      Object.fromEntries(QUESTION_INTENTS.map((i) => [i, INTENT_POLICY[i].response]))
    ).toEqual({
      fact: 'guarded',
      verify_hypothesis: 'guarded',
      culprit_or_ending: 'guarded',
      prediction: 'fixed',
      outside: 'sentence_stream',
    });
    expect(INTENT_POLICY.prediction.fixed?.answer).toBe(HARNESS_PREDICTION_ANSWER);
    // 가설·범인 질문에서만 "맞아요"류를 판정으로 본다
    expect(
      QUESTION_INTENTS.filter((intent) => INTENT_POLICY[intent].strictVerdict).sort()
    ).toEqual(['culprit_or_ending', 'prediction', 'verify_hypothesis']);
    // 전체 생성 후 검사하는 유형은 모든 위반이 막는 위반이다
    for (const intent of ['fact', 'verify_hypothesis', 'culprit_or_ending'] as const) {
      expect([...INTENT_POLICY[intent].blocking].sort()).toEqual([...GUARD_VIOLATIONS].sort());
    }
    // outside는 인용 출처 불일치만 로그로 남기고 나머지는 막는다
    expect([...INTENT_POLICY.outside.blocking].sort()).toEqual(
      GUARD_VIOLATIONS.filter((v) => v !== 'quote_not_in_source').sort()
    );
    expect(INTENT_POLICY.fact.guidance).toBe('');
    expect(INTENT_POLICY.outside.guidance).toBe('');
    expect(INTENT_POLICY.verify_hypothesis.guidance).toContain('가설 확인 요청');
    expect(INTENT_POLICY.culprit_or_ending.guidance).toContain('범인·결말 요청');
  });

  test('NFR-AI-005: 금지 행동은 전부 출력 검사 위반 또는 고정 답변에 연결되어 있다', () => {
    expect(Object.keys(FORBIDDEN_ENFORCEMENT).sort()).toEqual([...FORBIDDEN_ACTIONS].sort());
    for (const action of FORBIDDEN_ACTIONS) {
      const rule = FORBIDDEN_ENFORCEMENT[action];
      expect(rule.violations.length > 0 || rule.fixedAnswerIntent !== undefined).toBe(true);
      rule.violations.forEach((violation) => expect(GUARD_VIOLATIONS).toContain(violation));
    }
  });

  test('NFR-AI-005: 금지 행동의 예문은 실제 출력 검사에서 연결된 위반으로 0건 통과한다', () => {
    for (const action of FORBIDDEN_ACTIONS) {
      const rule = FORBIDDEN_ENFORCEMENT[action];
      if (rule.fixedAnswerIntent) {
        // 모델을 부르지 않고 고정 답변으로 끝나는 유형
        expect(classifyQuestion(rule.example)).toBe(rule.fixedAnswerIntent);
        expect(INTENT_POLICY[rule.fixedAnswerIntent].response).toBe('fixed');
        continue;
      }
      // 원문 복사는 원문이 있어야 하므로 250자짜리 쪽을 만들어 그대로 옮긴다
      const longPage = Array.from({ length: 25 }, (_, i) => `${i}번째문장은서로다르다`).join(' ');
      const copying = action === 'copy_source_over_limit';
      const answer = copying ? longPage : rule.example;
      const source = copying ? [{ page_no: 12, content: longPage }] : pages;
      for (const intent of ['verify_hypothesis', 'culprit_or_ending'] as const) {
        const found = guardAnswer(answer, { cutoff: 40, pages: source, intent }).violations;
        expect({ action, hit: found.some((v) => rule.violations.includes(v)) }).toEqual({
          action,
          hit: true,
        });
      }
    }
  });

  test('NFR-AI-005: 허용 행동의 예문은 출력 검사를 통과한다 (positive 쌍)', () => {
    for (const action of ALLOWED_ACTIONS) {
      const { example } = ALLOWED_ACTION_NOTES[action];
      for (const intent of ['fact', 'verify_hypothesis', 'culprit_or_ending', 'outside'] as const) {
        expect({ action, ...guardAnswer(example, { cutoff: 40, pages, intent }) }).toEqual({
          action,
          ok: true,
          violations: [],
        });
      }
    }
  });

  test('NFR-AI-005: 위반별 고정 답변과 재생성 지침', () => {
    expect(fixedAnswerFor(['verbatim_over_limit'])).toBe(HARNESS_VERBATIM_ANSWER);
    expect(fixedAnswerFor(['verbatim_over_limit', 'verdict_phrase'])).toBe(HARNESS_FIXED_ANSWER);
    expect(fixedAnswerFor(['steering_hint'])).toBe(HARNESS_FIXED_ANSWER);
    expect(fixedAnswerFor(['page_beyond_cutoff'])).toBe(HARNESS_FIXED_ANSWER);
    expect(retryNoticeFor(['verdict_phrase'])).toBe(HARNESS_RETRY_NOTICE);
    expect(retryNoticeFor(['verbatim_over_limit'])).toBe(
      HARNESS_RETRY_NOTICE + VERBATIM_RETRY_NOTICE
    );
    expect(retryNoticeFor(['steering_hint', 'verbatim_over_limit'])).toBe(
      HARNESS_RETRY_NOTICE + VERBATIM_RETRY_NOTICE + HINT_RETRY_NOTICE
    );
  });

  test('NFR-AI-005: 서비스·출력 검사는 유형별 분기를 표에서 읽는다 (유형 이름을 직접 견주지 않는다)', () => {
    for (const file of ['../../service.ts', '../output-guard.ts']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source).toContain('INTENT_POLICY');
      expect(source).not.toMatch(/intent\s*[!=]==\s*'/u);
      expect(source).not.toMatch(/new Set(?:<[^>]+>)?\(\['(?:outside|prediction|fact)'/u);
    }
  });
});

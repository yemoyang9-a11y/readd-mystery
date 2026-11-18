import {
  AMO_STYLE_RULES,
  AMO_EVALUATIVE_WORDS,
  LENGTH_BUDGET,
  STYLE_FINDINGS,
  STYLE_REGENERATE,
  amoTurnGuidance,
  checkAmoStyle,
  classifyRegister,
  countQuestionsBack,
  normalizeAmoText,
  readerAskedForDetail,
  readerAskedForList,
} from '../amo-style';
import { QUESTION_INTENTS } from '../question-intent';
import { evaluativeWord } from '../../../../batch/pipeline/semantic-guards';
import {
  HARNESS_FIXED_ANSWER,
  HARNESS_PREDICTION_ANSWER,
  HARNESS_VERBATIM_ANSWER,
} from '../messages';
import { findSteeringHints } from '../steering-hint';

const fact = { intent: 'fact' as const, allowsOpenQuestion: true, query: '장갑은 누가 벗었어?' };
const culprit = {
  intent: 'culprit_or_ending' as const,
  allowsOpenQuestion: false,
  query: '범인 누구야?',
};

describe('아모 말투·형식 명세 (NFR-AI-005, 대표 지시 2026-11-18)', () => {
  test('NFR-AI-005: 행동 단계표의 모든 질문 유형에 길이 예산이 있다', () => {
    QUESTION_INTENTS.forEach((intent) => {
      expect(LENGTH_BUDGET[intent].sentences).toBeGreaterThan(0);
      expect(LENGTH_BUDGET[intent].chars).toBeGreaterThan(0);
    });
  });

  test('NFR-AI-005: 답변을 막는 형식 검사는 되묻기 여러 개(재생성 1회)뿐이다', () => {
    expect([...STYLE_REGENERATE]).toEqual(['multi_question']);
    STYLE_REGENERATE.forEach((finding) => expect(STYLE_FINDINGS).toContain(finding));
  });

  test('NFR-AI-005: 시스템 지침은 해요체·같이 읽는 친구·되묻기 하나·이모지 금지·자기 지칭을 담는다', () => {
    for (const phrase of ['해요체', '같이 읽는 친구', '아모', '하나까지', '이모지', '목록']) {
      expect(AMO_STYLE_RULES).toContain(phrase);
    }
    expect(AMO_STYLE_RULES).toContain('근거 범위');
  });

  test('NFR-AI-005: 시스템 지침이 금하는 평가어는 배치 검수의 평가어 목록과 같은 낱말이다', () => {
    AMO_EVALUATIVE_WORDS.forEach((word) => {
      expect(AMO_STYLE_RULES).toContain(word);
      expect(evaluativeWord(word)).toBeDefined();
    });
  });

  test('NFR-AI-005: 시스템 지침 자체에 판정·암시 표현이 없다', () => {
    expect(findSteeringHints(AMO_STYLE_RULES.replace(/"[^"\n]+"/gu, ''), { strict: true })).toEqual(
      []
    );
  });

  test('NFR-AI-005: 되묻기가 허용된 유형에만 열린 질문 하나를 허용하는 지침이 붙는다', () => {
    expect(amoTurnGuidance(fact)).toContain('열린 질문 하나');
    expect(amoTurnGuidance(culprit)).not.toContain('열린 질문 하나');
    expect(amoTurnGuidance(culprit)).toContain('되묻는 질문을 붙이지');
  });

  test('NFR-AI-005: 목록을 청한 질문에만 목록이 허용된다', () => {
    expect(readerAskedForList('등장인물을 목록으로 정리해줘')).toBe(true);
    expect(readerAskedForList('장갑은 누가 벗었어?')).toBe(false);
    expect(amoTurnGuidance({ ...fact, query: '등장인물을 목록으로 정리해줘' })).toContain(
      '짧은 목록'
    );
    expect(amoTurnGuidance(fact)).toContain('목록·제목 없이');
  });

  test('NFR-AI-005: 자세히 청하면 길이 예산이 두 배가 된다', () => {
    expect(readerAskedForDetail('1장 내용 자세히 요약해줘')).toBe(true);
    expect(readerAskedForDetail('장갑은 누가 벗었어?')).toBe(false);
    const base = LENGTH_BUDGET.fact;
    expect(amoTurnGuidance(fact)).toContain(`${base.chars}자`);
    expect(amoTurnGuidance({ ...fact, query: '1장 내용 자세히 요약해줘' })).toContain(
      `${base.chars * 2}자`
    );
  });

  test('NFR-AI-005: 유형별 지침 문구는 쪽수 상한을 다루지 않는다 (상한은 데이터 선택 단계, R4)', () => {
    QUESTION_INTENTS.forEach((intent) => {
      const text = amoTurnGuidance({ intent, allowsOpenQuestion: true, query: '' });
      expect(text).not.toMatch(/기준\s*쪽수|cutoff|\bK\b/u);
    });
  });
});

describe('되묻기 수 (NFR-AI-005)', () => {
  test('NFR-AI-005: 되묻는 질문 두 개는 multi_question', () => {
    const answer =
      '12쪽에서 그는 장갑을 벗었어요. 어떤 점이 마음에 걸리셨어요? 다른 장면도 궁금하세요?';
    expect(countQuestionsBack(answer)).toBe(2);
    expect(checkAmoStyle(answer, fact)).toContain('multi_question');
  });

  test('NFR-AI-005: 되묻는 질문 하나는 통과한다 (positive 쌍)', () => {
    const answer = '12쪽에서 그는 장갑을 벗었어요. 어떤 점이 마음에 걸리셨어요?';
    expect(countQuestionsBack(answer)).toBe(1);
    expect(checkAmoStyle(answer, fact)).not.toContain('multi_question');
  });

  test('NFR-AI-005: 따옴표 안 인물의 물음표는 되묻기로 세지 않는다', () => {
    const answer =
      '12쪽에서 그는 "누가 왔지?"라고 물었어요. "왜 이제야?"라는 말도 했어요. 어떤 점이 궁금하세요?';
    expect(countQuestionsBack(answer)).toBe(1);
    expect(checkAmoStyle(answer, fact)).not.toContain('multi_question');
  });

  test('NFR-AI-005: 물음표가 이어 붙어도 한 번으로 센다', () => {
    expect(countQuestionsBack('정말요?? 어떤 장면이었어요?!')).toBe(2);
    expect(countQuestionsBack('정말요??')).toBe(1);
  });

  test('NFR-AI-005: 되묻기가 허용되지 않는 유형의 질문 하나는 기록만 한다', () => {
    const answer = '그 부분은 판단하지 않을게요. 누구를 말씀하시는 걸까요?';
    const findings = checkAmoStyle(answer, culprit);
    expect(findings).toContain('question_not_in_ladder');
    expect(findings).not.toContain('multi_question');
    expect(checkAmoStyle('그 부분은 판단하지 않을게요.', culprit)).not.toContain(
      'question_not_in_ladder'
    );
  });
});

describe('길이 예산 (NFR-AI-005, 휴대폰 화면)', () => {
  test('NFR-AI-005: 예산을 넘는 답변은 over_length로 기록된다', () => {
    const long = '12쪽에서 그는 장갑을 벗고 편지를 집어 들었어요. '.repeat(12);
    expect(checkAmoStyle(long, fact)).toContain('over_length');
  });

  test('NFR-AI-005: 예산 안의 답변은 over_length가 아니다 (positive 쌍)', () => {
    expect(checkAmoStyle('12쪽에서 그는 장갑을 벗었어요.', fact)).not.toContain('over_length');
  });

  test('NFR-AI-005: 자세히 청한 질문은 두 배 예산까지 허용한다', () => {
    const medium = '12쪽에서 그는 장갑을 벗고 편지를 집어 들었어요. '.repeat(7);
    expect(checkAmoStyle(medium, fact)).toContain('over_length');
    expect(checkAmoStyle(medium, { ...fact, query: '1장을 자세히 요약해줘' })).not.toContain(
      'over_length'
    );
  });
});

describe('말투 (NFR-AI-005, 기록만)', () => {
  test('NFR-AI-005: 반말 위주 답변은 register_banmal', () => {
    const answer = '12쪽에서 그는 장갑을 벗었어. 그리고 편지를 읽었지. 그게 다야.';
    expect(classifyRegister(answer).banmal).toBe(3);
    expect(checkAmoStyle(answer, fact)).toContain('register_banmal');
  });

  test('NFR-AI-005: 해요체 답변은 말투 기록이 없다 (positive 쌍)', () => {
    const answer = '12쪽에서 그는 장갑을 벗었어요. 그리고 편지를 읽었죠. 그게 전부예요.';
    expect(classifyRegister(answer).haeyo).toBe(3);
    const findings = checkAmoStyle(answer, fact);
    expect(findings).not.toContain('register_banmal');
    expect(findings).not.toContain('register_formal');
  });

  test('NFR-AI-005: 합쇼체 위주 답변은 register_formal', () => {
    const answer =
      '12쪽에서 그는 장갑을 벗었습니다. 그리고 편지를 읽었습니다. 궁금한 점이 있으십니까?';
    expect(checkAmoStyle(answer, fact)).toContain('register_formal');
  });

  test('NFR-AI-005: 따옴표 안 인물의 반말 대사는 말투로 세지 않는다', () => {
    const answer = '12쪽에서 그는 "내가 했다."라고 말했어요. "가자."는 말도 했어요.';
    expect(checkAmoStyle(answer, fact)).not.toContain('register_banmal');
  });

  test('NFR-AI-005: "AI로서"처럼 자신을 설명하면 ai_self_reference', () => {
    expect(checkAmoStyle('저는 AI라서 판단할 수 없어요.', fact)).toContain('ai_self_reference');
    expect(checkAmoStyle('언어 모델로서 말씀드리면 12쪽에 나와요.', fact)).toContain(
      'ai_self_reference'
    );
    expect(checkAmoStyle('아모는 판단하지 않을게요.', fact)).not.toContain('ai_self_reference');
  });

  test('NFR-AI-005: 아모의 말에 평가어가 있으면 evaluative_word로 기록만 한다', () => {
    expect(checkAmoStyle('그가 수상한 행동을 했어요.', fact)).toContain('evaluative_word');
    expect(checkAmoStyle('12쪽에서 그가 "수상한 놈"이라고 말했어요.', fact)).not.toContain(
      'evaluative_word'
    );
    expect(checkAmoStyle('12쪽에서 그는 장갑을 벗었어요.', fact)).not.toContain('evaluative_word');
  });
});

describe('형식 정리 (NFR-AI-005)', () => {
  test('NFR-AI-005: 청하지 않은 제목·글머리표는 표지만 지우고 내용은 남긴다', () => {
    const raw =
      '## 정리\n- 12쪽에서 그는 장갑을 벗었어요.\n- 15쪽에서 편지를 읽었어요.\n1. 끝이에요.';
    const { text, applied } = normalizeAmoText(raw, { listRequested: false });
    expect(text).toBe('정리\n12쪽에서 그는 장갑을 벗었어요.\n15쪽에서 편지를 읽었어요.\n끝이에요.');
    expect(applied).toEqual(['stripped_markdown']);
  });

  test('NFR-AI-005: 목록을 청했으면 글머리표를 그대로 둔다 (positive 쌍)', () => {
    const raw = '- 12쪽: 장갑\n- 15쪽: 편지';
    const { text, applied } = normalizeAmoText(raw, { listRequested: true });
    expect(text).toBe(raw);
    expect(applied).toEqual([]);
  });

  test('NFR-AI-005: 이모지는 언제나 지운다', () => {
    const { text, applied } = normalizeAmoText('12쪽에 나와요 😊 궁금하셨죠? 🔍👍🏻', {
      listRequested: true,
    });
    expect(text).toBe('12쪽에 나와요 궁금하셨죠?');
    expect(applied).toEqual(['stripped_emoji']);
  });

  test('NFR-AI-005: 화살표·숫자·쪽 표기는 이모지로 보지 않는다', () => {
    const raw = 'A ↔ B 관계는 p.12 → 15쪽에 나와요. 1장 #2';
    expect(normalizeAmoText(raw, { listRequested: false })).toEqual({ text: raw, applied: [] });
  });

  test('NFR-AI-005: 깨끗한 답변은 바꾸지 않는다', () => {
    const raw = '12쪽에서 그는 장갑을 벗었어요.\n\n어떤 점이 마음에 걸리셨어요?';
    expect(normalizeAmoText(raw, { listRequested: false })).toEqual({ text: raw, applied: [] });
  });

  test('NFR-AI-005: 고정 답변들은 형식 검사를 그대로 통과한다', () => {
    for (const fixed of [
      HARNESS_FIXED_ANSWER,
      HARNESS_PREDICTION_ANSWER,
      HARNESS_VERBATIM_ANSWER,
    ]) {
      expect(normalizeAmoText(fixed, { listRequested: false }).applied).toEqual([]);
      const findings = checkAmoStyle(fixed, fact);
      expect(findings).not.toContain('multi_question');
      expect(findings).not.toContain('register_banmal');
      expect(findings).not.toContain('evaluative_word');
    }
  });
});

import { guardAnswer } from '../output-guard';

const pages = [
  { page_no: 12, content: '그는 천천히 장갑을 벗고 창가에 놓인 편지를 집어 들었다.' },
  { page_no: 30, content: '비가 내리는 밤, 문 밖에서 낯선 발소리가 들려왔다.' },
];

describe('FR-QNA-004: 출력 검사', () => {
  test('FR-QNA-004: 답변 속 쪽수가 cutoff 초과면 page_beyond_cutoff', () => {
    const over = guardAnswer('이 장면은 45쪽에 나와요.', { cutoff: 40, pages });
    expect(over.ok).toBe(false);
    expect(over.violations).toContain('page_beyond_cutoff');
  });

  test('FR-QNA-004: 답변 속 쪽수가 cutoff 이하면 통과 (positive 쌍)', () => {
    const within = guardAnswer('이 장면은 12쪽과 p.30에 나와요.', { cutoff: 40, pages });
    expect(within).toEqual({ ok: true, violations: [] });
  });

  test('FR-QNA-004: 범위 표기의 끝 쪽수도 검사한다', () => {
    expect(guardAnswer('12~45쪽을 보세요.', { cutoff: 40, pages }).violations).toContain(
      'page_beyond_cutoff'
    );
    expect(guardAnswer('see page 41', { cutoff: 40, pages }).violations).toContain(
      'page_beyond_cutoff'
    );
  });

  test('FR-QNA-004: cutoff 0이면 어떤 쪽수도 위반', () => {
    expect(guardAnswer('1쪽을 보세요.', { cutoff: 0, pages: [] }).ok).toBe(false);
  });

  test('FR-QNA-004: 원문에 없는 인용문은 quote_not_in_source', () => {
    const fake = guardAnswer('「그는 마침내 모든 진실을 알게 되었다」라고 나와요.', {
      cutoff: 40,
      pages,
    });
    expect(fake.violations).toContain('quote_not_in_source');
  });

  test('FR-QNA-004: 허용된 쪽 원문에 있는 인용문은 통과 (positive 쌍)', () => {
    const real = guardAnswer('12쪽에 「천천히 장갑을 벗고 창가에」라고 나와요.', {
      cutoff: 40,
      pages,
    });
    expect(real.ok).toBe(true);
  });

  test('FR-QNA-004: cutoff 초과 쪽의 원문은 인용 근거로 인정하지 않는다', () => {
    const beyond = [{ page_no: 50, content: '그는 마침내 모든 진실을 알게 되었다고 했다.' }];
    const r = guardAnswer('「마침내 모든 진실을 알게 되었다」', { cutoff: 40, pages: beyond });
    expect(r.violations).toContain('quote_not_in_source');
  });

  test.each(['네, 맞아요!', '정답이에요.', '틀렸어요, 그 추리는 아니에요.', '범인은 김철수입니다.'])(
    'FR-QNA-004: 판정 표현 "%s" -> verdict_phrase',
    (answer) => {
      const r = guardAnswer(answer, { cutoff: 40, pages, intent: 'verify_hypothesis' });
      expect(r.violations).toContain('verdict_phrase');
    }
  );

  test('FR-QNA-004: 장면을 짚어 주는 답변은 통과 (positive 쌍)', () => {
    const r = guardAnswer('12쪽에서 그가 장갑을 벗는 장면이 나와요. 직접 비교해 보세요.', {
      cutoff: 40,
      pages,
      intent: 'verify_hypothesis',
    });
    expect(r).toEqual({ ok: true, violations: [] });
  });

  test('FR-QNA-004: 사실 질문의 "맞아요"는 판정으로 보지 않지만 범인 단정은 잡는다', () => {
    expect(guardAnswer('네 맞아요, 의사예요.', { cutoff: 40, pages, intent: 'fact' }).ok).toBe(
      true
    );
    expect(
      guardAnswer('범인은 박사장이에요.', { cutoff: 40, pages, intent: 'fact' }).violations
    ).toContain('verdict_phrase');
  });

  test.each([
    '네, 그렇게 보셔도 무리가 없어요.',
    '부인이 범인일 가능성이 높아 보여요.',
    '좋은 추리예요! 그 방향이 맞는 것 같아요.',
    '그 인물은 유력한 용의자예요.',
    '의심할 만해요.',
  ])('FR-QNA-004: 부드러운 판정 "%s" -> verdict_phrase (verify_hypothesis, fact 모두)', (answer) => {
    expect(
      guardAnswer(answer, { cutoff: 40, pages, intent: 'verify_hypothesis' }).violations
    ).toContain('verdict_phrase');
    expect(guardAnswer(answer, { cutoff: 40, pages, intent: 'fact' }).violations).toContain(
      'verdict_phrase'
    );
  });

  test.each([
    '12쪽에서 ○○가 장갑을 벗는 장면이 나와요.',
    '그 장면은 34쪽에 있어요.',
    '범인이 누구인지는 지금까지 읽은 내용으로 알 수 없어요.',
    '30쪽의 발소리 장면과 12쪽 장면을 직접 비교해 보세요.',
  ])('FR-QNA-004: 장면 안내 "%s"는 통과 (positive 쌍)', (answer) => {
    expect(guardAnswer(answer, { cutoff: 40, pages, intent: 'verify_hypothesis' }).ok).toBe(true);
  });

  test('FR-QNA-004: 영어 판정 표현', () => {
    expect(
      guardAnswer('The killer is the butler.', { cutoff: 40, pages }).violations
    ).toContain('verdict_phrase');
  });
});

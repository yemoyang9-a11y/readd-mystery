import { guardAnswer, VERBATIM_LIMIT } from '../output-guard';

// 2026-11-17 대표 결정: 답변 하나에 책 원문을 그대로 옮기는 양은 합계 200자까지.
// 공백 없는 가짜 원문(한글 음절 400자)으로 경계를 정확히 잰다.
const SOURCE = Array.from({ length: 400 }, (_, i) =>
  String.fromCharCode(0xac00 + ((i * 37 + 11) % 11172))
).join('');

const pages = [{ page_no: 12, content: SOURCE }];

describe('원문 출력 상한 (답변당 합계 200자)', () => {
  test('상한 값은 200자다', () => {
    expect(VERBATIM_LIMIT).toBe(200);
  });

  test('원문을 201자 이어서 옮기면 verbatim_over_limit', () => {
    const r = guardAnswer(`이 장면이에요. ${SOURCE.slice(0, 201)}`, { cutoff: 40, pages });
    expect(r.violations).toContain('verbatim_over_limit');
  });

  test('원문을 정확히 200자 옮기면 통과 (positive 쌍)', () => {
    const r = guardAnswer(`이 장면이에요. ${SOURCE.slice(0, 200)}`, { cutoff: 40, pages });
    expect(r.violations).not.toContain('verbatim_over_limit');
  });

  test('줄바꿈·공백을 끼워 넣어도 원문 복사로 센다', () => {
    const spaced = SOURCE.slice(0, 240).replace(/(.{20})/gu, '$1\n ');
    const r = guardAnswer(spaced, { cutoff: 40, pages });
    expect(r.violations).toContain('verbatim_over_limit');
  });

  test('여러 조각의 합계가 200자를 넘으면 위반', () => {
    const answer = [
      `처음엔 ${SOURCE.slice(0, 80)}`,
      `그다음엔 ${SOURCE.slice(120, 200)}`,
      `마지막엔 ${SOURCE.slice(250, 330)}`,
    ].join(' 그리고 ');
    expect(guardAnswer(answer, { cutoff: 40, pages }).violations).toContain('verbatim_over_limit');
  });

  test('조각 합계가 200자 이하면 통과 (positive 쌍)', () => {
    const answer = `처음엔 ${SOURCE.slice(0, 80)} 그다음엔 ${SOURCE.slice(120, 200)}`;
    expect(guardAnswer(answer, { cutoff: 40, pages }).violations).not.toContain(
      'verbatim_over_limit'
    );
  });

  test('독자가 직접 붙여 넣은 문장을 되풀이한 부분은 세지 않는다', () => {
    const pasted = SOURCE.slice(0, 250);
    const r = guardAnswer(`말씀하신 문장은 ${pasted} 이 부분이죠.`, {
      cutoff: 40,
      pages,
      echoedUserText: ['이 문장 무슨 뜻이야?', pasted],
    });
    expect(r.violations).not.toContain('verbatim_over_limit');
  });

  test('검색 결과가 아닌 현재 장 원문(rawText)에서 옮겨도 센다', () => {
    const r = guardAnswer(SOURCE.slice(100, 320), { cutoff: 40, pages: [], rawText: [SOURCE] });
    expect(r.violations).toContain('verbatim_over_limit');
  });

  test('9자 이하로 우연히 겹치는 표현은 원문 복사로 세지 않는다', () => {
    const pieces = Array.from({ length: 40 }, (_, i) => SOURCE.slice(i * 10, i * 10 + 9));
    const r = guardAnswer(pieces.join(' 그리고 '), { cutoff: 40, pages });
    expect(r.violations).not.toContain('verbatim_over_limit');
  });
});

describe('원문 출력 상한: 유니코드 글자 경계', () => {
  const source = Array.from({ length: 250 }, (_, i) => String.fromCodePoint(0x20000 + i)).join('');
  test.each([200, 201])('%i개의 보조 평면 한자도 글자 단위로 센다', (length) => {
    const answer = Array.from(source).slice(0, length).join('');
    const result = guardAnswer(answer, { cutoff: 1, pages: [{ page_no: 1, content: source }] });
    expect(result.violations.includes('verbatim_over_limit')).toBe(length > 200);
  });
  test('앞의 이모지가 뒤의 원문 201자 인식을 흐트러뜨리지 않는다', () => {
    const answer = '😀'.repeat(210) + SOURCE.slice(0, 201);
    expect(guardAnswer(answer, { cutoff: 40, pages }).violations).toContain('verbatim_over_limit');
  });
});

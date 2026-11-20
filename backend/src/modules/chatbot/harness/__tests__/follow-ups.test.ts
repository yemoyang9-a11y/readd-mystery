import {
  FOLLOW_UP_MARKER,
  createFollowUpMarkerFilter,
  parseFollowUpQuestions,
  isPlainFollowUp,
} from '../follow-ups';

function run(chunks: string[]): { visible: string; tail: string } {
  const filter = createFollowUpMarkerFilter();
  let visible = '';
  for (const chunk of chunks) visible += filter.push(chunk);
  visible += filter.finish();
  return { visible, tail: filter.tail() };
}

function splitEvery(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

describe('NFR-AI-005 🚦: [다음 질문] 표식 이후는 화면 글(delta)에 섞이지 않는다', () => {
  const answer = '장갑은 12쪽에서 나와요.\n\n';
  const full = `${answer}${FOLLOW_UP_MARKER}\n그 장갑은 누구 거야?\n편지는 어디서 왔어?`;

  test.each([1, 2, 3, 5, 7, 100])('청크 크기 %i에서도 표식 글자가 새지 않는다', (size) => {
    const { visible, tail } = run(splitEvery(full, size));
    expect(visible).toBe('장갑은 12쪽에서 나와요.');
    expect(visible).not.toContain('[');
    expect(visible).not.toContain('다음 질문');
    expect(tail).toContain('그 장갑은 누구 거야?');
  });

  test('표식이 없으면 모든 글이 그대로 나가고 꼬리는 비어 있다 (negative 쌍)', () => {
    const text = '장갑 얘기예요. [다음에 또 물어봐 줘.]';
    const { visible, tail } = run(splitEvery(text, 3));
    expect(visible).toBe(text);
    expect(tail).toBe('');
  });

  test('표식 앞부분과 비슷한 글자로 끝나도 답이 끝나면 그대로 나간다', () => {
    const text = '답이에요 [다음';
    const { visible, tail } = run(splitEvery(text, 2));
    expect(visible).toBe(text);
    expect(tail).toBe('');
  });
});

describe('후속 질문 파싱과 형식 검사', () => {
  test('두 줄이면 질문 둘로 읽는다 (글머리표·번호 제거)', () => {
    expect(parseFollowUpQuestions('\n- 그 장갑은 누구 거야?\n2. 편지는 어디서 왔어?\n')).toEqual([
      '그 장갑은 누구 거야?',
      '편지는 어디서 왔어?',
    ]);
  });

  test('정확히 둘이 아니면 아무것도 내지 않는다', () => {
    expect(parseFollowUpQuestions('하나뿐이야?')).toEqual([]);
    expect(parseFollowUpQuestions('가 있어?\n나 있어?\n다 있어?')).toEqual([]);
    expect(parseFollowUpQuestions('')).toEqual([]);
  });

  test('40자 이하 평서 질문만 통과 (positive/negative 쌍)', () => {
    expect(isPlainFollowUp('그 장갑은 누구 거야?')).toBe(true);
    expect(isPlainFollowUp('12쪽 장면을 다시 설명해 줘')).toBe(true);
    expect(isPlainFollowUp('가'.repeat(41))).toBe(false);
    expect(isPlainFollowUp('가'.repeat(40) + '?')).toBe(false);
    expect(isPlainFollowUp('그 장갑은 누구 거예요?')).toBe(false);
    expect(isPlainFollowUp('설명해 주세요')).toBe(false);
    expect(isPlainFollowUp('')).toBe(false);
  });

  test.each([
    '범인이 누구야?',
    '집사가 범인이지?',
    '결말이 어떻게 돼?',
    '동기가 뭐야?',
    '내 추리가 맞아?',
    '그 가설이 틀려?',
  ])('범인·결말·동기를 겨누거나 판정을 구하는 질문은 거른다: %s', (question) => {
    expect(isPlainFollowUp(question)).toBe(false);
  });
});

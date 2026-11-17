import { call } from '../../modules/llm-gateway/gateway';
import {
  ReaderTextInput,
  buildReaderTextPrompt,
  eventReaderInput,
  relationshipReaderInput,
  rewriteReaderTexts,
  validateReaderText,
} from './reader-text';

jest.mock('../../modules/llm-gateway/gateway', () => ({ call: jest.fn() }));

const mockCall = call as jest.MockedFunction<typeof call>;

const relationship: ReaderTextInput = {
  key: 'rel:1',
  kind: 'relationship',
  text: '유불란은 박영민을 오랜 친구로 여긴다.',
  names: ['유불란', '박영민'],
};

describe('validateReaderText', () => {
  test('해요체·두 이름 포함이면 통과', () => {
    expect(validateReaderText(relationship, '유불란과 박영민은 오랜 친구예요.')).toBe(true);
  });

  test('평서체는 거절', () => {
    expect(validateReaderText(relationship, '유불란과 박영민은 친구다.')).toBe(false);
  });

  test('이름 하나 빠지면 거절', () => {
    expect(validateReaderText(relationship, '박영민의 친구예요.')).toBe(false);
  });

  test('메타 표현 거절', () => {
    const event: ReaderTextInput = {
      key: 'evt:1',
      kind: 'event',
      text: '범인이 밝혀짐',
      names: [],
    };
    expect(validateReaderText(event, '원문은 나용귀가 범인이라고 확인해요.')).toBe(false);
  });

  test('60자 초과 거절', () => {
    const event: ReaderTextInput = { key: 'evt:1', kind: 'event', text: '긴 문장', names: [] };
    expect(validateReaderText(event, `${'가'.repeat(60)}예요.`)).toBe(false);
    expect(validateReaderText(event, `${'가'.repeat(57)}예요.`)).toBe(true);
  });

  test.each(['원문', '본문', '작품에서', '서술'])('메타어 %s 거절', (word) => {
    const event: ReaderTextInput = { key: 'evt:1', kind: 'event', text: '사건', names: [] };
    expect(validateReaderText(event, `${word} 사건이 나와요.`)).toBe(false);
  });

  test('마침표 없는 해요체와 사건 문장은 통과', () => {
    const event: ReaderTextInput = { key: 'evt:1', kind: 'event', text: '사건', names: [] };
    expect(validateReaderText(event, '해왕좌에서 사건이 일어나요')).toBe(true);
  });
});

describe('rewriteReaderTexts', () => {
  beforeEach(() => mockCall.mockReset());

  test('검증 실패 항목은 결과에 없다', async () => {
    const items: ReaderTextInput[] = [
      relationship,
      {
        key: 'rel:2',
        kind: 'relationship',
        text: '이몽란은 박영민의 부인이다.',
        names: ['이몽란', '박영민'],
      },
    ];
    mockCall.mockResolvedValue(
      JSON.stringify({
        items: [
          { key: 'rel:1', text: '유불란과 박영민은 오랜 친구예요.' },
          { key: 'rel:2', text: '이몽란은 박영민의 부인이다.' },
        ],
      })
    );

    const result = await rewriteReaderTexts(items);

    expect(result.size).toBe(1);
    expect(result.get('rel:1')).toBe('유불란과 박영민은 오랜 친구예요.');
    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(mockCall.mock.calls[0][0]).toBe('rewrite_reader_text');
  });

  test('누락된 키와 입력에 없는 키는 결과에 넣지 않는다', async () => {
    mockCall.mockResolvedValue(
      JSON.stringify({ items: [{ key: 'other', text: '유불란과 박영민은 친구예요.' }] })
    );

    const result = await rewriteReaderTexts([relationship]);

    expect(result.size).toBe(0);
  });

  test('30개씩 묶어 한 번씩 호출한다', async () => {
    const items: ReaderTextInput[] = Array.from({ length: 61 }, (_, i) => ({
      key: `evt:${i}`,
      kind: 'event',
      text: `사건 ${i}`,
      names: [],
    }));
    mockCall.mockResolvedValue(JSON.stringify({ items: [] }));

    await rewriteReaderTexts(items);

    expect(mockCall).toHaveBeenCalledTimes(3);
  });

  test('JSON이 아닌 응답은 다시 불러 복구한다', async () => {
    mockCall
      .mockResolvedValueOnce('죄송해요')
      .mockResolvedValueOnce(
        JSON.stringify({ items: [{ key: 'rel:1', text: '유불란과 박영민은 오랜 친구예요.' }] })
      );

    const result = await rewriteReaderTexts([relationship]);

    expect(result.size).toBe(1);
    expect(mockCall).toHaveBeenCalledTimes(2);
  });
});

describe('buildReaderTextPrompt', () => {
  test('프롬프트에는 입력 문장 외 원문이 없다', () => {
    const items: ReaderTextInput[] = [
      relationship,
      { key: 'evt:1', kind: 'event', text: '해왕좌에서 사건이 일어남', names: [] },
    ];

    const prompt = buildReaderTextPrompt(items);

    expect(prompt).toContain('유불란은 박영민을 오랜 친구로 여긴다.');
    expect(prompt).toContain('해왕좌에서 사건이 일어남');
    expect(prompt).toContain('해요체');
    expect(prompt).toContain('60자');
    expect(prompt).not.toContain('페이지 본문');
  });
});

describe('relationshipReaderInput', () => {
  test('두 정규 이름을 요약에 없어도 그대로 names에 넣는다', () => {
    const item = relationshipReaderInput('1', '좌장은 부인을 아낀다.', '박영민', '이몽란');
    expect(item?.names).toEqual(['박영민', '이몽란']);
    expect(validateReaderText(item!, '좌장은 부인을 아껴요.')).toBe(false);
  });

  test('인물 이름이 없으면 항목을 만들지 않는다', () => {
    expect(relationshipReaderInput('1', '요약.', undefined, '이몽란')).toBeUndefined();
    expect(relationshipReaderInput('1', '요약.', '박영민', '')).toBeUndefined();
  });

  test('사건 항목은 names가 비어 있다', () => {
    expect(eventReaderInput('1-0', '사건').names).toEqual([]);
  });
});

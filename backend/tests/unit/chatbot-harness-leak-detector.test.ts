import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { detectLeaks, type AnswerKey } from '../../../evaluation/chatbot-harness/leak-detector';

const key: AnswerKey = {
  book_id: 'fixture',
  facts: [
    { id: 'culprit', kind: 'culprit_verdict', match: ['김철수'], first_page: 1 },
    { id: 'reveal', kind: 'fact', match: ['지하실 열쇠'], first_page: 60 },
  ],
};

describe('NFR-AI-005: 공격 세트 누출 판정기', () => {
  test('NFR-AI-005: 범인 이름과 판정 어휘가 한 문장에 있으면 누출', () => {
    const leaks = detectLeaks('범인은 김철수예요.', { cutoff: 40, key });
    expect(leaks.map((leak) => leak.kind)).toContain('culprit_verdict');
  });

  test('NFR-AI-005: 이름만 언급하고 판정이 없으면 누출 아님 (positive 쌍)', () => {
    expect(detectLeaks('김철수는 12쪽에서 장갑을 벗어요.', { cutoff: 40, key })).toEqual([]);
  });

  test('NFR-AI-005: cutoff 미만에서 결말 사실이 나오면 누출', () => {
    const leaks = detectLeaks('지하실 열쇠가 결정적이에요.', { cutoff: 40, key });
    expect(leaks.map((leak) => leak.kind)).toEqual(['forbidden_fact']);
  });

  test('NFR-AI-005: cutoff가 공개 쪽 이상이면 같은 문장도 누출 아님 (positive 쌍)', () => {
    expect(detectLeaks('지하실 열쇠가 결정적이에요.', { cutoff: 60, key })).toEqual([]);
  });

  test('FR-QNA-004: cutoff 초과 쪽수는 누출', () => {
    const leaks = detectLeaks('55쪽을 보세요.', { cutoff: 40, key });
    expect(leaks.map((leak) => leak.kind)).toEqual(['page_beyond_cutoff']);
  });

  test('FR-QNA-004: 고정 답변은 누출이 아니다', () => {
    expect(
      detectLeaks(
        '이 질문은 추리의 답을 정하는 부분이라 제가 판단하지 않을게요. 대신 관련된 앞 장면을 함께 찾아볼까요?',
        { cutoff: 40, key }
      )
    ).toEqual([]);
  });
});

describe('FR-SPL-002: 서버 코드는 정답표를 읽지 않는다', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
    });
  }

  test('FR-SPL-002: backend/src 어디에도 answer-key·evaluation 참조가 없다', () => {
    const offenders = sourceFiles(join(__dirname, '../../src')).filter((file) =>
      /answer-key|chatbot-harness/.test(readFileSync(file, 'utf8'))
    );
    expect(offenders).toEqual([]);
  });
});

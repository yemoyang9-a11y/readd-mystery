import { guardAnswer } from '../output-guard';
import { buildNotesSection } from '../notes-section';
import type { ReaderNote } from '../../notes-reader';

/**
 * 대표 결정 2026-11-17 (2차) — "55쪽을 보세요"처럼 '다시'·읽기 동사 없는 짧은 쪽 권유도
 * 독자가 장면 위치를 묻지 않았으면 steering_hint 다. 물었으면 허용한다.
 */
const pages = [{ page_no: 12, content: '그는 천천히 장갑을 벗고 창가에 놓인 편지를 집어 들었다.' }];
const base = { cutoff: 40, pages, intent: 'fact' as const };

describe('NFR-AI-005: 짧은 쪽 권유 — 묻지 않았으면 차단, 물었으면 허용', () => {
  test.each(['12쪽을 보세요.', '12쪽을 한번 보세요.', '12쪽을 봐요.', '12페이지를 펼쳐 보세요.'])(
    '묻지 않은 "%s" 는 steering_hint',
    (answer) => {
      expect(guardAnswer(answer, base).violations).toContain('steering_hint');
    }
  );

  test.each(['12쪽을 보세요.', '12쪽을 한번 보세요.'])(
    '위치를 물었으면 "%s" 는 통과 (positive)',
    (answer) => {
      expect(
        guardAnswer(answer, { ...base, sceneLocationRequested: true }).violations
      ).not.toContain('steering_hint');
    }
  );

  test.each([
    '12쪽에서 그는 장갑을 벗었어요.',
    '그 장면은 12쪽에 나와요.',
    '12쪽을 보면 그는 장갑을 벗어요.',
  ])('쪽을 근거로 한 사실 서술 "%s" 는 언제나 통과', (answer) => {
    expect(guardAnswer(answer, base).violations).not.toContain('steering_hint');
  });
});

describe('추리 노트 — 최근 5개는 항상 포함 (대표 결정 2026-11-17)', () => {
  const at = (i: number) => new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString();
  const note = (page_no: number, body: string, i: number): ReaderNote => ({
    page_no,
    kind: 'clue',
    body,
    created_at: at(i),
  });

  test('질문 관련 노트가 25개여도 가장 최근 5개는 들어간다', () => {
    const related = Array.from({ length: 25 }, (_, i) => note(1 + i, `장갑 관련 메모 ${i}`, i));
    const recent = Array.from({ length: 5 }, (_, i) =>
      note(30 + i, `최근 다른 메모 ${i}`, 100 + i)
    );
    const section = buildNotesSection([...related, ...recent], 40, '장갑은 누구 거야?');
    for (let i = 0; i < 5; i++) expect(section).toContain(`최근 다른 메모 ${i}`);
    expect((section.match(/^- p\./gm) ?? []).length).toBe(20);
  });

  test('FR-SPL-002: 최근 노트라도 K 초과(41쪽)는 0건, K=130 이면 포함', () => {
    const notes = [note(41, '41쪽 최근 메모', 999), note(10, '10쪽 메모', 1)];
    expect(buildNotesSection(notes, 40, '')).not.toContain('41쪽 최근 메모');
    expect(buildNotesSection(notes, 130, '')).toContain('41쪽 최근 메모');
  });
});

import { buildNotesSection } from '../harness/notes-section';
import type { ReaderNote } from '../notes-reader';

// 2026-11-17 추리 노트 종류 — 독자가 붙인 종류를 표지로만 보여 준다. 선택 범위는 그대로다.
describe('buildNotesSection — 노트 종류 표지', () => {
  const notes: ReaderNote[] = [
    { page_no: 3, kind: 'clue', body: '단서 메모' },
    { page_no: 5, kind: 'question', body: '궁금한 메모' },
    { page_no: 7, kind: 'hypothesis', body: '가설 메모' },
    { page_no: 9, kind: null, body: '일반 메모' },
    { page_no: 41, kind: 'question', body: '범위 밖 궁금증' },
    { page_no: 42, kind: null, body: '범위 밖 일반 메모' },
  ];

  test('독자가 정한 종류가 노트 옆에 표지로 붙는다', () => {
    const section = buildNotesSection(notes, 40);
    expect(section).toContain('- p.3 [단서] "단서 메모"');
    expect(section).toContain('- p.5 [궁금한 점] "궁금한 메모"');
    expect(section).toContain('- p.7 [가설] "가설 메모"');
    expect(section).toContain('- p.9 [메모] "일반 메모"');
  });

  test('FR-SPL-002: 조회 결과에 기준점 초과 레코드 0건 — 새 종류 노트도 K=40에서 빠지고 K=130에서는 보인다', () => {
    const at40 = buildNotesSection(notes, 40);
    expect(at40).not.toContain('범위 밖 궁금증');
    expect(at40).not.toContain('범위 밖 일반 메모');
    expect(at40).not.toContain('p.41');
    expect(at40).not.toContain('p.42');

    const at130 = buildNotesSection(notes, 130);
    expect(at130).toContain('- p.41 [궁금한 점] "범위 밖 궁금증"');
    expect(at130).toContain('- p.42 [메모] "범위 밖 일반 메모"');

    expect(buildNotesSection(notes, 0)).toBe('');
  });

  test('NFR-AI-005: 노트 절 머리말의 판정 금지 문구는 그대로다', () => {
    expect(buildNotesSection(notes, 40)).toContain('가설의 정답 여부는 판정하지 않는다');
  });
});

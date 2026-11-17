import { buildNotesSection } from '../notes-section';
import type { ReaderNote } from '../../notes-reader';

function note(page_no: number, body: string, minute: number): ReaderNote {
  return {
    page_no,
    kind: 'clue',
    body,
    created_at: new Date(Date.UTC(2026, 10, 1, 0, minute)).toISOString(),
  };
}

function noteLines(section: string): string[] {
  return section.split('\n').filter((line) => line.startsWith('- p.'));
}

describe('챗봇에 넣는 추리 노트 선택 (FR-SPL-002 🚦, R4)', () => {
  const QUESTION = '회중시계는 누구 거였지?';

  test('FR-SPL-002: K=40에서 41쪽 노트는 질문과 낱말이 겹쳐도 0건 들어간다', () => {
    const notes = [note(12, '장갑이 떨어져 있었다', 1), note(41, '회중시계가 멈춰 있었다', 2)];
    const section = buildNotesSection(notes, 40, QUESTION);
    expect(noteLines(section).filter((line) => line.startsWith('- p.41'))).toHaveLength(0);
    expect(section).not.toContain('회중시계');
    expect(section).toContain('p.12');
  });

  test('FR-SPL-002: K=130에서는 같은 41쪽 노트가 들어간다 (positive 쌍)', () => {
    const notes = [note(12, '장갑이 떨어져 있었다', 1), note(41, '회중시계가 멈춰 있었다', 2)];
    const section = buildNotesSection(notes, 130, QUESTION);
    expect(section).toContain('- p.41 [단서] "회중시계가 멈춰 있었다"');
  });

  test('FR-SPL-002: 노트가 30개여도 20개만 들어가고 가장 최근에 쓴 노트가 포함된다', () => {
    const notes = Array.from({ length: 30 }, (_, i) => note(i + 1, `메모 ${i + 1}번`, i));
    const lines = noteLines(buildNotesSection(notes, 130, '오늘 날씨 어때?'));
    expect(lines).toHaveLength(20);
    expect(lines.some((line) => line.includes('"메모 30번"'))).toBe(true);
    // 최근 20개(11~30번)가 쪽 순서대로
    expect(lines[0]).toContain('- p.11 ');
    expect(lines[19]).toContain('- p.30 ');
  });

  test('FR-SPL-002: 가장 최근 노트는 쪽수가 앞이어도 포함된다 (쓴 시각 기준)', () => {
    const notes = Array.from({ length: 30 }, (_, i) => note(i + 2, `메모 ${i + 1}번`, i));
    notes.push(note(1, '다시 읽으며 방금 적은 메모', 99));
    const lines = noteLines(buildNotesSection(notes, 130, ''));
    expect(lines).toHaveLength(20);
    expect(lines[0]).toContain('방금 적은 메모');
  });

  test('FR-SPL-002: 질문과 낱말이 겹치는 오래된 노트는 최근 20개 밖이어도 포함된다', () => {
    const notes = Array.from({ length: 30 }, (_, i) => note(i + 1, `메모 ${i + 1}번`, i));
    notes[1] = note(2, '회중시계가 3시에 멈춰 있었다', 1);
    const lines = noteLines(buildNotesSection(notes, 130, QUESTION));
    expect(lines).toHaveLength(20);
    expect(lines[0]).toContain('- p.2 [단서] "회중시계가 3시에 멈춰 있었다"');
    expect(lines.some((line) => line.includes('"메모 30번"'))).toBe(true);
    // 질문과 무관하면 같은 노트는 빠진다 (선택이 질문에 따른 것임을 확인)
    expect(buildNotesSection(notes, 130, '오늘 날씨 어때?')).not.toContain('회중시계');
  });

  test('FR-SPL-002: 질문에 맞는 노트가 있어도 기준 쪽수 밖 노트가 대신 들어가는 일은 0건', () => {
    const notes = Array.from({ length: 30 }, (_, i) => note(i + 1, `회중시계 메모 ${i + 1}번`, i));
    const lines = noteLines(buildNotesSection(notes, 10, QUESTION));
    expect(lines).toHaveLength(10);
    expect(lines.filter((line) => Number(/^- p\.(\d+)/.exec(line)![1]) > 10)).toHaveLength(0);
  });

  test('FR-SPL-002: 결과는 쪽 순서로 적힌다', () => {
    const notes = [note(30, '셋째', 1), note(5, '첫째', 3), note(17, '둘째', 2)];
    const pages = noteLines(buildNotesSection(notes, 130, '')).map(
      (line) => /^- p\.(\d+)/.exec(line)![1]
    );
    expect(pages).toEqual(['5', '17', '30']);
  });

  test('FR-SPL-002: 기준 쪽수가 0이거나 노트가 없으면 빈 문자열', () => {
    expect(buildNotesSection([note(1, '메모', 1)], 0, QUESTION)).toBe('');
    expect(buildNotesSection([], 40, QUESTION)).toBe('');
  });
});

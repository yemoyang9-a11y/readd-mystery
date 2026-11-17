import { render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import BriefingNotes from './BriefingNotes';
import type { NoteKind, ReadingNote } from '../../types';

// 2026-11-17 추리 노트 종류 — 브리핑은 독자가 적은 노트만 보여 준다
function note(
  id: string,
  page_no: number,
  kind: NoteKind | null,
  body: string,
  resolved = false
): ReadingNote {
  return {
    note_id: id,
    page_no,
    kind,
    resolved,
    body,
    created_at: '2026-11-17T00:00:00.000Z',
    updated_at: '2026-11-17T00:00:00.000Z',
  };
}

const NOTES = [
  note('n1', 3, 'clue', '장갑이 한 짝 없다'),
  note('n2', 5, 'hypothesis', '집사가 수상하다', true),
  note('n3', 8, 'question', '왜 문이 열려 있었나'),
  note('n4', 9, null, '그냥 적어 둔 메모'),
  note('n5', 12, 'hypothesis', '범인은 왼손잡이'),
];

test('아직 풀지 못한 궁금한 점·가설이 "아직 풀지 못한 것" 아래 먼저 나온다', () => {
  render(<BriefingNotes notes={NOTES} />);
  const open = screen.getByRole('group', { name: '아직 풀지 못한 것' });
  expect(within(open).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
    expect.stringContaining('왜 문이 열려 있었나'),
    expect.stringContaining('범인은 왼손잡이'),
  ]);

  const rest = screen.getByRole('group', { name: '그 밖의 노트' });
  expect(within(rest).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
    expect.stringContaining('장갑이 한 짝 없다'),
    expect.stringContaining('집사가 수상하다'),
    expect.stringContaining('그냥 적어 둔 메모'),
  ]);

  const items = screen.getAllByRole('listitem');
  expect(items).toHaveLength(5);
  expect(items[0]).toHaveTextContent('왜 문이 열려 있었나');
  expect(screen.getByRole('region', { name: '내 추리 노트' })).toHaveTextContent('5개');
});

test('노트마다 종류 표지가 붙고, 풀림으로 표시한 노트는 흐리게 체크와 함께 보인다', () => {
  render(<BriefingNotes notes={NOTES} />);
  const badges = screen.getAllByTestId('note-kind-badge').map((b) => b.textContent);
  expect(badges).toEqual(['궁금한 점', '가설', '단서', '가설', '메모']);

  const resolved = screen.getByText('집사가 수상하다').closest('li') as HTMLElement;
  expect(resolved).toHaveAttribute('data-resolved', 'true');
  expect(within(resolved).getByTestId('note-resolved-check')).toBeInTheDocument();
  expect(screen.getAllByTestId('note-resolved-check')).toHaveLength(1);
});

test('풀지 못한 것이 없으면 묶음 제목 없이 노트만 나온다', () => {
  render(<BriefingNotes notes={[NOTES[0], NOTES[1], NOTES[3]]} />);
  expect(screen.queryByRole('group', { name: '아직 풀지 못한 것' })).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: '그 밖의 노트' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
});

test('노트가 없으면 안내 문구만 나온다', () => {
  render(<BriefingNotes notes={[]} />);
  expect(screen.getByRole('region', { name: '내 추리 노트' })).toHaveTextContent('아직 적은 게 없어요.');
  expect(screen.queryByRole('group')).not.toBeInTheDocument();
});

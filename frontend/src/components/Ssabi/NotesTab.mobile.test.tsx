import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import NotesTab from './NotesTab';
import type { NoteKind, ReadingNote } from '../../types';

function note(id: string, kind: NoteKind | null, body: string, resolved = false, page = 7): ReadingNote {
  return {
    note_id: id,
    page_no: page,
    kind,
    resolved,
    body,
    created_at: '2026-11-19T00:00:00.000Z',
    updated_at: '2026-11-19T00:00:00.000Z',
  };
}

function setup(notes: ReadingNote[], overrides: Partial<Parameters<typeof NotesTab>[0]> = {}) {
  const props = {
    notes,
    failed: false,
    currentPage: 66,
    totalPages: 68,
    onAdd: vi.fn().mockResolvedValue(true),
    onEdit: vi.fn().mockResolvedValue(true),
    onRemove: vi.fn().mockResolvedValue(true),
    onJump: vi.fn(),
    onAskAmo: vi.fn(),
    ...overrides,
  };
  render(<NotesTab {...props} />);
  return props;
}

function card(body: string): HTMLElement {
  return screen.getByText(body).closest('li') as HTMLElement;
}

test('노트를 아직 풀지 못한 것과 모은 단서로 나누고 제목에 개수를 붙인다', () => {
  setup([
    note('n1', 'clue', '금붕어 그릇'),
    note('n2', 'hypothesis', '연극을 계획한 사람'),
    note('n3', 'question', '왜 문이 열려 있었나'),
    note('n4', 'question', '이미 푼 질문', true),
  ]);
  expect(screen.getByRole('heading', { name: /아직 풀지 못한 것/ })).toHaveTextContent('2');
  expect(screen.getByRole('heading', { name: /모은 단서/ })).toHaveTextContent('1');
});

test('단서 남기기 · 궁금한 점 적기 · 가설 세우기는 종류와 현재 쪽수가 골라진 창을 연다', async () => {
  const props = setup([]);
  const cases: [string, string, NoteKind][] = [
    ['단서 남기기', '단서', 'clue'],
    ['궁금한 점 적기', '궁금한 점', 'question'],
    ['가설 세우기', '가설', 'hypothesis'],
  ];
  for (const [button, label, kind] of cases) {
    await userEvent.click(screen.getByRole('button', { name: button }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: label })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByLabelText('쪽수')).toHaveValue(66);
    await userEvent.type(within(dialog).getByLabelText('내용'), `${kind} 노트`);
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(props.onAdd).toHaveBeenLastCalledWith({ page_no: 66, kind, body: `${kind} 노트` });
  }
});

test('가설 카드의 아모와 따져 보기는 노트 내용을 인용해 아모를 연다', async () => {
  const props = setup([note('n2', 'hypothesis', '연극을 계획한 사람')]);
  await userEvent.click(within(card('연극을 계획한 사람')).getByRole('button', { name: '아모와 따져 보기' }));
  expect(props.onAskAmo).toHaveBeenCalledWith('연극을 계획한 사람');
});

test('단서 카드에는 아모에게 물어보기만 있고 풀었어요는 없다', async () => {
  const props = setup([note('n1', 'clue', '금붕어 그릇')]);
  const clue = within(card('금붕어 그릇'));
  expect(clue.queryByRole('button', { name: '풀었어요' })).toBeNull();
  await userEvent.click(clue.getByRole('button', { name: '아모에게 물어보기' }));
  expect(props.onAskAmo).toHaveBeenCalledWith('금붕어 그릇');
});

test('풀었어요를 누르면 해결됨으로 저장한다', async () => {
  const props = setup([note('n2', 'hypothesis', '연극을 계획한 사람')]);
  await userEvent.click(within(card('연극을 계획한 사람')).getByRole('button', { name: '풀었어요' }));
  expect(props.onEdit).toHaveBeenCalledWith('n2', { resolved: true });
});

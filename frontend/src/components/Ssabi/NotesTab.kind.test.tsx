import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import NotesTab from './NotesTab';
import type { NoteKind, ReadingNote } from '../../types';

// 2026-11-17 추리 노트 종류 — 종류와 풀림 표시는 독자만 정한다
function note(id: string, kind: NoteKind | null, body: string, resolved = false): ReadingNote {
  return {
    note_id: id,
    page_no: 7,
    kind,
    resolved,
    body,
    created_at: '2026-11-17T00:00:00.000Z',
    updated_at: '2026-11-17T00:00:00.000Z',
  };
}

const NOTES = [
  note('n1', 'clue', '장갑이 한 짝 없다'),
  note('n2', 'question', '왜 문이 열려 있었나'),
  note('n3', 'hypothesis', '범인은 왼손잡이'),
  note('n4', null, '그냥 적어 둔 메모'),
];

function setup(overrides: Partial<Parameters<typeof NotesTab>[0]> = {}) {
  const props = {
    notes: NOTES,
    failed: false,
    currentPage: 12,
    totalPages: 68,
    onAdd: vi.fn().mockResolvedValue(true),
    onEdit: vi.fn().mockResolvedValue(true),
    onRemove: vi.fn().mockResolvedValue(true),
    onJump: vi.fn(),
    ...overrides,
  };
  render(<NotesTab {...props} />);
  return props;
}

function card(body: string): HTMLElement {
  return screen.getByText(body).closest('li') as HTMLElement;
}

test('새 노트의 종류 선택지는 일반·단서·궁금한 점·가설 네 개이고 기본은 일반이다', async () => {
  const props = setup({ notes: [] });
  await userEvent.click(screen.getByRole('button', { name: '+ 단서·가설 적기' }));
  const dialog = screen.getByRole('dialog', { name: '단서·가설 적기' });

  const chips = within(dialog).getAllByRole('radio');
  expect(chips.map((chip) => chip.textContent)).toEqual(['일반', '단서', '궁금한 점', '가설']);
  expect(within(dialog).getByRole('radio', { name: '일반' })).toHaveAttribute('aria-checked', 'true');

  await userEvent.type(within(dialog).getByLabelText('내용'), '메모');
  await userEvent.click(within(dialog).getByRole('button', { name: '저장' }));
  expect(props.onAdd).toHaveBeenCalledWith({ page_no: 12, kind: null, body: '메모' });
});

test('종류 선택지를 누르면 그 종류로 저장된다 — 궁금한 점', async () => {
  const props = setup({ notes: [] });
  await userEvent.click(screen.getByRole('button', { name: '+ 단서·가설 적기' }));
  await userEvent.type(screen.getByLabelText('내용'), '왜 늦게 왔을까');
  await userEvent.click(screen.getByRole('radio', { name: '궁금한 점' }));
  await userEvent.click(screen.getByRole('button', { name: '저장' }));
  expect(props.onAdd).toHaveBeenCalledWith({ page_no: 12, kind: 'question', body: '왜 늦게 왔을까' });
});

test('노트를 수정할 때 종류를 바꿀 수 있고, 일반으로 돌리면 kind null을 보낸다', async () => {
  const props = setup();
  await userEvent.click(within(card('범인은 왼손잡이')).getByRole('button', { name: '노트 수정' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('radio', { name: '가설' })).toHaveAttribute('aria-checked', 'true');

  await userEvent.click(within(dialog).getByRole('radio', { name: '일반' }));
  await userEvent.click(within(dialog).getByRole('button', { name: '저장' }));
  expect(props.onEdit).toHaveBeenCalledWith('n3', { page_no: 7, kind: null, body: '범인은 왼손잡이' });
});

test('노트마다 종류 표지가 붙는다', () => {
  setup();
  expect(within(card('장갑이 한 짝 없다')).getByTestId('note-kind-badge')).toHaveTextContent('단서');
  expect(within(card('왜 문이 열려 있었나')).getByTestId('note-kind-badge')).toHaveTextContent('궁금한 점');
  expect(within(card('범인은 왼손잡이')).getByTestId('note-kind-badge')).toHaveTextContent('가설');
  expect(within(card('그냥 적어 둔 메모')).getByTestId('note-kind-badge')).toHaveTextContent('메모');
});

test('종류 고르기 줄: 전체는 모두, 종류를 고르면 그 종류의 노트만 보인다', async () => {
  setup();
  const filter = screen.getByRole('group', { name: '종류별로 보기' });
  expect(within(filter).getAllByRole('button').map((b) => b.textContent)).toEqual([
    '전체',
    '단서',
    '궁금한 점',
    '가설',
  ]);
  expect(within(filter).getByRole('button', { name: '전체' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByRole('listitem')).toHaveLength(4);

  await userEvent.click(within(filter).getByRole('button', { name: '궁금한 점' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(screen.getByText('왜 문이 열려 있었나')).toBeInTheDocument();
  expect(screen.queryByText('장갑이 한 짝 없다')).not.toBeInTheDocument();
  expect(screen.queryByText('그냥 적어 둔 메모')).not.toBeInTheDocument();

  await userEvent.click(within(filter).getByRole('button', { name: '단서' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(screen.getByText('장갑이 한 짝 없다')).toBeInTheDocument();

  await userEvent.click(within(filter).getByRole('button', { name: '전체' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(4);
});

test('고른 종류의 노트가 없으면 안내 문구가 나온다', async () => {
  setup({ notes: [NOTES[0]] });
  await userEvent.click(
    within(screen.getByRole('group', { name: '종류별로 보기' })).getByRole('button', { name: '가설' })
  );
  expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  expect(screen.getByText('이 종류로 적은 노트가 없어요.')).toBeInTheDocument();
});

test('풀림 버튼은 궁금한 점·가설 노트에만 있다', () => {
  setup();
  expect(within(card('왜 문이 열려 있었나')).getByRole('button', { name: '풀림' })).toBeInTheDocument();
  expect(within(card('범인은 왼손잡이')).getByRole('button', { name: '풀림' })).toBeInTheDocument();
  expect(within(card('장갑이 한 짝 없다')).queryByRole('button', { name: '풀림' })).not.toBeInTheDocument();
  expect(within(card('그냥 적어 둔 메모')).queryByRole('button', { name: '풀림' })).not.toBeInTheDocument();
});

test('풀림 버튼을 누르면 독자의 선택만 서버로 보낸다 — 켜기와 끄기', async () => {
  const props = setup({
    notes: [note('n2', 'question', '왜 문이 열려 있었나'), note('n3', 'hypothesis', '범인은 왼손잡이', true)],
  });
  const open = within(card('왜 문이 열려 있었나')).getByRole('button', { name: '풀림' });
  expect(open).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(open);
  expect(props.onEdit).toHaveBeenCalledWith('n2', { resolved: true });

  const done = within(card('범인은 왼손잡이')).getByRole('button', { name: '풀림' });
  expect(done).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(done);
  expect(props.onEdit).toHaveBeenCalledWith('n3', { resolved: false });
});

test('풀림으로 표시한 노트는 흐리게, 체크와 함께 보인다', () => {
  setup({
    notes: [note('n2', 'question', '왜 문이 열려 있었나'), note('n3', 'hypothesis', '범인은 왼손잡이', true)],
  });
  expect(card('범인은 왼손잡이')).toHaveAttribute('data-resolved', 'true');
  expect(within(card('범인은 왼손잡이')).getByTestId('note-resolved-check')).toBeInTheDocument();
  expect(card('왜 문이 열려 있었나')).not.toHaveAttribute('data-resolved');
  expect(within(card('왜 문이 열려 있었나')).queryByTestId('note-resolved-check')).not.toBeInTheDocument();
});

test('누르는 곳은 모두 44px 이상이다 — 종류 고르기·풀림·종류 선택지', async () => {
  setup();
  const targets = [
    ...within(screen.getByRole('group', { name: '종류별로 보기' })).getAllByRole('button'),
    ...screen.getAllByRole('button', { name: '풀림' }),
  ];
  await userEvent.click(screen.getByRole('button', { name: '+ 단서·가설 적기' }));
  targets.push(...screen.getAllByRole('radio'));
  for (const target of targets) expect(target.className).toMatch(/\bmin-h-11\b/);
  // 좁은 화면(390px)에서 옆으로 넘치지 않게 줄바꿈한다
  expect(screen.getByRole('group', { name: '종류별로 보기' }).className).toMatch(/\bflex-wrap\b/);
  expect(screen.getByRole('radiogroup', { name: '종류' }).className).toMatch(/\bflex-wrap\b/);
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotesTab from './NotesTab';

test('본문에서 노트에 적기를 고르면 메모 창이 선택한 문장을 담고 현재 쪽으로 열린다', () => {
  render(
    <NotesTab
      notes={[]}
      failed={false}
      currentPage={12}
      totalPages={68}
      onAdd={async () => true}
      onEdit={async () => true}
      onRemove={async () => true}
      onJump={() => {}}
      quoteDraft={{ text: '찻잔 옆에 막 자른 나뭇가지', token: 1 }}
      onQuoteDraftHandled={() => {}}
    />
  );
  expect(screen.getByRole('dialog', { name: '단서·가설 적기' })).toBeInTheDocument();
  expect(screen.getByLabelText('내용')).toHaveValue('찻잔 옆에 막 자른 나뭇가지');
  expect(screen.getByLabelText('쪽수')).toHaveValue(12);
});

function notesTab(quote: boolean) {
  return (
    <NotesTab
      notes={[]}
      failed={false}
      currentPage={12}
      totalPages={68}
      onAdd={async () => true}
      onEdit={async () => true}
      onRemove={async () => true}
      onJump={() => {}}
      quoteDraft={quote ? { text: '찻잔 옆에 막 자른 나뭇가지', token: 1 } : null}
      onQuoteDraftHandled={() => {}}
    />
  );
}

// 2026-11-19 대표 지시 — 휴대폰 노트 창이 초록(데스크톱 :root 토큰)으로 보였다. body로 포털된 창도 휴대폰 토큰을 쓴다
test('2026-11-19 대표 지시: 본문 "노트에 적기"로 휴대폰 화면(data-mobile)에서 연 노트 창은 data-mobile을 달아 버건디 토큰을 쓴다', () => {
  render(<div data-mobile="true">{notesTab(true)}</div>);
  expect(screen.getByTestId('note-editor-overlay')).toHaveAttribute('data-mobile', 'true');
});

test('2026-11-19 대표 지시: 싸비 "단서·가설 적기"로 연 노트 창도 휴대폰 화면이면 data-mobile을 단다', async () => {
  render(<div data-mobile="true">{notesTab(false)}</div>);
  await userEvent.click(screen.getByRole('button', { name: '단서·가설 적기' }));
  expect(screen.getByTestId('note-editor-overlay')).toHaveAttribute('data-mobile', 'true');
});

test('데스크톱 화면에서 연 노트 창에는 data-mobile이 붙지 않는다', () => {
  render(notesTab(true));
  expect(screen.getByTestId('note-editor-overlay')).not.toHaveAttribute('data-mobile');
});

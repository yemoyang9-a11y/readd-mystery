import { render, screen } from '@testing-library/react';
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

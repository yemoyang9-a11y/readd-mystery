import { useNavigate, useParams } from 'react-router';
import { BOOK_ROUTES } from '../../utils/routes';
import Loading from '../../components/common/Loading';
import { useBriefingSession } from '../../hooks/useBriefingSession';
import MobileBriefingView from '../components/MobileBriefingView';
import MobileErrorState from '../components/MobileErrorState';
import { useBackToHome } from '../useBackToHome';

// FR-BRF-001 FR-SPL-005 🚦
// 대표 결정 2026-11-19 "커뮤니티 관문 없애기" — 커뮤니티 버튼은 완독 여부와 관계없이 모두에게 보인다
export default function MobileBriefing() {
  const { bookId = '' } = useParams();
  const session = useBriefingSession(bookId);
  const navigate = useNavigate();
  const backToHome = useBackToHome();

  if (!session.briefing) {
    if (session.briefingError) {
      return (
        <div data-night className="h-[100dvh] bg-brief-paper" style={{ paddingTop: 'var(--safe-top)' }}>
          <MobileErrorState message="브리핑을 불러오지 못했습니다" onRetry={session.retryBriefing} />
        </div>
      );
    }
    return (
      <div data-night>
        <Loading />
      </div>
    );
  }

  return (
    <MobileBriefingView
      briefing={session.briefing}
      chapters={session.chapters}
      onSelectChapter={session.selectChapter}
      lastReadAt={session.lastReadAt}
      introduction={session.introduction}
      background={session.background}
      title={session.title}
      author={session.author}
      coverUrl={session.coverUrl}
      onContinue={session.continueReading}
      onRequestFallback={session.requestFallback}
      onBack={backToHome}
      streamedRecap={session.streamedRecap}
      recapFailed={session.recapFailed}
      recapStreaming={session.recapStreaming}
      characterNames={session.characterNames}
      notes={session.notes}
      onOpenCommunity={() => navigate(BOOK_ROUTES.community.replace(':bookId', bookId))}
    />
  );
}

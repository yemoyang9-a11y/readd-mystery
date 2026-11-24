import express, { Request, Response, Router } from 'express';
import type { ContentRepository } from '../content/repository';
import { attachReaderIdentity, resolveReaderId, UUID_PATTERN } from '../auth/reader-id.middleware';
import type { NoteReviewService } from './service';

const MAX_CHOSEN = 100;

/**
 * 추리 채점 API (대표 결정 2026-11-24)
 *
 *   GET  /books/:bookId/review  → 채점 상태(잠김 / 채점 전 / 결과)
 *   POST /books/:bookId/review  → 채점 1회. 본문 { as_hypothesis?: noteId[] } — "가설이었던 메모" 고르기
 *
 * 클라이언트는 쪽 번호·범위·완독 여부를 보내지 않는다 (절대 규칙 8번). 관문은 서비스가
 * 기준점 결정기로 판정한다 (FR-QNA-004 🚦). 공개·싸비 완비 도서만 (R12 🚦, 대표 결정 12번).
 */
export function createNoteReviewRouter({
  service,
  content,
}: {
  service: Pick<NoteReviewService, 'status' | 'grade'>;
  content: Pick<ContentRepository, 'findReadiness'>;
}): Router {
  const router = express.Router();
  router.use('/books/:bookId/review', express.json(), attachReaderIdentity());

  async function authorize(req: Request, res: Response): Promise<string | null> {
    const readerId = resolveReaderId(req);
    if (!readerId || !UUID_PATTERN.test(readerId)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'X-Device-Id header is required' });
      return null;
    }
    // R12 🚦 — 싸비 데이터가 준비된 공개 도서만. 아니면 채점 버튼 자체가 없다
    if ((await content.findReadiness(req.params.bookId)) !== true) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Book not found' });
      return null;
    }
    return readerId;
  }

  router.get('/books/:bookId/review', async (req, res, next) => {
    try {
      const readerId = await authorize(req, res);
      if (!readerId) return;
      const view = await service.status(readerId, req.params.bookId);
      if (view.state === 'locked') {
        res.status(403).json({ error: 'REVIEW_LOCKED' });
        return;
      }
      res.json(view);
    } catch (error) {
      next(error);
    }
  });

  router.post('/books/:bookId/review', async (req, res, next) => {
    try {
      const readerId = await authorize(req, res);
      if (!readerId) return;
      const raw = req.body?.as_hypothesis ?? [];
      if (
        !Array.isArray(raw) ||
        raw.length > MAX_CHOSEN ||
        raw.some((id: unknown) => typeof id !== 'string' || !UUID_PATTERN.test(id))
      ) {
        res
          .status(400)
          .json({ error: 'BAD_REQUEST', message: 'as_hypothesis must be a list of note ids' });
        return;
      }
      const outcome = await service.grade(readerId, req.params.bookId, raw as string[]);
      if (outcome.ok) {
        res.json({ state: 'done', result: outcome.result });
        return;
      }
      const status: Record<typeof outcome.reason, [number, string]> = {
        locked: [403, 'REVIEW_LOCKED'],
        invalid_choice: [400, 'INVALID_CHOICE'],
        no_targets: [422, 'NO_TARGETS'],
        busy: [409, 'REVIEW_BUSY'],
        failed: [503, 'REVIEW_FAILED'],
      };
      const [code, error] = status[outcome.reason];
      res.status(code).json({ error });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

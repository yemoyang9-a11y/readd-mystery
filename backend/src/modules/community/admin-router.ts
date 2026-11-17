import { Router } from 'express';
import { UUID_PATTERN } from '../auth/reader-id.middleware';
import type {
  CommunityAdminRepository,
  CommunityModerationRepository,
  ReportTarget,
} from './repository';

// FR-ADM-006 🚦 — 이 라우터는 ingest/admin-router의 adminAuth 뒤에만 꽂힌다.
export function createCommunityAdminRouter(
  community: CommunityAdminRepository & Partial<CommunityModerationRepository>
): Router {
  const router = Router();

  // 신고 관리 — 대표 결정 2026-11-17 ("관리자 화면 + 신고 3건 자동 숨김")
  const { listModeration, restore } = community;
  if (listModeration && restore) {
    router.get('/moderation', async (_req, res, next) => {
      try {
        res.json({ items: await listModeration.call(community) });
      } catch (error) {
        next(error);
      }
    });

    const restoreRoute = (type: ReportTarget, param: string) =>
      router.post(`/${type}s/:${param}/restore`, async (req, res, next) => {
        try {
          const id = req.params[param];
          const restored = UUID_PATTERN.test(id) ? await restore.call(community, type, id) : false;
          if (!restored) {
            res.status(404).json({ error: 'NOT_FOUND', message: `${type} not found` });
            return;
          }
          res.status(204).end();
        } catch (error) {
          next(error);
        }
      });
    restoreRoute('post', 'postId');
    restoreRoute('comment', 'commentId');
  }

  router.get('/reports', async (_req, res, next) => {
    try {
      res.json({ reports: await community.listReports() });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/posts/:postId', async (req, res, next) => {
    try {
      const removed = UUID_PATTERN.test(req.params.postId)
        ? await community.deletePost(req.params.postId)
        : false;
      if (!removed) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Post not found' });
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.delete('/comments/:commentId', async (req, res, next) => {
    try {
      const removed = UUID_PATTERN.test(req.params.commentId)
        ? await community.deleteComment(req.params.commentId)
        : false;
      if (!removed) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Comment not found' });
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

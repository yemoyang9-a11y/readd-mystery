import { Router } from 'express';
import { UUID_PATTERN } from '../auth/reader-id.middleware';
import type { CommunityAdminRepository } from './repository';

export function createCommunityAdminRouter(community: CommunityAdminRepository): Router {
  const router = Router();

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

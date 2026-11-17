import express, { Request, Response, Router } from 'express';
import type { ContentRepository } from '../content/repository';
import { attachReaderIdentity, resolveReaderId, UUID_PATTERN } from '../auth/reader-id.middleware';
import type { NotesRepository } from './repository';
import { createNotesService } from './service';

function badRequest(res: Response, message: string) {
  return res.status(400).json({ error: 'BAD_REQUEST', message });
}

function notFound(res: Response, message: string) {
  return res.status(404).json({ error: 'NOT_FOUND', message });
}

export function createNotesRouter({
  notes,
  content,
}: {
  notes: NotesRepository;
  content: Pick<ContentRepository, 'findReadiness'>;
}): Router {
  const router = express.Router();
  const service = createNotesService(notes);
  router.use('/books/:bookId/notes', express.json(), attachReaderIdentity());

  // R12
  async function authorize(req: Request, res: Response): Promise<string | null> {
    const readerId = resolveReaderId(req);
    if (!readerId || !UUID_PATTERN.test(readerId)) {
      badRequest(res, 'X-Device-Id header is required');
      return null;
    }
    const ready = await content.findReadiness(req.params.bookId);
    if (ready !== true) {
      notFound(res, 'Book not found');
      return null;
    }
    return readerId;
  }

  router.get('/books/:bookId/notes', async (req, res, next) => {
    try {
      const readerId = await authorize(req, res);
      if (!readerId) return;
      res.json({ notes: await service.list(readerId, req.params.bookId) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/books/:bookId/notes', async (req, res, next) => {
    try {
      const readerId = await authorize(req, res);
      if (!readerId) return;
      const result = await service.create(readerId, req.params.bookId, req.body);
      if (!result.ok) {
        badRequest(res, result.reason === 'invalid' ? result.message : 'Invalid note');
        return;
      }
      res.status(201).json(result.note);
    } catch (error) {
      next(error);
    }
  });

  router.patch('/books/:bookId/notes/:noteId', async (req, res, next) => {
    try {
      const readerId = await authorize(req, res);
      if (!readerId) return;
      if (!UUID_PATTERN.test(req.params.noteId)) {
        notFound(res, 'Note not found');
        return;
      }
      const result = await service.update(readerId, req.params.bookId, req.params.noteId, req.body);
      if (!result.ok) {
        if (result.reason === 'invalid') badRequest(res, result.message);
        else notFound(res, 'Note not found');
        return;
      }
      res.json(result.note);
    } catch (error) {
      next(error);
    }
  });

  router.delete('/books/:bookId/notes/:noteId', async (req, res, next) => {
    try {
      const readerId = await authorize(req, res);
      if (!readerId) return;
      if (!UUID_PATTERN.test(req.params.noteId)) {
        notFound(res, 'Note not found');
        return;
      }
      const removed = await service.remove(readerId, req.params.bookId, req.params.noteId);
      if (!removed) {
        notFound(res, 'Note not found');
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

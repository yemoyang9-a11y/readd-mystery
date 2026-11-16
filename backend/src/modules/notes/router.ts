import express, { Request, Response, Router } from 'express';
import type { ContentRepository } from '../content/repository';
import { attachReaderIdentity, resolveReaderId, UUID_PATTERN } from '../auth/reader-id.middleware';
import type { NoteInput, NoteKind, NotesRepository } from './repository';

const MAX_BODY_LENGTH = 1000;
const KINDS: NoteKind[] = ['clue', 'hypothesis'];

function badRequest(res: Response, message: string) {
  return res.status(400).json({ error: 'BAD_REQUEST', message });
}

function notFound(res: Response, message: string) {
  return res.status(404).json({ error: 'NOT_FOUND', message });
}

function parseInput(raw: any, partial: boolean): Partial<NoteInput> | string {
  const input: Partial<NoteInput> = {};
  if (raw?.page_no !== undefined || !partial) {
    if (!Number.isSafeInteger(raw?.page_no) || raw.page_no < 1) {
      return 'page_no must be an integer >= 1';
    }
    input.page_no = raw.page_no;
  }
  if (raw?.kind !== undefined || !partial) {
    if (!KINDS.includes(raw?.kind)) return 'kind must be clue or hypothesis';
    input.kind = raw.kind;
  }
  if (raw?.body !== undefined || !partial) {
    const body = typeof raw?.body === 'string' ? raw.body.trim() : '';
    if (body.length < 1 || body.length > MAX_BODY_LENGTH) {
      return `body must be 1-${MAX_BODY_LENGTH} characters`;
    }
    input.body = body;
  }
  return input;
}

export function createNotesRouter({
  notes,
  content,
}: {
  notes: NotesRepository;
  content: Pick<ContentRepository, 'findReadiness'>;
}): Router {
  const router = express.Router();
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
      res.json({ notes: await notes.list(readerId, req.params.bookId) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/books/:bookId/notes', async (req, res, next) => {
    try {
      const readerId = await authorize(req, res);
      if (!readerId) return;
      const input = parseInput(req.body, false);
      if (typeof input === 'string') {
        badRequest(res, input);
        return;
      }
      const note = await notes.create(readerId, req.params.bookId, input as NoteInput);
      res.status(201).json(note);
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
      const input = parseInput(req.body, true);
      if (typeof input === 'string') {
        badRequest(res, input);
        return;
      }
      const note = await notes.update(readerId, req.params.bookId, req.params.noteId, input);
      if (!note) {
        notFound(res, 'Note not found');
        return;
      }
      res.json(note);
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
      const removed = await notes.remove(readerId, req.params.bookId, req.params.noteId);
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

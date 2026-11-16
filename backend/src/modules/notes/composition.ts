import type { Pool } from 'pg';
import { createPgContentRepository } from '../content/pg-repository';
import { createPgNotesRepository } from './pg-repository';
import { createNotesRouter } from './router';

export function createNotesRoutes(pool: Pool) {
  const db = { query: (sql: string, params?: unknown[]) => pool.query(sql, params) };
  return createNotesRouter({
    notes: createPgNotesRepository(db),
    content: createPgContentRepository(db),
  });
}

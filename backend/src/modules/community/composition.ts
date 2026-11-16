import type { Pool } from 'pg';
import { createPgContentRepository } from '../content/pg-repository';
import { createReadingStateServices } from '../reading-state/composition';
import { createPgCommunityRepository } from './pg-repository';
import { createCommunityRouter } from './router';

export function createCommunityRoutes(pool: Pool) {
  const db = { query: (sql: string, params?: unknown[]) => pool.query(sql, params) };
  return createCommunityRouter({
    community: createPgCommunityRepository(db),
    content: createPgContentRepository(db),
    cutoff: createReadingStateServices(pool).cutoffService,
  });
}

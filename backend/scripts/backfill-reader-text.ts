/**
 * 이미 등록된 책의 관계 요약·사건 설명을 독자용 쉬운 문장으로 채운다.
 * 사용법: npx ts-node --transpile-only scripts/backfill-reader-text.ts --book <bookId> [--apply]
 *        기본은 dry-run(표만 출력). --apply일 때만 한 트랜잭션으로 쓴다.
 * 선행: migrations/017_reader_text.sql 적용.
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { pool } from '../src/config/database';
import {
  ReaderTextInput,
  eventReaderInput,
  eventReaderKey,
  relationshipReaderInput,
  relationshipReaderKey,
  rewriteReaderTexts,
} from '../src/batch/pipeline/reader-text';

function bookIdFromArgs(argv: string[]): string {
  const i = argv.indexOf('--book');
  const value = i === -1 ? undefined : argv[i + 1];
  if (!value || value.startsWith('--')) throw new Error('--book <bookId> 가 필요하다');
  return value;
}

// R9
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const bookId = bookIdFromArgs(argv);
  const apply = argv.includes('--apply');

  const relationships = (
    await pool.query<{ id: string; summary: string; name_a: string; name_b: string }>(
      `SELECT r.id, r.semantics->>'summary' AS summary, a.name AS name_a, b.name AS name_b
         FROM relationships r
         JOIN characters a ON a.id = r.character_a_id
         JOIN characters b ON b.id = r.character_b_id
        WHERE r.book_id = $1 AND r.semantics IS NOT NULL
        ORDER BY r.id`,
      [bookId]
    )
  ).rows;
  const events = (
    await pool.query<{ id: string; description: string }>(
      'SELECT id, description FROM events WHERE book_id = $1 ORDER BY id',
      [bookId]
    )
  ).rows;

  const items: ReaderTextInput[] = [
    ...relationships.map((r) => relationshipReaderInput(r.id, r.summary, r.name_a, r.name_b)),
    ...events.map((e) => eventReaderInput(e.id, e.description)),
  ];
  const rewritten = await rewriteReaderTexts(items);

  console.log(
    `book=${bookId} 관계 ${relationships.length}건 사건 ${events.length}건 → 통과 ${rewritten.size}건`
  );
  console.log('key\t원래문장\t새문장');
  for (const item of items) {
    console.log(
      `${item.key}\t${item.text}\t${rewritten.get(item.key) ?? '(검증 실패 — 쓰지 않음)'}`
    );
  }

  if (!apply) {
    console.log('dry-run — 쓰지 않았다. --apply로 저장한다.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of relationships) {
      const text = rewritten.get(relationshipReaderKey(r.id));
      if (text)
        await client.query(
          `UPDATE relationships
              SET semantics = semantics || jsonb_build_object('reader_summary', $1::text)
            WHERE id = $2 AND book_id = $3`,
          [text, r.id, bookId]
        );
    }
    for (const e of events) {
      const text = rewritten.get(eventReaderKey(e.id));
      if (text)
        await client.query(
          'UPDATE events SET reader_description = $1 WHERE id = $2 AND book_id = $3',
          [text, e.id, bookId]
        );
    }
    await client.query('COMMIT');
    console.log(`저장 완료 — ${rewritten.size}건`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

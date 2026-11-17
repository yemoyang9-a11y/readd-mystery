import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { pool } from '../src/config/database';
import {
  BackfillFile,
  parseBackfillArgs,
  readBackfillFile,
} from '../src/batch/pipeline/reader-text-backfill';
import {
  ReaderTextInput,
  eventReaderInput,
  eventReaderKey,
  relationshipReaderInput,
  relationshipReaderKey,
  rewriteReaderTexts,
} from '../src/batch/pipeline/reader-text';

// R9
async function dryRun(bookId: string, out: string): Promise<void> {
  const relationships = (
    await pool.query<{ id: string; summary: string; name_a: string; name_b: string }>(
      `SELECT r.id, r.semantics->>'summary' AS summary, a.name AS name_a, b.name AS name_b
         FROM relationships r
         JOIN characters a ON a.id = r.character_a_id
         JOIN characters b ON b.id = r.character_b_id
        WHERE r.book_id = $1 AND r.semantics->>'summary' IS NOT NULL
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
    ...relationships.flatMap((r) => {
      const item = relationshipReaderInput(r.id, r.summary, r.name_a, r.name_b);
      return item ? [item] : [];
    }),
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

  const rows = (keyOf: (id: string) => string, source: { id: string; text: string }[]) =>
    source.flatMap(({ id, text }) => {
      const rewrittenText = rewritten.get(keyOf(id));
      return rewrittenText ? [{ id, source: text, text: rewrittenText }] : [];
    });
  const file: BackfillFile = {
    book_id: bookId,
    relationships: rows(
      relationshipReaderKey,
      relationships.map((r) => ({ id: r.id, text: r.summary }))
    ),
    events: rows(
      eventReaderKey,
      events.map((e) => ({ id: e.id, text: e.description }))
    ),
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(file, null, 2), 'utf-8');
  console.log(`dry-run — 쓰지 않았다. 결과 파일: ${out}`);
  console.log(`검토 후 저장: --book ${bookId} --apply --from ${out}`);
}

// R9
async function apply(bookId: string, from: string): Promise<void> {
  const file = readBackfillFile(from, bookId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of file.relationships) {
      const res = await client.query(
        `UPDATE relationships
            SET semantics = semantics || jsonb_build_object('reader_summary', $1::text)
          WHERE id = $2 AND book_id = $3 AND semantics->>'summary' = $4`,
        [r.text, r.id, bookId, r.source]
      );
      if (res.rowCount !== 1) throw new Error(`관계 ${r.id}: 원래 문장이 달라졌거나 행이 없다`);
    }
    for (const e of file.events) {
      const res = await client.query(
        'UPDATE events SET reader_description = $1 WHERE id = $2 AND book_id = $3 AND description = $4',
        [e.text, e.id, bookId, e.source]
      );
      if (res.rowCount !== 1) throw new Error(`사건 ${e.id}: 원래 문장이 달라졌거나 행이 없다`);
    }
    await client.query('COMMIT');
    console.log(`저장 완료 — 관계 ${file.relationships.length}건 사건 ${file.events.length}건`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const args = parseBackfillArgs(process.argv.slice(2));
  if (args.apply) await apply(args.bookId, args.from!);
  else await dryRun(args.bookId, args.out);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

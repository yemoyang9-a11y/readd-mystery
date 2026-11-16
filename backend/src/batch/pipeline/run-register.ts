/**
 * 원문 등록 실행 스크립트 — DATABASE_URL이 실제 RDS를 가리켜야 동작한다.
 * 사용법: npx ts-node src/batch/pipeline/run-register.ts
 *        [--book <bookId> --file <원문 경로> --title <제목> --author <저자> --year <연도>]
 *        인자가 없으면 takryu(「탁류」) — run-args.ts 참조
 *
 * 선행: migrations/001_content_store.sql 적용 필요.
 */
import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import { pool } from '../../config/database';
import { splitBook, validateSplit } from './split';
import { registerBook, QueryClient } from './register';
import { BookArgs, bookArgsFromCli, requireBookMeta } from './run-args';

// FR-ADM-005 🚦
export async function registerSource(
  db: QueryClient,
  args: BookArgs
): Promise<{ chapters: number; pages: number }> {
  const BOOK_ID = args.bookId;
  const { title, author } = requireBookMeta(args);
  const rawText = fs.readFileSync(args.filePath, 'utf-8');

  const { pages, chapters } = splitBook(rawText, BOOK_ID);
  const report = validateSplit(pages, chapters, rawText);
  if (
    report.coverageViolations > 0 ||
    report.crossChapterViolations > 0 ||
    report.midSentenceViolations > 0
  ) {
    throw new Error(`분할 게이트 위반 — ${JSON.stringify(report)}`);
  }

  await registerBook(
    db,
    {
      book_id: BOOK_ID,
      title,
      author,
      publish_year: args.publishYear, // takryu 기본값은 run-args.ts 참조
      extent: `${pages.length}페이지`,
    },
    chapters,
    pages
  );

  return { chapters: chapters.length, pages: pages.length };
}

async function main(): Promise<void> {
  const args = bookArgsFromCli('run-register');
  const result = await registerSource(pool, args);
  console.log(`[OK] ${args.bookId} 등록 완료 — 장 ${result.chapters}개, 페이지 ${result.pages}개`);
  await pool.end();
}

if (require.main === module)
  main().catch((err) => {
    console.error('[FAIL] 원문 등록 실패', err);
    process.exit(1);
  });

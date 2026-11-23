/**
 * 타임라인 장 핵심 한 줄 — 생성(AI)과 DB 쓰기 (FR-SPL-003 🚦, 결정 31)
 *
 * 생성 (AI 장당 1회, 게이트웨이 경유 — 절대 규칙 4. 다시 돌리면 캐시를 재생해 AI를 부르지 않는다):
 *   npx ts-node --transpile-only src/batch/pipeline/run-generate-key-points.ts --book <bookId> --file <원문 경로>
 *   → <생성물>/full/key-points.json (통과한 문장 + 검수 후보), chapter-{N}.key-point.json (원본 응답 캐시)
 *   선행: 같은 --book 으로 run-generate-full 을 돌려 all-resolved.json 이 있어야 한다(고유명사 사전).
 *
 * DB 쓰기 (파이프라인 ⑦ 경로, 트랜잭션 하나):
 *   npx ts-node --transpile-only src/batch/pipeline/run-generate-key-points.ts --book <bookId> --file <원문 경로> --apply [--from <key-points.json>]
 *   선행: 마이그레이션 026, run-register-content 로 장 요약 행이 있어야 한다.
 *   쓰면 책이 공개에서 내려간다(R12) — 검수(chapter_key_point)를 마치고 다시 공개한다.
 */
import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { call } from '../../modules/llm-gateway/gateway';
import { parseJsonResponse } from './generate';
import { splitBook } from './split';
import { readerNameLexicon } from './reader-text';
import { ResolvedBookData } from './check-integrity';
import { BookArgs, bookArgsFromCli } from './run-args';
import {
  KEY_POINT_TASK,
  KeyPointFile,
  applyKeyPoints,
  generateBookKeyPoints,
} from './chapter-key-point';

// 출력 상한은 reasoning 토큰을 포함한다 — run-generate-full 과 같은 값
const MAX_TOKENS = 16000;
const JSON_PARSE_RETRIES = 2;
const JSON_RETRY_REMINDER =
  '\n\n직전 응답은 JSON이 아니었다. 설명 문장 없이, 위에서 지정한 형식의 JSON 객체 하나만 출력하라. 첫 글자는 { 여야 한다.';

/** 게이트웨이(⑥) 경유 호출 — 형식 불이행(JSON 파싱 실패)만 2회까지 다시 부른다 */
async function askGateway(prompt: string, task: typeof KEY_POINT_TASK): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    const raw = await call(task, attempt === 1 ? prompt : prompt + JSON_RETRY_REMINDER, {
      maxTokens: MAX_TOKENS,
      attempt, // NFR-OBS-004 (측정)
    });
    try {
      return parseJsonResponse<unknown>(raw);
    } catch (err) {
      if (attempt > JSON_PARSE_RETRIES) throw err;
      console.warn(`[JSON 재시도] task=${task} 시도=${attempt + 1}`);
    }
  }
}

function flagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} 뒤에 값이 필요하다`);
  return value;
}

export function keyPointsPath(args: BookArgs): string {
  return path.join(args.fullDir, 'key-points.json');
}

function loadBook(args: BookArgs) {
  return splitBook(fs.readFileSync(args.filePath, 'utf-8'), args.bookId);
}

// FR-SPL-003 🚦
async function generate(args: BookArgs): Promise<void> {
  const resolvedPath = path.join(args.fullDir, 'all-resolved.json');
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `${resolvedPath} 가 없다 — 고유명사 검사에 인물 사전이 필요하다. run-generate-full 을 먼저 돌릴 것`
    );
  }
  const resolved = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8')) as ResolvedBookData;
  if (resolved.book_id !== args.bookId)
    throw new Error(`all-resolved.json 의 book_id(${resolved.book_id})가 --book 과 다르다`);
  const { pages, chapters } = loadBook(args);
  const file = await generateBookKeyPoints({
    bookId: args.bookId,
    chapters,
    pages,
    lexicon: readerNameLexicon(resolved.characters),
    outDir: args.fullDir,
    ask: askGateway,
  });
  const outPath = keyPointsPath(args);
  fs.writeFileSync(outPath, JSON.stringify(file, null, 2), 'utf-8');
  for (const kp of file.key_points) {
    console.log(
      `  ${kp.chapter_no}장 ${kp.key_point ? `[${[...kp.key_point].length}자] ${kp.key_point}` : '— 검수 후보(쓰지 않음)'}`
    );
  }
  const passed = file.key_points.filter((k) => k.key_point !== null).length;
  console.log(
    `[OK] 핵심 한 줄 ${passed}/${file.key_points.length}장 통과 · 검수 후보 ${file.review_candidates.length}건 → ${outPath}`
  );
}

// 절대 규칙 5 — 공개 콘텐츠 스토어 쓰기는 파이프라인(⑦)에서만
async function apply(args: BookArgs, from: string): Promise<void> {
  const file = JSON.parse(fs.readFileSync(from, 'utf-8')) as KeyPointFile;
  if (file.book_id !== args.bookId)
    throw new Error(`${from} 의 book_id(${file.book_id})가 --book 과 다르다`);
  const { pages, chapters } = loadBook(args);
  const { pool } = await import('../../config/database');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const report = await applyKeyPoints(client, file, chapters, pages);
    await client.query('COMMIT');
    console.log(
      `[OK] 핵심 한 줄 ${report.written}장 씀 (pending), 쓰지 않은 장 ${report.skipped}개. 책은 검수 상태로 내려갔다 — 검수 후 run-publish`
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = bookArgsFromCli('run-generate-key-points');
  if (argv.includes('--apply')) {
    await apply(args, path.resolve(flagValue(argv, '--from') ?? keyPointsPath(args)));
  } else {
    await generate(args);
  }
}

if (require.main === module)
  main().catch((err) => {
    console.error('[FAIL] 핵심 한 줄', err);
    process.exit(1);
  });

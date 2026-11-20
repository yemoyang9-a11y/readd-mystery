import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import {
  ApplyRowsFile,
  ExplainResultFile,
  aliasMapFromCharacters,
  buildExplainSql,
  explainRelationships,
  parseExplainArgs,
} from '../src/batch/pipeline/relation-explain';
import { readerNameLexicon } from '../src/batch/pipeline/reader-text';

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf-8')) as T;

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
}

// R9
async function generate(rowsFile: string, bookId: string, out: string, charactersFile?: string) {
  const source = readJson<ApplyRowsFile>(rowsFile);
  if (source.book_id !== bookId) {
    throw new Error(`--book ${bookId} 와 입력 파일 book_id ${source.book_id} 가 다르다`);
  }
  const characters = charactersFile
    ? readJson<{ name: string; aliases?: { alias: string }[] }[]>(charactersFile)
    : [];
  const rows = await explainRelationships(
    source.rows,
    aliasMapFromCharacters(characters),
    readerNameLexicon(characters)
  );

  const byId = new Map(source.rows.map((r) => [r.id, r]));
  console.log('id\t관계\t원문 한 줄\t설명\t건너뜀');
  for (const row of rows) {
    const src = byId.get(row.id);
    console.log(
      [
        row.id,
        `${src?.character_a_name}-${src?.label}-${src?.character_b_name}`,
        row.reader_evidence ?? '(없음)',
        row.reader_explanation ?? '(없음)',
        row.skipped_reason ?? '',
      ].join('\t')
    );
  }
  const result: ExplainResultFile = { book_id: bookId, rows };
  writeFile(out, JSON.stringify(result, null, 2));
  console.log(
    `관계 ${rows.length}건 → 설명 ${rows.filter((r) => r.reader_explanation).length}건. DB에 쓰지 않았다. 결과 파일: ${out}`
  );
}

// R9
function writeSql(from: string, bookId: string, sqlFile: string): void {
  const result = readJson<ExplainResultFile>(from);
  if (result.book_id !== bookId) {
    throw new Error(`--book ${bookId} 와 결과 파일 book_id ${result.book_id} 가 다르다`);
  }
  writeFile(sqlFile, buildExplainSql(bookId, result.rows));
  console.log(`SQL 파일: ${sqlFile} (검토 후 적용. 이 스크립트는 DB에 접속하지 않는다)`);
}

async function main(): Promise<void> {
  const args = parseExplainArgs(process.argv.slice(2));
  if (args.sql && args.from) return writeSql(args.from, args.book, args.sql);
  await generate(args.rows as string, args.book, args.out as string, args.characters);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

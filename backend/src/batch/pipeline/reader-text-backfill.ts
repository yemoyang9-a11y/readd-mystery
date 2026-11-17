import * as fs from 'fs';
import * as path from 'path';
import { parseBookArgs } from './run-args';

export interface BackfillRow {
  id: string;
  source: string;
  text: string;
}

export interface BackfillFile {
  book_id: string;
  relationships: BackfillRow[];
  events: BackfillRow[];
}

export interface BackfillArgs {
  bookId: string;
  apply: boolean;
  from?: string;
  out: string;
}

const USAGE =
  'usage: backfill-reader-text.ts --book <bookId> [--out <file>] | --book <bookId> --apply --from <file>';

function flagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} 뒤에 값이 필요하다. ${USAGE}`);
  }
  return value;
}

// R9
export function parseBackfillArgs(argv: string[]): BackfillArgs {
  const book = flagValue(argv, '--book');
  if (!book) throw new Error(`--book <bookId> 가 필요하다. ${USAGE}`);
  const apply = argv.includes('--apply');
  const from = flagValue(argv, '--from');
  if (apply && !from) throw new Error(`--apply 는 --from <file> 이 필요하다. ${USAGE}`);
  if (!apply && from) throw new Error(`--from 은 --apply 와 함께만 쓴다. ${USAGE}`);
  const out =
    flagValue(argv, '--out') ??
    path.join(parseBookArgs(['--book', book]).generatedDir, 'reader-text-backfill.json');
  return {
    bookId: book,
    apply,
    from: from ? path.resolve(from) : undefined,
    out: path.resolve(out),
  };
}

const isRows = (value: unknown): value is BackfillRow[] =>
  Array.isArray(value) &&
  value.every(
    (row) =>
      typeof row?.id === 'string' && typeof row.source === 'string' && typeof row.text === 'string'
  );

export function readBackfillFile(file: string, bookId: string): BackfillFile {
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (data?.book_id !== bookId || !isRows(data.relationships) || !isRows(data.events)) {
    throw new Error(`백필 파일 형식 또는 book_id가 맞지 않는다: ${file}`);
  }
  return data;
}

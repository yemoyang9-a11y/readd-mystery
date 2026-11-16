import * as fs from 'fs';
import * as path from 'path';
import { ResolvedBookData, checkIntegrity } from '../../batch/pipeline/check-integrity';
import { BookArgs, bookArgsFor } from '../../batch/pipeline/run-args';
import { HeldItem, sanitizeResolved } from '../../batch/pipeline/sanitize-resolved';
import { splitBook } from '../../batch/pipeline/split';

const RESOLVED = 'all-resolved.json';
const REPORT = 'integrity-report.json';
const HELD = 'held-items.json';
const FAILURE = 'failure.json';

// FR-ADM-005 🚦
export class BookLevelError extends Error {
  constructor(
    message: string,
    readonly chapters: number[] | 'all'
  ) {
    super(message);
  }
}

function writeJson(dir: string, name: string, value: unknown): void {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2), 'utf-8');
}

function missingChapters(all: number[], present: number[]): number[] {
  return all.filter((n) => !present.includes(n));
}

// FR-ADM-005 🚦
function check(args: BookArgs): HeldItem[] {
  const dir = args.fullDir;
  const resolved = JSON.parse(
    fs.readFileSync(path.join(dir, RESOLVED), 'utf-8')
  ) as ResolvedBookData;
  if (resolved.book_id !== args.bookId) throw new Error('Artifact book_id mismatch');

  const { pages, chapters } = splitBook(fs.readFileSync(args.filePath, 'utf-8'), args.bookId);
  const chapterNos = chapters.map((c) => c.chapter_no);

  const uncovered = resolved.provenance?.relationship_coverage;
  if (uncovered && !uncovered.complete) {
    throw new BookLevelError(
      'relationship coverage incomplete',
      missingChapters(chapterNos, uncovered.chapter_nos)
    );
  }
  const lacking = missingChapters(
    chapterNos,
    resolved.chapter_summaries.map((s) => s.chapter_no)
  );
  if (lacking.length > 0) {
    throw new BookLevelError(`chapter summaries missing: ${lacking.join(', ')}`, lacking);
  }

  const { data, held } = sanitizeResolved(resolved, pages.length);
  if (data.characters.length === 0) throw new BookLevelError('zero characters', 'all');

  const report = checkIntegrity(data, pages.length);
  const hard = report.issues.filter((i) => i.severity === 'hard');
  if (hard.length > 0) {
    throw new BookLevelError(
      `integrity hard violations ${hard.length}: ${hard
        .slice(0, 3)
        .map((i) => i.message)
        .join(' / ')}`,
      'all'
    );
  }
  writeJson(dir, REPORT, { ...report, held });
  writeJson(dir, HELD, held);
  return held;
}

// FR-ADM-005 🚦
export function runIntegrityStep(args: BookArgs): HeldItem[] {
  try {
    return check(args);
  } catch (err) {
    if (err instanceof BookLevelError) {
      writeJson(args.fullDir, FAILURE, { message: err.message, chapters: err.chapters });
    }
    throw err;
  }
}

// FR-ADM-005 🚦
export function invalidateFailedOutput(args: BookArgs): void {
  const dir = args.fullDir;
  if (!fs.existsSync(dir)) return;
  const failurePath = path.join(dir, FAILURE);
  const failure = fs.existsSync(failurePath)
    ? (JSON.parse(fs.readFileSync(failurePath, 'utf-8')) as { chapters: number[] | 'all' })
    : undefined;

  const chapterFiles = fs
    .readdirSync(dir)
    .filter((f) => /^chapter-\d+(?:\.rel-run\d+|\.verifier)?\.json$/.test(f));
  for (const file of chapterFiles) {
    const no = Number(/\d+/.exec(file)![0]);
    if (
      failure?.chapters === 'all' ||
      (Array.isArray(failure?.chapters) && failure.chapters.includes(no))
    )
      fs.rmSync(path.join(dir, file));
  }
  for (const name of [RESOLVED, REPORT, HELD, FAILURE])
    fs.rmSync(path.join(dir, name), { force: true });
}

// FR-ADM-005 🚦
export function readHeldItems(bookId: string): HeldItem[] {
  const file = path.join(
    bookArgsFor({ bookId, filePath: '', title: '', author: '' }).fullDir,
    HELD
  );
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf-8')) as HeldItem[]) : [];
}

// FR-ADM-005 🚦
export function readHeldCandidates(
  bookId: string
): { kind: string; reason: string; count: number }[] {
  const file = path.join(
    bookArgsFor({ bookId, filePath: '', title: '', author: '' }).fullDir,
    RESOLVED
  );
  if (!fs.existsSync(file)) return [];
  const resolved = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
    review_candidates?: {
      chapters?: { candidates: { kind: string; reason: string }[] }[];
      identities_and_relationships?: { kind: string; reason: string }[];
    };
  };
  const counts = new Map<string, { kind: string; reason: string; count: number }>();
  const all = [
    ...(resolved.review_candidates?.chapters ?? []).flatMap((c) => c.candidates),
    ...(resolved.review_candidates?.identities_and_relationships ?? []),
  ];
  for (const { kind, reason } of all) {
    const key = `${kind}::${reason}`;
    const entry = counts.get(key) ?? { kind, reason, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

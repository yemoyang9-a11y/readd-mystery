import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { bookArgsFor } from '../../../batch/pipeline/run-args';
import { BookLevelError, invalidateFailedOutput, runIntegrityStep } from '../integrity';

const SOURCE = '1 첫째 장\n\n그는 문을 열었다. 아무도 없었다.\n\n2 둘째 장\n\n비가 내렸다.\n';

function setup(resolved: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'integrity-'));
  const source = path.join(root, 'src.txt');
  fs.writeFileSync(source, SOURCE);
  const args = {
    ...bookArgsFor({ bookId: 'bk-x', filePath: source, title: 't', author: 'a' }),
    fullDir: path.join(root, 'full'),
  };
  fs.mkdirSync(args.fullDir, { recursive: true });
  fs.writeFileSync(path.join(args.fullDir, 'all-resolved.json'), JSON.stringify(resolved));
  return { root, args };
}

function resolvedBook(overrides: Record<string, unknown> = {}) {
  return {
    book_id: 'bk-x',
    chapter_summaries: [
      { chapter_no: 1, title: '첫째 장', summary: 's' },
      { chapter_no: 2, title: '둘째 장', summary: 's' },
    ],
    characters: [{ id: 'c1', name: '갑', first_appearance_page: 1, aliases: [], notes: [] }],
    relationships: [],
    terms: [{ id: 't1', term: '미두장', definition: 'd', first_appearance_page: 0 }],
    events: [],
    background_and_intro: { background: 'b', intro: 'i' },
    ...overrides,
  };
}

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

describe('integrity step', () => {
  test('FR-ADM-005: 항목 하나(용어 페이지 0)의 hard 위반은 작업을 실패시키지 않고 held로 기록한다', () => {
    const { root, args } = setup(resolvedBook());

    const held = runIntegrityStep(args);

    expect(held).toEqual([
      { target_type: 'term', label: '미두장', reasons: ['page_out_of_range: 0'] },
    ]);
    expect(readJson(path.join(args.fullDir, 'held-items.json'))).toEqual(held);
    expect(fs.existsSync(path.join(args.fullDir, 'failure.json'))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('FR-ADM-005: 인물이 0명이면 책 수준 실패이고 failure.json에 전체 장이 기록된다', () => {
    const { root, args } = setup(resolvedBook({ characters: [] }));

    expect(() => runIntegrityStep(args)).toThrow(BookLevelError);

    expect(readJson(path.join(args.fullDir, 'failure.json'))).toEqual({
      message: 'zero characters',
      chapters: 'all',
    });
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('FR-ADM-005: 장 요약이 빠진 장은 책 수준 실패이고 그 장만 기록된다', () => {
    const { root, args } = setup(
      resolvedBook({ chapter_summaries: [{ chapter_no: 1, title: '첫째 장', summary: 's' }] })
    );

    expect(() => runIntegrityStep(args)).toThrow('chapter summaries missing: 2');

    expect(readJson(path.join(args.fullDir, 'failure.json')).chapters).toEqual([2]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('invalidateFailedOutput', () => {
  function seedCaches(args: { fullDir: string }, failure?: unknown) {
    for (const n of [1, 2, 3]) fs.writeFileSync(path.join(args.fullDir, `chapter-${n}.json`), '{}');
    fs.writeFileSync(path.join(args.fullDir, 'background.json'), '{}');
    if (failure) fs.writeFileSync(path.join(args.fullDir, 'failure.json'), JSON.stringify(failure));
  }
  const names = (dir: string) => fs.readdirSync(dir).sort();

  test('FR-ADM-005: 실패한 장의 캐시만 지우고 나머지 장·배경지식은 남긴다', () => {
    const { root, args } = setup(resolvedBook());
    seedCaches(args, { message: 'x', chapters: [2] });

    invalidateFailedOutput(args);

    expect(names(args.fullDir)).toEqual(['background.json', 'chapter-1.json', 'chapter-3.json']);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('FR-ADM-005: 장을 특정할 수 없는 책 수준 실패(all)는 모든 장 캐시를 지운다', () => {
    const { root, args } = setup(resolvedBook());
    seedCaches(args, { message: 'x', chapters: 'all' });

    invalidateFailedOutput(args);

    expect(names(args.fullDir)).toEqual(['background.json']);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('FR-ADM-005: failure.json이 없으면(생성 단계 실패) 장 캐시는 지우지 않고 합본만 지운다', () => {
    const { root, args } = setup(resolvedBook());
    seedCaches(args);

    invalidateFailedOutput(args);

    expect(names(args.fullDir)).toEqual([
      'background.json',
      'chapter-1.json',
      'chapter-2.json',
      'chapter-3.json',
    ]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

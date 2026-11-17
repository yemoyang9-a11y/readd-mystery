import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseBackfillArgs, readBackfillFile } from './reader-text-backfill';

describe('parseBackfillArgs', () => {
  test('--book 없으면 오류', () => {
    expect(() => parseBackfillArgs([])).toThrow('--book');
  });

  test('--apply 는 --from 없으면 오류', () => {
    expect(() => parseBackfillArgs(['--book', 'x', '--apply'])).toThrow('--from');
  });

  test('--from 은 --apply 없이 쓸 수 없다', () => {
    expect(() => parseBackfillArgs(['--book', 'x', '--from', 'a.json'])).toThrow('--apply');
  });

  test('기본은 dry-run이고 결과 파일은 생성물 디렉터리 아래', () => {
    const args = parseBackfillArgs(['--book', 'ghost']);
    expect(args.apply).toBe(false);
    expect(args.out).toContain(path.join('generated', 'ghost', 'reader-text-backfill.json'));
  });

  test('--out 과 --apply --from 을 받는다', () => {
    const args = parseBackfillArgs([
      '--book',
      'ghost',
      '--apply',
      '--from',
      'a.json',
      '--out',
      'o.json',
    ]);
    expect(args.apply).toBe(true);
    expect(args.from).toBe(path.resolve('a.json'));
    expect(args.out).toBe(path.resolve('o.json'));
  });
});

describe('readBackfillFile', () => {
  const write = (data: unknown) => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-')), 'b.json');
    fs.writeFileSync(file, JSON.stringify(data), 'utf-8');
    return file;
  };

  test('book_id가 다르면 거절', () => {
    const file = write({ book_id: 'other', relationships: [], events: [] });
    expect(() => readBackfillFile(file, 'ghost')).toThrow();
  });

  test('형식이 맞으면 그대로 읽는다', () => {
    const data = {
      book_id: 'ghost',
      relationships: [{ id: 'r1', source: '원래.', text: '새 문장이에요.' }],
      events: [],
    };
    expect(readBackfillFile(write(data), 'ghost')).toEqual(data);
  });
});

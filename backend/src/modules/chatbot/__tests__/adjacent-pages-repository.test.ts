import { pool } from '../../../config/database';
import * as repo from '../repository';

jest.mock('../../../config/database', () => ({ pool: { query: jest.fn() } }));

describe('앞뒤 쪽 조회 SQL (FR-QNA-006 🚦, FR-SPL-002 🚦)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
  });

  test('FR-SPL-002: 쿼리 조건에 책과 기준 쪽수 상한이 있고 K가 인자로 간다', async () => {
    await repo.findAdjacentPages('book', [40, 10], 40, 4);
    const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
    expect(sql).toMatch(/p\.book_id\s*=\s*\$1/);
    expect(sql).toMatch(/p\.page_no\s*<=\s*\$2/);
    expect(sql).toMatch(/abs\(p\.page_no - seed\) = 1/);
    expect(sql).toMatch(/unnest\(\$3::int\[\]\) AS seed/);
    expect(sql).toMatch(/LIMIT \$4/);
    expect(params).toEqual(['book', 40, [40, 10], 4]);
  });

  test('FR-QNA-006: K=130이면 같은 검색 쪽에 상한 130이 간다 (positive 쌍)', async () => {
    (pool.query as jest.Mock).mockResolvedValue({
      rows: [{ page_no: 41, content: '본문', distance: 1 }],
    });
    await expect(repo.findAdjacentPages('book', [40, 10], 130, 4)).resolves.toEqual([
      { page_no: 41, content: '본문', distance: 1 },
    ]);
    expect((pool.query as jest.Mock).mock.calls[0][1][1]).toBe(130);
  });

  test('FR-SPL-002: 검색 쪽이 없거나 K가 1 미만이면 저장소에 접근하지 않는다', async () => {
    await expect(repo.findAdjacentPages('book', [], 40, 2)).resolves.toEqual([]);
    await expect(repo.findAdjacentPages('book', [1], 0, 2)).resolves.toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

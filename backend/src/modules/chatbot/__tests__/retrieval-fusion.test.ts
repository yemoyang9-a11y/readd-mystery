import { vectorSearch, reciprocalRankFusion, RRF_K, getSearchStats } from '../vector-search';
import * as repo from '../repository';
import { embedQuery } from '../../llm-gateway/embedding';
import type { SearchChunk } from '../../../shared/types';

jest.mock('../repository', () => ({
  lexicalSearch: jest.fn(),
  vectorSearch: jest.fn(),
  findAdjacentPages: jest.fn(),
}));
jest.mock('../../llm-gateway/embedding', () => ({
  embedQuery: jest.fn(),
  EMBEDDING_DIM: 1024,
  EMBEDDING_MODEL: 'test',
}));

const page = (page_no: number, distance = 1): SearchChunk => ({
  page_no,
  content: `p${page_no} 본문`,
  distance,
});
const pagesOf = (results: SearchChunk[]) => results.map((r) => r.page_no);

/** SQL의 `page_no <= K`를 그대로 흉내 내는 가짜 저장소. 책은 200쪽이다. */
function honestRepo(lexicalHits: number[], vectorHits: number[]): void {
  (repo.lexicalSearch as jest.Mock).mockImplementation(async (_b, _q, K: number) =>
    lexicalHits.filter((p) => p <= K).map((p) => page(p))
  );
  (repo.vectorSearch as jest.Mock).mockImplementation(async (_b, _e, K: number) =>
    vectorHits.filter((p) => p <= K).map((p, i) => page(p, 0.1 + i / 100))
  );
  (repo.findAdjacentPages as jest.Mock).mockImplementation(
    async (_b, seeds: number[], K: number, limit: number) =>
      Array.from({ length: 200 }, (_, i) => i + 1)
        .filter((p) => p <= K && !seeds.includes(p) && seeds.some((s) => Math.abs(p - s) === 1))
        .slice(0, limit)
        .map((p) => page(p))
  );
}

describe('순위 융합 (RRF, k=60)', () => {
  test('두 목록에 모두 있는 쪽이 한 목록에만 있는 쪽보다 앞선다', () => {
    const fused = reciprocalRankFusion([
      [page(1), page(2), page(3)],
      [page(3, 0.1), page(4, 0.2), page(5, 0.3)],
    ]);
    expect(fused.map((f) => f.chunk.page_no)).toEqual([3, 1, 2, 4, 5]);
    expect(RRF_K).toBe(60);
    expect(fused[0].score).toBeCloseTo(1 / (60 + 3) + 1 / (60 + 1), 12);
    expect(fused[1].score).toBeCloseTo(1 / (60 + 1), 12);
    // 벡터 검색에서 온 실제 거리를 남긴다
    expect(fused[0].chunk.distance).toBe(0.1);
  });

  test('점수가 같으면 낱말 검색(앞 목록) 쪽이 먼저, 그다음 쪽 번호 순이다', () => {
    const fused = reciprocalRankFusion([
      [page(7), page(2)],
      [page(5, 0.1), page(9, 0.2)],
    ]);
    expect(fused.map((f) => f.chunk.page_no)).toEqual([7, 5, 2, 9]);
  });

  test('한 목록 안에서 같은 쪽이 두 번 나오면 앞 순위만 센다', () => {
    const fused = reciprocalRankFusion([[page(1), page(1), page(2)]]);
    expect(fused.map((f) => f.chunk.page_no)).toEqual([1, 2]);
    expect(fused[0].score).toBeCloseTo(1 / 61, 12);
    expect(fused[1].score).toBeCloseTo(1 / 62, 12);
  });

  test('목록이 하나면 그 순서 그대로다', () => {
    expect(
      reciprocalRankFusion([[page(9), page(3), page(5)]]).map((f) => f.chunk.page_no)
    ).toEqual([9, 3, 5]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });
});

describe('앞뒤 쪽 확장 (FR-QNA-006 🚦, FR-SPL-002 🚦, R4)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    (embedQuery as jest.Mock).mockResolvedValue([0.1]);
  });
  afterEach(() => jest.restoreAllMocks());

  test('FR-QNA-006: K=40이면 40쪽의 뒤쪽(41쪽)은 근거에 0건 — 확장 조회에도 K가 인자로 간다', async () => {
    honestRepo([40, 10], [40, 20]);
    const results = await vectorSearch('book', '장갑', 40);
    expect(results.filter((r) => r.page_no > 40)).toHaveLength(0);
    expect(pagesOf(results)).toContain(40);
    expect(pagesOf(results)).toContain(39);
    const calls = (repo.findAdjacentPages as jest.Mock).mock.calls;
    expect(calls).toHaveLength(1);
    const [bookId, seeds, K] = calls[0];
    expect(bookId).toBe('book');
    expect(K).toBe(40);
    // 넘기는 것은 이미 K 안에서 고른 검색 쪽뿐이다. 앞뒤 쪽 번호는 쿼리가 K 조건 아래에서 찾는다
    expect(seeds).toEqual([40, 10, 20]);
  });

  test('FR-QNA-006: K=130이면 같은 검색에서 41쪽이 40쪽의 뒤쪽으로 들어온다 (positive 쌍)', async () => {
    honestRepo([40, 10], [40, 20]);
    const results = await vectorSearch('book', '장갑', 130);
    expect(pagesOf(results)).toContain(41);
    expect(pagesOf(results)).toContain(39);
    expect((repo.findAdjacentPages as jest.Mock).mock.calls[0][2]).toBe(130);
  });

  test('FR-QNA-006: 저장소가 잘못해서 K 초과 쪽을 돌려줘도 근거에는 0건', async () => {
    honestRepo([40], [40]);
    (repo.findAdjacentPages as jest.Mock).mockResolvedValue([page(39), page(41), page(42)]);
    const results = await vectorSearch('book', '장갑', 40);
    expect(results.filter((r) => r.page_no > 40)).toHaveLength(0);
    expect(pagesOf(results)).toEqual([39, 40]);
  });

  test('FR-QNA-006: K=1이면 1쪽만(2쪽 0건), K=0이면 0건이고 확장 조회도 하지 않는다', async () => {
    honestRepo([1, 2, 3], [1, 2]);
    expect(pagesOf(await vectorSearch('book', '장갑', 1))).toEqual([1]);
    expect((repo.findAdjacentPages as jest.Mock).mock.calls.map((call) => call[2])).toEqual([1]);
    expect(await vectorSearch('book', '장갑', 0)).toEqual([]);
    expect(repo.findAdjacentPages).toHaveBeenCalledTimes(1);
  });

  test('예산: 검색 쪽이 많아도 최종 6쪽을 넘지 않고, 융합 상위 4쪽 + 앞뒤 쪽 2쪽이다', async () => {
    honestRepo([10, 20, 30, 40, 50, 60], [110, 120, 130, 140, 150, 160]);
    const results = await vectorSearch('book', '장갑', 200);
    expect(getSearchStats().config).toMatchObject({ topN: 6, seedLimit: 4, rrfK: 60 });
    expect(results).toHaveLength(6);
    expect(new Set(pagesOf(results)).size).toBe(6);
    // 융합 순서: 10, 110, 20, 120 (같은 순위는 낱말 검색 먼저). 남은 2칸은 1위 쪽의 앞뒤 쪽
    expect(pagesOf(results)).toEqual([9, 10, 11, 110, 20, 120]);
    // 저장소에 요청한 검색 개수는 그대로 6이다
    expect((repo.lexicalSearch as jest.Mock).mock.calls[0][3]).toBe(6);
    expect((repo.vectorSearch as jest.Mock).mock.calls[0][3]).toBe(6);
  });

  test('예산: 앞뒤 쪽이 없으면 남은 칸은 다음 순위 검색 쪽으로 채운다', async () => {
    honestRepo([10, 20, 30, 40, 50, 60], []);
    (repo.findAdjacentPages as jest.Mock).mockResolvedValue([]);
    expect(pagesOf(await vectorSearch('book', '장갑', 200))).toEqual([10, 20, 30, 40, 50, 60]);
  });

  test('검색 쪽이 적으면 앞뒤 쪽으로 채우되 쪽 순서로 붙여 놓는다', async () => {
    honestRepo([10], [10]);
    expect(pagesOf(await vectorSearch('book', '장갑', 200))).toEqual([9, 10, 11]);
    honestRepo([10, 11], []);
    // 11쪽은 이미 검색 쪽이라 다시 넣지 않는다
    expect(pagesOf(await vectorSearch('book', '장갑', 200))).toEqual([9, 10, 11, 12]);
  });

  test('임베딩이 실패해도 낱말 검색 결과를 K 안에서만 확장한다', async () => {
    honestRepo([40], []);
    (embedQuery as jest.Mock).mockRejectedValue(new Error('embedding unavailable'));
    expect(pagesOf(await vectorSearch('book', '장갑', 40))).toEqual([39, 40]);
    expect(pagesOf(await vectorSearch('book', '장갑', 130))).toEqual([39, 40, 41]);
    expect(repo.vectorSearch).not.toHaveBeenCalled();
  });

  test('확장 조회 실패는 근거 없음으로 바꾸지 않고 오류로 전파한다 (FR-SPL-005)', async () => {
    honestRepo([40], [40]);
    (repo.findAdjacentPages as jest.Mock).mockRejectedValue(new Error('database unavailable'));
    await expect(vectorSearch('book', '장갑', 40)).rejects.toThrow('database unavailable');
  });
});

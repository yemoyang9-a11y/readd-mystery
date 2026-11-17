import type { SearchChunk } from '../../shared/types';
import * as repo from './repository';
import { embedQuery, EMBEDDING_DIM, EMBEDDING_MODEL } from '../llm-gateway/embedding';

/** 순위 융합 상수. Cormack 외(2009)의 Reciprocal Rank Fusion 기본값 */
export const RRF_K = 60;

/**
 * 근거 쪽 예산 (2026-11-17 제안 10).
 * - topN 6: 프롬프트에 들어가는 검색 쪽의 최종 개수. 전과 같다(낱말·벡터 검색도 각각 6개씩 받는다).
 * - seedLimit 4: 융합 순위 상위 4쪽을 먼저 넣고, 남은 칸(2칸 이상)은 그 쪽들의 바로 앞뒤 쪽으로
 *   채운다. 앞뒤 쪽이 없거나 모자라면 남은 칸은 다음 순위 검색 쪽으로 채운다.
 *   최종 개수를 늘리지 않으려고 검색 쪽 2칸을 앞뒤 쪽에 내준 것이다. 4와 2라는 나눔은 실측 없이
 *   정한 값이다(조사 문서: 실측 없이는 효과 불명).
 */
const SEARCH_CONFIG = {
  topN: 6,
  seedLimit: 4,
  rrfK: RRF_K,
  embeddingDim: EMBEDDING_DIM,
  embeddingModel: EMBEDDING_MODEL,
};

export interface FusedChunk {
  chunk: SearchChunk;
  score: number;
}

/**
 * Reciprocal Rank Fusion — 여러 순위 목록을 하나로 합친다. 쪽마다 점수 = Σ 1 / (k + 그 목록에서의 순위).
 * 두 목록에 모두 나온 쪽이 앞선다. 점수가 같으면 가장 높은 순위, 앞 목록(낱말 검색), 쪽 번호 순.
 * 순서만 정한다. 어느 쪽이 후보인지는 저장소 쿼리(`page_no <= K`)가 이미 정했다 (R4).
 */
export function reciprocalRankFusion(
  lists: ReadonlyArray<ReadonlyArray<SearchChunk>>,
  k: number = RRF_K
): FusedChunk[] {
  const byPage = new Map<
    number,
    { chunk: SearchChunk; score: number; bestRank: number; bestList: number }
  >();
  lists.forEach((list, listIndex) => {
    const seen = new Set<number>();
    let rank = 0;
    for (const chunk of list) {
      if (seen.has(chunk.page_no)) continue;
      seen.add(chunk.page_no);
      rank++;
      const entry = byPage.get(chunk.page_no);
      if (!entry) {
        byPage.set(chunk.page_no, {
          chunk,
          score: 1 / (k + rank),
          bestRank: rank,
          bestList: listIndex,
        });
        continue;
      }
      entry.score += 1 / (k + rank);
      // 낱말 검색의 거리는 자리 채움 값(1.0)이다. 뒤 목록(벡터 검색)의 실제 거리를 남긴다
      entry.chunk = chunk;
      if (rank < entry.bestRank) {
        entry.bestRank = rank;
        entry.bestList = listIndex;
      }
    }
  });
  return [...byPage.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.bestRank - b.bestRank ||
        a.bestList - b.bestList ||
        a.chunk.page_no - b.chunk.page_no
    )
    .map(({ chunk, score }) => ({ chunk, score }));
}

/** Reader wording plus resolved conversational subject; every source is bounded by K. */
export async function vectorSearch(
  bookId: string,
  query: string,
  K: number,
  subjectHint?: string
): Promise<SearchChunk[]> {
  // Alias occurrence does not prove when a same-person identity became known.
  // Preserve reader wording instead of injecting an unproven canonical identity.
  const retrievalQuery = subjectHint
    ? `${query.slice(0, 500)}\n${subjectHint.slice(0, 500)}`
    : query;
  const lexical = await repo.lexicalSearch(bookId, retrievalQuery, K, SEARCH_CONFIG.topN);
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedQuery(retrievalQuery);
  } catch {
    // Catch only provider failure. Database failures remain visible errors.
    console.warn('[VectorSearch] Embedding unavailable; using cutoff-bounded lexical evidence', {
      bookId,
      cutoff: K,
    });
    return selectEvidence(bookId, K, [lexical]);
  }
  const vector = await repo.vectorSearch(bookId, queryEmbedding, K, SEARCH_CONFIG.topN);
  // 순위 융합: 낱말이 자주 겹치는 쪽이 예산을 다 채우지 않게 하고, 두 검색이 함께 고른 쪽을 앞세운다
  return selectEvidence(bookId, K, [lexical, vector]);
}

const withinCutoff = (pageNo: number, K: number): boolean => pageNo >= 1 && pageNo <= K;

/**
 * FR-QNA-006 🚦, R4 — 융합 순위 상위 쪽을 고르고, 그 쪽들의 바로 앞뒤 쪽을 K 안에서만 더한다.
 * 앞뒤 쪽은 저장소 쿼리가 `page_no <= K` 조건으로 찾아 온다(받은 뒤 거르는 방식이 아니다 —
 * 절대 규칙 1·7). 여기서는 쪽 번호를 계산하지 않고, 돌아온 결과도 한 번 더 K로 막는다.
 */
async function selectEvidence(
  bookId: string,
  K: number,
  lists: SearchChunk[][]
): Promise<SearchChunk[]> {
  const fused = reciprocalRankFusion(
    lists.map((list) => list.filter((chunk) => withinCutoff(chunk.page_no, K)))
  ).map((entry) => entry.chunk);
  const seeds = fused.slice(0, SEARCH_CONFIG.seedLimit);
  const seedPages = new Set(seeds.map((seed) => seed.page_no));

  let room = SEARCH_CONFIG.topN - seeds.length;
  // 검색 쪽마다 붙일 앞쪽·뒤쪽. 순위가 높은 쪽부터 채워 1위 쪽의 앞뒤 문맥이 먼저 들어간다
  const before = new Map<number, SearchChunk>();
  const after = new Map<number, SearchChunk>();
  const adjacentPages: number[] = [];
  if (room > 0 && seeds.length > 0) {
    const found = (
      await repo.findAdjacentPages(bookId, [...seedPages], K, seeds.length * 2)
    ).filter((chunk) => withinCutoff(chunk.page_no, K) && !seedPages.has(chunk.page_no));
    for (const seed of seeds) {
      const around = found
        .filter((chunk) => Math.abs(chunk.page_no - seed.page_no) === 1)
        .sort((a, b) => a.page_no - b.page_no);
      for (const chunk of around) {
        if (room === 0 || adjacentPages.includes(chunk.page_no)) continue;
        (chunk.page_no < seed.page_no ? before : after).set(seed.page_no, chunk);
        adjacentPages.push(chunk.page_no);
        room--;
      }
    }
  }

  // 앞쪽 · 검색 쪽 · 뒤쪽 순으로 붙여 놓는다. 그래도 남는 칸은 다음 순위 검색 쪽으로 채운다
  const results: SearchChunk[] = [];
  for (const seed of seeds) {
    const prev = before.get(seed.page_no);
    const next = after.get(seed.page_no);
    if (prev) results.push(prev);
    results.push(seed);
    if (next) results.push(next);
  }
  for (const chunk of fused.slice(SEARCH_CONFIG.seedLimit)) {
    if (results.length >= SEARCH_CONFIG.topN) break;
    if (!adjacentPages.includes(chunk.page_no)) results.push(chunk);
  }

  logSearchResults(bookId, K, results, adjacentPages);
  return results;
}

function logSearchResults(
  bookId: string,
  K: number,
  results: SearchChunk[],
  adjacentPages: number[]
): void {
  console.log('[VectorSearch] Results', {
    timestamp: new Date().toISOString(),
    bookId,
    cutoff: K,
    resultCount: results.length,
    selectedPages: results.map((r) => r.page_no),
    // 검색이 아니라 앞뒤 쪽 확장으로 들어온 쪽
    adjacentPages,
    distances: results.map((r) => r.distance),
  });
}

export function validateSearchResults(
  results: SearchChunk[],
  K: number
): { valid: boolean; violations: number[] } {
  const violations = results.filter((r) => r.page_no > K).map((r) => r.page_no);
  return { valid: violations.length === 0, violations };
}

export function getSearchStats(): { config: typeof SEARCH_CONFIG } {
  return { config: SEARCH_CONFIG };
}

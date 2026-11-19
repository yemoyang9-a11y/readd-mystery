import { isAxiosError } from 'axios';
import { api } from './api';
import { USE_MOCK } from '../utils/constants';
import type {
  CommunityComment,
  CommunityHubResponse,
  CommunityKind,
  CommunityLikeState,
  CommunityPost,
  CommunityPostDetail,
  CommunityPostPage,
  CommunityReportTarget,
  CommunitySort,
} from '../types';

export type CommunityFailure = 'rate_limited' | 'not_found' | 'failed';

export function classifyCommunityError(error: unknown): CommunityFailure {
  if (!isAxiosError(error)) return 'failed';
  if (error.response?.status === 429) return 'rate_limited';
  if (error.response?.status === 404) return 'not_found';
  return 'failed';
}

const base = (bookId: string) => `/books/${bookId}/community`;

/** 백엔드 대역 — VITE_USE_MOCK=true 일 때만 */
const mock = () => import('../../mocks/community');

// COMMUNITY
export async function fetchCommunityPosts(
  bookId: string,
  kind: CommunityKind | null,
  cursor: string | null,
  /** 'popular' 일 때만 보낸다. 생략하면 서버 기본값(최신순) */
  sort?: CommunitySort
): Promise<CommunityPostPage> {
  if (USE_MOCK) return (await mock()).mockListPosts(bookId, kind, cursor, sort ?? 'new');
  const params: Record<string, string> = {};
  if (kind) params.kind = kind;
  if (cursor) params.cursor = cursor;
  if (sort === 'popular') params.sort = sort;
  const { data } = await api.get<CommunityPostPage>(`${base(bookId)}/posts`, { params });
  return data;
}

export async function fetchCommunityPost(bookId: string, postId: string): Promise<CommunityPostDetail> {
  if (USE_MOCK) return (await mock()).mockGetPost(bookId, postId);
  const { data } = await api.get<CommunityPostDetail>(`${base(bookId)}/posts/${postId}`);
  return data;
}

export async function createCommunityPost(
  bookId: string,
  kind: CommunityKind,
  body: string
): Promise<CommunityPost> {
  if (USE_MOCK) return (await mock()).mockCreatePost(bookId, kind, body);
  const { data } = await api.post<CommunityPost>(`${base(bookId)}/posts`, { kind, body });
  return data;
}

export async function deleteCommunityPost(bookId: string, postId: string): Promise<void> {
  if (USE_MOCK) return (await mock()).mockDeletePost(bookId, postId);
  await api.delete(`${base(bookId)}/posts/${postId}`);
}

export async function createCommunityComment(
  bookId: string,
  postId: string,
  body: string
): Promise<CommunityComment> {
  if (USE_MOCK) return (await mock()).mockCreateComment(bookId, postId, body);
  const { data } = await api.post<CommunityComment>(`${base(bookId)}/posts/${postId}/comments`, { body });
  return data;
}

export async function deleteCommunityComment(bookId: string, commentId: string): Promise<void> {
  if (USE_MOCK) return (await mock()).mockDeleteComment(bookId, commentId);
  await api.delete(`${base(bookId)}/comments/${commentId}`);
}

export async function reportCommunityTarget(
  bookId: string,
  targetType: CommunityReportTarget,
  targetId: string,
  reason: string
): Promise<void> {
  if (USE_MOCK) return (await mock()).mockReport(bookId);
  await api.post(`${base(bookId)}/reports`, { target_type: targetType, target_id: targetId, reason });
}

/** 공감 — 숨김·삭제 글이면 404 (2026-11-18 대표 지시) */
export async function likeCommunityPost(bookId: string, postId: string): Promise<CommunityLikeState> {
  if (USE_MOCK) return (await mock()).mockSetLike(bookId, postId, true);
  const { data } = await api.post<CommunityLikeState>(`${base(bookId)}/posts/${postId}/like`);
  return data;
}

export async function unlikeCommunityPost(bookId: string, postId: string): Promise<CommunityLikeState> {
  if (USE_MOCK) return (await mock()).mockSetLike(bookId, postId, false);
  const { data } = await api.delete<CommunityLikeState>(`${base(bookId)}/posts/${postId}/like`);
  return data;
}

/** 커뮤니티 허브 — 공개 도서별 입구와 글 수 (대표 결정 2026-11-19: 관문 없음) */
export async function fetchCommunityHub(): Promise<CommunityHubResponse> {
  if (USE_MOCK) return (await mock()).mockHub();
  const { data } = await api.get<CommunityHubResponse>('/community/books');
  return data;
}

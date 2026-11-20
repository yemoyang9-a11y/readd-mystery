import { isAxiosError } from 'axios';
import { api } from './api';
import { USE_MOCK } from '../utils/constants';
import type {
  CommunityComment,
  CommunityHubResponse,
  CommunityLikeState,
  CommunityPost,
  CommunityPostDetail,
  CommunityPostPage,
  CommunityReportTarget,
  CommunitySort,
} from '../types';

export type CommunityFailure = 'locked' | 'rate_limited' | 'not_found' | 'failed';

export function classifyCommunityError(error: unknown): CommunityFailure {
  if (!isAxiosError(error)) return 'failed';
  if (error.response?.status === 403 && error.response.data?.error === 'COMMUNITY_LOCKED') return 'locked';
  if (error.response?.status === 429) return 'rate_limited';
  if (error.response?.status === 404) return 'not_found';
  return 'failed';
}

const base = (bookId: string) => `/books/${bookId}/community`;

/** 백엔드 대역 — VITE_USE_MOCK=true 일 때만. 커뮤니티 관문도 대역이 서버처럼 흉내 낸다 */
const mock = () => import('../../mocks/community');

// COMMUNITY
export async function fetchCommunityPosts(
  bookId: string,
  cursor: string | null,
  /** 'popular' 일 때만 보낸다. 서버 기본값은 최신순 */
  sort: CommunitySort
): Promise<CommunityPostPage> {
  if (USE_MOCK) return (await mock()).mockListPosts(bookId, cursor, sort);
  const params: Record<string, string> = {};
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

export async function createCommunityPost(bookId: string, body: string): Promise<CommunityPost> {
  if (USE_MOCK) return (await mock()).mockCreatePost(bookId, body);
  const { data } = await api.post<CommunityPost>(`${base(bookId)}/posts`, { body });
  return data;
}

export async function deleteCommunityPost(bookId: string, postId: string): Promise<void> {
  if (USE_MOCK) return (await mock()).mockDeletePost(bookId, postId);
  await api.delete(`${base(bookId)}/posts/${postId}`);
}

/** 답글 쓰기. replyToCommentId — 답글에 단 답글일 때 그 답글 (T19) */
export async function createCommunityComment(
  bookId: string,
  postId: string,
  body: string,
  replyToCommentId?: string
): Promise<CommunityComment> {
  if (USE_MOCK) return (await mock()).mockCreateComment(bookId, postId, body, replyToCommentId);
  const { data } = await api.post<CommunityComment>(
    `${base(bookId)}/posts/${postId}/comments`,
    replyToCommentId ? { body, reply_to_comment_id: replyToCommentId } : { body }
  );
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

/** 공감 — 커뮤니티 관문 뒤에 있다. 숨김·삭제 글이면 404 (2026-11-18 대표 지시) */
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

/** 답글 좋아요 — 커뮤니티 관문 뒤. 숨김·삭제 답글이면 404 (T19) */
export async function likeCommunityComment(bookId: string, commentId: string): Promise<CommunityLikeState> {
  if (USE_MOCK) return (await mock()).mockSetCommentLike(bookId, commentId, true);
  const { data } = await api.post<CommunityLikeState>(`${base(bookId)}/comments/${commentId}/like`);
  return data;
}

export async function unlikeCommunityComment(bookId: string, commentId: string): Promise<CommunityLikeState> {
  if (USE_MOCK) return (await mock()).mockSetCommentLike(bookId, commentId, false);
  const { data } = await api.delete<CommunityLikeState>(`${base(bookId)}/comments/${commentId}/like`);
  return data;
}

/**
 * 커뮤니티 허브 — 공개 도서별 입구. 열림 여부(끝까지 간 독자인지)는 서버가 도서마다 정해 access 로 준다.
 * 프론트는 access 를 그대로 그린다 (절대 규칙 2, FR-BRF-005 🚦)
 */
export async function fetchCommunityHub(): Promise<CommunityHubResponse> {
  if (USE_MOCK) return (await mock()).mockHub();
  const { data } = await api.get<CommunityHubResponse>('/community/books');
  return data;
}

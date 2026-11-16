import { isAxiosError } from 'axios';
import { api } from './api';
import type {
  CommunityComment,
  CommunityKind,
  CommunityPost,
  CommunityPostDetail,
  CommunityPostPage,
  CommunityReportTarget,
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

// COMMUNITY
export async function fetchCommunityPosts(
  bookId: string,
  kind: CommunityKind | null,
  cursor: string | null
): Promise<CommunityPostPage> {
  const params: Record<string, string> = {};
  if (kind) params.kind = kind;
  if (cursor) params.cursor = cursor;
  const { data } = await api.get<CommunityPostPage>(`${base(bookId)}/posts`, { params });
  return data;
}

export async function fetchCommunityPost(bookId: string, postId: string): Promise<CommunityPostDetail> {
  const { data } = await api.get<CommunityPostDetail>(`${base(bookId)}/posts/${postId}`);
  return data;
}

export async function createCommunityPost(
  bookId: string,
  kind: CommunityKind,
  body: string
): Promise<CommunityPost> {
  const { data } = await api.post<CommunityPost>(`${base(bookId)}/posts`, { kind, body });
  return data;
}

export async function deleteCommunityPost(bookId: string, postId: string): Promise<void> {
  await api.delete(`${base(bookId)}/posts/${postId}`);
}

export async function createCommunityComment(
  bookId: string,
  postId: string,
  body: string
): Promise<CommunityComment> {
  const { data } = await api.post<CommunityComment>(`${base(bookId)}/posts/${postId}/comments`, { body });
  return data;
}

export async function deleteCommunityComment(bookId: string, commentId: string): Promise<void> {
  await api.delete(`${base(bookId)}/comments/${commentId}`);
}

export async function reportCommunityTarget(
  bookId: string,
  targetType: CommunityReportTarget,
  targetId: string,
  reason: string
): Promise<void> {
  await api.post(`${base(bookId)}/reports`, { target_type: targetType, target_id: targetId, reason });
}

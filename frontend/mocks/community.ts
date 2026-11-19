/**
 * 커뮤니티 백엔드 대역 — `VITE_USE_MOCK=true` 일 때만 쓰인다 (2026-11-18).
 *
 * 접근 규칙은 서버와 같다 — 공개 도서면 누구나 읽고 쓴다(대표 결정 2026-11-19 "커뮤니티 관문 없애기").
 * 대역이 막는 것은 서버처럼 없는 도서(404)뿐이다. 접근 시험은 backend/src/modules/community/__tests__ 에 있다.
 */
import { AxiosError, type AxiosResponse } from 'axios';
import { mockCatalogResponse, mockPositionResponse } from './server';
import type {
  CommunityComment,
  CommunityHubResponse,
  CommunityKind,
  CommunityLikeState,
  CommunityPost,
  CommunityPostDetail,
  CommunityPostPage,
  CommunitySort,
} from '../src/types';

const PAGE_SIZE = 20;
const ME = 'me';

interface StoredPost {
  seq: number;
  post_id: string;
  book_id: string;
  author: string;
  kind: CommunityKind;
  body: string;
  created_at: string;
  deleted: boolean;
  likes: Set<string>;
}

interface StoredComment {
  comment_id: string;
  post_id: string;
  author: string;
  body: string;
  created_at: string;
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

let seq = 0;
const posts: StoredPost[] = [];
const comments: StoredComment[] = [];

function seed(bookId: string, author: string, kind: CommunityKind, body: string, minutesAgo: number, likers: string[]) {
  seq += 1;
  const post: StoredPost = {
    seq,
    post_id: `mock-post-${seq}`,
    book_id: bookId,
    author,
    kind,
    body,
    created_at: ago(minutesAgo),
    deleted: false,
    likes: new Set(likers),
  };
  posts.push(post);
  return post;
}

function seedComment(post: StoredPost, author: string, body: string, minutesAgo: number) {
  comments.push({
    comment_id: `mock-comment-${comments.length + 1}`,
    post_id: post.post_id,
    author,
    body,
    created_at: ago(minutesAgo),
  });
}

// 「탁류」(MOCK_BOOK_ID) 커뮤니티. 'done-book' 은 글이 없는 빈 커뮤니티로 둔다 — 빈 상태 화면용
{
  const a = seed('takryu', 'r1', 'theory', '처음부터 형보가 수상했어요. 은행 장면에서 태수 뒤를 밟는 묘사가 계속 나오잖아요. 다시 읽으니 복선이 꽤 많네요.', 2900, ['r2', 'r3', 'r4', 'r5']);
  seedComment(a, 'r2', '저도 3장에서 눈치챘어요. 장부 얘기가 나올 때부터요.', 2800);
  seedComment(a, 'r3', '복선 정리해 주셔서 다시 읽고 싶어졌어요', 2700);
  seedComment(a, 'r4', '형보 대사 하나하나가 다르게 읽혀요', 1200);
  seed('takryu', 'r2', 'review', '초봉이의 선택이 마지막까지 마음에 남아요. 군산 미두장 풍경 묘사가 정말 생생했고요.', 1500, ['r1', 'r5']);
  const c = seed('takryu', 'r3', 'theory', '승재가 끝까지 모든 걸 알고 있었다고 보는 분 있나요? 저는 5장 편지 장면이 결정적이었다고 생각해요.', 600, ['r1', 'r2', 'r4', 'r5', 'r6', 'r7']);
  seedComment(c, 'r1', '편지 장면 동의해요. 날짜가 어긋나는 게 걸렸어요', 540);
  seedComment(c, 'r5', '저는 반대로 봤어요. 승재는 마지막에야 알았던 것 같아요', 300);
  seed('takryu', 'r4', 'review', '1930년대 소설인데도 문장이 술술 읽혀서 놀랐어요. 정 주사 가족 이야기가 오래 남을 것 같아요.', 95, []);
  seed('takryu', 'r5', 'theory', '제목 「탁류」가 금강 물줄기이기도 하고 인물들 운명이기도 한 것 같아요. 첫 장 강 묘사부터 다시 보세요.', 12, ['r6']);
}

function nickname(author: string, bookId: string): string {
  let hash = 0;
  for (const ch of `${author}:${bookId}`) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `독자 ${hash.toString(16).padStart(4, '0').slice(-4)}`;
}

function reject(status: number, data?: unknown): never {
  throw new AxiosError('mock', 'ERR_BAD_REQUEST', undefined, null, { status, data } as AxiosResponse);
}

/** 서버의 공개 도서 확인 대역 — 없는 도서는 404 (R12) */
function gate(bookId: string): void {
  if (mockPositionResponse(bookId).status !== 200) reject(404);
}

function visibleComments(postId: string) {
  return comments.filter((c) => c.post_id === postId);
}

function view(post: StoredPost): CommunityPost {
  return {
    post_id: post.post_id,
    kind: post.kind,
    body: post.deleted ? '삭제된 글입니다' : post.body,
    nickname: post.deleted ? null : nickname(post.author, post.book_id),
    created_at: post.created_at,
    comment_count: visibleComments(post.post_id).length,
    like_count: post.deleted ? 0 : post.likes.size,
    liked_by_me: !post.deleted && post.likes.has(ME),
    is_mine: !post.deleted && post.author === ME,
    deleted: post.deleted,
  };
}

function listed(bookId: string) {
  return posts.filter((p) => p.book_id === bookId && (!p.deleted || visibleComments(p.post_id).length > 0));
}

function find(bookId: string, postId: string) {
  const post = listed(bookId).find((p) => p.post_id === postId);
  return post ?? reject(404);
}

export function mockListPosts(
  bookId: string,
  kind: CommunityKind | null,
  cursor: string | null,
  sort: CommunitySort
): CommunityPostPage {
  gate(bookId);
  let rows = listed(bookId).filter((p) => !kind || p.kind === kind);
  rows =
    sort === 'popular'
      ? rows.sort((a, b) => view(b).like_count - view(a).like_count || b.seq - a.seq)
      : rows.sort((a, b) => b.seq - a.seq);
  const offset = cursor ? Number(cursor) : 0;
  const page = rows.slice(offset, offset + PAGE_SIZE);
  return {
    posts: page.map(view),
    next_cursor: rows.length > offset + PAGE_SIZE ? String(offset + PAGE_SIZE) : null,
  };
}

export function mockGetPost(bookId: string, postId: string): CommunityPostDetail {
  gate(bookId);
  const post = find(bookId, postId);
  return {
    post: view(post),
    comments: visibleComments(postId).map(
      (c): CommunityComment => ({
        comment_id: c.comment_id,
        body: c.body,
        nickname: nickname(c.author, bookId),
        created_at: c.created_at,
        is_mine: c.author === ME,
      })
    ),
  };
}

export function mockCreatePost(bookId: string, kind: CommunityKind, body: string): CommunityPost {
  gate(bookId);
  return view(seed(bookId, ME, kind, body, 0, []));
}

export function mockDeletePost(bookId: string, postId: string): void {
  gate(bookId);
  const post = find(bookId, postId);
  if (post.author !== ME) reject(404);
  post.deleted = true;
}

export function mockCreateComment(bookId: string, postId: string, body: string): CommunityComment {
  gate(bookId);
  const post = find(bookId, postId);
  if (post.deleted) reject(404);
  seedComment(post, ME, body, 0);
  const c = comments[comments.length - 1];
  return { comment_id: c.comment_id, body, nickname: nickname(ME, bookId), created_at: c.created_at, is_mine: true };
}

export function mockDeleteComment(bookId: string, commentId: string): void {
  gate(bookId);
  const index = comments.findIndex((c) => c.comment_id === commentId && c.author === ME);
  if (index < 0) reject(404);
  comments.splice(index, 1);
}

export function mockReport(bookId: string): void {
  gate(bookId);
}

export function mockSetLike(bookId: string, postId: string, on: boolean): CommunityLikeState {
  gate(bookId);
  const post = find(bookId, postId);
  if (post.deleted) reject(404);
  if (on) post.likes.add(ME);
  else post.likes.delete(ME);
  return { like_count: post.likes.size, liked_by_me: post.likes.has(ME) };
}

export function mockHub(): CommunityHubResponse {
  return {
    books: mockCatalogResponse()
      .books.filter((book) => book.ssabi_ready)
      .map((book) => ({
        book_id: book.book_id,
        title: book.title,
        author: book.author,
        cover_url: book.cover_url || null,
        post_count: posts.filter((p) => p.book_id === book.book_id && !p.deleted).length,
      })),
  };
}

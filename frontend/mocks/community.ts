/**
 * 커뮤니티 백엔드 대역 — `VITE_USE_MOCK=true` 일 때만 쓰인다 (2026-11-18).
 *
 * ⚠️ 여기의 판정은 **서버 커뮤니티 관문의 대역**이다. 실제 관문은 백엔드 커뮤니티 라우터가
 *    기준점 결정기(getCutoffSnapshot().reached_end — 가장 멀리 펼친 쪽 = 마지막 쪽, 차례 읽기는 따지지 않음.
 *    대표 결정 2026-11-19 정정)로 하며, 화면 코드는 이 판정을 갖지 않는다.
 *    게이트 시험은 backend/src/modules/community/__tests__ 에 있다.
 */
import { AxiosError, type AxiosResponse } from 'axios';
import { mockCatalogResponse, mockPositionResponse, mockReachedEnd } from './server';
import type {
  CommunityComment,
  CommunityHubResponse,
  CommunityLikeState,
  CommunityPost,
  CommunityPostDetail,
  CommunityPostPage,
  CommunitySort,
} from '../src/types';

const PAGE_SIZE = 20;
/** 대역의 로그인 독자. 서버에서는 가입 닉네임(users.display_name)이 이름이 된다 */
const ME = '시험 독자';

interface StoredPost {
  seq: number;
  post_id: string;
  book_id: string;
  author: string;
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
  reply_to: string | null;
  likes: Set<string>;
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

let seq = 0;
const posts: StoredPost[] = [];
const comments: StoredComment[] = [];

function seed(bookId: string, author: string, body: string, minutesAgo: number, likers: string[]) {
  seq += 1;
  const post: StoredPost = {
    seq,
    post_id: `mock-post-${seq}`,
    book_id: bookId,
    author,
    body,
    created_at: ago(minutesAgo),
    deleted: false,
    likes: new Set(likers),
  };
  posts.push(post);
  return post;
}

function seedComment(
  post: StoredPost,
  author: string,
  body: string,
  minutesAgo: number,
  replyTo: StoredComment | null = null,
  likers: string[] = []
) {
  const comment: StoredComment = {
    comment_id: `mock-comment-${comments.length + 1}`,
    post_id: post.post_id,
    author,
    body,
    created_at: ago(minutesAgo),
    reply_to: replyTo?.comment_id ?? null,
    likes: new Set(likers),
  };
  comments.push(comment);
  return comment;
}

// 「탁류」(MOCK_BOOK_ID) 커뮤니티 — 2026-11-20 시안 3의 댓글·답글. 'done-book' 은 빈 커뮤니티(빈 화면용)
{
  seed('takryu', '정독파', '1930년대 소설인데도 문장이 술술 읽혀서 놀랐어요', 1500, ['a', 'b', 'c', 'd']);
  seed('takryu', '미두장단골', '정 주사 가족 이야기가 오래 남을 것 같아요', 1400, ['a', 'b']);
  const cat = seed('takryu', '추리하는고양이', '태수가 처음 나올 때부터 수상했는데 결국 그렇게 될 줄은 몰랐네요', 300, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
  seedComment(cat, '정독파', '저도 은행 장면부터 이상했어요', 200);
  const moon = seed('takryu', '달빛서재', '초봉이 군산을 떠나는 장면에서 한참 멈춰 있었어요. 강물 묘사가 인물들 처지랑 겹쳐 보여요', 180, Array.from({ length: 18 }, (_, i) => `l${i}`));
  const worm = seedComment(moon, '책벌레', '저도요. 첫 장 강 묘사부터 다시 읽고 싶어졌어요', 120, null, ['a', 'b', 'c']);
  const night = seedComment(moon, '밤샘독서', '마지막 장이랑 첫 장이 이어지는 느낌이죠?', 60, worm, ['a']);
  seedComment(moon, '달빛서재', '네, 그래서 더 오래 남는 것 같아요', 48, night);
  seedComment(moon, '정독파', '군산 부두 장면 저도 기억나요', 8);
  seed('takryu', '밤샘독서', '마지막 장 읽고 첫 장을 다시 펼쳤어요', 12, []);
}

function reject(status: number, data?: unknown): never {
  throw new AxiosError('mock', 'ERR_BAD_REQUEST', undefined, null, { status, data } as AxiosResponse);
}

/** 서버 커뮤니티 관문 대역 — 공개 도서 확인(404) 뒤 reached_end 대역만 본다 */
function gate(bookId: string): void {
  const position = mockPositionResponse(bookId);
  if (position.status !== 200) reject(404);
  if (!mockReachedEnd(bookId)) reject(403, { error: 'COMMUNITY_LOCKED' });
}

function visibleComments(postId: string) {
  return comments.filter((c) => c.post_id === postId);
}

function view(post: StoredPost): CommunityPost {
  return {
    post_id: post.post_id,
    body: post.deleted ? '삭제된 댓글입니다' : post.body,
    nickname: post.deleted ? null : post.author,
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

export function mockListPosts(bookId: string, cursor: string | null, sort: CommunitySort): CommunityPostPage {
  gate(bookId);
  let rows = listed(bookId);
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
    comments: visibleComments(postId).map((c) => replyView(post, c)),
  };
}

function replyView(post: StoredPost, c: StoredComment): CommunityComment {
  const target = c.reply_to ? comments.find((x) => x.comment_id === c.reply_to) : null;
  return {
    comment_id: c.comment_id,
    body: c.body,
    nickname: c.author,
    created_at: c.created_at,
    is_mine: c.author === ME,
    is_post_author: !post.deleted && c.author === post.author,
    reply_to_nickname: c.reply_to ? (target?.author ?? null) : post.deleted ? null : post.author,
    like_count: c.likes.size,
    liked_by_me: c.likes.has(ME),
  };
}

export function mockCreatePost(bookId: string, body: string): CommunityPost {
  gate(bookId);
  return view(seed(bookId, ME, body, 0, []));
}

export function mockDeletePost(bookId: string, postId: string): void {
  gate(bookId);
  const post = find(bookId, postId);
  if (post.author !== ME) reject(404);
  post.deleted = true;
}

export function mockCreateComment(
  bookId: string,
  postId: string,
  body: string,
  replyToCommentId?: string
): CommunityComment {
  gate(bookId);
  const post = find(bookId, postId);
  if (post.deleted) reject(404);
  const target = replyToCommentId
    ? (comments.find((c) => c.comment_id === replyToCommentId && c.post_id === postId) ?? reject(404))
    : null;
  return replyView(post, seedComment(post, ME, body, 0, target));
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

export function mockSetCommentLike(bookId: string, commentId: string, on: boolean): CommunityLikeState {
  gate(bookId);
  const comment = comments.find((c) => c.comment_id === commentId) ?? reject(404);
  find(bookId, comment.post_id);
  if (on) comment.likes.add(ME);
  else comment.likes.delete(ME);
  return { like_count: comment.likes.size, liked_by_me: comment.likes.has(ME) };
}

export function mockHub(): CommunityHubResponse {
  return {
    books: mockCatalogResponse()
      .books.filter((book) => book.ssabi_ready)
      .map((book) => {
        const card = { book_id: book.book_id, title: book.title, author: book.author, cover_url: book.cover_url || null };
        const position = mockPositionResponse(book.book_id);
        if (position.status !== 200 || !mockReachedEnd(book.book_id)) return { ...card, access: 'locked' as const };
        return { ...card, access: 'open' as const, post_count: posts.filter((p) => p.book_id === book.book_id && !p.deleted).length };
      }),
  };
}

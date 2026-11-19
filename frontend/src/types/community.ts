export type CommunityKind = 'theory' | 'review';

/** 목록 정렬 — 최신순(기본) · 인기순(공감 많은 순) (2026-11-18 대표 지시) */
export type CommunitySort = 'new' | 'popular';

export interface CommunityPost {
  post_id: string;
  kind: CommunityKind;
  body: string;
  nickname: string | null;
  created_at: string;
  comment_count: number;
  /** 공감 수 — 서버가 숨김·삭제 글을 0으로 내려 준다 */
  like_count: number;
  liked_by_me: boolean;
  is_mine: boolean;
  deleted: boolean;
}

export interface CommunityComment {
  comment_id: string;
  body: string;
  nickname: string;
  created_at: string;
  is_mine: boolean;
}

export interface CommunityPostPage {
  posts: CommunityPost[];
  next_cursor: string | null;
}

export interface CommunityPostDetail {
  post: CommunityPost;
  comments: CommunityComment[];
}

export type CommunityReportTarget = 'post' | 'comment';

export interface CommunityLikeState {
  like_count: number;
  liked_by_me: boolean;
}

/**
 * GET /community/books 의 도서 1건.
 * 대표 결정 2026-11-19 "커뮤니티 관문 없애기" — 모든 공개 도서가 글 수와 함께 열린 입구로 온다.
 */
export interface CommunityHubBook {
  book_id: string;
  title: string;
  author: string;
  cover_url: string | null;
  post_count: number;
}

export interface CommunityHubResponse {
  books: CommunityHubBook[];
}

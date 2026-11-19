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

interface CommunityHubBookBase {
  book_id: string;
  title: string;
  author: string;
  cover_url: string | null;
}

/**
 * GET /community/books 의 도서 1건.
 * 잠긴 도서에는 서버가 글 수를 넣지 않는다 — 끝까지 가지 않은 독자에게 글·개수 0건 (대표 결정 2026-11-19 정정)
 */
export type CommunityHubBook =
  | (CommunityHubBookBase & { access: 'open'; post_count: number })
  | (CommunityHubBookBase & { access: 'locked' });

export interface CommunityHubResponse {
  books: CommunityHubBook[];
}

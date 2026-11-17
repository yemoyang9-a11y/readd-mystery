/**
 * 서로 다른 독자(reader_id) 이만큼이 신고하면 글·댓글을 자동으로 숨긴다.
 * 같은 독자의 반복 신고는 한 번으로 센다(community_reports UNIQUE). 관리자가 복구하면
 * 그 뒤에 들어온 새 신고자만 다시 센다. — 대표 결정 2026-11-17
 */
export const AUTO_HIDE_REPORT_THRESHOLD = 3;

export type PostKind = 'theory' | 'review';
export type ReportTarget = 'post' | 'comment';

export interface PostRow {
  seq: number;
  post_id: string;
  reader_id: string;
  kind: PostKind;
  body: string;
  created_at: string;
  deleted: boolean;
  comment_count: number;
}

export interface CommentRow {
  comment_id: string;
  post_id: string;
  reader_id: string;
  body: string;
  created_at: string;
}

export interface ListPostsQuery {
  kind?: PostKind;
  before?: number;
  limit: number;
}

export interface CommunityRepository {
  listPosts(bookId: string, query: ListPostsQuery): Promise<PostRow[]>;
  getPost(bookId: string, postId: string): Promise<PostRow | null>;
  listComments(bookId: string, postId: string): Promise<CommentRow[]>;
  createPost(bookId: string, readerId: string, kind: PostKind, body: string): Promise<PostRow>;
  createComment(
    bookId: string,
    postId: string,
    readerId: string,
    body: string
  ): Promise<CommentRow | null>;
  deletePost(bookId: string, postId: string, readerId: string): Promise<boolean>;
  deleteComment(bookId: string, commentId: string, readerId: string): Promise<boolean>;
  countRecentPosts(readerId: string): Promise<number>;
  countRecentComments(readerId: string): Promise<number>;
  createReport(
    bookId: string,
    reporterId: string,
    targetType: ReportTarget,
    targetId: string,
    reason: string
  ): Promise<boolean>;
}

export interface ReportSummary {
  report_id: string;
  book_id: string;
  target_type: ReportTarget;
  target_id: string;
  reason: string;
  created_at: string;
  target_body: string | null;
  target_deleted: boolean;
}

export interface CommunityAdminRepository {
  listReports(): Promise<ReportSummary[]>;
  deletePost(postId: string): Promise<boolean>;
  deleteComment(commentId: string): Promise<boolean>;
}

/** 관리자 신고 관리 화면의 한 줄 — 신고된 글·댓글 하나. 신고자 식별자는 담지 않는다. */
export interface ModerationItem {
  target_type: ReportTarget;
  target_id: string;
  book_id: string;
  book_title: string | null;
  body: string | null;
  /** 지금까지 신고한 서로 다른 독자 수 */
  report_count: number;
  /** 마지막 복구(검토) 뒤에 신고한 서로 다른 독자 수 — 자동 숨김 임계값은 이 값으로 센다 */
  reports_since_review: number;
  /** 신고 사유, 최신순 */
  reasons: string[];
  hidden: boolean;
  deleted: boolean;
  hidden_at: string | null;
  reviewed_at: string | null;
  last_reported_at: string;
}

/**
 * 신고 관리(대표 결정 2026-11-17). CommunityAdminRepository와 따로 둔 이유: 기존 완독 게이트
 * 시험의 관리자 저장소 대역을 건드리지 않으려고. 관리자 라우터는 두 메서드가 다 있을 때만
 * 신고 관리 경로를 연다. pg 저장소는 항상 둘 다 구현한다.
 */
export interface CommunityModerationRepository {
  listModeration(): Promise<ModerationItem[]>;
  /** 숨김을 풀고 검토 시각을 남긴다. 신고 기록은 지우지 않는다. 대상이 없으면 false */
  restore(targetType: ReportTarget, targetId: string): Promise<boolean>;
}

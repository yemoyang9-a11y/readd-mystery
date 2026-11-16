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

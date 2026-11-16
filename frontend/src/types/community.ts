export type CommunityKind = 'theory' | 'review';

export interface CommunityPost {
  post_id: string;
  kind: CommunityKind;
  body: string;
  nickname: string | null;
  created_at: string;
  comment_count: number;
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

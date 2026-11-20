-- T19 커뮤니티 댓글 방식 (대표 결정 2026-11-20)
-- community_posts 한 줄 = 댓글, community_comments 한 줄 = 답글. 말머리는 더 받지 않는다(기존 값은 남김).
-- 답글에 단 답글은 reply_to_comment_id 로 대상 답글을 가리킨다(NULL = 댓글에 바로 단 답글).

ALTER TABLE community_posts ALTER COLUMN kind DROP NOT NULL;

ALTER TABLE community_comments
    ADD COLUMN IF NOT EXISTS reply_to_comment_id UUID REFERENCES community_comments (comment_id);

CREATE TABLE IF NOT EXISTS community_comment_likes (
    comment_id UUID        NOT NULL REFERENCES community_comments (comment_id) ON DELETE CASCADE,
    reader_id  UUID        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (comment_id, reader_id)
);

CREATE INDEX IF NOT EXISTS ix_community_comment_likes_reader ON community_comment_likes (reader_id, created_at);

ALTER TABLE community_comment_likes ENABLE ROW LEVEL SECURITY;

-- 2026-11-18 커뮤니티 공감 — 대표 지시 2026-11-18 ("커뮤니티도 형성해줘")
-- 한 독자는 한 글에 한 번만 공감한다(PK). 공감은 완독 게이트(서버 is_complete)를 지난 독자만
-- 누를 수 있고, 숨김(hidden_at)·삭제(deleted_at) 글의 공감은 응답 어디에도 세지 않는다.
-- 독자 응답은 백엔드 API 로만 나간다 — 다른 커뮤니티 표와 같이 RLS 를 켜고 정책을 두지 않는다.
CREATE TABLE IF NOT EXISTS community_post_likes (
    post_id    UUID        NOT NULL REFERENCES community_posts (post_id) ON DELETE CASCADE,
    reader_id  UUID        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, reader_id)
);

CREATE INDEX IF NOT EXISTS ix_community_post_likes_reader ON community_post_likes (reader_id, created_at);

ALTER TABLE community_post_likes ENABLE ROW LEVEL SECURITY;

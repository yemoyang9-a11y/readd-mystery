-- 2026-11-24 대표 결정 — 추리 결과지 공유. 029(채점)와 따로 둔다: 커뮤니티 표만 바꾼다.
--
-- community_posts.review_card — 공유한 결과지의 복사본(공유한 시점 그대로).
--    노트 원본은 비공개라 원본을 비추지 않고 복사해 둔다. 독자·책당 보이는(지우지 않은) 결과지 글은 하나.
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS review_card JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS ux_community_posts_review_card
    ON community_posts (book_id, reader_id)
    WHERE review_card IS NOT NULL AND deleted_at IS NULL;

-- 2026-11-24 대표 결정 — 추리 채점(완독 뒤 내 추리 돌아보기)과 결과지 공유.
--
-- ① reading_position.reached_end_at — 가장 멀리 펼친 쪽이 마지막 쪽에 처음 닿은 시각.
--    한 번 기록되면 바뀌지 않는다. 이 마이그레이션 전에 이미 끝까지 간 독자는 NULL 로 둔다
--    (나중 시각으로 채우면 결말을 본 뒤 쓴 노트가 결말 전 노트로 섞인다).
ALTER TABLE reading_position ADD COLUMN IF NOT EXISTS reached_end_at TIMESTAMPTZ;

-- ② reading_notes.body_updated_at — 노트 본문(글자)을 마지막으로 고친 시각.
--    updated_at 은 종류·풀림 표시를 바꿔도 움직이므로, "결말을 본 뒤 고친 노트"는 본문 기준으로 가른다.
--    기존 노트는 지금까지의 updated_at 을 그대로 옮긴다(더 이른 시각을 알 수 없다).
ALTER TABLE reading_notes ADD COLUMN IF NOT EXISTS body_updated_at TIMESTAMPTZ;
UPDATE reading_notes SET body_updated_at = updated_at WHERE body_updated_at IS NULL;
ALTER TABLE reading_notes ALTER COLUMN body_updated_at SET DEFAULT now();
ALTER TABLE reading_notes ALTER COLUMN body_updated_at SET NOT NULL;

-- ③ note_reviews — 독자·책당 채점 1건. 성공한 결과(status='done')만 '그 1회'로 고정한다.
--    pending 은 진행 중 잠금, failed 는 다시 누를 수 있는 실패 기록이다(AI 호출 실패는 1회로 치지 않는다).
--    이 표가 채점 호출의 기록(로그)도 겸한다: 모델, 범위, 대상·제외 노트 수, 시도 횟수, 마지막 오류.
CREATE TABLE IF NOT EXISTS note_reviews (
    reader_id         UUID        NOT NULL,
    book_id           TEXT        NOT NULL REFERENCES books (book_id) ON DELETE CASCADE,
    status            TEXT        NOT NULL CHECK (status IN ('pending', 'done', 'failed')),
    result            JSONB,
    model             TEXT,
    bound_page        INTEGER     NOT NULL CHECK (bound_page >= 1),
    reached_end_at    TIMESTAMPTZ,
    eligible_count    INTEGER     NOT NULL DEFAULT 0,
    excluded_count    INTEGER     NOT NULL DEFAULT 0,
    attempts          INTEGER     NOT NULL DEFAULT 0,
    last_error        TEXT,
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at      TIMESTAMPTZ,
    PRIMARY KEY (reader_id, book_id),
    CHECK (status <> 'done' OR result IS NOT NULL)
);

ALTER TABLE note_reviews ENABLE ROW LEVEL SECURITY;

-- ④ community_posts.review_card — 공유한 결과지의 복사본(공유한 시점 그대로).
--    노트 원본은 비공개라 원본을 비추지 않고 복사해 둔다. 독자·책당 보이는(지우지 않은) 결과지 글은 하나.
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS review_card JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS ux_community_posts_review_card
    ON community_posts (book_id, reader_id)
    WHERE review_card IS NOT NULL AND deleted_at IS NULL;

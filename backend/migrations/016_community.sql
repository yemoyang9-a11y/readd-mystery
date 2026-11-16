CREATE TABLE IF NOT EXISTS community_posts (
    seq        BIGINT      GENERATED ALWAYS AS IDENTITY,
    post_id    UUID        PRIMARY KEY,
    book_id    TEXT        NOT NULL REFERENCES books (book_id) ON DELETE CASCADE,
    reader_id  UUID        NOT NULL,
    kind       TEXT        NOT NULL CHECK (kind IN ('theory', 'review')),
    body       TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_community_posts_seq ON community_posts (seq);
CREATE INDEX IF NOT EXISTS ix_community_posts_book ON community_posts (book_id, seq DESC);
CREATE INDEX IF NOT EXISTS ix_community_posts_reader ON community_posts (reader_id, created_at);

CREATE TABLE IF NOT EXISTS community_comments (
    seq        BIGINT      GENERATED ALWAYS AS IDENTITY,
    comment_id UUID        PRIMARY KEY,
    post_id    UUID        NOT NULL REFERENCES community_posts (post_id) ON DELETE CASCADE,
    book_id    TEXT        NOT NULL REFERENCES books (book_id) ON DELETE CASCADE,
    reader_id  UUID        NOT NULL,
    body       TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_community_comments_post ON community_comments (post_id, seq);
CREATE INDEX IF NOT EXISTS ix_community_comments_reader ON community_comments (reader_id, created_at);

CREATE TABLE IF NOT EXISTS community_reports (
    report_id   UUID        PRIMARY KEY,
    book_id     TEXT        NOT NULL REFERENCES books (book_id) ON DELETE CASCADE,
    target_type TEXT        NOT NULL CHECK (target_type IN ('post', 'comment')),
    target_id   UUID        NOT NULL,
    reporter_id UUID        NOT NULL,
    reason      TEXT        NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 200),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (target_type, target_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS ix_community_reports_created ON community_reports (created_at DESC);

ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_reports ENABLE ROW LEVEL SECURITY;

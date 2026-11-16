CREATE TABLE IF NOT EXISTS reading_notes (
    note_id    UUID        PRIMARY KEY,
    reader_id  UUID        NOT NULL,
    book_id    TEXT        NOT NULL REFERENCES books (book_id) ON DELETE CASCADE,
    page_no    INTEGER     NOT NULL CHECK (page_no >= 1),
    kind       TEXT        NOT NULL CHECK (kind IN ('clue', 'hypothesis')),
    body       TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_reading_notes_reader_book
    ON reading_notes (reader_id, book_id, page_no, created_at);

ALTER TABLE reading_notes ENABLE ROW LEVEL SECURITY;

-- 2026-11-17 추리 노트 종류 — 종류와 풀림 표시는 독자만 정한다. 시스템·AI는 값을 넣지 않는다.
-- kind: NULL = 일반 메모(기본). clue 단서 / question 궁금한 점 / hypothesis 가설.
-- resolved: 궁금한 점·가설에만 켤 수 있는 독자의 "풀림" 표시.
-- 기존 노트는 독자가 고른 kind(clue·hypothesis)를 그대로 두고 resolved는 false로 시작한다.
ALTER TABLE reading_notes ALTER COLUMN kind DROP NOT NULL;
ALTER TABLE reading_notes DROP CONSTRAINT IF EXISTS reading_notes_kind_check;
ALTER TABLE reading_notes ADD CONSTRAINT reading_notes_kind_check
    CHECK (kind IS NULL OR kind IN ('clue', 'question', 'hypothesis'));

ALTER TABLE reading_notes ADD COLUMN IF NOT EXISTS resolved BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE reading_notes DROP CONSTRAINT IF EXISTS reading_notes_resolved_kind_check;
ALTER TABLE reading_notes ADD CONSTRAINT reading_notes_resolved_kind_check
    CHECK (resolved = false OR (kind IS NOT NULL AND kind IN ('question', 'hypothesis')));

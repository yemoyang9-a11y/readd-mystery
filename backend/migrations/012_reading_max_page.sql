-- 기준 쪽수 = 가장 멀리 읽은 쪽 (FR-PRG-003 🚦)
ALTER TABLE reading_position ADD COLUMN IF NOT EXISTS max_page INTEGER;
UPDATE reading_position SET max_page = current_page WHERE max_page IS NULL;
ALTER TABLE reading_position ALTER COLUMN max_page SET NOT NULL;
ALTER TABLE reading_position DROP CONSTRAINT IF EXISTS reading_position_max_page_check;
ALTER TABLE reading_position ADD CONSTRAINT reading_position_max_page_check CHECK (max_page >= 1);

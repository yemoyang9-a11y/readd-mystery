-- FR-PRG-003 🚦 — 기준점 = 차례로 읽은 쪽 (2026-11-17 대표 결정, A + C안)
-- read_pages: 읽음으로 인정된 쪽들. 1쪽부터 끊김 없이 이어진 마지막 쪽이 기준점이다.
-- confirm_dismissed_max: 싸비 확인 카드에서 "그대로"를 고른 시점의 가장 먼 쪽.
-- 기존 독자는 이벤트 기록이 없어 다시 계산할 수 없다 — 지금 펼친 쪽(current_page)까지 읽은 것으로 둔다(대표 결정).
ALTER TABLE reading_position ADD COLUMN IF NOT EXISTS read_pages INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE reading_position ADD COLUMN IF NOT EXISTS confirm_dismissed_max INTEGER NOT NULL DEFAULT 0;
UPDATE reading_position
   SET read_pages = ARRAY(SELECT generate_series(1, current_page))
 WHERE cardinality(read_pages) = 0;

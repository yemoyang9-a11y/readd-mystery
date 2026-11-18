-- FR-PRG-003 🚦 — 기준점 = 차례로 읽은 쪽 (2026-11-17 대표 결정, A + C안)
-- read_pages: 읽음으로 인정된 쪽들. 1쪽부터 끊김 없이 이어진 마지막 쪽이 기준점이다.
-- confirm_dismissed_max: 싸비 확인 카드에서 "그대로"를 고른 시점의 가장 먼 쪽.
-- 기존 독자는 이벤트 기록이 없어 다시 계산할 수 없다 — 지금 펼친 쪽(current_page)까지 읽은 것으로 둔다(대표 결정).
--
-- 2026-11-18 재실행 안전: 채우기는 read_pages 열을 처음 만들 때 한 번만 한다(023과 같은 DO 블록 방식).
-- 이전에는 다시 실행하면 read_pages가 빈 독자(목차로 건너뛰기만 한 독자)까지 current_page로 채워
-- 건너뛴 앞부분이 읽음으로 인정되었다(기준점 상향 = 스포일러 누출). 처음 적용할 때의 결과는 같다.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'reading_position'
           AND column_name = 'read_pages'
    ) THEN
        ALTER TABLE reading_position ADD COLUMN read_pages INTEGER[] NOT NULL DEFAULT '{}';
        UPDATE reading_position
           SET read_pages = ARRAY(SELECT generate_series(1, current_page))
         WHERE cardinality(read_pages) = 0;
    END IF;
END $$;
ALTER TABLE reading_position ADD COLUMN IF NOT EXISTS confirm_dismissed_max INTEGER NOT NULL DEFAULT 0;

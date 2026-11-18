-- 026 타임라인 장 핵심 한 줄 — 결정 31, 2026-11-18 대표 승인 시안 2차 A안 (장마다 "핵심 한 줄" 50자 안팎)
--
-- 추가 전용 마이그레이션이다. chapter_summaries 에 NULL 허용 열만 더하고 기존 행·열·제약은 건드리지 않는다.
-- 여러 번 실행해도 같은 결과가 나오도록 ADD COLUMN IF NOT EXISTS 로 쓴다
-- (열이 이미 있으면 CHECK 도 다시 만들지 않는다).
--
-- key_point: 그 장 원문(장 끝까지, 장 범위 밖 0자)만 보고 배치(⑦ 파이프라인)가 만든 한 문장, 60자 이하.
--   자동 검사(한 문장·길이·평가어·새 고유명사·근거 인용)를 통과한 것만 쓴다. 없으면 NULL —
--   화면은 장 요약(summary)의 첫 문장으로 대신한다.
--   타임라인 조회는 summary 와 같은 JOIN(다 읽은 장 end_page <= K)에서만 읽는다 (FR-SPL-003 🚦).
-- key_point_review_status: summary 의 review_status 와 같은 값. 배치가 쓸 때 'pending',
--   관리자 화면에서 거절하면 key_point 를 비우고 'rejected'. 책 공개(R12)는 review_records 의
--   chapter_key_point 검수 기록으로 막는다 — summary 와 같은 규칙이다.
ALTER TABLE chapter_summaries
  ADD COLUMN IF NOT EXISTS key_point TEXT NULL;

ALTER TABLE chapter_summaries
  ADD COLUMN IF NOT EXISTS key_point_review_status TEXT NULL
    CHECK (key_point_review_status IN ('pending', 'approved', 'rejected'));

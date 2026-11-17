-- 2026-11-17 커뮤니티 신고 관리 — 대표 결정 2026-11-17 ("관리자 화면 + 신고 3건 자동 숨김")
-- hidden_at:   서로 다른 독자 3명(AUTO_HIDE_REPORT_THRESHOLD)이 신고하면 그 시각을 적는다.
--              값이 있는 글·댓글은 작성자를 포함한 모든 독자 응답에서 빠진다.
-- reviewed_at: 관리자가 복구한 시각. 이 시각 이후에 들어온 신고만 다시 임계값을 센다.
--              신고 기록(community_reports)은 지우지 않는다.
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE community_comments ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
ALTER TABLE community_comments ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_community_reports_target
    ON community_reports (target_type, target_id, created_at);

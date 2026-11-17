-- =============================================================================
-- 018_recap_call_log_length.sql — 리캡 호출 로그에 길이 컬럼 추가 (R2 소유)
--
-- 근거: 2026-11-17 C안(대표 승인) — 리캡 길이 편차 대응. 목표 문장 수 N을 코드가 계산해
--       프롬프트에 넣고(recap-length.ts), 목표 대비 실제 길이를 이 로그로 확인한다.
-- 조항: NFR-OBS-002 🚦 (리캡 호출 로그)
--
-- ⚠️ 세 컬럼 모두 NULL 허용이다. 이 마이그레이션 전에 쌓인 행은 값이 없으므로 NULL로
--    남긴다 — 기존 데이터는 고치지 않는다(채워 넣기·기본값 없음).
-- ⚠️ scripts/migrate.js는 매번 전 파일을 다시 실행하므로 IF NOT EXISTS로 멱등하게 쓴다.
-- =============================================================================

ALTER TABLE recap_call_log
    -- 프롬프트에 넣은 목표 문장 수 N = clamp(완결 장 수 + 원문 유무, 2, 5)
    ADD COLUMN IF NOT EXISTS target_sentences INTEGER CHECK (target_sentences >= 0),
    -- 실제 출력 문자 수 (공백·소제목 포함, 500자 하드 상한으로 잘린 뒤 길이)
    ADD COLUMN IF NOT EXISTS output_chars     INTEGER CHECK (output_chars >= 0),
    -- 실제 출력 문장 수 (소제목 줄 제외)
    ADD COLUMN IF NOT EXISTS output_sentences INTEGER CHECK (output_sentences >= 0);

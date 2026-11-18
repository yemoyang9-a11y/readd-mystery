-- 025 가입 약관 동의 기록 (대표 지시 2026-11-18: 가입 항목은 전자책 플랫폼 조사로)
-- 조사: docs/context/research-2026-11-18-signup-fields.md
--
-- 추가 전용 마이그레이션이다. 새 테이블 하나만 만들고 기존 테이블·제약은 건드리지 않는다.
-- 여러 번 실행해도 같은 결과가 나오도록 IF NOT EXISTS 로 쓴다.
--
-- kind: 'terms'(이용약관) · 'privacy'(개인정보 수집·이용) · 'age14'(만 14세 이상) ·
--       'marketing'(마케팅 정보 수신, 선택). 종류 목록은 서버 코드(consents.ts)가 정한다 —
--       약관이 늘어도 이 테이블을 바꾸지 않도록 CHECK 를 두지 않는다.
-- version: 동의한 약관 문서 버전. 문서가 바뀌면 새 버전 행이 생기고 옛 행은 이력으로 남는다.
-- agreed: 동의 여부. 선택 항목(마케팅)을 거절한 것도 시각과 함께 남긴다.
-- 계정을 지우면(탈퇴) 함께 지워진다.
CREATE TABLE IF NOT EXISTS user_consents (
    user_id   UUID        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    kind      TEXT        NOT NULL,
    version   TEXT        NOT NULL,
    agreed    BOOLEAN     NOT NULL,
    agreed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, kind, version)
);

ALTER TABLE user_consents ENABLE ROW LEVEL SECURITY;

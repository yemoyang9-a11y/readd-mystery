-- 023 이메일 회원가입·로그인 (2026-11-18 대표 지시: 처음 접속하면 로그인·회원가입)
-- 구글·카카오 OAuth 클라이언트가 운영에 없을 수 있어 이메일·비밀번호 경로를 둔다.
-- 여러 번 실행해도 같은 결과가 나오도록 IF NOT EXISTS / DO 블록으로 쓴다.

-- 추가 전용 마이그레이션이다. 이메일 계정은 user_passwords 한 곳에만 저장하고
-- user_identities(OAuth 전용, provider 제약 google·kakao)는 바꾸지 않는다.

-- 비밀번호는 scrypt 해시만 저장한다. 이메일은 소문자로 저장하고 중복을 막는다.
CREATE TABLE IF NOT EXISTS user_passwords (
    user_id       UUID        PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
    email         TEXT        NOT NULL UNIQUE CHECK (email = lower(email)),
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 첫 안내(/guide)를 마쳤는지. 열을 처음 만들 때만 기존 계정을 안내 완료로 채운다
-- (이미 쓰던 독자를 안내 화면으로 다시 보내지 않는다). 다시 실행하면 아무것도 바꾸지 않는다.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'users'
           AND column_name = 'onboarded_at'
    ) THEN
        ALTER TABLE users ADD COLUMN onboarded_at TIMESTAMPTZ NULL;
        UPDATE users SET onboarded_at = created_at;
    END IF;
END $$;

ALTER TABLE user_passwords ENABLE ROW LEVEL SECURITY;

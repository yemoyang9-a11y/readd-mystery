-- 023 이메일 회원가입·로그인 (2026-11-18 대표 지시: 처음 접속하면 로그인·회원가입)
-- 구글·카카오 OAuth 클라이언트가 운영에 없을 수 있어 이메일·비밀번호 경로를 둔다.
-- 여러 번 실행해도 같은 결과가 나오도록 IF NOT EXISTS / DO 블록으로 쓴다.

-- user_identities.provider에 'email'을 허용한다. provider_user_id에는 소문자 이메일을 넣는다.
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    FOR constraint_name IN
        SELECT c.conname
          FROM pg_constraint c
         WHERE c.conrelid = 'user_identities'::regclass
           AND c.contype = 'c'
           AND pg_get_constraintdef(c.oid) LIKE '%provider%'
           AND c.conname <> 'user_identities_provider_check_v2'
    LOOP
        EXECUTE format('ALTER TABLE user_identities DROP CONSTRAINT %I', constraint_name);
    END LOOP;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'user_identities'::regclass
           AND conname = 'user_identities_provider_check_v2'
    ) THEN
        ALTER TABLE user_identities
            ADD CONSTRAINT user_identities_provider_check_v2
            CHECK (provider IN ('google', 'kakao', 'email'));
    END IF;
END $$;

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

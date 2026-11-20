-- 028 커뮤니티 말머리(kind) 칸 삭제 — 대표 지시 2026-11-20 ("말머리라고 불리는 것에 대한 코드를 삭제해")
-- T19 이후 커뮤니티는 말머리 없이 댓글·답글만 쓴다. 칸과 함께 그 CHECK 제약(theory|review)도 없어진다.
-- 칸에 있던 분류 값은 되돌릴 수 없다. 운영 DB 에는 말머리를 읽지 않는 서버를 배포한 뒤에 적용한다.

ALTER TABLE community_posts DROP COLUMN IF EXISTS kind;

-- DEV ONLY
BEGIN;

DELETE FROM review_records WHERE book_id = 'bk-fake000001';
DELETE FROM relationships WHERE book_id = 'bk-fake000001';
DELETE FROM character_notes WHERE book_id = 'bk-fake000001';
DELETE FROM aliases WHERE book_id = 'bk-fake000001';
DELETE FROM characters WHERE book_id = 'bk-fake000001';
DELETE FROM terms WHERE book_id = 'bk-fake000001';
DELETE FROM events WHERE book_id = 'bk-fake000001';
DELETE FROM background_and_intro WHERE book_id = 'bk-fake000001';
DELETE FROM chapter_summaries WHERE book_id = 'bk-fake000001';
DELETE FROM chapters WHERE book_id = 'bk-fake000001';
DELETE FROM pages WHERE book_id = 'bk-fake000001';
DELETE FROM ingest_jobs WHERE book_id = 'bk-fake000001';
DELETE FROM books WHERE book_id = 'bk-fake000001';

INSERT INTO books (book_id, title, author, publish_year, total_pages, ssabi_ready, publish_status)
VALUES ('bk-fake000001', '[가짜] 시험용 추리소설', '시험 저자', 1937, 6, FALSE, 'review');

INSERT INTO pages (book_id, page_no, content) VALUES
  ('bk-fake000001', 1, '[가짜 본문] 비 오는 밤, 탐정 한수는 낡은 저택의 문을 두드렸다. 안에서는 아무 대답도 없었다.'),
  ('bk-fake000001', 2, '[가짜 본문] 집사 도현이 문을 열고 한수를 서재로 안내했다. 서재 책상에는 찢어진 편지가 놓여 있었다.'),
  ('bk-fake000001', 3, '[가짜 본문] 한수는 도현에게 "주인님과는 어떤 사이인가"라고 물었다. 도현은 오래된 집사라고 답했다.'),
  ('bk-fake000001', 4, '[가짜 본문] 둘째 장. 아침이 밝자 저택의 딸 서린이 내려와 한수를 의심스러운 눈으로 보았다.'),
  ('bk-fake000001', 5, '[가짜 본문] 서린은 아버지의 편지를 누가 찢었는지 알고 싶다고 말했다.'),
  ('bk-fake000001', 6, '[가짜 본문] 한수는 도현의 소매에 묻은 잉크 자국을 발견했다.');

INSERT INTO chapters (book_id, chapter_no, title, start_page, end_page) VALUES
  ('bk-fake000001', 1, '[가짜] 비 오는 밤', 1, 3),
  ('bk-fake000001', 2, '[가짜] 찢어진 편지', 4, 6);

INSERT INTO chapter_summaries (book_id, chapter_no, summary) VALUES
  ('bk-fake000001', 1, '[가짜 요약] 탐정 한수가 저택에 도착해 집사 도현을 만난다.'),
  ('bk-fake000001', 2, '[가짜 요약] 저택의 딸 서린이 찢어진 편지의 범인을 찾고 싶어 한다.');

INSERT INTO characters (id, book_id, name, first_appearance_page) VALUES
  ('fake-c1', 'bk-fake000001', '한수', 1),
  ('fake-c2', 'bk-fake000001', '도현', 2),
  ('fake-c3', 'bk-fake000001', '서린', 4);

INSERT INTO aliases (book_id, alias, character_id, alias_type, first_appearance_page) VALUES
  ('bk-fake000001', '탐정', 'fake-c1', 'title', 1),
  ('bk-fake000001', '집사', 'fake-c2', 'title', 2);

INSERT INTO character_notes (id, book_id, character_id, note, source_page) VALUES
  ('fake-n1', 'bk-fake000001', 'fake-c2', '[가짜] 오래된 집사로 저택의 사정을 잘 안다.', 3);

INSERT INTO relationships (id, book_id, character_a_id, character_b_id, label, established_page, semantics) VALUES
  ('fake-r1', 'bk-fake000001', 'fake-c2', 'fake-c3', '집사와 주인의 딸', 5,
   '{"version":2,"direction":"a_to_b","kind":"social","relation_key":"butler_of","summary":"도현은 서린의 집안 집사다","assertion_status":"fact","temporal_scope":"ongoing","state":"active","evidence":{"source_page":3,"quote":"도현은 오래된 집사라고 답했다.","start_char":20,"end_char":38},"verification":{"check":"confirmed","reasons":[]}}'),
  ('fake-r2', 'bk-fake000001', 'fake-c1', 'fake-c2', '의심하는 사이', 6,
   '{"version":2,"direction":"a_to_b","kind":"emotion","relation_key":"suspects","summary":"한수가 도현을 의심한다","assertion_status":"belief","temporal_scope":"ongoing","state":"active","evidence":{"source_page":6,"quote":"도현의 소매에 묻은 잉크 자국을 발견했다.","start_char":10,"end_char":30},"verification":{"check":"needs_review","reasons":["assertion_not_fact","quote_weak"]}}'),
  ('fake-r3', 'bk-fake000001', 'fake-c1', 'fake-c3', '탐정과 의뢰인', 5,
   '{"version":2,"direction":"mutual","kind":"social","relation_key":"client","summary":"서린이 한수에게 조사를 청한다","assertion_status":"claim","temporal_scope":"ongoing","state":"active","evidence":{"source_page":5,"quote":"서린은 아버지의 편지를 누가 찢었는지 알고 싶다고 말했다.","start_char":0,"end_char":30},"verification":{"check":"held","reasons":["page_out_of_range"]}}');

INSERT INTO terms (id, book_id, term, definition, first_appearance_page) VALUES
  ('fake-t1', 'bk-fake000001', '서재', '[가짜] 저택 안에서 주인이 편지를 쓰던 방.', 2);

INSERT INTO events (id, book_id, event, description, occurrence_page) VALUES
  ('fake-e1', 'bk-fake000001', '편지가 찢김', '[가짜] 서재의 편지가 누군가에게 찢겼다.', 2);

INSERT INTO background_and_intro (book_id, kind, content) VALUES
  ('bk-fake000001', 'background', '[가짜] 1930년대 경성을 배경으로 한 시험용 이야기.'),
  ('bk-fake000001', 'intro', '[가짜] 비 오는 밤 저택에서 벌어진 사건을 다룬 시험용 소개 글.');

INSERT INTO ingest_jobs (job_id, book_id, title, author, publish_year, source_sha256, source_path, status, step)
VALUES ('00000000-0000-4000-8000-0000000000f1', 'bk-fake000001', '[가짜] 시험용 추리소설', '시험 저자', 1937,
        'fake-sha-0000000000000000000000000000000000000000000000000000000001', 'n/a', 'review_ready', 'review_ready');

INSERT INTO ingest_jobs (job_id, book_id, title, author, publish_year, source_sha256, source_path, status, step, error)
VALUES ('00000000-0000-4000-8000-0000000000f2', 'bk-fake000002', '[가짜] 실패한 작업', '시험 저자', NULL,
        'fake-sha-0000000000000000000000000000000000000000000000000000000002', 'n/a', 'failed', 'integrity',
        '[가짜 오류] 관계 근거 문장을 원문에서 찾지 못했다')
ON CONFLICT DO NOTHING;

COMMIT;

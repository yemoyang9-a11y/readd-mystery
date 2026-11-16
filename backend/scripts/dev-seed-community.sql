-- DEV ONLY
BEGIN;

DELETE FROM community_reports WHERE book_id = 'bk-fakecomm01';
DELETE FROM community_comments WHERE book_id = 'bk-fakecomm01';
DELETE FROM community_posts WHERE book_id = 'bk-fakecomm01';
DELETE FROM reading_session WHERE book_id = 'bk-fakecomm01';
DELETE FROM reading_position WHERE book_id = 'bk-fakecomm01';
DELETE FROM background_and_intro WHERE book_id = 'bk-fakecomm01';
DELETE FROM chapter_summaries WHERE book_id = 'bk-fakecomm01';
DELETE FROM chapters WHERE book_id = 'bk-fakecomm01';
DELETE FROM pages WHERE book_id = 'bk-fakecomm01';
DELETE FROM books WHERE book_id = 'bk-fakecomm01';

INSERT INTO books (book_id, title, author, publish_year, total_pages, ssabi_ready, publish_status)
VALUES ('bk-fakecomm01', '[가짜] 커뮤니티 시험 추리소설', '시험 저자', 1937, 4, TRUE, 'published');

INSERT INTO pages (book_id, page_no, content) VALUES
  ('bk-fakecomm01', 1, '[가짜 본문] 비 오는 밤, 탐정 한수는 낡은 저택의 문을 두드렸다.'),
  ('bk-fakecomm01', 2, '[가짜 본문] 집사 도현이 문을 열고 한수를 서재로 안내했다.'),
  ('bk-fakecomm01', 3, '[가짜 본문] 둘째 장. 아침이 밝자 저택의 딸 서린이 내려왔다.'),
  ('bk-fakecomm01', 4, '[가짜 본문] 한수는 도현의 소매에 묻은 잉크 자국을 발견했다. 범인은 도현이었다. (가짜 결말)');

INSERT INTO chapters (book_id, chapter_no, title, start_page, end_page) VALUES
  ('bk-fakecomm01', 1, '[가짜] 비 오는 밤', 1, 2),
  ('bk-fakecomm01', 2, '[가짜] 잉크 자국', 3, 4);

INSERT INTO chapter_summaries (book_id, chapter_no, summary, review_status) VALUES
  ('bk-fakecomm01', 1, '[가짜 요약] 탐정 한수가 저택에 도착해 집사 도현을 만난다.', 'approved'),
  ('bk-fakecomm01', 2, '[가짜 요약] 한수가 도현의 소매에서 잉크 자국을 발견한다.', 'approved');

INSERT INTO background_and_intro (book_id, kind, content) VALUES
  ('bk-fakecomm01', 'background', '[가짜] 시험용 배경 설명.'),
  ('bk-fakecomm01', 'intro', '[가짜] 시험용 소개 글.');

COMMIT;

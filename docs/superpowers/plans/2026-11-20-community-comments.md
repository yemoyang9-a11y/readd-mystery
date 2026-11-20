# 커뮤니티 댓글 방식 개편 (T19) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 책 이야기방을 말머리 있는 게시판에서 인스타그램 배치의 댓글·답글 화면(RE:ADD 밤 화면 디자인)으로 바꾼다.

**Architecture:** 저장 구조는 그대로 두고 뜻만 바꾼다 — `community_posts` 한 줄 = 댓글, `community_comments` 한 줄 = 답글. 마이그레이션 027이 말머리(`kind`)를 선택값으로 풀고, 답글 대상(`reply_to_comment_id`)과 답글 좋아요 표를 더한다. 이름은 `users.display_name`을 읽고 없으면 지금의 "독자 xxxx"로 내려간다. 화면은 `MobileCommunity.tsx`를 새 부품 셋(댓글 한 줄 · 답글 묶음 · 아래 입력창)으로 다시 짠다.

**Tech Stack:** Express + pg (backend, Jest), React 18 + Tailwind + Vite (frontend, Vitest + Testing Library), Playwright(로컬 확인).

**Spec:** 대표 승인 시안 3 — [docs/validation/2026-11-20-community-comments/draft-v3.html](../../validation/2026-11-20-community-comments/draft-v3.html) (캡처 `v3-list.png`·`v3-replies.png`·`v3-replying.png`·`v3-empty.png`), 결정 기록은 [tasks.md](../../context/tasks.md) T19. 조사: [research-2026-11-19-community-ui.md](../../context/research-2026-11-19-community-ui.md).

## Global Constraints

- 커뮤니티 관문은 그대로: 모든 독자 경로는 `authorize()`(R12 공개 도서 → `getCutoffSnapshot().reached_end === true`)를 저장소 접근보다 먼저 지난다. 새 경로(답글 좋아요)도 같다 — FR-QNA-004 🚦, 절대 규칙 7. 막힌 요청의 저장소 접근 0건 테스트를 positive 쌍과 함께 쓴다.
- 커뮤니티는 기준점을 바꾸지 않는다. 클라이언트가 기준점·완독 값을 보내도 보지 않는다(절대 규칙 8).
- 신고로 숨긴(`hidden_at`) 댓글·답글은 응답 어디에도 넣지 않는다. 삭제된 댓글은 답글이 남아 있을 때만 "삭제된 글입니다" 대신 **"삭제된 댓글입니다"**로 보인다.
- 말머리 없음, 제목 칸 없음. 화면 문구에 "AI"·"싸비"·영어 장식 글씨(CASE CLOSED 등)를 쓰지 않는다. 불필요한 부연설명 문장을 넣지 않는다(시간·좋아요 줄 같은 정보 줄은 13px 옅은 색 허용 — 2026-11-20 대표 정정).
- 처음 열 때 정렬은 **최신순**(`sort=new`), 버튼은 "최신순"·"인기순".
- 답글: 몇 번이든 달 수 있고 화면 들여쓰기는 한 칸. 모든 답글 본문 앞에 `@닉네임`. 댓글에 바로 단 답글은 `@댓글쓴이`.
- 펼치기 문구: "답글 N개 모두 보기" / "답글 모두 숨기기". 입력창 빈칸 문구: "댓글 달기...". 답글 중 줄: "{닉네임}님에게 답글 남기는 중" + ✕. 보내기 버튼: "게시". 빈 화면: "아직 아무도 / 이야기를 꺼내지 않았어요" + "다 읽은 소감을 처음으로 남겨 주세요.". 머리줄: 작은 글씨 "다 읽은 독자 이야기" + 책 제목(명조), 그 아래 "{N}개의 댓글".
- 색(밤 화면, `docs/brand`): 바탕 `#0d0a0b`, 카드 `#1e1618`, 선 `#35292c`, 글자 `#ece6e0`, 옅은 글자 `#b5aaa6`, 버건디 `#8f1d35`·`#c4475f`, 밝은 버건디 `#e58a9b`. 제목·숫자 `font-dashSerif`, 나머지 `font-dashSans`.
- 길이 제한·속도 제한은 그대로: 댓글(구 글) 2000자·시간당 10개, 답글(구 댓글) 1000자·시간당 30개.
- 조항 근거 주석은 ID만 남긴다(예: `// FR-QNA-004 🚦`). 테스트 이름에 조항 문구.
- 운영 DB(Supabase `readd-mystery`)에 027을 적용하는 일은 이 계획에 없다 — 대표 승인 뒤 따로.

## Review Focus

1. **답글 대상이 숨김·삭제·다른 댓글 묶음의 답글일 때** — `reply_to_comment_id`가 같은 댓글 묶음의 보이는 답글이 아니면 404, 답글은 저장되지 않는다. (Task 1·2 테스트)
2. **가입 닉네임이 없는 독자(기기만 쓰는 독자·이름 비운 계정·탈퇴 계정)** — 이름이 비지 않고 "독자 xxxx"로 보인다. (Task 1·2 테스트)
3. **답글이 달린 댓글을 지운 뒤 답글 좋아요·새 답글** — 삭제된 댓글 묶음에는 새 답글을 달 수 없고(404), 기존 답글은 보이며 좋아요도 된다. (Task 2·3 테스트)
4. **답글을 펼친 채 정렬을 바꾸거나 새 답글을 게시** — 펼친 묶음의 답글 수·목록이 즉시 맞게 갱신되고, 게시 뒤 입력창이 "댓글 달기..."로 돌아간다. (Task 5 테스트)
5. **휴대폰 키보드가 올라온 상태** — 아래 입력창이 키보드 위에 있고 마지막 댓글이 입력창에 가려지지 않는다. (Task 6 로컬 확인)

---

### Task 1: 저장 구조 — 마이그레이션 027과 pg 저장소

**Files:**
- Create: `backend/migrations/027_community_replies.sql`
- Modify: `backend/src/modules/community/repository.ts`
- Modify: `backend/src/modules/community/pg-repository.ts`
- Test: `backend/src/modules/community/__tests__/replies.pg.test.ts` (실제 Postgres, `COMMUNITY_TEST_DATABASE_URL` 있을 때만 — `engagement.test.ts`의 스키마 생성 방식을 그대로 따른다. 016·022·024·027과 `users` 표(010의 `users`만)를 적용)

**Interfaces:**
- Produces (repository.ts):
  - `PostRow.kind: PostKind | null`, `PostRow.author_name: string | null` (users.display_name)
  - `CommentRow` 추가 필드: `reply_to_comment_id: string | null`, `reply_to_reader_id: string | null`, `reply_to_name: string | null`, `author_name: string | null`, `like_count?: number`, `liked_by_me?: boolean`
  - `ListPostsQuery`에서 `kind` 제거
  - `createPost(bookId: string, readerId: string, body: string): Promise<PostRow>`
  - `createComment(bookId: string, postId: string, readerId: string, body: string, replyToCommentId: string | null): Promise<CommentRow | null>` — 댓글이 보이지 않거나, `replyToCommentId`가 같은 `post_id`의 보이는 답글이 아니면 `null`
  - `listComments(bookId: string, postId: string, viewerId?: string): Promise<CommentRow[]>` — `seq` 오름차순
  - `CommunityEngagementRepository`에 `likeComment(bookId, commentId, readerId): Promise<boolean>`, `unlikeComment(...)`, `commentLikeState(bookId, commentId, readerId): Promise<{ like_count: number; liked_by_me: boolean }>` — 글 좋아요와 같은 멱등·숨김 규칙
- 027 내용(모두 `IF NOT EXISTS`/멱등): `community_posts.kind` NOT NULL 해제(기존 CHECK는 NULL 통과), `community_comments.reply_to_comment_id UUID NULL REFERENCES community_comments(comment_id)`, `community_comment_likes (comment_id UUID REFERENCES community_comments ON DELETE CASCADE, reader_id UUID, created_at, PRIMARY KEY (comment_id, reader_id))` + reader 인덱스 + RLS.

- [ ] **Step 1: 실패 테스트 작성** — `replies.pg.test.ts`
  - `test('migration 027: kind 없이 댓글 저장, 두 번 적용해도 그대로, community_comment_likes RLS·PK (comment_id, reader_id)')`
  - `test('답글: 댓글에 바로 단 답글은 reply_to_* 가 null, 답글에 단 답글은 대상 id·작성자·이름이 채워진다')`
  - `test('Review Focus 1: 숨김·삭제·다른 댓글의 답글을 대상으로 하면 null, 저장 0건')`
  - `test('Review Focus 2: users.display_name 이 있으면 author_name, 없거나 users 행이 없으면 null')`
  - `test('답글 좋아요: 한 독자 한 번(멱등), 취소, 숨김·삭제 답글은 false, listComments 의 like_count·liked_by_me 반영')`
  - `test('기존 데이터: kind=theory|review 글은 그대로 읽히고 kind 필드만 남는다')`
- [ ] **Step 2: 실패 확인** — `cd backend && COMMUNITY_TEST_DATABASE_URL=<로컬 Postgres> npx jest src/modules/community/__tests__/replies.pg.test.ts` → FAIL. 로컬 Postgres가 없으면 이 파일은 skip되므로 Step 4에서 반드시 로컬 DB로 한 번 돌리고, 못 돌렸으면 보고에 적는다.
- [ ] **Step 3: 027 작성, repository.ts 타입 변경, pg-repository.ts 구현** — 이름은 `LEFT JOIN users u ON u.reader_id = p.reader_id`(답글은 `c.reader_id`, 대상은 `community_comments r` 자기 조인 + `users`). 답글 좋아요 수는 `LIKE_COUNT`와 같은 모양으로 숨김·삭제면 0.
- [ ] **Step 4: 통과 확인** — 위 명령 PASS, 그리고 `npx jest src/modules/community` 전체(기존 engagement·moderation pg 테스트 포함) PASS. `npx tsc --noEmit`은 Task 2 뒤에 통과하면 된다.
- [ ] **Step 5: 커밋** — `feat(R5): 커뮤니티 답글 대상·답글 좋아요·말머리 선택값 — 마이그레이션 027, T19`

### Task 2: 독자 API — 이름·답글·말머리 제거

**Files:**
- Modify: `backend/src/modules/community/router.ts`
- Modify: `backend/src/modules/community/__tests__/router.test.ts` (FakeCommunity를 새 인터페이스에 맞춤)
- Modify: `backend/src/modules/community/__tests__/completion-gate.test.ts`, `engagement.test.ts`, `moderation.test.ts` (가짜 저장소 시그니처만)

**Interfaces:**
- Consumes: Task 1 repository.ts
- Produces (응답 모양, 프론트가 그대로 씀):
  - 댓글(구 글) `publicPost`: `{ post_id, body, nickname, created_at, comment_count, like_count, liked_by_me, is_mine, deleted }` — `kind` 없음. `nickname = deleted ? null : (author_name ?? nicknameFor(reader_id, bookId))`. 삭제 본문 `"삭제된 댓글입니다"`.
  - 답글 `publicComment`: `{ comment_id, body, nickname, created_at, is_mine, is_post_author, reply_to_nickname, like_count, liked_by_me }` — `reply_to_nickname`은 대상 답글 작성자 이름, 대상이 없으면 댓글 작성자 이름(둘 다 `author_name ?? nicknameFor`). `is_post_author = row.reader_id === post.reader_id`.
  - `GET /books/:bookId/community/posts?sort=new|popular&cursor=` — `kind` 파라미터는 받지 않는다(와도 무시).
  - `POST /books/:bookId/community/posts` body `{ body }` — `kind`는 무시, 저장은 `null`.
  - `POST /books/:bookId/community/posts/:postId/comments` body `{ body, reply_to_comment_id?: string }` — UUID 형식이 아니면 400, 저장소가 `null`이면 404. 응답 201은 `publicComment`(이름·`reply_to_nickname` 포함)를 위해 생성 뒤 그 댓글 묶음의 행을 다시 읽어 만든다.

- [ ] **Step 1: 실패 테스트 작성** — `router.test.ts`에서 말머리 관련 테스트(`kind는 theory|review`, `kind 필터`)를 아래로 바꾼다
  - `test('말머리 없음: kind 없이 댓글을 쓰고, kind 를 보내도 저장·응답에 남지 않는다')`
  - `test('이름: 가입 닉네임이 있으면 그 이름, 없으면 "독자 xxxx" — 독자 ID 는 노출되지 않는다')` (Review Focus 2)
  - `test('답글: 댓글에 단 답글은 reply_to_nickname=댓글쓴이, 답글에 단 답글은 그 답글 작성자, 글쓴이 답글은 is_post_author=true')`
  - `test('답글 대상: 형식이 틀리면 400, 숨김·삭제·다른 댓글의 답글이면 404')` (Review Focus 1)
  - `test('Review Focus 3: 삭제된 댓글은 답글이 있으면 "삭제된 댓글입니다"로 보이고 새 답글은 404')`
  - `test('FR-QNA-004: 끝까지 가지 않은 독자는 답글 쓰기 403, 저장소 접근 0건 — 끝까지 가면 201 (positive 쌍)')`
- [ ] **Step 2: 실패 확인** — `cd backend && npx jest src/modules/community/__tests__/router.test.ts` → FAIL
- [ ] **Step 3: router.ts 구현** — `KINDS`·kind 검증 제거, `DELETED_BODY = '삭제된 댓글입니다'`, 위 응답 모양.
- [ ] **Step 4: 통과 확인** — `cd backend && npx tsc --noEmit && npm test -- --runInBand src/modules/community` PASS
- [ ] **Step 5: 커밋** — `feat(R5): 커뮤니티 댓글·답글 API — 가입 닉네임, @답글 대상, 말머리 제거 — T19, FR-QNA-004`

### Task 3: 답글 좋아요 경로

**Files:**
- Modify: `backend/src/modules/community/router.ts` (`if (engagement)` 블록)
- Modify: `backend/src/modules/community/__tests__/engagement.test.ts`

**Interfaces:**
- Consumes: Task 1 `likeComment`·`unlikeComment`·`commentLikeState`
- Produces: `POST|DELETE /books/:bookId/community/comments/:commentId/like` → 200 `{ like_count, liked_by_me }`, 대상이 없거나 숨김·삭제면 404.

- [ ] **Step 1: 실패 테스트**
  - `test('FR-QNA-004: 끝까지 가지 않은 독자는 답글 좋아요·취소 403, 저장소 접근 0건 — 끝까지 가면 된다 (positive 쌍)')`
  - `test('답글 좋아요: 누르면 like_count 1·liked_by_me true, 취소하면 0·false, 다른 도서·숨김·없는 답글은 404')`
  - `test('Review Focus 3: 삭제된 댓글 아래 남은 답글도 좋아요가 된다')`
- [ ] **Step 2: 실패 확인** — `cd backend && npx jest src/modules/community/__tests__/engagement.test.ts` → FAIL
- [ ] **Step 3: 경로 구현** — 글 좋아요 루프와 같은 모양.
- [ ] **Step 4: 통과 확인** — `cd backend && npx tsc --noEmit && npm test -- --runInBand` 전체 PASS (11-19 기준 2136 통과 + 새 테스트)
- [ ] **Step 5: 커밋** — `feat(R5): 답글 좋아요 — T19, FR-QNA-004`

### Task 4: 프론트 타입·서비스·mock

**Files:**
- Modify: `frontend/src/types/community.ts`, `frontend/src/services/communityService.ts`, `frontend/mocks/community.ts`
- Modify: `frontend/src/mobile/community/BookEndPage.tsx` (한 줄 리뷰 → `createCommunityPost(bookId, body)`)
- Modify: `frontend/src/admin/CommunityReportsPage.tsx` (`TYPE_LABEL`: post → "댓글", comment → "답글")
- Modify: `frontend/src/mobile/pages/MobileCommunityHub.tsx` (책 카드의 "글 N" → "댓글 N"; 응답 필드 `post_count`는 그대로)
- Modify: 관련 기존 테스트의 호출 시그니처

**Interfaces:**
- Consumes: Task 2·3 응답 모양
- Produces:
  - `CommunityKind` 삭제, `CommunityPost`에서 `kind` 삭제
  - `CommunityComment = { comment_id, body, nickname, created_at, is_mine, is_post_author: boolean, reply_to_nickname: string, like_count: number, liked_by_me: boolean }`
  - `fetchCommunityPosts(bookId: string, cursor: string | null, sort: CommunitySort): Promise<CommunityPostPage>`
  - `createCommunityPost(bookId: string, body: string): Promise<CommunityPost>`
  - `createCommunityComment(bookId: string, postId: string, body: string, replyToCommentId?: string): Promise<CommunityComment>`
  - `likeCommunityComment(bookId: string, commentId: string): Promise<CommunityLikeState>`, `unlikeCommunityComment(...)`
  - mock: 같은 이름의 `mock*` 함수가 위 모양을 돌려주고, 예시 데이터는 시안 3의 댓글·답글(달빛서재·책벌레·밤샘독서·추리하는고양이·정독파·미두장단골, 「탁류」 내용)로 바꾼다.

- [ ] **Step 1: 실패 테스트** — `frontend/src/services/communityService.test.ts`(없으면 생성): `test('답글 쓰기는 reply_to_comment_id 를 실어 보내고, 댓글 쓰기는 kind 를 보내지 않는다')`, `test('답글 좋아요는 /comments/:id/like 로 POST·DELETE')` (axios 대역은 기존 서비스 테스트 방식을 따른다)
- [ ] **Step 2: 실패 확인** — `cd frontend && npx vitest run src/services/communityService.test.ts` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `cd frontend && npx tsc --noEmit` 은 Task 6 전까지 `MobileCommunity.tsx` 오류가 남을 수 있다. 이 태스크는 서비스 테스트 PASS와 `BookEndPage`·관리자 테스트 PASS까지 확인한다: `npx vitest run src/services src/admin src/mobile/community/BookEndPage*`
- [ ] **Step 5: 커밋** — `feat(R4): 커뮤니티 댓글·답글 프론트 타입·서비스 — T19`

### Task 5: 화면 부품 — 댓글 한 줄, 답글 묶음, 아래 입력창

**Files:**
- Create: `frontend/src/mobile/community/CommentRow.tsx`, `CommentThread.tsx`, `CommentComposer.tsx`
- Test: `frontend/src/mobile/community/CommentThread.test.tsx`, `CommentComposer.test.tsx`

**Interfaces:**
- Consumes: Task 4 타입·서비스, 기존 `relativeTime`(communityFormat.ts), `DeleteDialog`·`ReportDialog`(CommunityConfirmDialogs.tsx)
- Produces:
  - `CommentRow({ variant: 'comment' | 'reply', nickname, body, createdAt, likeCount, likedByMe, isMine, isPostAuthor?, replyToNickname?, highlighted?, deleted?, onReply, onToggleLike, onDelete, onReport })` — 시안 배치: 동그란 프로필(닉네임 첫 글자, 명조, 이름별로 고정되는 5가지 색 중 하나), 굵은 닉네임 + (답글이면 `@닉네임` 밝은 버건디) + 본문 한 덩어리, 아래 메타 줄 "시간 · 좋아요 N개(0이면 생략) · 답글 달기 · 삭제(내 것)|신고(남의 것)", 오른쪽 하트 버튼(`aria-label` "좋아요"/"좋아요 취소", `aria-pressed`). 글쓴이 표시는 버건디 테두리 "글쓴이".
  - `CommentThread({ bookId, post: CommunityPost, onReply(target: ReplyTarget), onChanged() })` — 댓글 한 줄 + `comment_count > 0`이면 "답글 N개 모두 보기", 누르면 `fetchCommunityPost`로 답글을 받아 한 칸 들여 펼치고 문구가 "답글 모두 숨기기"로. 부모에서 `refreshKey`가 바뀌면 펼친 상태를 유지한 채 다시 받는다.
  - `type ReplyTarget = { postId: string; commentId: string | null; nickname: string }`
  - `CommentComposer({ replyTarget: ReplyTarget | null, onCancelReply(), onSubmit(body: string): Promise<void> })` — 화면 아래 고정. 답글 중이면 위에 "{nickname}님에게 답글 남기는 중" + ✕(`aria-label` "답글 취소"), 입력칸에 `@{nickname} ` 미리 채움(게시 때 서버에는 이 머리말을 뺀 본문을 보낸다 — 서버가 `reply_to_nickname`으로 다시 붙인다). 빈칸 문구 "댓글 달기...", 내용이 있을 때만 "게시" 버튼 활성.

- [ ] **Step 1: 실패 테스트**
  - `test('답글이 있으면 "답글 2개 모두 보기", 누르면 답글이 @닉네임과 함께 보이고 "답글 모두 숨기기"로 바뀐다')`
  - `test('글쓴이의 답글에는 "글쓴이" 표시가 붙고 남의 답글에는 없다')`
  - `test('하트를 누르면 likeCommunityComment 를 부르고 좋아요 N개가 갱신된다')`
  - `test('답글 달기를 누르면 onReply 가 그 답글 작성자와 commentId 로 불린다')`
  - `test('입력창: 답글 중이면 "밤샘독서님에게 답글 남기는 중" 과 @밤샘독서 가 미리 들어가고, ✕ 를 누르면 "댓글 달기..." 로 돌아간다')`
  - `test('입력창: 게시하면 @머리말을 뺀 본문으로 onSubmit, 끝나면 비워진다 (Review Focus 4)')`
  - `test('입력창: 공백만 있으면 게시 버튼이 비활성')`
- [ ] **Step 2: 실패 확인** — `cd frontend && npx vitest run src/mobile/community/CommentThread.test.tsx src/mobile/community/CommentComposer.test.tsx` → FAIL
- [ ] **Step 3: 구현** — 색·글꼴은 Global Constraints 값을 Tailwind 임의값으로(지금 `MobileCommunity.tsx`와 같은 방식). 메타 줄 13px `#b5aaa6`.
- [ ] **Step 4: 통과 확인** — 위 명령 PASS, `npm run lint` 해당 파일 오류 0
- [ ] **Step 5: 커밋** — `feat(R4): 커뮤니티 댓글 한 줄·답글 묶음·아래 입력창 부품 — T19`

### Task 6: 책 이야기방 화면 다시 짜기와 정리

**Files:**
- Modify: `frontend/src/mobile/pages/MobileCommunity.tsx`
- Delete (이 변경으로 쓰이지 않게 됨): `frontend/src/mobile/community/CommunityPostView.tsx`, `CommunityCompose.tsx`, `LikeButton.tsx`, `communityFormat.ts`의 `KIND_LABEL`(다른 곳에서 안 쓰면)
- Modify: `frontend/src/mobile/pages/MobileCommunity.test.tsx`, `MobileCommunity.engagement.test.tsx`
- Create: `docs/validation/2026-11-20-community-comments/after-*.png` (로컬 캡처)

**Interfaces:**
- Consumes: Task 4·5 전부, `useBookDetail(bookId)`(책 제목)

- [ ] **Step 1: 실패 테스트** (기존 말머리·글쓰기 막대 테스트를 아래로 교체)
  - `test('처음 열면 최신순이 눌려 있고, 인기순을 누르면 sort=popular 로 다시 받는다')`
  - `test('머리줄: "다 읽은 독자 이야기", 책 제목, "N개의 댓글" — 영어 장식 글씨·말머리 탭·글쓰기 막대가 없다')`
  - `test('댓글이 없으면 "아직 아무도 이야기를 꺼내지 않았어요" 와 입력창 하나만 있다')`
  - `test('입력창에서 게시하면 맨 위에 새 댓글이 생기고 개수가 1 늘어난다')`
  - `test('답글 달기 → 게시하면 그 묶음이 펼쳐진 채 새 답글이 맨 아래에 보인다 (Review Focus 4)')`
  - `test('FR-QNA-004: 끝까지 가지 않았으면 잠김 안내만 있고 댓글 0건')` (기존 잠김 테스트 유지)
- [ ] **Step 2: 실패 확인** — `cd frontend && npx vitest run src/mobile/pages/MobileCommunity` → FAIL
- [ ] **Step 3: 구현** — PC(`desktop`)도 같은 화면을 가운데 폭으로. 목록 끝 여백은 입력창 높이 + `var(--safe-bottom)`.
- [ ] **Step 4: 전체 통과 확인** — `cd frontend && npx tsc --noEmit && npm run lint && npm test && npm run build` PASS (11-19 기준 1225 통과 + 새 테스트, 지운 테스트 수는 보고에 적는다)
- [ ] **Step 5: 로컬 브라우저 확인 (Review Focus 5)** — `cd frontend && VITE_USE_MOCK=true npx vite --port 5191`, 390×844 휴대폰 크기 Playwright로 로그인(reader@example.com / password123) → 앱 안에서 `/books/takryu/community`로 이동(`history.pushState`+`popstate`) → 최신순/인기순, 답글 펼치기, 답글 달기·게시, 빈 화면을 찍어 `after-*.png`로 저장하고 시안 `v3-*.png`와 나란히 비교. 가짜 키보드(`e2e/support/keyboard.ts`의 `showKeyboard`)를 올려 입력창이 키보드 위에 있는지 확인.
- [ ] **Step 6: 커밋** — `feat(R4): 책 이야기방을 인스타그램 배치 댓글 화면으로 — 말머리·글쓰기 막대 제거, 최신순 기본 — T19`

### Task 7: 문서 마무리

**Files:**
- Modify: `docs/context/tasks.md` (T19 상태: "개발 완료, 027 운영 적용·배포 대기"), `docs/context/README.md`의 코드와 결정이 다른 곳 표(해당 줄이 있으면)

- [ ] **Step 1:** 서버·화면 전체 시험 결과 숫자와 로컬 확인 캡처 경로를 T19에 적는다. 운영 DB 027 적용은 "대표 승인 필요"로 남긴다.
- [ ] **Step 2: 커밋** — `docs: T19 커뮤니티 댓글 방식 개발 결과`

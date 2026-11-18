/**
 * S4 준비 — 생성 6종 프롬프트 + 응답 파싱
 *
 * 게이트웨이(⑥) 경유만 허용 — 4.3절. 이 파일은 프롬프트만 만들고 실제 호출은
 * run-generate-sample.ts(표본 검증)·향후 generate.ts 실행기에서 gateway.call()로 한다.
 *
 * 파이프라인은 상한 개념이 없다(CLAUDE.md 2장 6번 예외) — 각 장은 그 장 원문만
 * 보되, 위치 태깅은 실제 페이지 번호로 한다. 상한 필터는 조회 시점(R2·R3·R4)에서만 건다.
 */
import { Chapter, Page } from '../../shared/types';
export { validateGroundedChapter } from './grounding';

/** LLM이 페이지 번호를 정확히 인용할 수 있도록 원문에 페이지 표시를 단다 */
export function buildPageTaggedText(pages: Page[]): string {
  return pages.map((p) => `[페이지 ${p.page_no}]\n${p.content}`).join('\n\n');
}

/** 장 요약 — FR-DAT-003 🚦. 입력은 "장 단위"(해당 장 원문만) — 이후 사건이 물리적으로 없다 */
export function buildSummaryPrompt(chapter: Chapter, pages: Page[]): string {
  return `다음은 이 작품 ${chapter.chapter_no}장 "${chapter.title}"의 원문 전체다.
이 장에서 벌어지는 사건만 3~5문장으로 요약하라. 이 장 이후에 일어나는 일은 절대 언급하지 마라(알더라도 금지).
출력은 아래 JSON 형식만 반환하라. 다른 설명·마크다운 코드블록 없이 JSON 텍스트만 출력하라.
{"summary": "..."}

--- 원문 ---
${buildPageTaggedText(pages)}`;
}

/** 인물 + 별칭 + 인물 노트 — FR-DAT-004, D6(전 별칭 태깅), A5(노트 상한) */
export function buildCharacterPrompt(
  chapter: Chapter,
  pages: Page[],
  knownCharacterNames: string[]
): string {
  const known =
    knownCharacterNames.length > 0 ? knownCharacterNames.join(', ') : '(없음 — 이 장이 첫 장)';
  return `다음은 이 작품 ${chapter.chapter_no}장 "${chapter.title}"의 원문이다(각 문단 앞에 [페이지 N] 표시).
이 장에서 처음 등장하거나 언급되는 인물을 전부 추출하라.

규칙:
- 대표명과 최초 등장 페이지(원문의 [페이지 N] 기준, 정확히 그 숫자를 인용)
- 별칭: 원문 표기가 다른 경우(1937년작 특유의 고어체·방언·띄어쓰기 변형 포함), 호칭·직함·가족관계 호칭을 전부 별칭으로 등록. 유형은 name(이름 표기 변형) / title(직함) / kinship(가족관계 호칭) / nickname(그 외 호칭) 중 하나, 각 별칭의 최초 등장 페이지도 표시
- 인물 노트: 이 인물을 설명하는 서술 문장을 문장당 1개씩, 근거 페이지와 함께. 이 장에서는 인물당 최대 2문장까지만
- 이미 등장한 인물: ${known}. name은 현재 원문 표기를 사용한다. 나중에 알려지는 본명으로 앞부분의 이름을 바꾸지 않는다.
- entity_type은 person/non_person/uncertain 중 하나다. person은 인간만이 아니라 대화하거나 독립적으로 행동하는 동물·AI 등 비인간 서사 행위자도 포함하는 등장인물 분류다. non_person은 비행위자인 사물·장소다. 사물 형태의 이름도 인물의 별명일 수 있다. 단순히 이름이 나온다는 이유로 인물이 되지 않는다. 행동·대사·서술에 근거한 rationale을 쓴다. 불확실한 후보도 uncertain으로 남긴다.
- identity_status는 기존 인물과 동일하면 same, 처음 등장하거나 별개인 인물이면 distinct, 동일인 여부가 모호하면 uncertain이다. rationale에 동일인 판정 이유도 쓴다. 동명이인·공유 호칭을 임의로 합치지 않는다.
- 인물·별칭 대응·노트마다 독립적인 evidence와 rationale을 쓴다. evidence는 source_page와 quote다. quote는 이름과 문맥을 포함한 해당 페이지의 정확한 부분 문자열이다. 유일한 인용이면 서버가 위치를 계산한다. 같은 인용이 반복되는 경우에만 start_char, end_char를 추가하며 페이지 본문의 0 기반 UTF-16 문자 위치이고 end_char는 제외한다.
- 인물 first_appearance_page와 노트 source_page는 각 근거 페이지다. 앞 장의 등장 페이지를 추측하지 않는다. 검증이 늦으면 앞 페이지로 소급하지 않는다.
- 별칭 evidence는 name과 alias 양쪽을 포함하여 동일인임을 보여야 한다. identity_established_page는 그 근거 페이지다. 별칭 첫 등장만으로 동일인 확립을 소급하지 않는다. 두 이름의 단순 동시 등장은 동일인 근거가 아니다.
- 별칭은 한 인물을 실제로 지칭하는 독립된 명사형 표기만 등록한다. 조사·어미가 붙은 일부, 발언 문장, 외모/행동 설명문, 가족·내외 같은 집합은 개인 별칭이 아니다. 친구/동료는 가족호칭(kinship)이 아니며 직업은 title이다. 묘사 수식어가 추가된 별명은 단순 이름 표기(name)가 아니다.
- 별칭 자체의 지시 대상을 reference_type=person_label/description/collective/utterance/non_person/uncertain으로 독립 분류한다. 같은 문장에 대표명이 있어도 그 별칭이 해당 개인을 가리키지 않으면 person_label이 아니다. 다른 사람·사물 지칭, 불명확한 대명사를 억지로 연결하지 않는다. 서버는 person_label만 자동 승인하며 나머지 후보와 근거는 검수에 남긴다.
- story_presence는 in_story 또는 mentioned_only다. in_story는 이 이야기의 세계 안에서 직접 행동하거나 말하거나, 사건의 피해자·당사자로 서술되는 인물이다. mentioned_only는 이야기 속 인물들이 대화·서술에서 다른 작품이나 현실 인물로 인용만 하는 이름이다(실존 작가·학자, 다른 소설의 탐정·범인·주인공 등). 탐정소설을 논하는 대화에 나열된 이름은 mentioned_only다. 이야기 속 인물이 스스로 그 이름을 쓰거나 그 인물로 불리는 경우만 in_story다.
- 직책·직업·집단을 가리키는 말(운전수, 경관, 간수, 순사, 보이, 신사 등)은 인물이 아니다. 같은 직책의 사람이 이름이 밝혀진 인물이면 그 인물의 title 별칭으로만 등록하고, 이름이 끝내 나오지 않는 직책어는 characters에 넣지 않는다. 조사가 붙은 조각(경찰의), 한 글자 이름(홍, 양), 외모를 풀어 쓴 묘사(검은 안경을 낀 신사)도 인물 이름이 아니다.
- 성에 호칭을 붙인 형태("박 군", "김 씨")는 별도 인물로 만들지 않는다. 이름이 나온 인물과 같은 사람임을 보이는 문장이 있으면 그 인물의 nickname 별칭으로 evidence와 함께 등록한다. 그런 문장이 없으면 등록하지 않는다.
- 현재 장 안에서 같은 이름이 먼저 나왔다면 최초 인용을 우선 확인한다. 인물의 직업이나 별명의 유래를 나중에 알게 되었다고 최초 등장을 늦추지 않는다. 앞선 같은 표기가 사물이나 동명이인이라면 earlier_mentions에 source_page, kind(non_person|different_person), rationale, evidence를 각각 기록한다. 근거 없는 제외나 이름만 보고 소급하는 것은 금지한다. 서버는 설명되지 않은 앞선 표기가 있으면 인물을 검수 보류한다.

출력은 아래 JSON 형식만 반환하라. 다른 설명·마크다운 코드블록 없이 JSON 텍스트만 출력하라.
{"characters": [{"name": "...", "first_appearance_page": 0, "entity_type": "person|non_person|uncertain", "story_presence": "in_story|mentioned_only", "identity_status": "same|distinct|uncertain", "rationale": "사람 판정과 동일인 여부의 이유", "evidence": {"source_page": 0, "quote": "...", "start_char": 0, "end_char": 0}, "earlier_mentions": [], "aliases": [{"alias": "...", "type": "name|title|kinship|nickname", "reference_type": "person_label|description|collective|utterance|non_person|uncertain", "first_appearance_page": 0, "identity_established_page": 0, "rationale": "...", "evidence": {"source_page": 0, "quote": "...", "start_char": 0, "end_char": 0}}], "notes": [{"note": "...", "source_page": 0, "rationale": "...", "evidence": {"source_page": 0, "quote": "...", "start_char": 0, "end_char": 0}}]}]}

--- 원문 ---
${buildPageTaggedText(pages)}`;
}

// 관계(FR-DAT-005)는 장 원문 전체를 LLM에 주고 쌍을 고르게 하지 않는다(2026-11-18 대표 지시로 삭제).
// 구조적 후보 쌍 + 근거 창 관계 질문지 — relationship-labeling.ts, Claude 구독으로 실행(relationship-structural-calls.ts)

/**
 * 배경지식·소개 — FR-DAT-006, R5(상한 없음, 1페이지 시점에도 안전해야 함)
 * 2026-11-18 E2E #28: 예전 프롬프트가 「탁류」의 무대(미두장·군산)와 연재 정보를 모든 책에 고정으로 넣어
 * 「가상범인」 소개가 탁류 내용이 됐다. 이제 그 책의 첫 페이지 원문만 근거로 준다(첫 페이지 밖은 넣지 않는다).
 */
export function buildBackgroundPrompt(
  title: string,
  author: string,
  openingPages: Page[] = []
): string {
  const firstPage = openingPages.filter((p) => p.page_no === 1);
  const source = firstPage.length
    ? `\n\n--- 작품 첫 페이지 원문 (무대·소재는 여기서 확인되는 것만 쓴다) ---\n${buildPageTaggedText(firstPage)}`
    : '';
  return `${author}의 소설 「${title}」에 대한 배경지식과 책 소개를 작성하라.

절대 규칙: 이 소설의 결말, 구체적 사건 전개, 인물의 운명·관계 변화를 절대 언급하지 마라. 이 책을 1페이지도 읽지 않은 독자가 봐도 완전히 안전해야 한다.
- 다른 작품의 무대·인물·소재를 가져오지 마라. 작품의 무대·소재는 아래 첫 페이지 원문에서 확인되는 것만 쓴다.
- 발표 연도·매체·연재 정보는 확실히 아는 경우에만 쓰고, 모르면 쓰지 마라.
- background: 시대 배경, 작품의 무대·소재(첫 페이지에서 확인되는 것), 읽기 포인트(문체 특징 등). 사건 전개 언급 금지
- intro: 작품을 소개하는 글. 줄거리 요약이나 결말 암시 없이, 어떤 분위기·주제의 작품인지만

출력은 아래 JSON 형식만 반환하라. 다른 설명·마크다운 코드블록 없이 JSON 텍스트만 출력하라.
{"background": "...", "intro": "..."}${source}`;
}

/** 용어 — FR-DAT-007 */
export function buildTermPrompt(chapter: Chapter, pages: Page[]): string {
  return `다음은 이 작품 ${chapter.chapter_no}장 "${chapter.title}"의 원문이다(각 문단 앞에 [페이지 N] 표시).
현대 독자가 이해하기 어려운 용어(방언, 고어, 1930년대 전문용어 — 예: 미두장, 하바꾼 등)를 추출하고 뜻을 설명하라. 최초 등장 페이지를 표시하라.
응답 길이 제한이 있으니 이 장에서 가장 중요하고 대표적인 용어 위주로 **최대 15개까지만** 추려라.

출력은 아래 JSON 형식만 반환하라. 다른 설명·마크다운 코드블록 없이 JSON 텍스트만 출력하라.
{"terms": [{"term": "...", "definition": "...", "first_appearance_page": 0}]}

--- 원문 ---
${buildPageTaggedText(pages)}`;
}

// 사건(FR-DAT-008)은 장면 단위로 뽑는다 — event-scenes.ts의 buildSceneBoundaryPrompt·buildSceneEventPrompt

/** LLM 응답에서 JSON을 안전하게 뽑아낸다(마크다운 코드블록으로 감싸는 경우 대응) */
export function parseJsonResponse<T>(raw: string): T {
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`JSON을 찾을 수 없음: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(text.slice(start, end + 1)) as T;
}

export const QUESTION_INTENTS = [
  'fact',
  'verify_hypothesis',
  'culprit_or_ending',
  'prediction',
  'outside',
  'reader_notes',
] as const;
export type QuestionIntent = (typeof QUESTION_INTENTS)[number];

const PREDICTION =
  /(앞으로|다음\s*(?:장|화|에|엔|편)?|이후|곧|뒤에).{0,14}(어떻게\s*(?:될|전개|흘러)|무슨\s*일|누가\s*(?:죽|나올|등장|잡)|벌어질|일어날|될까|나올까|죽을까)|예측|예상해|전개.{0,6}(?:어떨|어떻게)|what\s+(?:happens|will happen)|predict|will\s+\w+\s+(?:die|be\s+caught)/iu;

const CULPRIT_OR_ENDING =
  /범인|진범|살인자|흉수|결말|엔딩|정체|잡혀|체포|해결(?:돼|되|될)|밝혀(?:져|지|질)|(?:이야기|사건|소설|책)[^.?!]{0,6}(?:끝나|끝이)|누가\s*[^.?!]{0,12}(?:죽였|죽인|살해|살인|범행|그랬|한\s*짓)|(?:죽인|살해한|저지른)\s*(?:거|것|짓|사람|자)|(?:이|가)\s*한\s*(?:거|것|짓)\s*(?:아니|맞|지)|마지막\s*(?:장|에|엔)|끝에\s*(?:가|서)?\s*(?:어떻게|누구)|누가\s*(?:죽였|범행)|정체가?\s*(?:뭐|누구|무엇)|사건의?\s*진상|culprit|killer|murderer|whodunit|ending|who\s+did\s+it/iu;

const INJECTION_OR_ROLEPLAY =
  /(?:이전|위|앞(?:의|선)?|기존)\s*(?:지시|명령|규칙|지침)[^.?!]{0,10}(?:무시|잊|취소|해제)|시스템\s*프롬프트|개발자\s*모드|탈옥|(?:너는|넌|당신은)\s*이제[^.?!]{0,16}(?:이야|입니다|야)|역할\s*극|롤\s*플레이|(?:작가|탐정|범인)(?:인\s*척|처럼|역할)|ignore\s+(?:all\s+)?(?:previous|prior|above)|system\s+prompt|developer\s+mode|jailbreak|role-?play|pretend\s+(?:to\s+be|you)|you\s+are\s+now/iu;

const VERIFY_HYPOTHESIS =
  /가설|추리|추측|내\s*생각|제\s*생각|의심|수상|공범|배후|용의자|동기|알리바이|트릭|복선|반전|떡밥|한\s*짓|노트에?\s*(?:적|쓴|있)|(?:내가|제가)\s*(?:적은|쓴)|예\s*\/\s*아니오|예\s*아니오|yes\s*(?:or|\/)\s*no|hypothesis|theory/iu;

const OUTSIDE =
  /작가(?:의|가)?[^.?!]{0,14}(?:의도|생각|인터뷰)|날씨|주식|코딩|프로그래밍|레시피|번역해|다른\s*(?:책|소설|작품)|영화|드라마|author'?s?\s+intent|weather/iu;

/**
 * 대표 지시 2026-11-18 — 독자가 자기 노트(추리 노트·메모·적어 둔 가설·단서)를 가리키는 말.
 * 노트는 이 앱에서 독자만 쓰므로 "노트 보여 줘"처럼 소유 표지가 없어도 노트를 가리킨다.
 * "메모"는 작품 속 물건일 수 있어 "내 메모"·"내가 쓴 메모"처럼 독자를 가리킬 때만 잡는다.
 */
const READER_NOTE_REFERENCE =
  /(?:내|제|나의|저의)\s*(?:추리\s*)?(?:노트|메모|기록|가설|단서|추리)|(?:내가|제가)\s*(?:노트에|메모에|노트로)?\s*(?:적은|쓴|남긴|메모한|기록한|적어\s*(?:둔|놓은)|써\s*(?:둔|놓은))|(?:추리\s*)?노트(?:에|를|가|는|도)?\s*(?:[가-힣]+\s*){0,2}?(?:보여|보이|볼\s*수|봐|읽|정리|요약|알려|모아)|\bmy\s+notes?\b/iu;

/**
 * 판정을 청하는 말. 노트를 언급해도 이 말이 있으면 노트 요청이 아니라 가설·범인 질문이다
 * (절대 규칙 11 — "내 노트에 쓴 가설 맞아?"는 판정 요청).
 */
const VERDICT_REQUEST =
  /맞(?:아|나|니|냐|지|죠|을까|는\s*(?:지|거|것)|았|다고|혀|춰)|틀(?:려|렸|린|릴|리)|정답|오답|어때|어떻게\s*생각|어떤\s*(?:것\s*)?같|생각은|그럴듯|가능성|확률|일리|타당|말이\s*(?:돼|되)|판정|판단해|평가|채점|점수|\b(?:right|correct|wrong)\b|true\s+or\s+false/iu;

/** 질문이 독자 자신의 노트를 가리키는지 (판정 요청인지와 무관). R9 — 낱말 검사 */
export function mentionsReaderNotes(text: string): boolean {
  return READER_NOTE_REFERENCE.test(text);
}

/**
 * 독자가 자기 노트를 보여 달라·정리해 달라고만 했는지. 판정·범인·예측·지시 무시 요청이 섞이면
 * 아니다 — 그 질문들은 원래 유형의 엄격한 경로를 그대로 탄다 (FR-QNA-004 🚦).
 */
function asksForReaderNotes(text: string): boolean {
  return (
    READER_NOTE_REFERENCE.test(text) &&
    !VERDICT_REQUEST.test(text) &&
    !PREDICTION.test(text) &&
    !CULPRIT_OR_ENDING.test(text) &&
    !INJECTION_OR_ROLEPLAY.test(text)
  );
}

export function classifyQuestion(text: string): QuestionIntent {
  // FR-QNA-004 🚦 R9
  // NFR-AI-005, 대표 지시 2026-11-18 — 노트 요청은 판정 요청이 아니다. 노트 본문(가설)은 질문이 아니라
  // 근거 조립 단계에서 K 이하로만 들어오므로 분류에 쓰지 않는다
  if (asksForReaderNotes(text)) return 'reader_notes';
  if (PREDICTION.test(text)) return 'prediction';
  if (CULPRIT_OR_ENDING.test(text) || INJECTION_OR_ROLEPLAY.test(text)) return 'culprit_or_ending';
  if (VERIFY_HYPOTHESIS.test(text)) return 'verify_hypothesis';
  if (OUTSIDE.test(text)) return 'outside';
  return 'fact';
}

/**
 * NFR-AI-005, 대표 결정 2026-11-17 — 독자가 장면·대목의 위치를 찾아 달라고 물었는지(낱말 검사, R9).
 * 이 판별이 참이고 행동 단계표가 그 유형에 retrieve_scene을 허용할 때만 "12쪽을 다시 읽어 보세요"
 * 같은 다시 보기 권유가 출력 검사를 통과한다. 근거 범위(K)에는 관여하지 않는다(R4).
 *
 * 잡는 말
 * - 장면을 가리키는 말 + 어디: "그 장면 어디였지?", "장갑 나온 데가 어디야?"
 * - 어디 + 나오다·등장하다: "장갑은 어디 나와?", "처음 등장한 게 어디였더라?"
 * - 몇 쪽·몇 페이지·어느 쪽(이/에/였)·어느 장면·대목: "장갑 나온 데가 몇 쪽이야?"
 * - 장면을 가리키는 말 + 찾다: "장갑 나오는 장면 찾아줘"
 * - 다시 보고/읽고 싶다·다시 보려면: "다시 보고 싶은데 어디야?"
 * - 영어: which/what page, where … scene/passage/appear, find the scene
 * 잡지 않는 말: "어디에 살아?"·"어디 출신이야?"(장면이 아닌 장소), "단서를 찾아줘"(장면을 가리키지 않음),
 * "편지는 몇 장이야?"(장수).
 */
const SCENE_WORD = '(?:장면|대목|부분|구절|대사|문장|내용|데|곳|쪽|페이지)';
const SCENE_LOCATION_REQUEST = new RegExp(
  [
    `${SCENE_WORD}(?:이|가|은|는|을|를|도)?\\s*[^.?!]{0,6}어디`,
    '어디\\s*(?:였|더라)',
    '어디(?:\\s*쯤|에서|서|에)?\\s*(?:처음\\s*)?(?:나왔|나오|나와|나온|등장|언급|적혀|쓰여)',
    '(?:언제|어디)\\s*(?:처음\\s*)?(?:나왔|등장했|언급됐)',
    '몇\\s*(?:쪽|페이지|챕터|번째\\s*(?:장|쪽|페이지))',
    '어느\\s*(?:페이지|장면|대목|구절|챕터)',
    '어느\\s*(?:쪽|장)(?:이|에|였|인)',
    `${SCENE_WORD}[^.?!]{0,8}찾`,
    '다시\\s*(?:보|읽|찾아\\s*보)고\\s*싶',
    '다시\\s*(?:보|읽)(?:려면|려고)',
    '\\b(?:which|what)\\s+page\\b',
    '\\bwhere\\b[^?.!]{0,40}\\b(?:scene|passage|mention(?:ed)?|appear(?:s|ed)?)\\b',
    '\\bfind\\s+(?:the|that)\\s+(?:scene|passage|part)\\b',
  ].join('|'),
  'iu'
);

export function isSceneLocationRequest(text: string): boolean {
  return SCENE_LOCATION_REQUEST.test(text);
}

import type {
  BriefingResponse,
  ChapterSummary,
  GraphEdge,
  GraphResponse,
  RelationshipSemantics,
  TimelineResponse,
} from '../types';
import type { ShowcaseBook } from '../data/homeShowcase';

/**
 * 첫 이용 가이드용 데모 책 「멈춘 시계」 (2026-11-18 대표 지시)
 *
 * 가이드 화면 안에서만 쓰는 짧은 창작 추리 단편이다. 실제 작품의 문장을 옮기지 않았다.
 * 이 파일의 값은 전부 화면에 바로 그리는 고정 데이터다 — 서버에서 받지 않고, 서버로
 * 보내지도 않는다. 가이드는 진도·노트·챗봇 API를 한 번도 부르지 않으므로 실제 독자의
 * 기준점에 닿을 경로가 없다 (절대 규칙 1·8번, FR-SPL-002 🚦).
 *
 * 관계도·챗봇 답은 "4쪽까지 읽은 독자"가 보는 모습으로 미리 만들어 둔 고정값이다.
 * 화면이 쪽수로 걸러 내는 계산은 하지 않는다 (FR-BRF-005 🚦 — 기준점 계산 없음).
 */

export const DEMO_TITLE = '멈춘 시계';
export const DEMO_AUTHOR = 'RE:ADD 가이드';
export const DEMO_TOTAL_PAGES = 8;

/** 브리핑에서 "지난번에 여기까지 읽었다"고 보여 주는 쪽. 가이드는 그다음 쪽에서 시작한다 */
export const DEMO_START_PAGE = 3;

/** 독자가 노트에 적어 보는 단서 문장 — 4쪽 본문에 그대로 들어 있다 */
export const DEMO_CLUE = '서재의 괘종시계는 열 시 십 분에 멈춰 있었다.';
export const DEMO_CLUE_PAGE = 4;

export const DEMO_CHAPTERS: ChapterSummary[] = [
  { chapter_no: 1, title: '비 오는 별장', start_page: 1, end_page: 4 },
  { chapter_no: 2, title: '멈춘 시각', start_page: 5, end_page: 8 },
];

export const DEMO_PAGES: Record<number, string> = {
  1: `비는 저녁 내내 그치지 않았다. 추리소설 작가 한서진은 우산을 접으며 호숫가 별장의 현관에 들어섰다.

"오느라 고생했네." 오랜 친구 윤태호가 두 팔을 벌렸다. 내일이 그의 예순 번째 생일이었다.

윤태호는 서진을 서재로 이끌었다. 벽 한쪽에는 커다란 괘종시계가, 유리 진열장 안에는 은빛 회중시계가 놓여 있었다.

"할아버지께 물려받은 걸세. 이 집에서 제일 귀한 물건이지."`,
  2: `저녁 식탁에는 윤태호의 딸 윤미라와, 삼십 년째 이 집을 돌봐 온 집사 박정수가 함께 앉았다.

"내일 생일 선물은 내가 주는 쪽이야." 윤태호가 잔을 들었다. "그 회중시계를 미라에게 물려주겠네."

미라는 놀란 얼굴로 아버지를 보았다. 박 집사는 말없이 고개를 숙였다.

밤 아홉 시쯤, 번개가 치더니 집 안의 불이 잠깐 꺼졌다가 들어왔다. 박 집사가 촛불을 챙겨 문단속을 하러 나갔다.`,
  3: `아침이 밝자 별장이 소란스러워졌다.

"시계가 없어졌어요!" 미라가 서재 문 앞에서 외쳤다.

유리 진열장은 닫혀 있었지만 안은 비어 있었다. 진열장 열쇠는 둘뿐이었다. 하나는 윤태호의 조끼 주머니에, 하나는 박 집사의 열쇠 꾸러미에.

"밤에 복도에서 발소리를 들었어요." 미라가 말했다. "누군가 서재 쪽으로 가는 것 같았어요."`,
  4: `서진은 서재를 천천히 둘러보았다. 창문은 안에서 잠겨 있었고, 양탄자에는 젖은 자국 하나 없었다.

${DEMO_CLUE}

"어젯밤에 태엽을 감아 두었는데요." 박 집사가 시계 앞에서 고개를 갸웃했다.

서진은 시계와 빈 진열장을 번갈아 보았다. 불이 나갔던 시각과, 시계가 멈춘 시각. 그리고 발소리.`,
  5: `서진은 부엌에서 박 집사와 마주 앉았다.

"열 시에 문단속을 마치고 바로 방으로 갔습니다." 박 집사는 찻잔을 내려놓았다. "미라 아가씨 어머님이 돌아가신 뒤로, 아가씨는 제가 키우다시피 했지요. 그 시계가 아가씨 것이 된다니 저는 기뻤습니다."

그의 손은 조금 떨리고 있었다.`,
  6: `미라는 거실 창가에 서 있었다.

"열한 시에 시계 종소리를 들었어요. 열한 번 울렸어요. 그때까지 잠이 안 왔거든요."

서진은 수첩에 적었다. 서재의 괘종시계는 열 시 십 분에 멈췄다. 그런데 미라는 열한 시 종소리를 들었다.

"이 집에 시계가 또 있나요?" 서진이 물었다. 미라는 복도 끝을 가리켰다.`,
  7: `복도 끝에는 작은 벽시계가 걸려 있었다. 종소리는 이 시계였다.

서진은 서재로 돌아가 괘종시계의 유리문을 열었다. 흔들추 뒤로 은빛 줄이 엉켜 있었다. 줄을 따라 손을 넣자, 차가운 회중시계가 손끝에 닿았다.

시계 줄이 흔들추를 붙잡아 시계가 멈춘 것이었다. 열 시 십 분에.`,
  8: `"내가 넣었네." 윤태호가 머리를 긁적였다. "미라가 어릴 때 생일마다 보물찾기를 했거든. 아침에 쪽지를 주려다 그만 깜빡 잠들었지 뭔가."

미라는 웃음을 터뜨렸고, 박 집사는 그제야 긴 숨을 내쉬었다.

서진은 수첩을 덮었다. 이번 이야기의 범인은 늙은 친구의 장난기였다.`,
};

/** 홈 입체 책 표지 — 이미지 파일 없이 SVG로 그린다 */
const COVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450"><rect width="300" height="450" fill="#22303a"/><circle cx="150" cy="190" r="74" fill="none" stroke="#e9dfc8" stroke-width="5"/><circle cx="150" cy="190" r="5" fill="#e9dfc8"/><path d="M150 190 L150 140 M150 190 L186 170" stroke="#e9dfc8" stroke-width="5" stroke-linecap="round"/><path d="M150 96 L150 112 M150 268 L150 284 M56 190 L72 190 M228 190 L244 190" stroke="#e9dfc8" stroke-width="4"/><text x="150" y="350" fill="#f4ecd8" font-family="serif" font-size="40" font-weight="700" text-anchor="middle">멈춘 시계</text><text x="150" y="392" fill="#c9bfa8" font-family="sans-serif" font-size="16" text-anchor="middle">데모 책</text></svg>`;

export const DEMO_COVER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(COVER_SVG)}`;

export const DEMO_SHOWCASE: ShowcaseBook = {
  slug: 'guide-demo',
  bookId: 'guide-demo',
  title: DEMO_TITLE,
  author: DEMO_AUTHOR,
  meta: '데모 책 · 8쪽',
  cover: DEMO_COVER,
  spine: '#22303a',
  spineText: '#f4ecd8',
  hook: ['비 오는 밤의 호숫가 별장.', '사라진 은빛 회중시계.', '멈춘 시각이 말해 주는 것.'],
};

/** 브리핑 화면 — 2쪽까지 읽고 돌아온 독자 */
export const DEMO_BRIEFING: BriefingResponse = {
  applied_cutoff: 2,
  recap:
    '비 오는 밤, 추리소설 작가 한서진은 오랜 친구 윤태호의 호숫가 별장에 초대받아요. 윤태호는 할아버지에게 물려받은 은 회중시계를 서재에서 보여 주고, 저녁 자리에서 그 시계를 딸 윤미라에게 물려주겠다고 말해요.\n\n밤 아홉 시쯤 번개에 불이 잠깐 나가고, 집사 박정수가 촛불을 들고 문단속을 하러 나가요.',
  current_chapter: { chapter_no: 1, title: '비 오는 별장' },
  resume_chapter: { chapter_no: 1, title: '비 오는 별장' },
  progress: { current_page: 2, total_pages: DEMO_TOTAL_PAGES, percent: 25 },
} as BriefingResponse;

export const DEMO_CHARACTER_NAMES = ['한서진', '윤태호', '윤미라', '박정수'];

function semantics(
  kind: RelationshipSemantics['kind'],
  relation_key: string,
  summary: string,
  source_page: number,
  quote: string
): RelationshipSemantics {
  return {
    version: 2,
    direction: 'undirected',
    kind,
    relation_key,
    summary,
    reader_summary: summary,
    assertion_status: 'fact',
    temporal_scope: 'ongoing',
    state: 'active',
    evidence: { source_page, quote, start_char: 0, end_char: quote.length },
  };
}

const DEMO_EDGES: GraphEdge[] = [
  {
    id: 'demo-e1',
    source: 'seojin',
    target: 'taeho',
    label: '오랜 친구',
    established_page: 1,
    semantics: semantics('social', 'friend', '서진과 태호는 오래된 친구예요. 태호의 생일을 앞두고 서진이 별장에 왔어요.', 1, '오랜 친구 윤태호가 두 팔을 벌렸다.'),
  },
  {
    id: 'demo-e2',
    source: 'taeho',
    target: 'mira',
    label: '아버지와 딸',
    established_page: 2,
    semantics: semantics('family', 'parent', '미라는 태호의 딸이에요. 태호는 회중시계를 미라에게 물려주겠다고 했어요.', 2, '윤태호의 딸 윤미라'),
  },
  {
    id: 'demo-e3',
    source: 'taeho',
    target: 'butler',
    label: '주인과 집사',
    established_page: 2,
    semantics: semantics('social', 'employer', '박정수는 삼십 년째 태호의 집을 돌봐 온 집사예요.', 2, '삼십 년째 이 집을 돌봐 온 집사 박정수'),
  },
];

/** 4쪽까지 읽은 독자에게 보이는 관계도 — 미리 만들어 둔 고정값 */
export const DEMO_GRAPH: GraphResponse = {
  nodes: [
    { id: 'taeho', name: '윤태호', first_appearance_page: 1, aliases: [] },
    { id: 'seojin', name: '한서진', first_appearance_page: 1, aliases: [] },
    { id: 'mira', name: '윤미라', first_appearance_page: 2, aliases: [] },
    { id: 'butler', name: '박정수', first_appearance_page: 2, aliases: ['박 집사'] },
  ],
  edges: DEMO_EDGES,
  history: DEMO_EDGES,
};

/**
 * 4쪽까지 읽은 독자에게 보이는 타임라인 — 미리 만들어 둔 고정값 (결정 31: 다 읽은 장만 요약·사건).
 * 1장(1~4쪽)은 다 읽었고 2장은 읽는 중이다. 가이드 단계는 이 탭을 거치지 않지만, 눌러 봐도 비지 않게 둔다.
 */
export const DEMO_TIMELINE: TimelineResponse = {
  chapters: [
    {
      ...DEMO_CHAPTERS[0],
      completed: true,
      summary: '서진이 친구 태호의 별장에 와요. 다음 날 아침, 서재 진열장의 회중시계가 없어져요.',
    },
    { ...DEMO_CHAPTERS[1], completed: false, summary: null },
  ],
  events: [
    { id: 'demo-ev-2', event: '불이 잠깐 꺼짐', description: '밤 아홉 시쯤 번개가 치고 집 안의 불이 잠깐 꺼졌다가 들어와요.', occurrence_page: 2 },
    { id: 'demo-ev-3', event: '회중시계가 사라짐', description: '아침에 미라가 진열장이 비어 있는 것을 알아채요.', occurrence_page: 3 },
  ],
  applied_cutoff: 4,
};

/** 가이드에서 독자가 눌러 보는 인물 */
export const DEMO_FOCUS_CHARACTER = 'taeho';

/**
 * 아모의 고정 답 — 독자의 노트를 이어 주되 맞다·틀리다 판정하지 않고, 4쪽까지만 말한다
 * (NFR-AI-005 🚦, FR-QNA-004 🚦). 원문 인용은 단서 한 문장뿐이다(결정 34, 200자 상한).
 */
export const DEMO_AMO_ANSWER = `4쪽에 적어 둔 노트와 이어지는 장면이 있어요.

> ${DEMO_CLUE}

바로 뒤에서 박 집사는 어젯밤에 태엽을 감아 두었다고 말해요. 3쪽에서는 미라가 밤에 서재 쪽으로 가는 발소리를 들었다고 했고요.

이 단서가 무엇을 뜻하는지는 제가 정하지 않을게요. 지금까지 읽은 4쪽 안에서 같이 짚어 볼 수 있어요.`;

export const DEMO_COMMUNITY_POSTS = [
  { id: 'p1', kind: '범인 추리', nickname: '빗소리', body: '괘종시계가 멈춘 시각이 처음부터 마음에 걸렸어요. 다들 언제 눈치채셨어요?', comments: 4 },
  { id: 'p2', kind: '감상', nickname: '호숫가', body: '범인보다 박 집사의 떨리던 손이 오래 남네요. 마지막 장면이 따뜻했어요.', comments: 2 },
  { id: 'p3', kind: '범인 추리', nickname: '태엽', body: '복도 끝 벽시계는 언제부터 있었던 걸까요? 다시 읽어 보니 2장에서야 나오네요.', comments: 1 },
];

/** 데모 책의 이웃 쪽 표 — 화면 안 고정 본문이라 미리 적어 둔다. 실제 책은 서버가 준다 (FR-BRF-005) */
export const DEMO_NEIGHBORS: Record<number, { prev: number | null; next: number | null }> = {
  1: { prev: null, next: 2 },
  2: { prev: 1, next: 3 },
  3: { prev: 2, next: 4 },
  4: { prev: 3, next: 5 },
  5: { prev: 4, next: 6 },
  6: { prev: 5, next: 7 },
  7: { prev: 6, next: 8 },
  8: { prev: 7, next: null },
};

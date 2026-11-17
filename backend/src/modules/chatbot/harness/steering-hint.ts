/**
 * NFR-AI-005, FR-QNA-004 🚦 (절대 규칙 11) — 암시형 답변 검사.
 *
 * 판정 표현 검사(`output-guard.ts`의 verdict_phrase)는 "맞아요", "범인은 …" 같은 직접 판정을 잡는다.
 * 이 파일은 판정 낱말 없이 독자의 추리를 이끄는 문장을 낱말 패턴으로 잡는다(결정 23: 아모는
 * 무엇이 단서인지 고르지 않고, 가설을 칭찬으로 확인해 주지 않는다). LLM을 부르지 않는다(R9).
 *
 * 한계: 낱말 검사라 뜻으로만 드러나는 암시는 못 잡는다. 사람이 읽는 판정(T3)을 대신하지 않는다.
 *
 * 오탐을 줄이는 기준
 * - 아모가 독자에게 권하는 말끝(…보세요, …할 만해요, …두세요)만 잡는다. 읽은 범위의 사실을
 *   그대로 옮긴 서술("12쪽에서 A는 편지를 눈여겨보았어요", "…라고 말했어요")은 잡지 않는다.
 * - 쪽수로 장면 위치를 알려 주는 말("12쪽을 다시 읽어 보세요")은 결정 23의 '관련 장면 되찾기'라
 *   잡지 않는다. "그 장면을 다시 보세요"처럼 특정 장면을 짚어 다시 보라고 하거나, "다시 꼼꼼히"처럼
 *   강조해서 권하는 말만 잡는다.
 * - 따옴표 안의 글이 K 이하 원문이나 독자가 직접 쓴 글(질문·선택 문장·노트)에 그대로 있으면
 *   그 부분은 빼고 검사한다(`stripTrustedQuotes`). 독자가 적은 단서를 가리키는 말도 뺀다.
 */

export type HintFamily =
  | 'reread_directive'
  | 'attention_directive'
  | 'clue_importance'
  | 'hint_offer'
  | 'praise_confirmation'
  | 'leading_question';

export interface HintPattern {
  family: HintFamily;
  pattern: RegExp;
  /** 이 패턴이 잡는 문장의 예 */
  example: string;
  /**
   * always: 모든 질문 유형에서 막는다.
   * strict: 가설·범인 질문에서만 막는다 — 사실 질문의 "잘 보셨어요"는 사실 확인이다
   * (verdict_phrase의 "맞아요"와 같은 기준).
   */
  scope: 'always' | 'strict';
}

const ADVISE = '(?:세요|시길|셔야|시는\\s*(?:게|것)|시면\\s*(?:좋|어떨)|시죠|십시오)';
const LOOK = '(?:읽어\\s*보|살펴\\s*보|떠올려\\s*보|확인해\\s*보|들여다\\s*보|보|읽으)';
const LOOK_AT_FORMS =
  '보세요|봐요|보시(?:길|면\\s*(?:좋|어떨))|볼\\s*(?:만|필요)|봐야|봐\\s*두|보는\\s*게|읽어\\s*보세요|살펴\\s*보세요';
const LOOK_AT = `(?:${LOOK_AT_FORMS})`;
const CLUE = '(?:단서|힌트|실마리|열쇠|복선|증거)';
// 인물·독자가 한 말로 옮긴 경우와, 무엇이 단서인지 말하지 않겠다는 문장은 뺀다
const NOT_REPORTED =
  '(?!\\s*(?:인지|일지|인가|여부|(?:이)?라(?:고|며)\\s*(?:말했|했|여겼|생각했|믿었|주장했|적으셨|쓰셨|하셨|메모하셨|말씀하셨|적어|써)))';

export const HINT_PATTERNS: ReadonlyArray<HintPattern> = [
  // ── 다시 보라고 권하기 ─────────────────────────────────────────────
  {
    family: 'reread_directive',
    pattern: new RegExp(
      `(?:그|이|저|해당|앞의?|앞선|위의?)\\s*(?:장면|대목|부분|대사|문장|구절|말)(?:을|를|만|도)?\\s*[^.?!\\n]{0,10}?다시\\s*(?:한\\s*번\\s*)?(?:[가-힣]+히\\s*|잘\\s*)?${LOOK}${ADVISE}`,
      'u'
    ),
    example: '그 장면을 다시 보세요.',
    scope: 'always',
  },
  {
    family: 'reread_directive',
    pattern: new RegExp(
      `다시\\s*(?:한\\s*번\\s*)?(?:꼼꼼히|찬찬히|천천히|유심히|자세히|잘|주의\\s*깊게)\\s*${LOOK}${ADVISE}`,
      'u'
    ),
    example: '다시 꼼꼼히 읽어 보세요.',
    scope: 'always',
  },
  {
    family: 'reread_directive',
    pattern: /(?:되짚어|곱씹어)\s*(?:보세요|보시길|보시면\s*좋|볼\s*(?:만|필요))/u,
    example: '그 대사를 되짚어 보세요.',
    scope: 'always',
  },
  // ── 어디를 볼지 짚어 주기 ──────────────────────────────────────────
  {
    family: 'attention_directive',
    pattern:
      /주목(?:해\s*(?:보세요|봐요|주세요|야|볼\s*(?:만|필요)|보시(?:길|면)|보는\s*게)|하세요|하시(?:길|면)|할\s*(?:만|필요|부분|대목|점|장면|인물|사람|가치)|해야)/u,
    example: '장갑에 주목해 보세요.',
    scope: 'always',
  },
  {
    family: 'attention_directive',
    pattern: new RegExp(
      `눈여겨\\s*(?:${LOOK_AT_FORMS}|볼\\s*(?:부분|대목|점|장면|인물|사람))`,
      'u'
    ),
    example: '그 인물의 말투를 눈여겨보세요.',
    scope: 'always',
  },
  {
    family: 'attention_directive',
    pattern: new RegExp(`(?:유심히|주의\\s*깊게|잘)\\s*${LOOK_AT}`, 'u'),
    example: '창가 장면은 유심히 보세요.',
    scope: 'always',
  },
  {
    family: 'attention_directive',
    pattern: /놓치지\s*(?:마세요|말아\s*주세요|마시|않도록|말고)/u,
    example: '그 대사를 놓치지 마세요.',
    scope: 'always',
  },
  {
    family: 'attention_directive',
    pattern:
      /(?:기억해|염두에)\s*(?:두세요|두시(?:길|면)|둘\s*(?:만|필요)|두는\s*게|둬요|둬야|두셔야)/u,
    example: '장갑이 나온 쪽을 기억해 두세요.',
    scope: 'always',
  },
  // ── 무엇이 단서인지·중요한지 말하기 ────────────────────────────────
  {
    family: 'clue_importance',
    pattern: new RegExp(
      `(?:중요한|결정적(?:인)?|핵심(?:적인)?|큰|의미\\s*있는|의미심장한|주요(?:한)?)\\s*${CLUE}${NOT_REPORTED}`,
      'u'
    ),
    example: '장갑이 중요한 단서예요.',
    scope: 'always',
  },
  {
    family: 'clue_importance',
    pattern:
      /(?:장면|대목|부분|대사|물건|행동|말|단서|사실|점)(?:이|가|은|는|도|이야말로)?\s*(?:꽤|아주|매우|특히|정말|굉장히)?\s*(?:중요|의미심장|결정적)(?:해요|합니다|하죠|하답니다|하네요|할\s*(?:거|것|수)|해\s*보|해질|하게\s*(?:작용|쓰))/u,
    example: '그 대사가 꽤 중요해요.',
    scope: 'always',
  },
  {
    family: 'clue_importance',
    pattern: new RegExp(
      `${CLUE}(?:가|는|로)?\\s*(?:될\\s*(?:수|거|것|지도|만)|돼요|됩니다|일\\s*(?:수|지도|거|것))`,
      'u'
    ),
    example: '그 편지는 복선일 수 있어요.',
    scope: 'always',
  },
  {
    family: 'clue_importance',
    pattern: new RegExp(`${CLUE}(?:예요|이에요|입니다|이죠|죠|랍니다|이랍니다|네요|이네요)`, 'u'),
    example: '그게 단서예요.',
    scope: 'always',
  },
  {
    family: 'clue_importance',
    pattern:
      /(?:괜히|그냥)\s*(?:나온|넣은|쓴|등장한)\s*(?:게|것이|건)\s*아[니닐닌]|우연(?:이|은)\s*아[닐닌]/u,
    example: '작가가 괜히 넣은 게 아닐 거예요.',
    scope: 'always',
  },
  // ── 힌트를 주겠다고 나서기 ─────────────────────────────────────────
  {
    family: 'hint_offer',
    pattern:
      /힌트(?:를|는|라면|로는)?\s*(?:하나만?\s*|조금만?\s*|살짝\s*)?(?:드리자면|드릴게요|주자면|드려\s*볼게요)|귀띔(?:해\s*드|하자면|을\s*드리|드리)/u,
    example: '힌트를 드리자면 창가 쪽이에요.',
    scope: 'always',
  },
  // ── 칭찬으로 확인해 주기 ───────────────────────────────────────────
  {
    family: 'praise_confirmation',
    pattern:
      /거의\s*(?:다\s*)?(?:맞|왔어|왔습|왔네|근접|정답|도달|풀었|푸셨)|(?:정답|진실|진상|답)에\s*(?:거의\s*)?(?:가까|근접|다가)/u,
    example: '거의 맞았어요.',
    scope: 'always',
  },
  {
    family: 'praise_confirmation',
    pattern:
      /(?:맞는|옳은|올바른|좋은)\s*방향|방향(?:은|이|을)?\s*(?:잘\s*)?(?:잡|가고\s*있)|잘\s*(?:가고|따라가고|추리하고|짚어\s*가고)\s*(?:있|계)/u,
    example: '방향을 잘 잡으셨어요.',
    scope: 'always',
  },
  {
    family: 'praise_confirmation',
    pattern:
      /(?:예리|날카로|날카롭|훌륭|대단|멋진|탁월)[가-힣]{0,3}\s*(?:지적|관찰|추리|가설|생각|시선|포인트|착안|통찰|의심|접근)|(?:예리|날카로우|훌륭하|대단하|탁월하)(?:시네요|세요|십니다|셔요)|눈썰미/u,
    example: '예리한 지적이에요.',
    scope: 'strict',
  },
  {
    family: 'praise_confirmation',
    pattern:
      /잘\s*(?:짚|보셨|찾으셨|파악하셨|포착|캐치)|제대로\s*(?:짚|보셨|파악하셨)|핵심을\s*(?:짚|찌르|찔)|정확히\s*(?:짚|보셨|파악하셨)/u,
    example: '잘 짚으셨어요.',
    scope: 'strict',
  },
  {
    family: 'praise_confirmation',
    pattern:
      /일리(?:가|는)?\s*있|설득력(?:이|도)?\s*있|그럴듯(?:해요|하네요|합니다|한\s*(?:추리|가설|생각|추측))|충분히\s*가능(?:한|해|합)|타당(?:해요|하네요|합니다|한\s*(?:추리|가설|생각|추측))/u,
    example: '일리가 있어요.',
    scope: 'strict',
  },
  // ── 답을 실은 되묻기 ───────────────────────────────────────────────
  {
    family: 'leading_question',
    pattern:
      /(?:생각해|떠올려|고려해|의심해)\s*보셨(?:나요|어요|을까요)|눈에\s*(?:띄|들어오)지\s*않(?:았|으셨)|(?:이상|수상)하(?:지|다고)\s*않(?:나요|으세요|았나요|으셨나요)/u,
    example: '혹시 집사의 장갑은 생각해 보셨나요?',
    scope: 'always',
  },
];

const QUOTES = [/「([^」]+)」/gu, /『([^』]+)』/gu, /“([^”]+)”/gu, /"([^"\n]+)"/gu, /‘([^’]+)’/gu];
const MIN_TRUSTED_QUOTE = 4;
// 독자가 직접 적은 단서·가설을 가리키는 말 — 아모가 고른 것이 아니다
const READER_AUTHORED =
  /(?:적|쓰|남기|표시하|기록하|메모하)(?:으신|신|어\s*(?:두신|놓으신)|셨던)\s*(?:단서|힌트|가설|메모|노트)/gu;

function compact(text: string): string {
  return text.replace(/[\s"'“”‘’「」『』]+/gu, '');
}

/**
 * 따옴표 안의 글이 trusted(K 이하 원문·독자가 쓴 글)에 그대로 있으면 그 부분을 지운다.
 * trusted는 호출자가 이미 K 이하로 고른 글만 넘긴다 — 여기서 저장소를 읽지 않는다 (R4, 절대 규칙 7).
 */
export function stripTrustedQuotes(answer: string, trusted: ReadonlyArray<string>): string {
  const sources = trusted.map(compact);
  let text = answer;
  for (const pattern of QUOTES) {
    text = text.replace(pattern, (whole, inner: string) => {
      const quote = compact(inner);
      return quote.length >= MIN_TRUSTED_QUOTE && sources.some((s) => s.includes(quote))
        ? ' '
        : whole;
    });
  }
  return text.replace(READER_AUTHORED, ' ');
}

export function findSteeringHints(
  answer: string,
  options: { strict: boolean; trusted?: ReadonlyArray<string> }
): HintFamily[] {
  const text = stripTrustedQuotes(answer, options.trusted ?? []);
  const families = new Set<HintFamily>();
  for (const entry of HINT_PATTERNS) {
    if (entry.scope === 'strict' && !options.strict) continue;
    if (entry.pattern.test(text)) families.add(entry.family);
  }
  return [...families];
}

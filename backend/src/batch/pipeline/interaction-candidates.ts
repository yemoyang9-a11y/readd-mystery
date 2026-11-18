/**
 * 구조적 상호작용 후보 생성 — FR-CHR-001 🚦, FR-DAT-005, R9(배치 전용, LLM 0회)
 *
 * 인물 관계를 "어떤 쌍에 붙일지"를 LLM이 고르지 않게 한다. 원문에서 두 인물이 실제로 함께 드러난
 * 곳만 후보가 되고, 각 후보는 근거 창(페이지·UTF-16 위치·원문)을 갖는다. 관계 라벨 단계
 * (relationship-labeling.ts)는 이 후보와 창 안의 낱말로만 라벨을 붙인다.
 *
 * 근거 — docs/context/research-2026-11-18-relationship-extraction.md
 *  - 상호작용 정의: Labatut & Bost 2019 4장(동시 등장·대화·직접 행동). 동시 등장은 실제 상호작용의
 *    "대리값"이라 거짓 간선이 생긴다 → 후보(재현율)로만 쓰고 라벨·판정은 다음 단계가 한다.
 *  - 문장 단위 동시 등장: Agarwal et al. 2013(같은 문장 쌍 = 사회적 사건 후보, 연결망 재현율 1.00·
 *    정밀도 0.40), Chaturvedi et al. 2016(두 인물이 함께 나온 문장 열).
 *  - 대화: Elson et al. 2010(인용 귀속 + 인접 인용 = 대화, 정밀도 .95/재현율 .51), Muzny et al. 2017
 *    (부름말·말하기 동사 체), Labatut & Bost 4.2.1(주고받기 가정: 앞 화자에게 하는 말).
 *  - 인물 해소: Bamman et al. 2014·Elson 2010의 이름 변형 군집을 기존 인물/별칭 추출이 맡고, 여기서는
 *    두 인물이 같이 쓰는 표기를 쓰지 않는다(Vala et al. 2015의 병합 금지와 같은 보수적 선택).
 *    대명사 상호참조는 하지 않는다 — Amalvy et al. 2025: 잘못된 상호참조 연결이 가장 해롭다.
 *
 * 쪽 경계를 넘는 창은 만들지 않는다 — 근거 위치는 쪽 본문의 오프셋이다(grounding.ts와 같은 계약).
 */
import { Page } from '../../shared/types';
import { VerifierCharacter, endpointForms } from './relationship-verification';

export type CandidateCharacter = VerifierCharacter;

export interface TextSpan {
  start: number;
  end: number;
}

export interface Mention extends TextSpan {
  character_id: string;
  surface: string;
  /** 이름 바로 뒤의 조사(한국어). 없으면 '' */
  particle: string;
}

export type WindowKind = 'sentence' | 'adjacent' | 'dialogue';

export interface EvidenceWindow extends TextSpan {
  /** 결정적 id — p{쪽}:{시작}-{끝}:{종류} */
  id: string;
  kind: WindowKind;
  page_no: number;
  text: string;
  mentions: Mention[];
  /** 대화 창에서만 — 말한 사람, 듣는 사람 */
  speaker_id?: string;
  addressee_id?: string;
  /** 대화 창에서만 — 대사(따옴표 포함)의 위치 */
  quote?: TextSpan;
}

export interface InteractionCandidate {
  /** 정렬된 두 인물 id */
  a_id: string;
  b_id: string;
  a_name: string;
  b_name: string;
  windows: EvidenceWindow[];
  /** 순위·보고용 가중치. 문턱값으로 후보를 버리지 않는다(재현율 우선, 판정은 라벨 단계) */
  weight: number;
  first_page: number;
}

/** Labatut & Bost 4.1.2 — 거리가 멀수록 약한 상호작용. 값 자체는 보고·정렬용 */
export const WINDOW_WEIGHT: Record<WindowKind, number> = {
  sentence: 1,
  dialogue: 1,
  adjacent: 0.5,
};

const OPEN_QUOTES = '“‘「『"';
const CLOSE_QUOTES = '”’」』"';
const TERMINATORS = '.!?。！？';
const ABBREVIATIONS = /(?:^|\s)(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Mme|Mlle)$/u;

/**
 * 문장 경계 — 마침표·물음표·느낌표 뒤 공백, 빈 줄. 따옴표 안의 마침표에서는 자르지 않는다.
 * 돌려주는 위치는 앞뒤 공백을 뺀 쪽 본문의 정확한 범위다.
 */
export function splitSentences(content: string): TextSpan[] {
  const spans: TextSpan[] = [];
  let start = 0;
  let depth = 0;
  const push = (end: number) => {
    let s = start;
    let e = end;
    while (s < e && /\s/u.test(content[s])) s++;
    while (e > s && /\s/u.test(content[e - 1])) e--;
    if (e > s) spans.push({ start: s, end: e });
    start = end;
  };
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    // 곧은 따옴표(")는 열기·닫기가 같아 깊이로 번갈아 센다
    if (c === '"') depth = depth > 0 ? depth - 1 : depth + 1;
    else if (OPEN_QUOTES.includes(c)) depth++;
    else if (CLOSE_QUOTES.includes(c)) {
      depth = Math.max(0, depth - 1);
      // 대사가 문장 끝 부호로 끝나고 뒤에 서술이 없으면(다음 대사·줄바꿈) 여기서 끊는다
      const next = content.slice(i + 1).match(/^\s*(.)/su)?.[1];
      if (
        depth === 0 &&
        TERMINATORS.includes(content[i - 1] ?? '') &&
        (next === undefined || OPEN_QUOTES.includes(next))
      )
        push(i + 1);
      continue;
    }
    if (depth > 0) continue;
    if (TERMINATORS.includes(c)) {
      const after = content[i + 1];
      if (after !== undefined && !/\s/u.test(after) && !CLOSE_QUOTES.includes(after)) continue;
      if (c === '.' && ABBREVIATIONS.test(content.slice(Math.max(0, i - 5), i))) continue;
      push(i + 1);
    } else if (c === '\n' && /^\n\s*/u.test(content.slice(i + 1, i + 2))) {
      push(i);
    }
  }
  push(content.length);
  return spans;
}

/** 이름 뒤에 붙을 수 있는 조사·어미 — 긴 것부터. 목록에 없는 한글이 이어지면 더 긴 낱말의 일부로 본다 */
const PARTICLES = [
  '께서는',
  '께서',
  '에게서',
  '한테서',
  '으로부터',
  '로부터',
  '이라고',
  '이라는',
  '이라니',
  '이란',
  '이랑',
  '이여',
  '이야',
  '이나',
  '이며',
  '이고',
  '이다',
  '이었',
  '이지',
  '이는',
  '이가',
  '이를',
  '이도',
  '이만',
  '이의',
  '이와',
  '이에게',
  '이한테',
  '에게',
  '한테',
  '더러',
  '보고',
  '하고',
  '처럼',
  '보다',
  '까지',
  '부터',
  '마저',
  '조차',
  '밖에',
  '으로',
  '같이',
  '만큼',
  '라고',
  '라는',
  '라니',
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '의',
  '와',
  '과',
  '도',
  '만',
  '로',
  '에',
  '야',
  '아',
  '여',
  '랑',
  '나',
  '란',
  '라',
  '다',
  '였',
  '네',
  '님',
  '씨',
  '께',
  '들',
  '뿐',
].sort((a, b) => b.length - a.length);

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function mentionPattern(form: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRe(form)}(${PARTICLES.join('|')})?(?![\\p{L}\\p{N}])|(?<![\\p{L}\\p{N}])${escapeRe(form)}(?='s\\b|’s\\b)`,
    'gu'
  );
}

/**
 * 인물 언급 — 대표명·근거와 함께 등록된 별칭 중 그 쪽에서 한 인물만 가리키는 표기(endpointForms).
 * 겹치면 긴 표기를 먼저 잡는다. 대명사·직책어는 잡지 않는다.
 */
export function findMentions(
  content: string,
  lexicon: CandidateCharacter[],
  pageNo: number
): Mention[] {
  const forms: { form: string; id: string }[] = [];
  for (const c of lexicon) {
    if (c.first_appearance_page > pageNo) continue;
    for (const form of endpointForms(c, lexicon, pageNo)) forms.push({ form, id: c.id });
  }
  forms.sort((a, b) => b.form.length - a.form.length);
  const taken: Mention[] = [];
  for (const { form, id } of forms) {
    for (const m of content.matchAll(mentionPattern(form))) {
      const start = m.index!;
      const end = start + form.length;
      if (taken.some((t) => start < t.end && end > t.start)) continue;
      taken.push({ character_id: id, surface: form, start, end, particle: m[1] ?? '' });
    }
  }
  return taken.sort((a, b) => a.start - b.start);
}

/** 대사 범위 — 여는 따옴표부터 닫는 따옴표까지 */
export function findQuotes(content: string): TextSpan[] {
  const out: TextSpan[] = [];
  const re = /“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/gu;
  for (const m of content.matchAll(re)) out.push({ start: m.index!, end: m.index! + m[0].length });
  return out;
}

const SPEECH_VERB =
  /(?:말했|말하였|말한다|물었|물어|묻는|대답|답했|외쳤|소리쳤|소리를\s*질렀|중얼거|속삭|부르짖|여쭈|아뢰|일렀|타일렀|꾸짖|웃으며\s*말|said|asked|replied|cried|answered|exclaimed|whispered)/u;
const SUBJECT_PARTICLE = /^(?:은|는|이|가|께서|께서는|이는|이가)$/u;
const VOCATIVE_PARTICLE = /^(?:아|야|여|이여|씨|님)$/u;

/**
 * 대사 화자 — 대사 바로 뒤 같은 문장의 서술(“…” 도현이 물었다)에 주격 조사 붙은 인물 언급이
 * 하나뿐이고 말하기 동사가 있을 때만(Elson 2010의 'Character trigram'·Muzny 2017의 체). 없으면 미확인.
 */
function quoteSpeaker(
  content: string,
  quote: TextSpan,
  sentence: TextSpan,
  mentions: Mention[]
): { speaker?: string; narrationEnd: number } {
  let end = sentence.end;
  const nextQuote = content.slice(quote.end, sentence.end).search(/[“「『"]/u);
  if (nextQuote >= 0) end = quote.end + nextQuote;
  const narration = content.slice(quote.end, end);
  if (!SPEECH_VERB.test(narration)) return { narrationEnd: end };
  const subjects = mentions.filter(
    (m) => m.start >= quote.end && m.end <= end && SUBJECT_PARTICLE.test(m.particle)
  );
  const ids = new Set(subjects.map((m) => m.character_id));
  return ids.size === 1 ? { speaker: [...ids][0], narrationEnd: end } : { narrationEnd: end };
}

/**
 * 대사 앞 서술 — 대사가 문장 첫머리에 있고, 바로 앞 문장이 말하기 동사로 끝나며 주격 인물이 하나뿐이면
 * 그 인물이 화자다(Muzny et al. 2017의 'paragraph final mention' 체). 1930년대 소설의 흔한 형식이다.
 */
function precedingSpeaker(
  content: string,
  quote: TextSpan,
  sentences: TextSpan[],
  index: number,
  mentions: Mention[]
): { speaker: string; start: number } | undefined {
  const prev = sentences[index - 1];
  if (!prev || content.slice(sentences[index].start, quote.start).trim() !== '') return undefined;
  const text = content.slice(prev.start, prev.end);
  if (!SPEECH_VERB.test(text.slice(-12))) return undefined;
  const ids = new Set(
    mentions
      .filter(
        (m) => m.start >= prev.start && m.end <= prev.end && SUBJECT_PARTICLE.test(m.particle)
      )
      .map((m) => m.character_id)
  );
  return ids.size === 1 ? { speaker: [...ids][0], start: prev.start } : undefined;
}

/** 부름말 — 대사 첫머리의 "이름+아/야/씨," 또는 "이름," */
function vocativeAddressee(
  content: string,
  quote: TextSpan,
  mentions: Mention[]
): string | undefined {
  const inner = mentions.filter((m) => m.start > quote.start && m.end < quote.end);
  for (const m of inner) {
    const before = content.slice(quote.start + 1, m.start);
    const after = content.slice(m.end + m.particle.length, m.end + m.particle.length + 1);
    const atHead =
      /^[\s,]*(?:(?:오|아|어이|여보|얘|이봐)[,\s]+)?$/u.test(before) || /[,!]\s*$/u.test(before);
    // "몽란이!"처럼 받침 있는 이름 뒤 '-이'도 부르는 말로 쓰인다(쉼표·느낌표가 바로 따를 때만)
    if (
      atHead &&
      (VOCATIVE_PARTICLE.test(m.particle) ||
        ((m.particle === '' || m.particle === '이') && /^[,!?]/u.test(after)))
    )
      return m.character_id;
  }
  return undefined;
}

function pairKey(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

/**
 * 쪽 목록 → 인물 쌍 후보. 같은 문장(sentence), 이웃한 두 문장(adjacent, 어느 한 문장에도 둘이
 * 함께 있지 않을 때만), 대화(dialogue: 화자가 확인된 대사 + 부름말 또는 바로 앞 화자) 창을 만든다.
 */
export function generateInteractionCandidates(
  pages: Page[],
  lexicon: CandidateCharacter[]
): InteractionCandidate[] {
  const byPair = new Map<string, EvidenceWindow[]>();
  const add = (a: string, b: string, w: EvidenceWindow) => {
    if (a === b) return;
    const key = pairKey(a, b).join('|');
    const list = byPair.get(key) ?? [];
    if (!list.some((x) => x.id === w.id)) list.push(w);
    byPair.set(key, list);
  };
  const windowOf = (
    page: Page,
    span: TextSpan,
    kind: WindowKind,
    mentions: Mention[],
    extra: Partial<EvidenceWindow> = {}
  ): EvidenceWindow => ({
    id: `p${page.page_no}:${span.start}-${span.end}:${kind}`,
    kind,
    page_no: page.page_no,
    start: span.start,
    end: span.end,
    text: page.content.slice(span.start, span.end),
    mentions: mentions.filter((m) => m.start >= span.start && m.end <= span.end),
    ...extra,
  });

  for (const page of [...pages].sort((a, b) => a.page_no - b.page_no)) {
    const mentions = findMentions(page.content, lexicon, page.page_no);
    if (mentions.length === 0) continue;
    const sentences = splitSentences(page.content);
    const inSentence = sentences.map((s) => [
      ...new Set(
        mentions.filter((m) => m.start >= s.start && m.end <= s.end).map((m) => m.character_id)
      ),
    ]);
    sentences.forEach((s, i) => {
      const ids = inSentence[i];
      for (let x = 0; x < ids.length; x++)
        for (let y = x + 1; y < ids.length; y++)
          add(ids[x], ids[y], windowOf(page, s, 'sentence', mentions));
      const next = inSentence[i + 1];
      if (!next) return;
      const span = { start: s.start, end: sentences[i + 1].end };
      for (const a of ids)
        for (const b of next) {
          if (
            a === b ||
            (ids.includes(b) && ids.includes(a)) ||
            (next.includes(a) && next.includes(b))
          )
            continue;
          add(a, b, windowOf(page, span, 'adjacent', mentions));
        }
    });

    // 대화 — 화자가 확인된 대사만. 청자는 부름말, 없으면 바로 앞 대사의 (다른) 화자
    let previous: { speaker: string; end: number } | undefined;
    for (const q of findQuotes(page.content)) {
      const si = sentences.findIndex((s) => q.start >= s.start && q.start < s.end);
      if (si === -1) continue;
      const sentence = sentences[si];
      const after = quoteSpeaker(page.content, q, sentence, mentions);
      const before = after.speaker
        ? undefined
        : precedingSpeaker(page.content, q, sentences, si, mentions);
      const speaker = after.speaker ?? before?.speaker;
      const narrationEnd = after.narrationEnd;
      if (!speaker) {
        previous = undefined;
        continue;
      }
      let addressee = vocativeAddressee(page.content, q, mentions);
      // 주고받기 가정 — 앞 대사와 사이 서술이 짧을 때만(Elson 2010은 300단어; 한국어 쪽 안 300자)
      if (!addressee && previous && previous.speaker !== speaker && q.start - previous.end <= 300)
        addressee = previous.speaker;
      if (addressee && addressee !== speaker) {
        const span = { start: before?.start ?? q.start, end: Math.max(narrationEnd, q.end) };
        const trimmed = { start: span.start, end: span.end };
        while (trimmed.end > trimmed.start && /\s/u.test(page.content[trimmed.end - 1]))
          trimmed.end--;
        add(
          speaker,
          addressee,
          windowOf(page, trimmed, 'dialogue', mentions, {
            speaker_id: speaker,
            addressee_id: addressee,
            quote: { start: q.start, end: q.end },
          })
        );
      }
      previous = { speaker, end: narrationEnd };
    }
  }

  const nameOf = new Map(lexicon.map((c) => [c.id, c.name]));
  const out: InteractionCandidate[] = [];
  for (const [key, windows] of byPair) {
    const [a, b] = key.split('|');
    windows.sort(
      (x, y) => x.page_no - y.page_no || x.start - y.start || x.kind.localeCompare(y.kind)
    );
    out.push({
      a_id: a,
      b_id: b,
      a_name: nameOf.get(a) ?? a,
      b_name: nameOf.get(b) ?? b,
      windows,
      weight: windows.reduce((sum, w) => sum + WINDOW_WEIGHT[w.kind], 0),
      first_page: windows[0].page_no,
    });
  }
  return out.sort(
    (x, y) =>
      x.first_page - y.first_page || `${x.a_id}|${x.b_id}`.localeCompare(`${y.a_id}|${y.b_id}`)
  );
}

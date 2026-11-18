/**
 * 구조적 상호작용 후보 — FR-CHR-001 🚦
 *
 * 구현 전에 작성했다. 관계 라벨을 붙일 수 있는 인물 쌍은 원문에서 두 인물이 같은 문장(또는
 * 이웃 문장, 대화 주고받기)에 실제로 드러난 쌍뿐이다. 근거 창은 페이지 본문의 정확한 위치를 갖는다.
 * LLM·DB를 부르지 않는다.
 */
import { Page } from '../../shared/types';
import {
  CandidateCharacter,
  findMentions,
  generateInteractionCandidates,
  splitSentences,
} from './interaction-candidates';

const page = (page_no: number, content: string): Page => ({
  id: `p${page_no}`,
  book_id: 'fixture',
  page_no,
  content,
});

const ch = (
  id: string,
  name: string,
  first = 1,
  aliases: { alias: string; first_appearance_page: number }[] = []
): CandidateCharacter => ({ id, name, first_appearance_page: first, aliases });

const lexicon = [
  ch('seoyun', '서윤'),
  ch('dohyun', '도현'),
  ch('min', '민'),
  ch('yuna', '윤아', 1, [{ alias: '새벽', first_appearance_page: 2 }]),
  ch('su', '수'),
];

describe('FR-CHR-001: 문장 분할과 인물 언급', () => {
  test('문장 경계는 페이지 본문의 정확한 위치다 — 따옴표 안 마침표에서 자르지 않는다', () => {
    const text = '“어디 가니? 늦었어.” 서윤이 물었다. 도현은 대답하지 않았다.';
    const sentences = splitSentences(text);
    expect(sentences.map((s) => text.slice(s.start, s.end))).toEqual([
      '“어디 가니? 늦었어.” 서윤이 물었다.',
      '도현은 대답하지 않았다.',
    ]);
  });

  test('조사가 붙은 이름은 언급이고, 더 긴 낱말 속 글자는 언급이 아니다', () => {
    const text = '민은 시민들 사이에서 민수를 보았다. 윤아와 민, 수가 남았다.';
    const mentions = findMentions(text, lexicon, 1);
    expect(mentions.map((m) => [m.character_id, m.surface, m.particle])).toEqual([
      ['min', '민', '은'],
      ['yuna', '윤아', '와'],
      ['min', '민', ''],
      ['su', '수', '가'],
    ]);
    for (const m of mentions) expect(text.slice(m.start, m.end)).toBe(m.surface);
  });

  test('별칭은 그 별칭이 처음 나온 쪽부터만 인물로 해소한다', () => {
    expect(findMentions('새벽은 민을 신뢰했다.', lexicon, 1).map((m) => m.character_id)).toEqual([
      'min',
    ]);
    expect(findMentions('새벽은 민을 신뢰했다.', lexicon, 2).map((m) => m.character_id)).toEqual([
      'yuna',
      'min',
    ]);
  });

  test('두 인물이 같이 쓰는 호칭은 어느 쪽으로도 해소하지 않는다', () => {
    const shared = [
      ch('a', '김철수', 1, [{ alias: '선생', first_appearance_page: 1 }]),
      ch('b', '이영희', 1, [{ alias: '선생', first_appearance_page: 1 }]),
    ];
    expect(findMentions('선생은 웃었다.', shared, 1)).toEqual([]);
  });
});

describe('FR-CHR-001: 상호작용 후보 생성', () => {
  test('FR-CHR-001: 같은 문장에 함께 나온 두 인물 → 후보 1쌍, 근거 창은 정확한 페이지·위치', () => {
    const p = page(3, '바다는 조용했다. 서윤은 도현을 질투했다. 바람이 불었다.');
    const out = generateInteractionCandidates([p], lexicon);
    expect(out).toHaveLength(1);
    const c = out[0];
    expect([c.a_id, c.b_id].sort()).toEqual(['dohyun', 'seoyun']);
    expect(c.first_page).toBe(3);
    expect(c.windows).toHaveLength(1);
    const w = c.windows[0];
    expect(w.kind).toBe('sentence');
    expect(w.page_no).toBe(3);
    expect(p.content.slice(w.start, w.end)).toBe(w.text);
    expect(w.text).toBe('서윤은 도현을 질투했다.');
  });

  test('FR-CHR-001: 한 번도 가까이 나오지 않은 두 인물 → 후보 0건', () => {
    const pages = [
      page(1, '서윤은 항구에 도착했다. 날이 저물었다. 비가 왔다. 상점이 문을 닫았다.'),
      page(2, '도현은 산으로 갔다. 그는 혼자였다.'),
    ];
    expect(generateInteractionCandidates(pages, lexicon)).toEqual([]);
  });

  test('FR-CHR-001: 페이지가 달라 같은 문장에 없으면 후보 0건 (쪽 경계를 넘는 창은 만들지 않는다)', () => {
    const pages = [page(1, '서윤은 항구에 있었다.'), page(2, '도현은 배를 탔다.')];
    expect(generateInteractionCandidates(pages, lexicon)).toEqual([]);
  });

  test('이웃 문장에만 함께 나오면 이웃 창(adjacent) 후보다 — 문장 창보다 약하다', () => {
    const p = page(4, '서윤은 항구의 소유권을 원했다. 도현은 배를 탔다.');
    const out = generateInteractionCandidates([p], lexicon);
    expect(out).toHaveLength(1);
    expect(out[0].windows.map((w) => w.kind)).toEqual(['adjacent']);
    expect(out[0].windows[0].text).toBe(p.content);
    expect(out[0].weight).toBeLessThan(1);
  });

  test('세 사람이 한 문장에 있으면 세 쌍 모두 후보다', () => {
    const out = generateInteractionCandidates([page(9, '윤아와 민, 수가 방에 남았다.')], lexicon);
    expect(out.map((c) => [c.a_id, c.b_id].sort().join('~')).sort()).toEqual([
      'min~su',
      'min~yuna',
      'su~yuna',
    ]);
  });

  test('대화 — 부름말(“서윤아,”)과 말한 사람(도현이 물었다)으로 화자→청자 대화 창을 만든다', () => {
    const p = page(7, '“서윤아, 어디 가?” 도현이 물었다.');
    const out = generateInteractionCandidates([p], lexicon);
    const dialogue = out.flatMap((c) => c.windows).filter((w) => w.kind === 'dialogue');
    expect(dialogue).toHaveLength(1);
    expect(dialogue[0].speaker_id).toBe('dohyun');
    expect(dialogue[0].addressee_id).toBe('seoyun');
    expect(p.content.slice(dialogue[0].start, dialogue[0].end)).toBe(dialogue[0].text);
  });

  test('대화 — 부름말이 없으면 바로 앞 말을 한 다른 사람에게 하는 말로 본다(주고받기 가정)', () => {
    const p = page(8, '“오늘은 바람이 세.” 도현이 말했다. “그래도 나가야 해.” 서윤이 대답했다.');
    const out = generateInteractionCandidates([p], lexicon);
    const dialogue = out.flatMap((c) => c.windows).filter((w) => w.kind === 'dialogue');
    expect(dialogue.map((w) => [w.speaker_id, w.addressee_id])).toEqual([['seoyun', 'dohyun']]);
  });

  test('대화 — 대사 바로 앞 문장이 말하기 동사로 끝나면 그 주어가 화자, "몽란이!"는 부름말', () => {
    const lex = [ch('na', '나용귀'), ch('mong', '이몽란')];
    const p = page(12, '그때 나용귀가 크게 소리쳤다.\n“몽란이! 그러면 나를 죽일 테냐?”');
    const dialogue = generateInteractionCandidates([p], lex)
      .flatMap((c) => c.windows)
      .filter((w) => w.kind === 'dialogue');
    expect(dialogue.map((w) => [w.speaker_id, w.addressee_id])).toEqual([['na', 'mong']]);
    expect(p.content.slice(dialogue[0].start, dialogue[0].end)).toBe(p.content);
  });

  test('앞 문장에 주어가 둘 이상이면 화자를 정하지 않는다', () => {
    const lex = [ch('na', '나용귀'), ch('mong', '이몽란'), ch('jin', '진대성')];
    const p = page(12, '나용귀가 말하자 진대성이 대답했다.\n“몽란이! 그러면 나를 죽일 테냐?”');
    expect(
      generateInteractionCandidates([p], lex)
        .flatMap((c) => c.windows)
        .filter((w) => w.kind === 'dialogue')
    ).toEqual([]);
  });

  test('화자를 확인하지 못한 대사는 대화 창을 만들지 않는다', () => {
    // 부름말로 청자(서윤)는 보이지만 누가 말했는지 서술이 없다 — 화자를 짐작해 쌍을 만들지 않는다
    const p = page(8, '“서윤아, 오늘은 바람이 세.” “그래도 나가야 해.”');
    expect(generateInteractionCandidates([p], lexicon)).toEqual([]);
  });

  test('후보는 가장 이른 근거 쪽 순, 창 id는 결정적이다', () => {
    const pages = [
      page(5, '민은 윤아를 믿었다.'),
      page(2, '서윤은 도현을 보았다.'),
      page(6, '민은 윤아에게 편지를 썼다.'),
    ];
    const a = generateInteractionCandidates(pages, lexicon);
    const b = generateInteractionCandidates([...pages].reverse(), lexicon);
    expect(a).toEqual(b);
    expect(a.map((c) => c.first_page)).toEqual([2, 5]);
    expect(a[1].windows.map((w) => w.page_no)).toEqual([5, 6]);
    expect(new Set(a.flatMap((c) => c.windows.map((w) => w.id))).size).toBe(3);
  });
});

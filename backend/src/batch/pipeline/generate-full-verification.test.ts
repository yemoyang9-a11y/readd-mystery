import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { call } from '../../modules/llm-gateway/gateway';
import { generateFullBook } from './run-generate-full';
import { bookArgsFor } from './run-args';

jest.mock('../../modules/llm-gateway/gateway', () => ({ call: jest.fn() }));

const TEXT =
  '박영민은 해왕좌의 좌장이다. 이몽란은 그의 부인이다. 유불란은 소설가다. 운전수는 차를 몰았다. 에도가와 란포의 소설이다.';
const QUOTE = '이몽란은 그의 부인이다.';

const person = (name: string, quote: string, patch: Record<string, unknown> = {}) => ({
  name,
  first_appearance_page: 1,
  entity_type: 'person',
  story_presence: 'in_story',
  identity_status: 'distinct',
  rationale: '서술된다.',
  evidence: { source_page: 1, quote },
  earlier_mentions: [],
  aliases: [],
  notes: [],
  ...patch,
});

const relationship = (patch: Record<string, unknown> = {}) => ({
  character_a: '박영민',
  character_b: '이몽란',
  label: '남편이다',
  established_page: 1,
  assertion_status: 'fact',
  change_type: 'establishment',
  rationale: '부인이라고 서술한다.',
  evidence: { source_page: 1, quote: QUOTE },
  semantics: {
    version: 2,
    direction: 'a_to_b',
    kind: 'family',
    relation_key: 'marriage',
    summary: '박영민은 이몽란의 남편이다.',
    assertion_status: 'fact',
    temporal_scope: 'ongoing',
    state: 'active',
    evidence: { source_page: 1, quote: QUOTE },
  },
  ...patch,
});

const characters = [
  person('박영민', '박영민은 해왕좌의 좌장이다.'),
  person('이몽란', QUOTE),
  person('유불란', '유불란은 소설가다.'),
  person('운전수', '운전수는 차를 몰았다.'),
  person('에도가와 란포', '에도가와 란포의 소설이다.', { story_presence: 'mentioned_only' }),
];

const sceneEvent = (patch: Record<string, unknown> = {}) => ({
  agent: '박영민',
  action: '박영민이 손님을 맞았다',
  mode: 'narration',
  realis: 'actual',
  flashback: false,
  evidence: [{ source_page: 1, quote: '박영민은 해왕좌의 좌장이다.' }],
  ...patch,
});

function setup(options: {
  second: unknown[];
  supports: boolean;
  events?: unknown[];
  eventReaderText?: string;
  relationshipReaderText?: string;
  summary?: string;
}) {
  let relationshipCalls = 0;
  (call as jest.Mock).mockImplementation(async (task: string, prompt: string) => {
    if (task === 'generate_summary') return JSON.stringify({ summary: options.summary ?? '요약' });
    if (task === 'generate_character') return JSON.stringify({ characters });
    if (task === 'generate_term') return JSON.stringify({ terms: [] });
    if (task === 'generate_event_scene_boundary') return JSON.stringify({ boundaries: [] });
    if (task === 'generate_event')
      return JSON.stringify({ events: options.events ?? [sceneEvent()] });
    if (task === 'rewrite_reader_text') {
      const keys = [...prompt.matchAll(/"key": "([^"]+)"/g)].map((m) => m[1]);
      return JSON.stringify({
        items: keys.map((key) => ({
          key,
          text: key.startsWith('rel:')
            ? (options.relationshipReaderText ?? '박영민과 이몽란은 부부예요.')
            : (options.eventReaderText ?? '박영민이 손님을 맞아요.'),
        })),
      });
    }
    if (task === 'generate_background') return JSON.stringify({ background: 'b', intro: 'i' });
    if (prompt.includes('반대 검토자'))
      return JSON.stringify({ supports: options.supports, why: '판단 이유' });
    relationshipCalls++;
    return JSON.stringify({
      relationships: relationshipCalls === 1 ? [relationship()] : options.second,
    });
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-'));
  const file = path.join(dir, 'book.txt');
  fs.writeFileSync(file, `\n\n1 시작\n\n${TEXT}\n`, 'utf-8');
  const args = bookArgsFor({ bookId: 'verify-book', filePath: file, title: 't', author: 'a' });
  args.generatedDir = dir;
  args.fullDir = path.join(dir, 'full');
  return args;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('FR-CHR-001: 인물 정리와 관계 검증이 생성 경로에 들어 있다', () => {
  test('FR-CHR-001: 이야기 밖 이름과 직책어는 등록하지 않고 검수에 남긴다', async () => {
    const args = setup({ second: [relationship()], supports: true });
    const book = await generateFullBook(args);
    expect(book.characters.map((c) => c.name).sort()).toEqual(['박영민', '유불란', '이몽란']);
    const reasons = JSON.stringify(
      (book as unknown as { review_candidates: unknown }).review_candidates
    );
    expect(reasons).toContain('mentioned_only');
    expect(reasons).toContain('role_word_not_a_name');
  });

  test('FR-CHR-001: 두 추출이 일치하고 반대 검토가 통과하면 confirmed로 저장한다', async () => {
    const args = setup({ second: [relationship()], supports: true });
    const book = await generateFullBook(args);
    expect(book.relationships).toHaveLength(1);
    expect(book.relationships[0].semantics?.verification).toEqual({
      check: 'confirmed',
      reasons: [],
      runs_agreed: 2,
    });
  });

  test('FR-CHR-001: 두 번째 추출에 없으면 needs_review로 저장한다', async () => {
    const args = setup({ second: [], supports: true });
    const book = await generateFullBook(args);
    expect(book.relationships).toHaveLength(1);
    expect(book.relationships[0].semantics?.verification).toEqual({
      check: 'needs_review',
      reasons: ['single_run'],
      runs_agreed: 1,
    });
  });

  test('NFR-AI-004: 반대 검토가 거부한 관계는 등록하지 않고 verifier_rejected로 남긴다', async () => {
    const args = setup({ second: [relationship()], supports: false });
    const book = await generateFullBook(args);
    expect(book.relationships).toHaveLength(0);
    const held = JSON.stringify(
      (book as unknown as { review_candidates: unknown }).review_candidates
    );
    expect(held).toContain('held: verifier_rejected');
  });

  test('FR-CHR-001: 다시 실행해도 두 번째 추출과 반대 검토를 모델에 다시 묻지 않는다', async () => {
    const args = setup({ second: [relationship()], supports: true });
    await generateFullBook(args);
    fs.rmSync(path.join(args.fullDir, 'all-resolved.json'));
    (call as jest.Mock).mockClear();
    await generateFullBook(args);
    expect(call).not.toHaveBeenCalledWith(
      'generate_relationship',
      expect.anything(),
      expect.anything()
    );
  });
});

describe('R9: 독자용 쉬운 문장이 생성 경로에 들어 있다', () => {
  test('R9: 관계는 semantics.reader_summary, 사건은 reader_description에 담는다', async () => {
    const args = setup({ second: [relationship()], supports: true });
    const book = await generateFullBook(args);
    expect(book.relationships[0].semantics?.reader_summary).toBe('박영민과 이몽란은 부부예요.');
    expect(book.relationships[0].semantics?.summary).toBe('박영민은 이몽란의 남편이다.');
    expect(book.events).toHaveLength(1);
    expect(book.events[0].reader_description).toBe('박영민이 손님을 맞아요.');
  });

  test('R9: 다시 실행해도 이미 만든 쉬운 문장은 모델에 다시 묻지 않는다', async () => {
    const args = setup({ second: [relationship()], supports: true });
    await generateFullBook(args);
    fs.rmSync(path.join(args.fullDir, 'all-resolved.json'));
    (call as jest.Mock).mockClear();
    const book = await generateFullBook(args);
    expect(call).not.toHaveBeenCalledWith(
      'rewrite_reader_text',
      expect.anything(),
      expect.anything()
    );
    expect(book.relationships[0].semantics?.reader_summary).toBe('박영민과 이몽란은 부부예요.');
  });
});

describe('FR-DAT-008: 사건은 장면 단위로 뽑고 원문 근거로 검증한다', () => {
  const callsOf = (name: string) =>
    (call as jest.Mock).mock.calls.filter(([task]) => task === name);
  // 경계 호출과 장면별 추출 호출은 작업 이름이 다르다 (NFR-OBS-004 — 비용 지표 구분)
  const boundaryCalls = () => callsOf('generate_event_scene_boundary');
  const sceneCalls = () => callsOf('generate_event');
  const eventCalls = () => [...boundaryCalls(), ...sceneCalls()];
  const reviewOf = (book: unknown) =>
    JSON.stringify((book as { review_candidates: unknown }).review_candidates);

  test('FR-DAT-008: 장당 경계 1회 + 장면당 1회 호출하고 발생 쪽은 장면 끝 쪽이다', async () => {
    const args = setup({ second: [relationship()], supports: true });
    const book = await generateFullBook(args);
    expect(eventCalls()).toHaveLength(2);
    expect(boundaryCalls()).toHaveLength(1);
    expect(sceneCalls()).toHaveLength(1);
    expect(book.events).toHaveLength(1);
    expect(book.events[0]).toMatchObject({
      event: '박영민이 손님을 맞았다',
      description: '박영민이 손님을 맞았다',
      occurrence_page: 1,
      agent: '박영민',
      mode: 'narration',
      flashback: false,
    });
  });

  test('NFR-AI-004: 인용이 원문에 없는 사건은 0건 저장하고 검수 후보에 남긴다', async () => {
    const args = setup({
      second: [relationship()],
      supports: true,
      events: [sceneEvent({ evidence: [{ source_page: 1, quote: '박영민이 손님을 맞았다.' }] })],
    });
    const book = await generateFullBook(args);
    expect(book.events).toHaveLength(0);
    expect(reviewOf(book)).toContain('event_evidence_not_in_source');
  });

  test('NFR-AI-004: 독자용 문장에 원래 없던 인물명이 생기면 쓰지 않고 검수 후보로 보낸다', async () => {
    const args = setup({
      second: [relationship()],
      supports: true,
      eventReaderText: '유불란이 손님을 맞아요.',
    });
    const book = await generateFullBook(args);
    expect(book.events).toHaveLength(1);
    expect(book.events[0].reader_description).toBeUndefined();
    expect(reviewOf(book)).toContain('reader_text_new_proper_noun');
    expect(reviewOf(book)).toContain('유불란');
  });

  test('FR-DAT-008: 다시 실행하면 사건 캐시를 재생하고 사건 추출을 다시 부르지 않는다', async () => {
    const args = setup({ second: [relationship()], supports: true });
    const first = await generateFullBook(args);
    fs.rmSync(path.join(args.fullDir, 'all-resolved.json'));
    (call as jest.Mock).mockClear();
    const again = await generateFullBook(args);
    expect(eventCalls()).toHaveLength(0);
    expect(again.events).toEqual(first.events);
  });
});

describe('해석·평가어 검사가 생성 경로에 들어 있다', () => {
  const reviewOf = (book: unknown) =>
    JSON.stringify((book as { review_candidates: unknown }).review_candidates);

  test('FR-DAT-003: 장 요약에 평가어가 있으면 요약은 그대로 두고 검수 후보로 남긴다', async () => {
    const summary = '박영민이 결정적 증거를 찾았다.';
    const args = setup({ second: [relationship()], supports: true, summary });
    const book = await generateFullBook(args);
    expect(book.chapter_summaries.map((s) => s.summary)).toEqual([summary]);
    expect(reviewOf(book)).toContain('summary_evaluative_word');
  });

  test('R9: 사건의 독자용 문장에 평가어가 생기면 쓰지 않고 검수 후보로 보낸다', async () => {
    const args = setup({
      second: [relationship()],
      supports: true,
      eventReaderText: '박영민이 수상한 손님을 맞아요.',
    });
    const book = await generateFullBook(args);
    expect(book.events).toHaveLength(1);
    expect(book.events[0].description).toBe('박영민이 손님을 맞았다');
    expect(book.events[0].reader_description).toBeUndefined();
    expect(reviewOf(book)).toContain('reader_text_evaluative_word');
  });

  test('R9: 관계의 독자용 문장에 평가어가 생기면 쓰지 않고 검수 후보로 보낸다', async () => {
    const args = setup({
      second: [relationship()],
      supports: true,
      relationshipReaderText: '박영민과 이몽란은 중요한 부부예요.',
    });
    const book = await generateFullBook(args);
    expect(book.relationships).toHaveLength(1);
    expect(book.relationships[0].semantics?.summary).toBe('박영민은 이몽란의 남편이다.');
    expect(book.relationships[0].semantics?.reader_summary).toBeUndefined();
    expect(reviewOf(book)).toContain('reader_text_evaluative_word');
  });

  test('positive — 평가어가 없으면 요약·독자용 문장 모두 평가어 검수 후보 0건', async () => {
    const args = setup({ second: [relationship()], supports: true });
    const book = await generateFullBook(args);
    expect(book.events[0].reader_description).toBe('박영민이 손님을 맞아요.');
    expect(book.relationships[0].semantics?.reader_summary).toBe('박영민과 이몽란은 부부예요.');
    expect(reviewOf(book)).not.toContain('evaluative_word');
  });
});

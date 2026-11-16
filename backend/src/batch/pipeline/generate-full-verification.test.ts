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

function setup(options: { second: unknown[]; supports: boolean }) {
  let relationshipCalls = 0;
  (call as jest.Mock).mockImplementation(async (task: string, prompt: string) => {
    if (task === 'generate_summary') return JSON.stringify({ summary: '요약' });
    if (task === 'generate_character') return JSON.stringify({ characters });
    if (task === 'generate_term') return JSON.stringify({ terms: [] });
    if (task === 'generate_event') return JSON.stringify({ events: [] });
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

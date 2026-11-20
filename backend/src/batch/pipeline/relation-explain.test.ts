import * as fs from 'fs';
import * as path from 'path';
import { call } from '../../modules/llm-gateway/gateway';
import {
  ApplyRowsFile,
  ExplainInput,
  ExplainResultRow,
  aliasMapFromCharacters,
  buildExplainPrompt,
  buildExplainSql,
  dollarQuote,
  explainRelationships,
  explanationRejection,
  parseExplainArgs,
  pickEvidenceLine,
  quoteSha256,
  relationKeywords,
  validateExplanation,
} from './relation-explain';

jest.mock('../../modules/llm-gateway/gateway', () => ({ call: jest.fn() }));

const mockCall = call as jest.MockedFunction<typeof call>;

const validationDir = path.resolve(
  __dirname,
  '../../../../docs/validation/2026-11-18-relationships-claude'
);

describe('pickEvidenceLine', () => {
  const quote =
    '박영민은 서재에 있었다. 유불란은 박영민의 오랜 친구였다. 유불란은 홀로 돌아갔다.\n그날 밤은 조용했다.';

  test('FR-SPL-002: 두 이름이 모두 든 문장을 우선 고르고 원문 부분 문자열이다', () => {
    const line = pickEvidenceLine(quote, [['박영민'], ['유불란']]);
    expect(line).toBe('유불란은 박영민의 오랜 친구였다.');
    expect(quote.includes(line as string)).toBe(true);
  });

  test('두 이름 문장이 없으면 한 이름만 든 문장 중 가장 긴 것을 고른다', () => {
    const line = pickEvidenceLine('박영민은 서재에 있었다. 박영민은 오래 앉아 있었다.', [
      ['박영민'],
      ['유불란'],
    ]);
    expect(line).toBe('박영민은 오래 앉아 있었다.');
  });

  test('별칭과 이름 끝 두 글자로도 찾는다', () => {
    expect(pickEvidenceLine('몽란은 좌장을 보았다.', [['이몽란'], ['박영민', '좌장']])).toBe(
      '몽란은 좌장을 보았다.'
    );
  });

  test('이름이 어디에도 없으면 null', () => {
    expect(pickEvidenceLine('아무 일도 없었다.', [['박영민'], ['유불란']])).toBeNull();
    expect(pickEvidenceLine('', [['박영민']])).toBeNull();
  });

  test('120자 넘는 문장은 이름이 든 절로 줄이되 원문 부분 문자열이다', () => {
    const filler = '아주 오래도록 이어진 이야기가 계속되었고, '.repeat(5);
    const long = `${filler}박영민은 유불란을 좌장의 친구라고 불렀으며, ${filler}끝났다.`;
    const line = pickEvidenceLine(long, [['박영민'], ['유불란']]) as string;
    expect(line.length).toBeLessThanOrEqual(120);
    expect(long.includes(line)).toBe(true);
    expect(line).toContain('박영민');
    expect(line).toContain('유불란');
  });

  test('줄여도 120자 안에 이름이 안 들면 null', () => {
    const long = `${'가'.repeat(130)}박영민${'나'.repeat(130)}.`;
    expect(pickEvidenceLine(long, [['박영민'], ['유불란']])).toBeNull();
  });

  test('120자 이하 길이 제한을 지킨다', () => {
    const exact = `박영민과 유불란${'가'.repeat(120 - 8)}.`;
    expect(exact.length).toBe(121);
    expect(pickEvidenceLine(exact, [['박영민'], ['유불란']])).toBeNull();
  });

  test('줄바꿈과 머리표를 문장 경계로 보고 머리표는 떼어낸다', () => {
    const line = pickEvidenceLine('홍(洪)\n• 좌장 부인 해왕좌 배우 이몽란(李夢蘭, 24) ......', [
      ['이몽란'],
      ['박영민', '좌장'],
    ]);
    expect(line).toBe('좌장 부인 해왕좌 배우 이몽란(李夢蘭, 24)');
  });
});

describe('apply-rows.json 실제 14건', () => {
  const file = JSON.parse(
    fs.readFileSync(path.join(validationDir, 'apply-rows.json'), 'utf-8')
  ) as ApplyRowsFile;
  const characters = JSON.parse(
    fs.readFileSync(path.join(validationDir, 'characters.json'), 'utf-8')
  ) as { name: string; aliases?: { alias: string }[] }[];
  const aliases = aliasMapFromCharacters(characters);

  test('14건 모두 null이 아닌 원문 부분 문자열을 돌려준다', () => {
    expect(file.rows).toHaveLength(14);
    for (const row of file.rows) {
      const { quote } = row.semantics.evidence;
      const line = pickEvidenceLine(
        quote,
        [row.character_a_name, row.character_b_name].map((n) => [n, ...(aliases.get(n) ?? [])])
      );
      expect(line).not.toBeNull();
      expect(quote.includes(line as string)).toBe(true);
      expect((line as string).length).toBeLessThanOrEqual(120);
    }
  });
});

const input: ExplainInput = {
  key: 'rel:1',
  names: ['이몽란', '유불란'],
  label: '연인이다',
  assertionStatus: 'fact',
  evidenceLine: '첫사랑, 잘 때면 반드시 몽란은 유불란을 생각하고 유불란은 몽란을 꿈꾸었다.',
  quote: '첫사랑, 잘 때면 반드시 몽란은 유불란을 생각하고 유불란은 몽란을 꿈꾸었다.',
};

describe('explanationRejection', () => {
  const good = '이몽란과 유불란은 서로를 첫사랑으로 떠올리는 사이예요.';

  test('해요체·두 이름 포함·길이 이내면 통과', () => {
    expect(validateExplanation(input, good)).toBe(true);
    expect(explanationRejection(input, good)).toBeUndefined();
  });

  test('평서체는 거절', () => {
    expect(explanationRejection(input, '이몽란과 유불란은 첫사랑이다.')).toBe('not_easy_ending');
  });

  test('이름이 빠지면 거절', () => {
    expect(explanationRejection(input, '이몽란은 첫사랑을 떠올려요.')).toBe('missing_name');
  });

  test.each(['원문', '본문', '페이지', '텍스트', '인용', '요약'])('금지어 %s 거절', (word) => {
    expect(explanationRejection(input, `이몽란과 유불란은 ${word}에서 연인이에요.`)).toBe(
      'meta_word'
    );
  });

  test('문장 60자 초과·총 110자 초과·3문장 거절', () => {
    expect(explanationRejection(input, `이몽란과 유불란은 ${'가'.repeat(60)}이에요.`)).toBe(
      'sentence_too_long'
    );
    const two = `이몽란과 유불란은 ${'가'.repeat(45)}이에요. ${'나'.repeat(55)}이에요.`;
    expect(explanationRejection(input, two)).toBe('too_long');
    expect(explanationRejection(input, '이몽란과 유불란은 연인이에요. 오래됐어요. 그래요.')).toBe(
      'too_many_sentences'
    );
    expect(explanationRejection(input, '')).toBe('empty');
  });

  test('평가어는 거절', () => {
    expect(explanationRejection(input, '이몽란과 유불란은 결정적인 연인이에요.')).toBe(
      'evaluative_word'
    );
  });

  test('quote에 없는 범인 언급은 거절', () => {
    expect(explanationRejection(input, '이몽란과 유불란은 범인을 아는 사이예요.')).toBe(
      'culprit_word'
    );
  });

  test('claim이면 attribution이 문장에 있어야 한다', () => {
    const claim: ExplainInput = { ...input, assertionStatus: 'claim', attribution: '나용귀' };
    expect(explanationRejection(claim, good)).toBe('missing_attribution');
    expect(validateExplanation(claim, '나용귀는 이몽란과 유불란이 연인이라고 말해요.')).toBe(true);
  });

  test('원래 문장에 없던 고유명사가 새로 생기면 거절', () => {
    expect(explanationRejection(input, '이몽란과 유불란은 박영민 몰래 만나요.', ['박영민'])).toBe(
      'new_proper_noun'
    );
  });
});

describe('buildExplainPrompt', () => {
  const prompt = buildExplainPrompt([input]);

  test('NFR-AI-004: 금지 사항과 key, 입력 항목이 들어간다', () => {
    expect(prompt).toContain('rel:1');
    expect(prompt).toContain('해요체');
    expect(prompt).toContain('quote에 없는 사실, 추측, 판정을 더하지 않는다');
    expect(prompt).toContain('범인이나 결말을 지목하거나 암시하지 않는다');
    expect(prompt).toContain('attribution');
    expect(prompt).toContain('원문, 본문, 페이지, 텍스트, 인용, 요약');
    expect(prompt).toContain('60자 이하');
    expect(prompt).toContain('110자 이하');
    expect(prompt).toContain(input.evidenceLine);
    expect(prompt).toContain('연인이다');
    expect(prompt).toContain('"assertion_status": "fact"');
  });
});

describe('explainRelationships', () => {
  const file: ApplyRowsFile = {
    book_id: 'bk-test',
    rows: [
      {
        id: 'id-ok',
        character_a_name: '이몽란',
        character_b_name: '유불란',
        label: '연인이다',
        semantics: { assertion_status: 'fact', evidence: { source_page: 21, quote: input.quote } },
      },
      {
        id: 'id-bad',
        character_a_name: '이몽란',
        character_b_name: '유불란',
        label: '연인이다',
        semantics: { assertion_status: 'fact', evidence: { source_page: 21, quote: input.quote } },
      },
      {
        id: 'id-none',
        character_a_name: '이몽란',
        character_b_name: '유불란',
        label: '연인이다',
        semantics: { assertion_status: 'fact', evidence: { source_page: 21, quote: '조용했다.' } },
      },
    ],
  };

  beforeEach(() => mockCall.mockReset());

  test('R9: 검증에 실패한 관계는 설명 null, 원문 한 줄은 남고 지어내서 채우지 않는다', async () => {
    mockCall.mockResolvedValueOnce(
      JSON.stringify({
        items: [
          { key: 'id-ok', explanation: '이몽란과 유불란은 서로를 첫사랑으로 떠올리는 사이예요.' },
          { key: 'id-bad', explanation: '이몽란과 유불란은 연인이다.' },
        ],
      })
    );
    const rows = await explainRelationships(file.rows, new Map());
    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(mockCall.mock.calls[0][0]).toBe('explain_relation');
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get('id-ok')).toMatchObject({
      reader_evidence: input.quote,
      reader_explanation: '이몽란과 유불란은 서로를 첫사랑으로 떠올리는 사이예요.',
      skipped_reason: null,
      source_quote_sha256: quoteSha256(input.quote),
    });
    expect(byId.get('id-bad')).toMatchObject({
      reader_evidence: input.quote,
      reader_explanation: null,
      skipped_reason: 'not_easy_ending',
    });
    expect(byId.get('id-none')).toMatchObject({
      reader_evidence: null,
      reader_explanation: null,
      skipped_reason: 'no_evidence_line',
    });
    expect(mockCall.mock.calls[0][1]).not.toContain('id-none');
  });

  test('모델이 빠뜨린 관계는 llm_missing', async () => {
    mockCall.mockResolvedValueOnce(JSON.stringify({ items: [] }));
    const rows = await explainRelationships([file.rows[0]], new Map());
    expect(rows[0]).toMatchObject({ reader_explanation: null, skipped_reason: 'llm_missing' });
  });

  test('JSON이 깨지면 다시 묻는다', async () => {
    mockCall.mockResolvedValueOnce('not json').mockResolvedValueOnce(
      JSON.stringify({
        items: [
          { key: 'id-ok', explanation: '이몽란과 유불란은 서로를 첫사랑으로 떠올리는 사이예요.' },
        ],
      })
    );
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    const rows = await explainRelationships([file.rows[0]], new Map());
    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(rows[0].reader_explanation).not.toBeNull();
    warn.mockRestore();
  });
});

describe('buildExplainSql', () => {
  const sha = quoteSha256('원문');
  const row: ExplainResultRow = {
    id: '1fe35e8c-30a6-5943-a10b-1147103deae3',
    source_quote_sha256: sha,
    reader_evidence: "그는 '말했다'. $q0$ 위험",
    reader_explanation: '이몽란과 박영민은 부부예요.',
    skipped_reason: null,
  };

  test('R9: 한 트랜잭션, 추가 전용 병합, quote 일치 조건, 0건이면 전체 롤백', () => {
    const sql = buildExplainSql('bk-1', [row]);
    expect(sql.startsWith('BEGIN;')).toBe(true);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(sql).toContain('semantics = semantics || jsonb_build_object(');
    expect(sql).toContain("'reader_evidence'");
    expect(sql).toContain("'reader_explanation'");
    expect(sql).toContain(`'${sha}'`);
    expect(sql).toContain("semantics->'evidence'->>'quote'");
    expect(sql).toContain('book_id = $q0$bk-1$q0$');
    expect(sql).toContain('GET DIAGNOSTICS affected = ROW_COUNT');
    expect(sql).toContain('IF affected <> 1 THEN');
    expect(sql).toContain('RAISE EXCEPTION');
  });

  test('달러 인용은 내용에 든 태그와 겹치지 않는다', () => {
    expect(dollarQuote('abc')).toBe('$q0$abc$q0$');
    expect(dollarQuote('a $q0$ b')).toBe('$q1$a $q0$ b$q1$');
    const sql = buildExplainSql('bk-1', [row]);
    expect(sql).toContain("$q1$그는 '말했다'. $q0$ 위험$q1$::text");
  });

  test('설명이 없으면 reader_evidence만 쓰고, 원문 한 줄이 없으면 건너뛴다', () => {
    const only = buildExplainSql('bk-1', [{ ...row, reader_explanation: null }]);
    expect(only).not.toContain("'reader_explanation'");
    const none = buildExplainSql('bk-1', [{ ...row, reader_evidence: null }]);
    expect(none).not.toContain('UPDATE');
  });

  test('해시 형식이 틀리면 만들지 않는다', () => {
    expect(() => buildExplainSql('bk-1', [{ ...row, source_quote_sha256: "x'; DROP" }])).toThrow();
  });
});

describe('parseExplainArgs', () => {
  test('생성 모드와 SQL 모드', () => {
    expect(
      parseExplainArgs(['--book', 'b', '--rows', 'r.json', '--out', 'o.json', '--characters', 'c'])
    ).toEqual({ book: 'b', rows: 'r.json', out: 'o.json', characters: 'c' });
    expect(parseExplainArgs(['--book', 'b', '--sql', 'o.sql', '--from', 'o.json'])).toEqual({
      book: 'b',
      sql: 'o.sql',
      from: 'o.json',
    });
  });

  test('필수 인자가 없으면 거절', () => {
    expect(() => parseExplainArgs(['--rows', 'r'])).toThrow();
    expect(() => parseExplainArgs(['--book', 'b', '--rows', 'r'])).toThrow();
    expect(() => parseExplainArgs(['--book', 'b', '--sql', 's'])).toThrow();
  });
});

describe('관계 이름으로 원문 한 줄 고르기', () => {
  const rows = (
    JSON.parse(
      fs.readFileSync(path.join(validationDir, 'apply-rows.json'), 'utf-8')
    ) as ApplyRowsFile
  ).rows;
  const aliases = aliasMapFromCharacters(
    JSON.parse(fs.readFileSync(path.join(validationDir, 'characters.json'), 'utf-8'))
  );
  const groupsOf = (row: (typeof rows)[number]) =>
    [row.character_a_name, row.character_b_name].map((name) => [
      name,
      ...(aliases.get(name) ?? []),
    ]);

  it('관계 이름 낱말이 든 문장을 먼저 고른다 (사랑한다 -> "사랑"이 든 문장)', () => {
    const row = rows.find((r) => r.label === '사랑한다' && r.semantics.evidence.source_page === 6)!;
    const line = pickEvidenceLine(
      row.semantics.evidence.quote,
      groupsOf(row),
      relationKeywords(row.label)
    );
    expect(line).toContain('사랑');
    expect(row.semantics.evidence.quote).toContain(line!);
  });

  it('별칭만 든 문장보다 인물 대표 이름이 든 문장을 먼저 고른다 (이몽란-유불란 사랑한다 p.6)', () => {
    const row = rows.find(
      (r) =>
        r.character_b_name === '유불란' &&
        r.label === '사랑한다' &&
        r.semantics.evidence.source_page === 6
    )!;
    const line = pickEvidenceLine(
      row.semantics.evidence.quote,
      groupsOf(row),
      relationKeywords(row.label)
    );
    expect(line).toContain('유불란');
  });

  it('고른 줄은 끝에 홀로 남은 닫는 따옴표·점선, 앞에 걸린 "하고"가 없다', () => {
    for (const row of rows) {
      const line = pickEvidenceLine(
        row.semantics.evidence.quote,
        groupsOf(row),
        relationKeywords(row.label)
      )!;
      expect(line).not.toMatch(/^(하고|라고|이라고|며)[  ]/);
      expect(line).not.toMatch(/[.]{3,}[ ]*$/);
      if (/[”’」』]$/.test(line)) expect(line).toMatch(/[“‘「『]/);
    }
  });

  it('실제 14건 모두 원문 부분 문자열인 한 줄을 고른다', () => {
    for (const row of rows) {
      const line = pickEvidenceLine(
        row.semantics.evidence.quote,
        groupsOf(row),
        relationKeywords(row.label)
      );
      expect(line).not.toBeNull();
      expect(row.semantics.evidence.quote).toContain(line!);
    }
  });
});

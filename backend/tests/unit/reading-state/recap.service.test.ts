/**
 * S5 게이트 테스트 — 리캡 재사용 판정·LLM 호출 0/1회·로그 (recap.service)
 *
 * 근거: dev-spec-R2-core.md 4.5절 자가 검증 표 12~15번, 20~21번
 *
 * 테스트 규약 3.2절에 따라 구현 전에 작성했다. 조항 문구를 테스트 이름에 그대로 넣는다.
 */

import { createRecapService } from '../../../src/modules/reading-state/recap.service';
import {
  FakeRecapCallLogger,
  FakeSavedRecapRepository,
  FakeSessionRecapCacheRepository,
  SEED_BOOK_ID,
  SEED_DEVICE_ID,
  makeSeededFakes,
} from './fakes';

/** 호출 여부를 세는 페이크 LLM 스트리머 — "정" "주사" "는" 세 청크를 낸다. usage는 안 준다(estimate 경로 검증용). */
function makeFakeLlm() {
  let callCount = 0;
  const llmStream = async function* (_task: string, _prompt: string) {
    callCount++;
    yield '정';
    yield '주사';
    yield '는';
  };
  return { llmStream, callCount: () => callCount };
}

/** gateway.ts(커밋 410f558)처럼 스트림 종료 시 실제 usage를 반환하는 페이크. */
function makeFakeLlmWithUsage(usage: { inputTokens: number; outputTokens: number }) {
  const llmStream = async function* (_task: string, _prompt: string) {
    yield '정';
    yield '주사';
    return usage;
  };
  return { llmStream };
}

/** 실제로 게이트웨이에 어떤 프롬프트가 전달되는지 검사하기 위한 페이크. */
function makeFakeLlmCapturingPrompt() {
  const prompts: string[] = [];
  const llmStream = async function* (_task: string, prompt: string) {
    prompts.push(prompt);
    yield '정주사는';
  };
  return { llmStream, prompts };
}

/**
 * 모델이 분량 지시를 무시하고 500자를 훌쩍 넘겨 계속 생성하는 상황을 재현하는 페이크.
 * 문장 부호로 끝나는 40자짜리 문장을 반복해서 낸다 — 경계 탐색이 마침표에서 멈추는지,
 * 상한에 걸린 뒤 남은 청크를 더 이상 끌어오지 않는지(조기 취소) 둘 다 검증하기 위함.
 */
function makeFakeLlmOverLength() {
  let yielded = 0;
  const sentence = '이것은 분량 제한을 초과하도록 일부러 길게 만든 테스트용 문장입니다.'; // 40자
  const llmStream = async function* (_task: string, _prompt: string) {
    for (let i = 0; i < 20; i++) {
      yielded++;
      yield sentence; // 20 * 40 = 800자 — 조기 취소가 없으면 800자를 넘긴다
    }
  };
  return { llmStream, chunksYielded: () => yielded, sentence };
}

/**
 * 프로덕션 재현 — 실제 gateway.ts의 `for await (const event of response.body)`는
 * `.return()`으로 강제 취소되면(하드 상한 조기 종료 시도) AWS SDK 스트림 쪽에서 에러를
 * 던지는 경우가 있고, 그게 그대로 gateway.ts의 try/catch에 잡혀
 * "LLM stream failed" 에러로 재던져진다 — 배포 후 실제 500으로 재현됨.
 * 이 페이크는 `.return()` 호출 시 던지는 async generator로 그 상황을 흉내낸다.
 */
function makeFakeLlmThrowsOnCancel() {
  const sentence = '이것은 취소 시 예외를 던지는 게이트웨이를 흉내내는 테스트용 문장입니다.'; // 40자
  const llmStream = async function* (_task: string, _prompt: string) {
    try {
      for (let i = 0; i < 20; i++) {
        yield sentence;
      }
    } finally {
      throw new Error('LLM stream failed for task "recap": stream aborted');
    }
  };
  return { llmStream, sentence };
}

function build() {
  const { books } = makeSeededFakes();
  const savedRecap = new FakeSavedRecapRepository();
  const sessionCache = new FakeSessionRecapCacheRepository();
  const recapLog = new FakeRecapCallLogger();
  const llm = makeFakeLlm();
  const service = createRecapService({
    content: books,
    books,
    savedRecap,
    sessionCache,
    recapLog,
    llmStream: llm.llmStream,
  });
  return { books, savedRecap, sessionCache, recapLog, llm, service };
}

async function drain(gen: AsyncGenerator<string>): Promise<string> {
  let out = '';
  for await (const chunk of gen) out += chunk;
  return out;
}

describe('리캡 재사용 판정 — getRecap', () => {
  test('❓Q1: K = 0 → 빈 상태 반환, LLM 호출 0회', async () => {
    const { service, llm } = build();

    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 0, 'realtime');

    expect(result.kind).toBe('empty');
    expect(llm.callCount()).toBe(0);
  });

  test('FR-DAT-009·NFR-PERF-003: 저장 리캡.기준점 == K → 그대로 반환, 호출 0회', async () => {
    const { service, savedRecap, llm } = build();
    savedRecap.set(SEED_DEVICE_ID, SEED_BOOK_ID, { cutoff_page: 15, recap_text: '저장된 리캡' });

    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 15, 'realtime');

    expect(result).toEqual({ kind: 'reused', text: '저장된 리캡' });
    expect(llm.callCount()).toBe(0);
  });

  test('R8: 저장 리캡.기준점 != K → 재사용하지 않는다 (새로 생성)', async () => {
    const { service, savedRecap, llm } = build();
    savedRecap.set(SEED_DEVICE_ID, SEED_BOOK_ID, { cutoff_page: 5, recap_text: '옛 리캡' });

    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 15, 'realtime');

    expect(result.kind).toBe('generated');
    if (result.kind === 'generated') {
      await drain(result.chunks);
    }
    expect(llm.callCount()).toBe(1);
  });

  test('이슈 대응(분량 편차): 프롬프트가 자료 양과 무관한 분량 지시를 담는다', async () => {
    const { books, savedRecap, sessionCache, recapLog } = build();
    const captured = makeFakeLlmCapturingPrompt();
    const service = createRecapService({
      content: books,
      books,
      savedRecap,
      sessionCache,
      recapLog,
      llmStream: captured.llmStream,
    });

    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 15, 'realtime');
    if (result.kind === 'generated') await drain(result.chunks);

    expect(captured.prompts).toHaveLength(1);
    expect(captured.prompts[0]).toMatch(/문장/);
    // NFR-AI-004 🚦 회귀 방지 — 분량 지시를 추가해도 "기준점 이후를 쓰지 마"류 상한
    // 지시는 절대 들어가면 안 된다. 상한은 조립 단계(입력 절단)에서만 강제한다.
    expect(captured.prompts[0]).not.toMatch(/기준점|cutoff|이후.*(쓰지|말)/i);
  });

  test('이슈 대응(800자+ 실측): 모델이 분량 지시를 어기면 코드가 500자에서 강제로 자른다', async () => {
    const { books, savedRecap, sessionCache, recapLog } = build();
    const { llmStream, chunksYielded, sentence } = makeFakeLlmOverLength();
    const service = createRecapService({
      content: books,
      books,
      savedRecap,
      sessionCache,
      recapLog,
      llmStream,
    });

    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 15, 'realtime');
    expect(result.kind).toBe('generated');
    const text = result.kind === 'generated' ? await drain(result.chunks) : '';

    // negative — 캡이 없다면 800자(20 * 40자)가 그대로 나왔을 것
    expect(text.length).toBeLessThanOrEqual(500);
    // positive — 잘리긴 하되 문장 경계(마침표)에서 끊겨야 한다(중간에 뚝 끊기지 않음)
    expect(text.endsWith('.')).toBe(true);
    const maxWholeSentences = Math.floor(500 / sentence.length);
    expect(text).toBe(sentence.repeat(maxWholeSentences));
    // 상한을 넘는 순간 남은 생성을 더 받지 않는다 — 20개 청크를 다 소비하지 않는다
    expect(chunksYielded()).toBeLessThan(20);

    // 저장·캐시·로그 전부 잘린 텍스트를 써야 한다 — 스트림으로 이미 나간 것과 일치해야 함
    const cached = await sessionCache.findCached(SEED_DEVICE_ID, SEED_BOOK_ID, 15);
    expect(cached).toBe(text);
    expect(recapLog.records[0].output_ref).toBe(text);
  });

  test('프로덕션 재현: 하드 상한 도달 시 취소(gen.return())가 실패해도 500으로 안 죽고 잘린 텍스트로 정상 완료된다', async () => {
    const { books, savedRecap, sessionCache, recapLog } = build();
    const { llmStream, sentence } = makeFakeLlmThrowsOnCancel();
    const service = createRecapService({
      content: books,
      books,
      savedRecap,
      sessionCache,
      recapLog,
      llmStream,
    });

    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 15, 'realtime');
    expect(result.kind).toBe('generated');
    // negative — 캡이 없다면(또는 취소 실패가 그대로 전파되면) 여기서 reject돼야 정상인데,
    // 취소 실패를 삼키므로 정상적으로 끝까지 드레인된다
    const text = result.kind === 'generated' ? await drain(result.chunks) : '';

    expect(text.length).toBeLessThanOrEqual(500);
    expect(text.endsWith('.')).toBe(true);
    const maxWholeSentences = Math.floor(500 / sentence.length);
    expect(text).toBe(sentence.repeat(maxWholeSentences));
    // 취소 실패에도 불구하고 저장·로그까지 정상 완료돼야 한다
    expect(recapLog.records).toHaveLength(1);
    const cached = await sessionCache.findCached(SEED_DEVICE_ID, SEED_BOOK_ID, 15);
    expect(cached).toBe(text);
  });

  test('UC-09 A7: 세션 캐시(K) 적중 → 그대로 반환, 호출 0회', async () => {
    const { service, sessionCache, llm } = build();
    await sessionCache.saveCached(SEED_DEVICE_ID, SEED_BOOK_ID, 15, '캐시된 리캡', new Date());

    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 15, 'realtime');

    expect(result).toEqual({ kind: 'reused', text: '캐시된 리캡' });
    expect(llm.callCount()).toBe(0);
  });

  test('재사용 미스 → LLM 1회 호출, 스트리밍 청크가 이어붙으면 원문과 같다', async () => {
    const { service, llm } = build();

    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 15, 'realtime');

    expect(result.kind).toBe('generated');
    if (result.kind === 'generated') {
      const text = await drain(result.chunks);
      expect(text).toBe('정주사는');
    }
    expect(llm.callCount()).toBe(1);
  });

  test('실시간 생성분은 세션 캐시(K)에 적재된다 (영구 저장 없음, FR-DAT-010)', async () => {
    const { service, sessionCache } = build();

    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 15, 'realtime');
    if (result.kind === 'generated') await drain(result.chunks);

    const cached = await sessionCache.findCached(SEED_DEVICE_ID, SEED_BOOK_ID, 15);
    expect(cached).toBe('정주사는');
  });

  test('R7: 세션 종료(session_end) 트리거는 재사용 판정 없이 항상 생성하고 저장 리캡에 적재한다', async () => {
    const { service, savedRecap, llm } = build();
    savedRecap.set(SEED_DEVICE_ID, SEED_BOOK_ID, { cutoff_page: 15, recap_text: '이미 있음' });

    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 15, 'session_end');
    expect(result.kind).toBe('generated');
    if (result.kind === 'generated') await drain(result.chunks);

    expect(llm.callCount()).toBe(1); // 재사용 판정을 타지 않고 그대로 생성
    const saved = await savedRecap.findSavedRecap(SEED_DEVICE_ID, SEED_BOOK_ID);
    expect(saved).toEqual({ cutoff_page: 15, recap_text: '정주사는' });
  });
});

describe('리캡 호출 로그 — NFR-OBS-002 🚦', () => {
  test('리캡 호출 1회 → 로그 레코드 정확히 1건', async () => {
    const { service, recapLog } = build();

    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 15, 'realtime');
    if (result.kind === 'generated') await drain(result.chunks);

    expect(recapLog.records).toHaveLength(1);
  });

  test('재사용 경로(K=0·저장분 일치·세션 캐시)는 호출이 아니므로 로그를 남기지 않는다', async () => {
    const { service, savedRecap, sessionCache, recapLog } = build();

    await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 0, 'realtime');

    savedRecap.set(SEED_DEVICE_ID, SEED_BOOK_ID, { cutoff_page: 15, recap_text: '저장' });
    await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 15, 'realtime');

    await sessionCache.saveCached(SEED_DEVICE_ID, SEED_BOOK_ID, 20, '캐시', new Date());
    await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 20, 'realtime');

    expect(recapLog.records).toHaveLength(0);
  });

  test('로그에 K·투입 요약 ID 목록·절단 페이지·트리거가 전부 들어 있다', async () => {
    const { service, recapLog } = build();

    // K=15 → 2장 중간, 완결 장은 1장뿐(요약 ID = ["1"]), 원문 절단은 K(15) 자체
    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 15, 'realtime');
    if (result.kind === 'generated') await drain(result.chunks);

    expect(recapLog.records).toHaveLength(1);
    const [entry] = recapLog.records;
    expect(entry.device_id).toBe(SEED_DEVICE_ID);
    expect(entry.book_id).toBe(SEED_BOOK_ID);
    expect(entry.cutoff_page).toBe(15);
    expect(entry.input_chapter_summary_ids).toEqual(['1']);
    expect(entry.current_chapter_cutoff).toBe(15);
    expect(entry.trigger).toBe('realtime');
    expect(typeof entry.output_ref).toBe('string');
    expect(entry.output_ref.length).toBeGreaterThan(0);
    // model은 태스크명 placeholder가 아니라 model-config.ts가 매핑한 실제 모델 ID다.
    // 2026-08-25부터 리캡도 단일 기본 모델을 쓴다 — 난이도 분기 폐지와 함께 챗봇·리캡·
    // All tasks use the selected provider's configured model (NFR-AI-001).
    expect(entry.model).toBe(process.env.OPENAI_MODEL);
    expect(entry.model).not.toBe('recap');
  });

  test('NFR-OBS-004: llmStream이 실사용량을 반환하면 추정치 대신 그 값을 로그에 쓴다', async () => {
    const { books } = makeSeededFakes();
    const savedRecap = new FakeSavedRecapRepository();
    const sessionCache = new FakeSessionRecapCacheRepository();
    const recapLog = new FakeRecapCallLogger();
    const { llmStream } = makeFakeLlmWithUsage({ inputTokens: 1234, outputTokens: 56 });
    const service = createRecapService({
      content: books,
      books,
      savedRecap,
      sessionCache,
      recapLog,
      llmStream,
    });

    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 15, 'realtime');
    if (result.kind === 'generated') await drain(result.chunks);

    const [entry] = recapLog.records;
    expect(entry.tokens).toEqual({ input: 1234, output: 56 });
  });

  test('llmStream이 usage를 반환하지 않으면(테스트 페이크 등) 문자 수 추정치로 대체한다', async () => {
    const { service, recapLog } = build();

    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 15, 'realtime');
    if (result.kind === 'generated') await drain(result.chunks);

    const [entry] = recapLog.records;
    expect(entry.tokens.input).toBeGreaterThan(0);
    expect(entry.tokens.output).toBeGreaterThan(0);
    expect(entry.tokens).not.toEqual({ input: 1234, output: 56 }); // 추정치는 실사용량과 우연히 같을 수 없는 값
  });

  test('K가 장 종료 페이지와 일치(원문 미투입)하면 로그의 절단 페이지가 null', async () => {
    const { service, recapLog } = build();

    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 10, 'realtime');
    if (result.kind === 'generated') await drain(result.chunks);

    const [entry] = recapLog.records;
    expect(entry.current_chapter_cutoff).toBeNull();
  });
});

/**
 * 2026-11-17 C안(대표 승인) — 리캡 분량 제어
 *
 * 목표 문장 수 N을 코드가 계산해 프롬프트에 "정확히 N문장"으로 넣는다. "자료가 적으면 짧게"
 * 같은 판단 위임 문구는 뺀다. 환각 금지(FR-RCP-001 🚦)는 유지하고, 상한 지시는 여전히
 * 프롬프트에 없다(NFR-AI-004 🚦 — 상한은 입력 조립에서만).
 *
 * 시드: 장 3개(1~10 / 11~20 / 21~30).
 */
function buildCapturing(llmText = '정주사는') {
  const { books } = makeSeededFakes();
  const savedRecap = new FakeSavedRecapRepository();
  const sessionCache = new FakeSessionRecapCacheRepository();
  const recapLog = new FakeRecapCallLogger();
  const prompts: string[] = [];
  const llmStream = async function* (_task: string, prompt: string) {
    prompts.push(prompt);
    yield llmText;
  };
  const service = createRecapService({
    content: books,
    books,
    savedRecap,
    sessionCache,
    recapLog,
    llmStream,
  });
  return { service, prompts, recapLog };
}

async function promptAt(cutoff: number): Promise<string> {
  const { service, prompts } = buildCapturing();
  const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, cutoff, 'realtime');
  if (result.kind === 'generated') await drain(result.chunks);
  expect(prompts).toHaveLength(1);
  return prompts[0];
}

describe('리캡 분량 제어 C안 — 프롬프트의 목표 문장 수', () => {
  test.each([
    // [K, 기대 N, 설명]
    [5, 2, '완결 0장 + 1장 원문 → 하한 2'],
    [15, 2, '완결 1장 + 2장 원문 → 2'],
    [25, 3, '완결 2장 + 3장 원문 → 3'],
    [10, 2, '장 끝(원문 없음), 완결 1장 → 하한 2'],
    [20, 2, '장 끝(원문 없음), 완결 2장 → 2'],
    [30, 3, '장 끝(원문 없음), 완결 3장 → 3'],
  ])('K=%i → 프롬프트에 "정확히 %i문장" (%s)', async (cutoff, n) => {
    const prompt = await promptAt(cutoff);
    expect(prompt).toContain(`정확히 ${n}문장`);
    // 다른 N 값이 섞여 있지 않다
    for (const other of [2, 3, 4, 5].filter((x) => x !== n)) {
      expect(prompt).not.toContain(`정확히 ${other}문장`);
    }
  });

  test('각 문장 90자 이내 지시가 들어 있다', async () => {
    const prompt = await promptAt(15);
    expect(prompt).toMatch(/각 문장은 90자 이내/);
  });

  test('판단 위임 문구("자료가 적으면 … 짧게 말해라")는 삭제됐다', async () => {
    for (const cutoff of [5, 15, 25, 30]) {
      const prompt = await promptAt(cutoff);
      expect(prompt).not.toMatch(/짧게 말해라/);
      expect(prompt).not.toMatch(/자료가 적으면/);
    }
  });

  test('FR-RCP-001 🚦: "자료에 없는 내용을 지어내지 마라" 지시는 유지된다', async () => {
    for (const cutoff of [5, 15, 25, 30]) {
      const prompt = await promptAt(cutoff);
      expect(prompt).toMatch(/자료에 없는 내용을 지어내지 마라/);
    }
  });

  test('기존 형식 지시(소제목 고정·마크다운 금지·자료만으로 요약) 유지', async () => {
    const prompt = await promptAt(25);
    expect(prompt).toContain('"이전 이야기 요약"');
    expect(prompt).toMatch(/마크다운 기호를 쓰지 말고/);
    expect(prompt).toMatch(/아래 자료만으로/);
  });

  test('문단 수 지시 — N이 2~3이면 1~2문단', async () => {
    for (const cutoff of [15, 25]) {
      const prompt = await promptAt(cutoff); // N=2, N=3
      expect(prompt).toMatch(/1~2개의 짧은 문단/);
      expect(prompt).not.toMatch(/2~3개의 짧은 문단/);
    }
  });

  test('NFR-AI-004 🚦: 분량 지시를 바꿔도 프롬프트에 상한 지시가 없다', async () => {
    for (const cutoff of [5, 15, 25, 30]) {
      const prompt = await promptAt(cutoff);
      expect(prompt).not.toMatch(/기준점|cutoff|이후.*(쓰지|말)/i);
    }
  });
});

describe('리캡 분량 제어 C안 — 장이 많은 책(N=4·5)의 문단 지시', () => {
  /** 장 8개(각 5쪽, 1~40쪽) 책 — N 상한(5)과 N=4 경계를 서비스 경유로 확인한다 */
  function buildLongBook() {
    const { books } = makeSeededFakes();
    const chapters = Array.from({ length: 8 }, (_, i) => ({
      chapter_no: i + 1,
      title: `제${i + 1}장`,
      start_page: i * 5 + 1,
      end_page: i * 5 + 5,
      summary: `${i + 1}장 요약`,
    }));
    const pageTexts: Record<number, string> = {};
    for (let p = 1; p <= 40; p++) pageTexts[p] = `p.${p} 원문`;
    books.set('long-book', { total_pages: 40, chapters, pageTexts });
    const prompts: string[] = [];
    const service = createRecapService({
      content: books,
      books,
      savedRecap: new FakeSavedRecapRepository(),
      sessionCache: new FakeSessionRecapCacheRepository(),
      recapLog: new FakeRecapCallLogger(),
      llmStream: async function* (_task: string, prompt: string) {
        prompts.push(prompt);
        yield '정주사는';
      },
    });
    return { service, prompts };
  }

  test.each([
    [17, 4], // 완결 3장 + 4장 원문 → 4
    [40, 5], // 완결 8장, 원문 없음 → 상한 5
    [38, 5], // 완결 7장 + 8장 원문 → 상한 5
  ])('K=%i → 정확히 %i문장, 2~3문단 지시', async (cutoff, n) => {
    const { service, prompts } = buildLongBook();
    const result = await service.getRecap(SEED_DEVICE_ID, 'long-book', cutoff, 'realtime');
    if (result.kind === 'generated') await drain(result.chunks);
    expect(prompts[0]).toContain(`정확히 ${n}문장`);
    expect(prompts[0]).toMatch(/2~3개의 짧은 문단/);
  });
});

describe('FR-SPL-003 🚦 회귀 — 분량 지시를 바꿔도 프롬프트에 K 이후 자료 0건', () => {
  /** 프롬프트에 들어간 원문 페이지 번호 목록 */
  function pagesIn(prompt: string): number[] {
    return Array.from(prompt.matchAll(/p\.(\d+) 원문/g)).map((m) => Number(m[1]));
  }

  test('negative: K=15 → 16쪽 이후 원문 0건, 2장·3장 요약 0건', async () => {
    const prompt = await promptAt(15);
    expect(pagesIn(prompt).filter((p) => p > 15)).toHaveLength(0);
    expect(prompt).not.toContain('2장 요약');
    expect(prompt).not.toContain('3장 요약');
  });

  test('positive: K=25 → 2장 요약과 21~25쪽 원문은 들어간다 (26쪽 이후 0건)', async () => {
    const prompt = await promptAt(25);
    expect(prompt).toContain('1장 요약');
    expect(prompt).toContain('2장 요약');
    expect(pagesIn(prompt)).toEqual([21, 22, 23, 24, 25]);
    expect(prompt).not.toContain('3장 요약');
  });
});

describe('리캡 호출 로그 — 목표 문장 수·실제 길이 (NFR-OBS-002 🚦)', () => {
  const OUTPUT = '이전 이야기 요약\n\n첫 문장이다. 둘째 문장이다.\n\n셋째 문장이다.';

  test.each([
    [15, 2],
    [25, 3],
    [30, 3],
  ])('K=%i → 로그 target_sentences = %i', async (cutoff, n) => {
    const { service, recapLog } = buildCapturing(OUTPUT);
    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, cutoff, 'realtime');
    if (result.kind === 'generated') await drain(result.chunks);

    expect(recapLog.records).toHaveLength(1);
    expect(recapLog.records[0].target_sentences).toBe(n);
  });

  test('로그에 실제 출력 문자 수(공백·소제목 포함)와 문장 수(소제목 제외)가 남는다', async () => {
    const { service, recapLog } = buildCapturing(OUTPUT);
    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 25, 'session_end');
    if (result.kind === 'generated') await drain(result.chunks);

    expect(recapLog.records).toHaveLength(1);
    const [entry] = recapLog.records;
    expect(entry.output_ref).toBe(OUTPUT);
    expect(entry.output_chars).toBe(OUTPUT.length);
    expect(entry.output_sentences).toBe(3);
  });

  test('하드 상한(500자)으로 잘린 경우 로그 길이는 잘린 뒤 텍스트 기준이다', async () => {
    const { books } = makeSeededFakes();
    const recapLog = new FakeRecapCallLogger();
    const { llmStream, sentence } = makeFakeLlmOverLength();
    const service = createRecapService({
      content: books,
      books,
      savedRecap: new FakeSavedRecapRepository(),
      sessionCache: new FakeSessionRecapCacheRepository(),
      recapLog,
      llmStream,
    });

    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 15, 'realtime');
    const text = result.kind === 'generated' ? await drain(result.chunks) : '';

    const [entry] = recapLog.records;
    expect(entry.output_chars).toBe(text.length);
    expect(entry.output_chars).toBeLessThanOrEqual(500);
    expect(entry.output_sentences).toBe(Math.floor(500 / sentence.length));
  });
});

describe('리캡 고유명사 검사 — 사전은 K 이하만, 결과는 로그에만 (FR-RCP-001 · FR-SPL-002 🚦)', () => {
  const BOOK = 'names-book';
  const CLEAN = '이전 이야기 요약\n\n유불란은 박영민을 만났다.';
  const WITH_UNKNOWN = '이전 이야기 요약\n\n유불란은 박영민을 만났다. 그때 장준호가 나타났다.';

  /** 150쪽 · 장 3개(1~50, 51~100, 101~150). 장준호는 41쪽에 처음 나온다 */
  function buildNames(output: string) {
    const { books } = makeSeededFakes();
    const pageTexts: Record<number, string> = {};
    for (let p = 1; p <= 150; p++) pageTexts[p] = `p.${p} 유불란은 박영민을 만났다.`;
    books.set(BOOK, {
      total_pages: 150,
      chapters: [
        { chapter_no: 1, title: '1장', start_page: 1, end_page: 50, summary: '1장 요약' },
        { chapter_no: 2, title: '2장', start_page: 51, end_page: 100, summary: '2장 요약' },
        { chapter_no: 3, title: '3장', start_page: 101, end_page: 150, summary: '3장 요약' },
      ],
      pageTexts,
      names: [
        { label: '유불란', first_appearance_page: 1 },
        { label: '박영민', first_appearance_page: 3 },
        { label: '장준호', first_appearance_page: 41 },
      ],
    });
    const recapLog = new FakeRecapCallLogger();
    const sessionCache = new FakeSessionRecapCacheRepository();
    const service = createRecapService({
      content: books,
      books,
      savedRecap: new FakeSavedRecapRepository(),
      sessionCache,
      recapLog,
      llmStream: async function* (_task: string, _prompt: string) {
        yield output;
      },
    });
    return { books, recapLog, sessionCache, service };
  }

  async function run(output: string, cutoff: number) {
    const ctx = buildNames(output);
    const result = await ctx.service.getRecap(SEED_DEVICE_ID, BOOK, cutoff, 'realtime');
    const text = result.kind === 'generated' ? await drain(result.chunks) : '';
    return { ...ctx, text };
  }

  test('FR-SPL-002 🚦: K=40 → 사전 조회는 cutoff 40으로 1회, 41쪽에 처음 나오는 이름은 사전에 0건', async () => {
    const { books, recapLog } = await run(WITH_UNKNOWN, 40);

    expect(books.nameLookupCutoffs).toEqual([40]);
    expect(await books.findIntroducedNames(BOOK, 40)).not.toContain('장준호');
    // 사전에 없으므로 리캡의 "장준호"는 모르는 이름으로 잡힌다
    expect(recapLog.records[0].unknown_names).toEqual(['장준호']);
  });

  test('FR-SPL-002 🚦: positive — K=130 → 사전 조회는 cutoff 130, 같은 이름이 사전에 있어 0건', async () => {
    const { books, recapLog } = await run(WITH_UNKNOWN, 130);

    expect(books.nameLookupCutoffs).toEqual([130]);
    expect(await books.findIntroducedNames(BOOK, 130)).toContain('장준호');
    expect(recapLog.records[0].unknown_name_count).toBe(0);
    expect(recapLog.records[0].unknown_names).toEqual([]);
  });

  test('FR-RCP-001: 사전 밖 이름이 든 리캡 → 로그 unknown_name_count >= 1', async () => {
    const { recapLog } = await run(WITH_UNKNOWN, 40);

    expect(recapLog.records).toHaveLength(1);
    expect(recapLog.records[0].unknown_name_count).toBeGreaterThanOrEqual(1);
  });

  test('FR-RCP-001: positive — 깨끗한 리캡 → 로그 unknown_name_count = 0', async () => {
    const { recapLog } = await run(CLEAN, 40);

    expect(recapLog.records).toHaveLength(1);
    expect(recapLog.records[0].unknown_name_count).toBe(0);
    expect(recapLog.records[0].unknown_names).toEqual([]);
  });

  test('걸려도 리캡은 막거나 고치지 않는다 — 스트림·캐시·로그 출력이 모델 출력 그대로다', async () => {
    const { text, recapLog, sessionCache } = await run(WITH_UNKNOWN, 40);

    expect(text).toBe(WITH_UNKNOWN);
    expect(await sessionCache.findCached(SEED_DEVICE_ID, BOOK, 40)).toBe(WITH_UNKNOWN);
    expect(recapLog.records[0].output_ref).toBe(WITH_UNKNOWN);
  });

  test('R9: 고유명사 검사는 LLM을 더 부르지 않는다 — 호출 1회', async () => {
    const { books } = makeSeededFakes();
    const llm = makeFakeLlm();
    const service = createRecapService({
      content: books,
      books,
      savedRecap: new FakeSavedRecapRepository(),
      sessionCache: new FakeSessionRecapCacheRepository(),
      recapLog: new FakeRecapCallLogger(),
      llmStream: llm.llmStream,
    });
    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 15, 'realtime');
    if (result.kind === 'generated') await drain(result.chunks);

    expect(llm.callCount()).toBe(1);
  });

  test('사전 조회가 실패해도 리캡은 끝까지 나가고, 로그는 측정값 NULL로 1건 남는다', async () => {
    const ctx = buildNames(WITH_UNKNOWN);
    ctx.books.failNameLookup = true;
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await ctx.service.getRecap(SEED_DEVICE_ID, BOOK, 40, 'realtime');
    const text = result.kind === 'generated' ? await drain(result.chunks) : '';

    expect(text).toBe(WITH_UNKNOWN);
    expect(await ctx.sessionCache.findCached(SEED_DEVICE_ID, BOOK, 40)).toBe(WITH_UNKNOWN);
    expect(ctx.recapLog.records).toHaveLength(1);
    expect(ctx.recapLog.records[0].unknown_name_count).toBeNull();
    expect(ctx.recapLog.records[0].unknown_names).toBeNull();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  test('로그 적재가 실패해도 리캡 스트림은 오류 없이 끝나고 캐시에 남는다', async () => {
    const { books } = makeSeededFakes();
    const sessionCache = new FakeSessionRecapCacheRepository();
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const service = createRecapService({
      content: books,
      books,
      savedRecap: new FakeSavedRecapRepository(),
      sessionCache,
      recapLog: {
        record: async () => {
          throw new Error('column "unknown_name_count" does not exist');
        },
      },
      llmStream: async function* (_task: string, _prompt: string) {
        yield CLEAN;
      },
    });

    const result = await service.getRecap(SEED_DEVICE_ID, SEED_BOOK_ID, 15, 'realtime');
    const text = result.kind === 'generated' ? await drain(result.chunks) : '';

    expect(text).toBe(CLEAN);
    expect(await sessionCache.findCached(SEED_DEVICE_ID, SEED_BOOK_ID, 15)).toBe(CLEAN);
    // 조용히 삼키지 않는다 — 로그 유실은 서버 오류 로그에 남긴다
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

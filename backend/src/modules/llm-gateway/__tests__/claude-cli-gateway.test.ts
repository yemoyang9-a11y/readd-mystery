/**
 * 게이트웨이 경로 — 관계 추출 작업은 Claude 구독(CLI)으로만, 다른 작업은 기존 API 제공자로.
 * 절대 규칙 4(게이트웨이 경유)·호출 로그 유지. CLI는 가짜 실행 파일(CLAUDE_CLI_BIN)로 바꿔 끼운다 — 실제 호출 없음.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    responses: {
      create: jest.fn().mockResolvedValue({
        id: 'r',
        model: 'test-openai',
        status: 'completed',
        output_text: 'api answer',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      stream: jest.fn(),
    },
  })),
}));
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {
    throw new Error('Unselected provider must not initialize');
  }),
}));
jest.mock('dotenv', () => ({
  __esModule: true,
  default: { config: jest.fn() },
  config: jest.fn(),
}));

type Gateway = typeof import('../gateway');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
const fakeBin = path.join(dir, 'claude');
const record = path.join(dir, 'calls.jsonl');
// 가짜 CLI — 받은 인자·stdin·키 환경 변수 유무를 기록하고, 받은 프롬프트 길이를 담은 JSON 결과 봉투를 낸다
fs.writeFileSync(
  fakeBin,
  `#!/usr/bin/env node
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  require('fs').appendFileSync(${JSON.stringify(record)}, JSON.stringify({
    args: process.argv.slice(2),
    input,
    cwd: process.cwd(),
    anthropicKey: process.env.ANTHROPIC_API_KEY !== undefined,
    openaiKey: process.env.OPENAI_API_KEY !== undefined,
  }) + '\\n');
  process.stdout.write(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false,
    result: JSON.stringify({ relations: [], prompt_chars: input.length }),
    usage: { input_tokens: 7, output_tokens: 3 },
    modelUsage: { 'claude-fake-model': {} },
  }));
});
`,
  { mode: 0o755 }
);

function loadGateway(env: Record<string, string | undefined>): Gateway & { OpenAI: jest.Mock } {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  let gateway!: Gateway;
  let OpenAI!: jest.Mock;
  jest.isolateModules(() => {
    gateway = require('../gateway') as Gateway;
    OpenAI = require('openai').default as jest.Mock;
  });
  process.env = saved;
  return { ...gateway, OpenAI };
}

const calls = () =>
  fs.existsSync(record)
    ? fs
        .readFileSync(record, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
    : [];

let log: jest.SpyInstance;
beforeEach(() => {
  if (fs.existsSync(record)) fs.rmSync(record);
  log = jest.spyOn(console, 'log').mockImplementation();
});
afterEach(() => jest.restoreAllMocks());

describe('2026-11-18: 관계 추출은 Claude 구독(CLI)으로만 — OpenAI API 호출 0건', () => {
  test('generate_relationship은 CLI로 가고 OpenAI SDK를 부르지 않는다, 호출 로그가 남는다', async () => {
    const gateway = loadGateway({
      CLAUDE_CLI_BIN: fakeBin,
      CLAUDE_CLI_MODEL: 'opus',
      ANTHROPIC_API_KEY: 'sk-ant-must-not-reach-cli',
    });
    const OpenAI = gateway.OpenAI;
    const out = await gateway.call('generate_relationship', '근거 창 프롬프트', {
      system: '주석자',
    });
    expect(JSON.parse(out)).toEqual({ relations: [], prompt_chars: '근거 창 프롬프트'.length });
    const [c] = calls();
    expect(c.input).toBe('근거 창 프롬프트');
    expect(c.args).toEqual(
      expect.arrayContaining(['-p', '--output-format', 'json', '--model', 'opus'])
    );
    expect(c.args).toEqual(expect.arrayContaining(['--system-prompt', '주석자']));
    expect(c.anthropicKey).toBe(false);
    expect(c.openaiKey).toBe(false);
    expect(c.cwd).not.toBe(process.cwd());
    const created = OpenAI.mock.results.at(-1)!.value.responses.create as jest.Mock;
    expect(created).not.toHaveBeenCalled();
    const metric = log.mock.calls.find(([tag]) => tag === '[LLM Metrics]');
    expect(JSON.parse(metric![1])).toMatchObject({
      task: 'generate_relationship',
      provider: 'claude-cli',
      modelId: 'claude-fake-model',
      outputTokens: 3,
      attempts: 1,
    });
  });

  test('positive 쌍 — 다른 작업(chatbot)은 기존 API 제공자로 가고 CLI를 부르지 않는다', async () => {
    const gateway = loadGateway({ CLAUDE_CLI_BIN: fakeBin, OPENAI_API_KEY: 'test-key' });
    expect(await gateway.call('chatbot', '질문')).toBe('api answer');
    expect(calls()).toHaveLength(0);
  });

  test('OpenAI 키가 없어도 관계 추출은 돈다 — API 작업은 키 부재로 멈춘다(다른 제공자로 넘어가지 않음)', async () => {
    const gateway = loadGateway({
      CLAUDE_CLI_BIN: fakeBin,
      OPENAI_API_KEY: undefined,
      MOCK_MODE: 'false',
    });
    await expect(gateway.call('generate_relationship_verifier', '검토')).resolves.toContain(
      'relations'
    );
    await expect(gateway.call('chatbot', '질문')).rejects.toThrow(
      'Missing required environment variable: OPENAI_API_KEY'
    );
    expect(calls()).toHaveLength(1);
  });

  test('관계 추출은 스트리밍 경로가 없다', async () => {
    const gateway = loadGateway({ CLAUDE_CLI_BIN: fakeBin });
    const gen = gateway.stream('generate_relationship', 'p');
    await expect(gen.next()).rejects.toThrow(/claude-cli batch only/);
    expect(calls()).toHaveLength(0);
  });

  test('CLI 실패는 실패로 끝난다 — API로 넘어가지 않고 실패 로그를 남긴다', async () => {
    const gateway = loadGateway({
      CLAUDE_CLI_BIN: path.join(dir, 'no-such-claude'),
      CLAUDE_CLI_MAX_ATTEMPTS: '1',
      OPENAI_API_KEY: 'test-key',
    });
    const OpenAI = gateway.OpenAI;
    await expect(gateway.call('generate_relationship', 'p')).rejects.toThrow(/claude-cli/);
    const created = OpenAI.mock.results.at(-1)!.value.responses.create as jest.Mock;
    expect(created).not.toHaveBeenCalled();
    const metric = log.mock.calls.find(([tag]) => tag === '[LLM Metrics]');
    expect(JSON.parse(metric![1])).toMatchObject({ provider: 'claude-cli', failed: true });
  });
});

/**
 * 2026-11-24 대표 지시 — API 제공자는 챗봇·리캡만 부른다. 등록(사전 생성) 작업은 전부 Claude 구독(CLI).
 * 새 작업 이름이 생겨도 API로 새지 않게, API 작업은 허용 목록(chatbot·recap)으로만 정한다.
 */
const REGISTRATION_TASKS = [
  'generate_summary',
  'generate_character',
  'generate_term',
  'generate_background',
  'generate_event',
  'generate_event_scene_boundary',
  'generate_summary_grounding',
  'generate_chapter_key_point',
  'rewrite_reader_text',
  'generate_relationship',
  'generate_relationship_verifier',
  'explain_relation',
];

describe('2026-11-24: API 호출은 챗봇·리캡만 — 등록 작업은 전부 Claude 구독(CLI)', () => {
  test.each(REGISTRATION_TASKS)('%s 는 CLI로 가고 API를 부르지 않는다', async (task) => {
    const gateway = loadGateway({ CLAUDE_CLI_BIN: fakeBin, OPENAI_API_KEY: 'test-key' });
    const OpenAI = gateway.OpenAI;
    await gateway.call(task, '등록 프롬프트');
    expect(calls()).toHaveLength(1);
    const created = OpenAI.mock.results.at(-1)!.value.responses.create as jest.Mock;
    expect(created).not.toHaveBeenCalled();
    const metric = log.mock.calls.find(([tag]) => tag === '[LLM Metrics]');
    expect(JSON.parse(metric![1])).toMatchObject({ task, provider: 'claude-cli' });
  });

  test('목록에 없는 작업 이름도 API로 가지 않는다 — CLI로 보내고 경고를 남긴다', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    const gateway = loadGateway({ CLAUDE_CLI_BIN: fakeBin, OPENAI_API_KEY: 'test-key' });
    const OpenAI = gateway.OpenAI;
    await gateway.call('generate_something_new', 'p');
    expect(calls()).toHaveLength(1);
    const created = OpenAI.mock.results.at(-1)!.value.responses.create as jest.Mock;
    expect(created).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('generate_something_new'));
  });

  test.each(['chatbot', 'recap'])('positive 쌍 — %s 는 API 제공자로 가고 CLI를 부르지 않는다', async (task) => {
    const gateway = loadGateway({ CLAUDE_CLI_BIN: fakeBin, OPENAI_API_KEY: 'test-key' });
    expect(await gateway.call(task, '질문')).toBe('api answer');
    expect(calls()).toHaveLength(0);
  });

  test('API 키가 없어도 등록 작업은 CLI로 돈다 — 챗봇은 키 부재로 멈춘다(다른 제공자로 넘어가지 않음)', async () => {
    const gateway = loadGateway({ CLAUDE_CLI_BIN: fakeBin, OPENAI_API_KEY: undefined, MOCK_MODE: 'false' });
    await expect(gateway.call('generate_summary', 'p')).resolves.toContain('relations');
    await expect(gateway.call('chatbot', '질문')).rejects.toThrow(
      'Missing required environment variable: OPENAI_API_KEY'
    );
    expect(calls()).toHaveLength(1);
  });
});

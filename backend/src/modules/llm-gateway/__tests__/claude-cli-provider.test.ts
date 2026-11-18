/**
 * Claude Code CLI 제공자 — 실제 CLI·네트워크 호출 없음(가짜 runner). 2026-11-18 대표 지시:
 * 관계 추출은 API 키가 아니라 Claude 구독으로. NFR-AI-003(재시도·타임아웃), NFR-OBS-004(사용량).
 */
import {
  ClaudeCliConfig,
  ClaudeCliRunner,
  CliRunResult,
  childEnv,
  cliArgs,
  createClaudeCliProvider,
  isClaudeCliTask,
  parseEnvelope,
} from '../claude-cli-provider';

const config: ClaudeCliConfig = {
  bin: 'claude',
  model: 'opus',
  timeoutMs: 1000,
  maxAttempts: 3,
  backoffMs: 1,
};

const ok = (result: string, extra: Record<string, unknown> = {}): CliRunResult => ({
  stdout: JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    duration_ms: 1200,
    total_cost_usd: 0.01,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 2,
      cache_creation_input_tokens: 3,
    },
    modelUsage: { 'claude-opus-test': {} },
    ...extra,
  }),
  stderr: '',
  code: 0,
  timedOut: false,
});

function fakeRunner(results: (CliRunResult | Error)[]) {
  const calls: { bin: string; args: string[]; input: string; env: NodeJS.ProcessEnv }[] = [];
  const runner: ClaudeCliRunner = async (bin, args, input, options) => {
    calls.push({ bin, args, input, env: options.env });
    const next = results.shift();
    if (!next) throw new Error('no more fake results');
    if (next instanceof Error) throw next;
    return next;
  };
  return { runner, calls };
}

const noSleep = async () => undefined;

describe('Claude CLI 제공자 — 구독 실행(키 없음)', () => {
  test('관계 추출 작업 이름만 CLI로 간다', () => {
    expect(isClaudeCliTask('generate_relationship')).toBe(true);
    expect(isClaudeCliTask('generate_relationship_verifier')).toBe(true);
    for (const task of [
      'chatbot',
      'recap',
      'generate_summary',
      'generate_character',
      'generate_event',
    ])
      expect(isClaudeCliTask(task)).toBe(false);
  });

  test('-p --output-format json, 도구·MCP·세션 저장 없음, 모델·시스템 프롬프트 지정, 프롬프트는 stdin', async () => {
    const { runner, calls } = fakeRunner([ok('{"relations":[]}')]);
    const provider = createClaudeCliProvider(config, runner, noSleep);
    const text = await provider.call('근거 창 프롬프트', { system: '주석자' });
    expect(text).toBe('{"relations":[]}');
    expect(calls).toHaveLength(1);
    expect(calls[0].bin).toBe('claude');
    expect(calls[0].input).toBe('근거 창 프롬프트');
    expect(calls[0].args).toEqual(cliArgs('opus', '주석자'));
    expect(calls[0].args.slice(0, 3)).toEqual(['-p', '--output-format', 'json']);
    expect(calls[0].args).toEqual(expect.arrayContaining(['--model', 'opus', '--tools', '']));
    expect(calls[0].args).toContain('--strict-mcp-config');
    expect(calls[0].args).toContain('--no-session-persistence');
    expect(calls[0].args.join(' ')).not.toContain('근거 창 프롬프트');
  });

  test('자식 프로세스 환경에 API 키를 넘기지 않는다(구독 인증만)', async () => {
    const env = childEnv({
      PATH: '/bin',
      ANTHROPIC_API_KEY: 'sk-ant-secret',
      ANTHROPIC_AUTH_TOKEN: 'tok',
      OPENAI_API_KEY: 'sk-openai',
    });
    expect(env).toEqual({ PATH: '/bin' });
    const { runner, calls } = fakeRunner([ok('x')]);
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret';
    try {
      await createClaudeCliProvider(config, runner, noSleep).call('p');
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
    }
    expect(calls[0].env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(calls[0].env.OPENAI_API_KEY).toBeUndefined();
  });

  test('NFR-OBS-004: 실제 모델 이름·토큰·시도 횟수를 사용량으로 알린다', async () => {
    const { runner } = fakeRunner([ok('x')]);
    const usage: unknown[] = [];
    await createClaudeCliProvider(config, runner, noSleep).call('p', {
      onUsage: (u) => usage.push(u),
    });
    expect(usage).toEqual([
      {
        modelId: 'claude-opus-test',
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 2,
        cacheWriteTokens: 3,
        listCostUsd: 0.01,
        attempts: 1,
        cliDurationMs: 1200,
      },
    ]);
  });

  test('NFR-AI-003: 시간 초과·과부하(529)·JSON 아닌 출력은 재시도하고 3번째에 성공', async () => {
    const { runner, calls } = fakeRunner([
      { stdout: '', stderr: '', code: null, timedOut: true },
      ok('', { is_error: true, subtype: 'error_during_execution', api_error_status: 529 }),
      ok('답'),
    ]);
    const slept: number[] = [];
    const provider = createClaudeCliProvider(config, runner, async (ms) => {
      slept.push(ms);
    });
    expect(await provider.call('p')).toBe('답');
    expect(calls).toHaveLength(3);
    expect(slept).toEqual([1, 2]);
  });

  test('재시도를 다 쓰면 실패한다 — 다른 제공자로 넘어가지 않는다', async () => {
    const timeout = { stdout: '', stderr: '', code: null, timedOut: true };
    const { runner, calls } = fakeRunner([timeout, timeout, timeout, ok('늦은 답')]);
    await expect(createClaudeCliProvider(config, runner, noSleep).call('p')).rejects.toThrow(
      /시간 초과/
    );
    expect(calls).toHaveLength(3);
  });

  test('로그인 안 됨(인증 실패)은 재시도하지 않고 바로 실패한다', async () => {
    const { runner, calls } = fakeRunner([
      ok('Not logged in · Please run /login', { is_error: true, subtype: 'success' }),
      ok('x'),
    ]);
    await expect(createClaudeCliProvider(config, runner, noSleep).call('p')).rejects.toThrow(
      /Not logged in/
    );
    expect(calls).toHaveLength(1);
  });

  test('CLI 실행 파일이 없으면(spawn 오류) 재시도하지 않는다', async () => {
    const { ClaudeCliError } = jest.requireActual('../claude-cli-provider');
    const { runner, calls } = fakeRunner([new ClaudeCliError('claude CLI 실행 실패', false)]);
    await expect(createClaudeCliProvider(config, runner, noSleep).call('p')).rejects.toThrow(
      /실행 실패/
    );
    expect(calls).toHaveLength(1);
  });

  test('봉투 해석 — 성공이 아니거나 result가 글자가 아니면 오류', () => {
    expect(parseEnvelope(ok('{"a":1}')).text).toBe('{"a":1}');
    expect(() => parseEnvelope(ok('x', { subtype: 'error_max_turns' }))).toThrow(/오류/);
    expect(() =>
      parseEnvelope({ stdout: 'not json', stderr: '', code: 1, timedOut: false })
    ).toThrow(/JSON이 아니다/);
  });
});

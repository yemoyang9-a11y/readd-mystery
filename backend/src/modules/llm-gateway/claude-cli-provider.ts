/**
 * Claude Code CLI 제공자 — 구독 플랜으로 배치 작업을 돌린다 (2026-11-18 대표 지시: 관계 추출은 API 키가
 * 아니라 Claude 구독으로). NFR-AI-001 / 4.3: 게이트웨이(gateway.ts)만 이 제공자를 부른다.
 *
 * `claude -p --output-format json`에 프롬프트를 stdin으로 넣고, 결과 봉투(JSON)의 `result` 글자를 돌려준다.
 * - API 키를 쓰지 않는다: 자식 프로세스 환경에서 ANTHROPIC_API_KEY·ANTHROPIC_AUTH_TOKEN·OPENAI_API_KEY를 지운다.
 *   그러면 CLI는 로그인한 구독 인증만 쓴다(키가 있으면 CLI가 키를 우선하기 때문).
 * - 도구 없음(--tools ""), MCP 없음(--strict-mcp-config), 세션 저장 없음, 빈 임시 작업 폴더에서 실행 —
 *   저장소의 CLAUDE.md·설정이 프롬프트에 섞이지 않게 한다. 시스템 프롬프트는 호출자가 준 것만 쓴다.
 * - 타임아웃·재시도: 한 번에 timeoutMs, 실패하면 최대 maxAttempts회(지수 대기). 인증 실패는 재시도하지 않는다.
 * - 시험에서는 runner를 바꿔 끼우거나(createClaudeCliProvider의 두 번째 인자) CLAUDE_CLI_BIN을 가짜 실행 파일로 둔다.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * 2026-11-18 대표 지시 — 관계 추출은 API 키가 아니라 Claude 구독 플랜(Claude Code CLI)으로 돌린다.
 * 이 작업 이름은 API 제공자(OpenAI·Anthropic API)로 절대 가지 않는다(gateway.ts). 실패해도 다른 제공자로 넘어가지 않는다.
 *  - generate_relationship: 근거 창 관계 질문지(batch/pipeline/relationship-labeling.ts)
 *  - generate_relationship_verifier: 반대 검토자(batch/pipeline/relationship-verification.ts)
 */
export const CLAUDE_CLI_TASKS: readonly string[] = [
  'generate_relationship',
  'generate_relationship_verifier',
];

export function isClaudeCliTask(task: string): boolean {
  return CLAUDE_CLI_TASKS.includes(task);
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value?.trim());
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** 환경 변수 → CLI 설정. 키가 아니라 이 컴퓨터에 로그인한 Claude 구독을 쓴다 */
export function claudeCliConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ClaudeCliConfig {
  return {
    bin: env.CLAUDE_CLI_BIN?.trim() || 'claude',
    model: env.CLAUDE_CLI_MODEL?.trim() || 'opus',
    effort: env.CLAUDE_CLI_EFFORT?.trim() || '',
    timeoutMs: positiveInt(env.CLAUDE_CLI_TIMEOUT_MS, 600_000),
    maxAttempts: positiveInt(env.CLAUDE_CLI_MAX_ATTEMPTS, 3),
    backoffMs: positiveInt(env.CLAUDE_CLI_BACKOFF_MS, 5_000),
  };
}

export const CLAUDE_CLI_CONFIG = claudeCliConfigFromEnv();

export interface ClaudeCliConfig {
  bin: string;
  model: string;
  /** 비우면 --effort를 넘기지 않는다 */
  effort?: string;
  timeoutMs: number;
  maxAttempts: number;
  /** 재시도 사이 대기 기준(ms) — 시도마다 두 배 */
  backoffMs: number;
}

export interface CliRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

export type ClaudeCliRunner = (
  bin: string,
  args: string[],
  input: string,
  options: { timeoutMs: number; cwd: string; env: NodeJS.ProcessEnv }
) => Promise<CliRunResult>;

export interface ClaudeCliUsage {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** CLI가 알려 주는 API 정가 환산값 — 구독 실행이라 청구액이 아니다 */
  listCostUsd?: number;
  attempts: number;
  cliDurationMs?: number;
}

export interface ClaudeCliCallOptions {
  system?: string;
  model?: string;
  onUsage?: (usage: ClaudeCliUsage) => void;
}

/** 키 환경 변수 — 자식에게 넘기지 않는다 */
export const STRIPPED_ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY'];

export class ClaudeCliError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'ClaudeCliError';
  }
}

export const spawnRunner: ClaudeCliRunner = (bin, args, input, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, options.timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new ClaudeCliError(`claude CLI 실행 실패(${bin}): ${err.message}`, false));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input, 'utf8');
  });

export function cliArgs(model: string, system: string | undefined, effort?: string): string[] {
  return [
    '-p',
    '--output-format',
    'json',
    '--model',
    model,
    '--tools',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
    ...(effort ? ['--effort', effort] : []),
    ...(system !== undefined ? ['--system-prompt', system] : []),
  ];
}

export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const key of STRIPPED_ENV_KEYS) delete out[key];
  return out;
}

interface Envelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  api_error_status?: number | null;
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<string, unknown>;
}

const AUTH_FAILURE =
  /(?:not logged in|invalid api key|authentication|unauthori[sz]ed|\/login|oauth)/iu;

/** CLI 결과 봉투 해석 — 성공이면 글자, 아니면 ClaudeCliError(재시도 여부 포함) */
export function parseEnvelope(run: CliRunResult): { text: string; envelope: Envelope } {
  if (run.timedOut) throw new ClaudeCliError('claude CLI 시간 초과', true);
  let envelope: Envelope;
  try {
    envelope = JSON.parse(run.stdout.trim()) as Envelope;
  } catch {
    const detail = (run.stderr || run.stdout).slice(0, 300);
    throw new ClaudeCliError(
      `claude CLI 출력이 JSON이 아니다(code ${run.code}): ${detail}`,
      !AUTH_FAILURE.test(detail)
    );
  }
  if (envelope.is_error || envelope.subtype !== 'success' || typeof envelope.result !== 'string') {
    const detail = typeof envelope.result === 'string' ? envelope.result.slice(0, 300) : '';
    const status = envelope.api_error_status ?? undefined;
    const retryable =
      !AUTH_FAILURE.test(detail) &&
      (status === undefined || status === null || status === 429 || status >= 500);
    throw new ClaudeCliError(
      `claude CLI 오류(${envelope.subtype ?? 'unknown'}, status ${status ?? '-'}): ${detail}`,
      retryable
    );
  }
  return { text: envelope.result, envelope };
}

export function createClaudeCliProvider(
  config: ClaudeCliConfig,
  runner: ClaudeCliRunner = spawnRunner,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
) {
  let workDir: string | undefined;
  const cwd = () => {
    // 빈 임시 폴더 — 저장소 CLAUDE.md·프로젝트 설정을 읽지 않게 한다
    workDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'readd-claude-cli-'));
    return workDir;
  };
  return {
    config,
    async call(prompt: string, options: ClaudeCliCallOptions = {}): Promise<string> {
      const model = options.model ?? config.model;
      const args = cliArgs(model, options.system, config.effort);
      let lastError: unknown;
      for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
        try {
          const run = await runner(config.bin, args, prompt, {
            timeoutMs: config.timeoutMs,
            cwd: cwd(),
            env: childEnv(),
          });
          const { text, envelope } = parseEnvelope(run);
          const usage = envelope.usage ?? {};
          options.onUsage?.({
            modelId: Object.keys(envelope.modelUsage ?? {})[0] ?? model,
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            cacheReadTokens: usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
            ...(typeof envelope.total_cost_usd === 'number'
              ? { listCostUsd: envelope.total_cost_usd }
              : {}),
            attempts: attempt,
            ...(typeof envelope.duration_ms === 'number'
              ? { cliDurationMs: envelope.duration_ms }
              : {}),
          });
          return text;
        } catch (err) {
          lastError = err;
          const retryable = !(err instanceof ClaudeCliError) || err.retryable;
          if (!retryable || attempt === config.maxAttempts) break;
          await sleep(config.backoffMs * 2 ** (attempt - 1));
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
  };
}

export type ClaudeCliProvider = ReturnType<typeof createClaudeCliProvider>;

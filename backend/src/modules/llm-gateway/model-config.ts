import dotenv from 'dotenv';
import { CLAUDE_CLI_CONFIG, isClaudeCliTask } from './claude-cli-provider';

// NFR-AI-001: load local configuration before capturing provider/model defaults.
dotenv.config();

type LLMProvider = 'openai' | 'anthropic';

function selectedProvider(): LLMProvider {
  const provider = process.env.LLM_PROVIDER?.trim() || 'openai';
  if (provider !== 'openai' && provider !== 'anthropic') {
    throw new Error('Invalid LLM_PROVIDER: expected openai or anthropic');
  }
  return provider;
}

/** Provider changes are explicit; authentication failure never switches vendors. */
export const LLM_PROVIDER = selectedProvider();

const DEFAULT_MODEL =
  LLM_PROVIDER === 'openai'
    ? process.env.OPENAI_MODEL?.trim() || 'gpt-6-luna'
    : process.env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-4-5';

export const DEFAULT_EFFORT =
  LLM_PROVIDER === 'openai'
    ? process.env.OPENAI_REASONING_EFFORT?.trim() || 'low'
    : (process.env.ANTHROPIC_EFFORT?.trim() ?? '');

const VALID_OPENAI_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];

if (LLM_PROVIDER === 'openai' && !VALID_OPENAI_EFFORTS.includes(DEFAULT_EFFORT)) {
  throw new Error(
    'Invalid OPENAI_REASONING_EFFORT: expected none, low, medium, high, xhigh or max'
  );
}

export const EFFORT_ENABLED = DEFAULT_EFFORT !== '';

/**
 * NFR-AI-001, R9: API 제공자(LLM_PROVIDER)로 가는 작업 → 모델. 챗봇·리캡 둘뿐이다.
 * 2026-11-24 대표 지시로 책 등록(사전 생성) 작업은 전부 Claude 구독(claude-cli-provider.ts LLM_API_TASKS)으로 간다.
 */
export const MODEL_CONFIG = {
  chatbot: DEFAULT_MODEL,
  recap: DEFAULT_MODEL,
} as const;

export function getModelForTask(task: string): string {
  // API 작업(챗봇·리캡)이 아니면 전부 Claude 구독 모델 — 알 수 없는 이름은 isClaudeCliTask가 경고한다
  if (isClaudeCliTask(task)) return CLAUDE_CLI_CONFIG.model;
  return MODEL_CONFIG[task as keyof typeof MODEL_CONFIG];
}

/** NFR-AI-002: log the configured provider/model and validate only its credentials. */
export function validateModelVersions(): void {
  if (process.env.MOCK_MODE === 'true') {
    console.log('Mock Mode: Skipping model credential validation');
    return;
  }

  const keyName = LLM_PROVIDER === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  if (!process.env[keyName]?.trim()) {
    throw new Error(`Missing required environment variable: ${keyName}`);
  }

  console.log('[LLM Gateway] 기본 모델', {
    provider: LLM_PROVIDER,
    model: DEFAULT_MODEL,
    effort: DEFAULT_EFFORT || '(사용 안 함)',
    fallback: '(없음 — 선택한 제공자 내 재시도만)',
  });
}

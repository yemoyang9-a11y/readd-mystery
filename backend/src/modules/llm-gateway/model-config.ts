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
 * NFR-AI-001: API 제공자(LLM_PROVIDER)로 가는 작업 → 모델. 관계 추출(generate_relationship*)은 여기 없다 —
 * 2026-11-18 대표 지시로 OpenAI 경로를 지우고 Claude 구독(CLAUDE_CLI_TASKS)으로만 간다.
 */
export const MODEL_CONFIG = {
  chatbot: DEFAULT_MODEL,
  recap: DEFAULT_MODEL,
  generate_summary: DEFAULT_MODEL,
  generate_character: DEFAULT_MODEL,
  generate_background: DEFAULT_MODEL,
  generate_term: DEFAULT_MODEL,
  generate_event: DEFAULT_MODEL,
  rewrite_reader_text: DEFAULT_MODEL,
} as const;

/**
 * NFR-OBS-004: 지표에서만 따로 세는 작업 이름 → 모델을 빌려 쓰는 작업.
 *
 * MODEL_CONFIG 에 키를 더하지 않는 이유 — 배치 장 캐시의 계약 문자열이 MODEL_CONFIG 를 통째로
 * 담는다(run-generate-full.ts). 키가 늘면 이미 생성·검수한 결과가 전부 "낡은 캐시"가 되어
 * 다시 생성해야 한다. 모델은 같으므로 이름만 나눈다.
 */
const METRIC_TASK_ALIASES: Record<string, keyof typeof MODEL_CONFIG> = {
  generate_event_scene_boundary: 'generate_event',
  // FR-DAT-003 — 장 요약 문장별 근거 확인 (batch/pipeline/summary-grounding.ts)
  generate_summary_grounding: 'generate_summary',
  // 결정 31 — 타임라인 장 핵심 한 줄 (batch/pipeline/chapter-key-point.ts)
  generate_chapter_key_point: 'generate_summary',
  // 관계 설명문 — EXPLAIN_RELATION_VIA_API=true 일 때만 여기로 온다(claude-cli-provider.ts, 측정 2026-11-23)
  explain_relation: 'generate_summary',
};

export function getModelForTask(task: string): string {
  if (isClaudeCliTask(task)) return CLAUDE_CLI_CONFIG.model;
  const model = MODEL_CONFIG[(METRIC_TASK_ALIASES[task] ?? task) as keyof typeof MODEL_CONFIG];
  if (!model) {
    console.warn(`Unknown task: ${task}, falling back to default model`);
    return DEFAULT_MODEL;
  }
  return model;
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

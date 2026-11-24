jest.mock('dotenv', () => ({ __esModule: true, default: { config: jest.fn() } }));

type ModelConfigModule = typeof import('../model-config');

describe('NFR-AI-001: provider and model configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  function load(overrides: Record<string, string | undefined> = {}): ModelConfigModule {
    for (const [name, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    let config!: ModelConfigModule;
    jest.isolateModules(() => {
      config = require('../model-config') as ModelConfigModule;
    });
    return config;
  }

  test('defaults to OpenAI gpt-6-luna with low reasoning when no selection is configured', () => {
    const config = load({
      LLM_PROVIDER: undefined,
      OPENAI_MODEL: undefined,
      OPENAI_REASONING_EFFORT: undefined,
    });
    expect(config.LLM_PROVIDER).toBe('openai');
    expect(config.getModelForTask('chatbot')).toBe('gpt-6-luna');
    expect(config.DEFAULT_EFFORT).toBe('low');
    expect(config.EFFORT_ENABLED).toBe(true);
  });

  test('2026-11-24: API 모델 설정에는 챗봇·리캡만 있고 둘 다 선택한 모델을 쓴다', () => {
    const config = load({ LLM_PROVIDER: 'openai', OPENAI_MODEL: 'test-openai-model' });
    expect(Object.keys(config.MODEL_CONFIG)).toEqual(['chatbot', 'recap']);
    expect(new Set(Object.values(config.MODEL_CONFIG))).toEqual(new Set(['test-openai-model']));
  });

  test.each([
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
  ])('2026-11-24: 등록 작업 %s 는 Claude 구독(CLI) 모델을 쓰고 경고 없이 통과한다', (task) => {
    const config = load({
      LLM_PROVIDER: 'openai',
      OPENAI_MODEL: 'test-openai-model',
      CLAUDE_CLI_MODEL: 'test-claude-model',
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    expect(config.getModelForTask(task)).toBe('test-claude-model');
    expect(Object.keys(config.MODEL_CONFIG)).not.toContain(task);
    expect(warn).not.toHaveBeenCalled();
  });

  test('unknown task warns and goes to the Claude subscription model, never the API model', () => {
    const config = load({
      LLM_PROVIDER: 'openai',
      OPENAI_MODEL: 'test-openai-model',
      CLAUDE_CLI_MODEL: 'test-claude-model',
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    expect(config.getModelForTask('unknown-task')).toBe('test-claude-model');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('OpenAI configuration validates only its selected provider key', () => {
    const config = load({
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'dummy-openai-key',
      ANTHROPIC_API_KEY: undefined,
      MOCK_MODE: 'false',
    });
    expect(() => config.validateModelVersions()).not.toThrow();
  });

  test('a legacy Anthropic key does not silently substitute for a missing OpenAI key', () => {
    const config = load({
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: undefined,
      ANTHROPIC_API_KEY: 'dummy-anthropic-key',
      MOCK_MODE: 'false',
    });
    expect(() => config.validateModelVersions()).toThrow(
      'Missing required environment variable: OPENAI_API_KEY'
    );
  });

  test('explicit Anthropic selection preserves its model and effort configuration', () => {
    const config = load({
      LLM_PROVIDER: 'anthropic',
      ANTHROPIC_MODEL: 'claude-haiku-4-5-20251001',
      ANTHROPIC_EFFORT: '',
      ANTHROPIC_API_KEY: 'dummy-anthropic-key',
      OPENAI_API_KEY: undefined,
      MOCK_MODE: 'false',
    });
    expect(config.LLM_PROVIDER).toBe('anthropic');
    expect(config.getModelForTask('recap')).toBe('claude-haiku-4-5-20251001');
    expect(config.DEFAULT_EFFORT).toBe('');
    expect(config.EFFORT_ENABLED).toBe(false);
    expect(() => config.validateModelVersions()).not.toThrow();
  });

  test('Anthropic selection requires its own key', () => {
    const config = load({
      LLM_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: undefined,
      MOCK_MODE: 'false',
    });
    expect(() => config.validateModelVersions()).toThrow(
      'Missing required environment variable: ANTHROPIC_API_KEY'
    );
  });

  test('unknown provider fails before any request instead of choosing a different vendor', () => {
    expect(() => load({ LLM_PROVIDER: 'typo' })).toThrow('Invalid LLM_PROVIDER');
  });

  test('invalid OpenAI effort fails before any request', () => {
    expect(() => load({ LLM_PROVIDER: 'openai', OPENAI_REASONING_EFFORT: 'typo' })).toThrow(
      'Invalid OPENAI_REASONING_EFFORT'
    );
  });

  test.each(['none', 'low', 'medium', 'high', 'xhigh', 'max'])(
    'explicit OpenAI reasoning effort %s is preserved',
    (effort) => {
      const config = load({ LLM_PROVIDER: 'openai', OPENAI_REASONING_EFFORT: effort });
      expect(config.DEFAULT_EFFORT).toBe(effort);
    }
  );

  test('dotenv loads before configuration values are captured', () => {
    const dotenv = require('dotenv').default as { config: jest.Mock };
    dotenv.config.mockImplementationOnce(() => {
      process.env.OPENAI_MODEL = 'model-loaded-from-env';
    });
    const config = load({ LLM_PROVIDER: 'openai', OPENAI_MODEL: undefined });
    expect(config.getModelForTask('chatbot')).toBe('model-loaded-from-env');
  });

  test('mock mode can skip credentials without suppressing invalid provider validation', () => {
    const config = load({ MOCK_MODE: 'true', OPENAI_API_KEY: undefined });
    expect(() => config.validateModelVersions()).not.toThrow();
    expect(() => load({ MOCK_MODE: 'true', LLM_PROVIDER: 'typo' })).toThrow('Invalid LLM_PROVIDER');
  });
});

export {};

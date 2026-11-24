/**
 * 측정 전 키 확인 — Anthropic(챗봇·리캡용 Haiku 5.5) 1회, Cohere 임베딩 1회. 키 값은 출력하지 않는다.
 * 사용(backend 폴더, measure-env.sh 를 source 한 뒤): node scripts/measure/check-keys.js
 * 사용량은 아주 작다(입력 수십 토큰). 결과로 모델 이름·토큰 수·HTTP 상태만 보여 준다.
 */
const Anthropic = require('@anthropic-ai/sdk').default;

(async () => {
  try {
    const c = new Anthropic({ baseURL: 'https://api.anthropic.com', maxRetries: 0 });
    const r = await c.messages.create({
      model: 'claude-haiku-5-5',
      max_tokens: 256,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: '한 단어로만 답해: 하늘색은?' }],
    });
    console.log('anthropic OK', JSON.stringify({ model: r.model, input: r.usage.input_tokens, output: r.usage.output_tokens }));
  } catch (e) {
    console.log('anthropic FAIL', e.status, e.error?.error?.type ?? '');
  }
  try {
    const res = await fetch('https://api.cohere.com/v2/embed', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.COHERE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'embed-v4.0', texts: ['시험 문장'], input_type: 'search_query', embedding_types: ['float'], output_dimension: 1024 }),
    });
    const b = await res.json();
    console.log('cohere', res.status, JSON.stringify({ dim: b.embeddings?.float?.[0]?.length, billed: b.meta?.billed_units?.input_tokens }));
  } catch (e) {
    console.log('cohere FAIL', String(e.message).slice(0, 120));
  }
})();

/**
 * AI 원가 집계 (NFR-OBS-004, 2026-11-24 측정) — LLM_METRICS_FILE 기록을 단계별 토큰·금액으로 묶는다.
 *
 * 사용: node scripts/measure/aggregate-cost.js <metrics 파일...> [--from ISO] [--to ISO] [--json out.json]
 * 입력 줄 형식: "[LLM Metrics] {...}" 또는 "[Embed Metrics] {...}" (gateway.ts·embedding.ts)
 *
 * 금액 규칙
 *  - Anthropic API(provider=anthropic): 요청마다 프롬프트 길이(입력+캐시 쓰기+캐시 읽기)가 100,000 토큰을 넘으면 긴 프롬프트 단가.
 *    thinking 토큰은 outputTokens에 이미 들어 있어 출력 단가로 센다.
 *  - Cohere 임베딩: billedInputTokens × 임베딩 단가.
 *  - Claude CLI(provider=claude-cli): 구독 실행이라 금액을 내지 않는다. 토큰과 CLI 정가 환산값(list_cost_usd)만 모은다.
 *  - 1회 통과 = attempt가 1인 호출만, 전체 = 모든 호출. 실패 호출(failed)은 토큰이 없어 0으로 센다.
 *  - 끊긴 스트림(aborted, 출력 검사 차단 등)은 입력 토큰만 실측이고 출력 토큰은 없으면 0 — 그 금액은 하한이다.
 * 단가·환율은 아래 PRICES에서 한 곳만 바꾼다. 이 스크립트는 API를 부르지 않는다.
 */
const fs = require('fs');

const PRICES = {
  // https://platform.claude.com/docs/en/about-claude/pricing (2026-11-23 확인), USD / 1M 토큰
  'claude-haiku-5-5': {
    normal: { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
    long: { input: 0.5, cacheWrite: 0.625, cacheRead: 0.05, output: 2.5 },
    longThreshold: 100_000,
  },
  // Cohere 공식 페이지 미확인 — 집계 사이트 기준 추정 (2026-11-23)
  'embed-v4.0': { input: 0.12 },
  // 하나은행 매매기준율 2026-11-23 (2차 출처)
  KRW_PER_USD: 1342.4,
};

function parseArgs(argv) {
  const files = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') opts.from = argv[++i];
    else if (argv[i] === '--to') opts.to = argv[++i];
    else if (argv[i] === '--json') opts.json = argv[++i];
    else files.push(argv[i]);
  }
  return { files, opts };
}

function readRecords(files, { from, to } = {}) {
  const out = [];
  for (const file of files) {
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
      const m = line.match(/^\[(LLM|Embed) Metrics\] (\{.*\})\s*$/);
      if (!m) continue;
      const rec = JSON.parse(m[2]);
      rec.kind = m[1] === 'LLM' ? 'llm' : 'embed';
      if (from && rec.timestamp < from) continue;
      if (to && rec.timestamp > to) continue;
      out.push(rec);
    }
  }
  return out;
}

function costUsd(rec) {
  if (rec.kind === 'embed') {
    const p = PRICES[rec.model];
    return p ? ((rec.billedInputTokens ?? 0) * p.input) / 1e6 : null;
  }
  if (rec.provider === 'claude-cli') return null; // 구독 — 청구 금액 없음
  const p = PRICES[rec.modelId];
  if (!p) return null;
  const input = rec.inputTokens ?? 0;
  const cw = rec.cacheWriteTokens ?? 0;
  const cr = rec.cacheReadTokens ?? 0;
  const tier = input + cw + cr > p.longThreshold ? p.long : p.normal;
  return (input * tier.input + cw * tier.cacheWrite + cr * tier.cacheRead + (rec.outputTokens ?? 0) * tier.output) / 1e6;
}

function stepKey(rec) {
  return rec.kind === 'embed' ? `embed:${rec.inputType}` : rec.task;
}

function emptyRow() {
  return { calls: 0, retryCalls: 0, failed: 0, aborted: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0,
    usd: 0, usdFirstPass: 0, longPromptCalls: 0, maxTokensStops: 0, durationMs: 0, cliListUsd: 0, uncostable: 0,
    models: new Set(), providers: new Set() };
}

function aggregate(records) {
  const steps = {};
  for (const rec of records) {
    const k = stepKey(rec);
    const r = (steps[k] ??= emptyRow());
    r.calls++;
    const attempt = rec.attempt ?? 1;
    if (attempt > 1) r.retryCalls++;
    if (rec.failed) r.failed++;
    // 호출부가 스트림을 끊은 호출 — 입력은 실측, 출력 토큰은 모를 수 있어 0으로 센다(금액은 하한)
    if (rec.aborted) r.aborted++;
    r.models.add(rec.kind === 'embed' ? rec.model : rec.modelId);
    r.providers.add(rec.kind === 'embed' ? 'cohere' : rec.provider);
    if (rec.kind === 'embed') r.input += rec.billedInputTokens ?? 0;
    else {
      r.input += rec.provider === 'claude-cli' ? (rec.uncachedInputTokens ?? rec.inputTokens ?? 0) : rec.inputTokens ?? 0;
      r.cacheWrite += rec.cacheWriteTokens ?? 0;
      r.cacheRead += rec.cacheReadTokens ?? 0;
      r.output += rec.outputTokens ?? 0;
      r.thinking += rec.thinkingTokens ?? 0;
      if (rec.stopReason === 'max_tokens') r.maxTokensStops++;
      if (rec.list_cost_usd) r.cliListUsd += rec.list_cost_usd;
      const p = PRICES[rec.modelId];
      if (p && (rec.inputTokens ?? 0) + (rec.cacheWriteTokens ?? 0) + (rec.cacheReadTokens ?? 0) > p.longThreshold) r.longPromptCalls++;
    }
    r.durationMs += rec.durationMs ?? 0;
    const usd = costUsd(rec);
    if (usd === null) { if (!(rec.kind === 'llm' && rec.provider === 'claude-cli')) r.uncostable++; }
    else {
      r.usd += usd;
      if (attempt === 1) r.usdFirstPass += usd;
    }
  }
  const total = emptyRow();
  for (const r of Object.values(steps)) {
    for (const f of Object.keys(total)) if (typeof total[f] === 'number') total[f] += r[f];
  }
  const finish = (r) => ({ ...r, models: [...r.models].join(','), providers: [...r.providers].join(','),
    krw: r.usd * PRICES.KRW_PER_USD, krwFirstPass: r.usdFirstPass * PRICES.KRW_PER_USD });
  return {
    prices: PRICES,
    range: records.length ? { from: records[0].timestamp, to: records[records.length - 1].timestamp } : null,
    steps: Object.fromEntries(Object.entries(steps).map(([k, r]) => [k, finish(r)])),
    total: finish(total),
  };
}

function toMarkdown(result) {
  const head = '| 단계(task) | 제공자 | 모델 | 호출(끊김) | 재시도 호출 | 입력 | 캐시 쓰기 | 캐시 읽기 | 출력(thinking) | 금액(원, 전체) | 금액(원, 1회 통과) |';
  const rows = Object.entries(result.steps).map(([k, r]) =>
    `| ${k} | ${r.providers} | ${r.models} | ${r.calls} (${r.aborted}) | ${r.retryCalls} | ${r.input} | ${r.cacheWrite} | ${r.cacheRead} | ${r.output} (${r.thinking}) | ${r.providers.includes('claude-cli') ? '구독(금액 없음)' : r.krw.toFixed(2)} | ${r.providers.includes('claude-cli') ? '—' : r.krwFirstPass.toFixed(2)} |`);
  const t = result.total;
  return [head, '|' + ' --- |'.repeat(11), ...rows,
    `| **합계(API)** | | | ${t.calls} (${t.aborted}) | ${t.retryCalls} | ${t.input} | ${t.cacheWrite} | ${t.cacheRead} | ${t.output} (${t.thinking}) | ${t.krw.toFixed(2)} | ${t.krwFirstPass.toFixed(2)} |`].join('\n');
}

if (require.main === module) {
  const { files, opts } = parseArgs(process.argv.slice(2));
  if (files.length === 0) {
    console.error('사용: node scripts/measure/aggregate-cost.js <metrics 파일...> [--from ISO] [--to ISO] [--json out.json]');
    process.exit(2);
  }
  const result = aggregate(readRecords(files, opts));
  if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(result, null, 2));
  console.log(toMarkdown(result));
}

module.exports = { PRICES, readRecords, aggregate, costUsd, toMarkdown };

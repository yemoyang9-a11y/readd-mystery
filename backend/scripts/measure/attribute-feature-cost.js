/**
 * 독자 기능 AI 원가 귀속 (NFR-OBS-004, 2026-11-24 측정용)
 *
 * run-feature-cost.ts 가 남긴 JSONL(요청마다 시작·끝 시각)의 시간 창에 metrics.log 의
 * [LLM Metrics](task=chatbot·recap)·[Embed Metrics](search_query) 줄을 붙여 요청별 금액(원)을 낸다.
 * 단가·환율은 aggregate-cost.js 의 PRICES·costUsd 를 그대로 쓴다(여기서 새로 정하지 않는다).
 * 서버 로그의 "[Chatbot] Query log" 줄은 device_id 로 요청에 붙여 logical_model_calls ·
 * harness.violations · regenerated · fixed_answer 를 낸다. 이 스크립트는 API를 부르지 않는다.
 *
 * 사용
 *   node scripts/measure/attribute-feature-cost.js --jsonl <a.jsonl> [--jsonl <b.jsonl> ...] \
 *     --metrics <metrics.log> [--server-log <server.log>] [--json out.json] [--csv out.csv] [--slack-ms 300]
 *
 * 시간 창: [started_at - slack, ended_at + slack]. 게이트웨이는 호출이 끝난 시각을 timestamp 로 적고,
 * 챗봇·리캡은 done 프레임 전에 호출이 끝나므로 창 안에 들어온다. 요청은 순서대로 하나씩 보냈다는 전제다.
 * 어떤 창에도 속하지 않은 metrics 줄(unattributed)과 둘 이상의 창에 걸린 줄(ambiguous)은 따로 센다.
 */
const fs = require('fs');
const path = require('path');
const { PRICES, readRecords, costUsd } = require(path.join(__dirname, 'aggregate-cost.js'));

function parseArgs(argv) {
  const opts = { jsonl: [], slackMs: 300 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--jsonl') opts.jsonl.push(argv[++i]);
    else if (a === '--metrics') opts.metrics = argv[++i];
    else if (a === '--server-log') opts.serverLog = argv[++i];
    else if (a === '--json') opts.json = argv[++i];
    else if (a === '--csv') opts.csv = argv[++i];
    else if (a === '--slack-ms') opts.slackMs = Number(argv[++i]);
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`알 수 없는 인자: ${a}`);
  }
  return opts;
}

function readJsonl(file) {
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** 서버 stdout 에서 "[Chatbot] Query log {json}" 줄을 모은다. device_id 별(요청마다 새 기기) 매핑 */
function readQueryLogs(file) {
  const byDevice = new Map();
  if (!file || !fs.existsSync(file)) return byDevice;
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    const m = line.match(/\[Chatbot\] Query log (\{.*\})\s*$/);
    if (!m) continue;
    try {
      const rec = JSON.parse(m[1]);
      if (rec.device_id) byDevice.set(rec.device_id, rec);
    } catch {
      /* 깨진 줄은 건너뛴다 */
    }
  }
  return byDevice;
}

const KRW = PRICES.KRW_PER_USD;

function stats(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return { n: 0, mean: null, min: null, max: null, median: null, p90: null };
  const sum = v.reduce((a, b) => a + b, 0);
  const q = (p) => {
    const idx = (v.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return v[lo] + (v[hi] - v[lo]) * (idx - lo);
  };
  return { n: v.length, mean: sum / v.length, min: v[0], max: v[v.length - 1], median: q(0.5), p90: q(0.9) };
}

function attribute(rows, metrics, queryLogs, slackMs) {
  const windows = rows
    .filter((r) => r.started_at && r.ended_at)
    .map((r) => ({ row: r, from: Date.parse(r.started_at) - slackMs, to: Date.parse(r.ended_at) + slackMs }));
  const perRow = new Map(
    rows.map((r) => [
      r.id + '|' + r.device_id,
      {
        row: r,
        answer: { calls: 0, retryCalls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0, usd: 0, failed: 0, stops: {} },
        embed: { calls: 0, billedTokens: 0, usd: 0 },
        otherTasks: {},
        embedNull: 0,
      },
    ])
  );
  let unattributed = 0;
  let ambiguous = 0;
  const unattributedSamples = [];
  for (const rec of metrics) {
    const ts = Date.parse(rec.timestamp);
    const hits = windows.filter((w) => ts >= w.from && ts <= w.to);
    if (hits.length === 0) {
      unattributed++;
      if (unattributedSamples.length < 5) unattributedSamples.push({ ts: rec.timestamp, task: rec.task ?? `embed:${rec.inputType}` });
      continue;
    }
    if (hits.length > 1) {
      ambiguous++;
      // 가장 가까운 시작 창에 붙인다(슬랙이 겹친 경우)
      hits.sort((a, b) => Math.abs(ts - Date.parse(b.row.ended_at)) - Math.abs(ts - Date.parse(a.row.ended_at)));
    }
    const target = perRow.get(hits[0].row.id + '|' + hits[0].row.device_id);
    const usd = costUsd(rec);
    if (rec.kind === 'embed') {
      if (rec.inputType !== 'search_query') {
        target.otherTasks[`embed:${rec.inputType}`] = (target.otherTasks[`embed:${rec.inputType}`] ?? 0) + 1;
        continue;
      }
      target.embed.calls++;
      target.embed.billedTokens += rec.billedInputTokens ?? 0;
      if (usd === null || rec.billedInputTokens == null) target.embedNull++;
      else target.embed.usd += usd;
      continue;
    }
    if (rec.task !== 'chatbot' && rec.task !== 'recap') {
      target.otherTasks[rec.task] = (target.otherTasks[rec.task] ?? 0) + 1;
      continue;
    }
    const a = target.answer;
    a.calls++;
    if ((rec.attempt ?? 1) > 1) a.retryCalls++;
    if (rec.failed) a.failed++;
    a.input += rec.inputTokens ?? 0;
    a.cacheWrite += rec.cacheWriteTokens ?? 0;
    a.cacheRead += rec.cacheReadTokens ?? 0;
    a.output += rec.outputTokens ?? 0;
    a.thinking += rec.thinkingTokens ?? 0;
    if (rec.stopReason) a.stops[rec.stopReason] = (a.stops[rec.stopReason] ?? 0) + 1;
    if (usd !== null) a.usd += usd;
  }

  const items = [];
  for (const t of perRow.values()) {
    const r = t.row;
    const ql = queryLogs.get(r.device_id);
    const violations = ql?.harness?.violations;
    const hasViolation = Array.isArray(violations) ? violations.some((v) => Array.isArray(v) ? v.length > 0 : Boolean(v)) : null;
    items.push({
      id: r.id,
      mode: r.mode,
      book: r.book,
      cutoff: r.cutoff,
      category: r.category ?? null,
      question: r.question ?? null,
      error: r.error,
      response_chars: r.response_chars,
      answer_calls: t.answer.calls,
      answer_retry_calls: t.answer.retryCalls,
      input_tokens: t.answer.input,
      cache_write_tokens: t.answer.cacheWrite,
      cache_read_tokens: t.answer.cacheRead,
      output_tokens: t.answer.output,
      thinking_tokens: t.answer.thinking,
      stop_reasons: t.answer.stops,
      embed_calls: t.embed.calls,
      embed_billed_tokens: t.embed.billedTokens,
      embed_unpriced: t.embedNull,
      other_tasks: t.otherTasks,
      answer_krw: t.answer.usd * KRW,
      embed_krw: t.embed.usd * KRW,
      total_krw: (t.answer.usd + t.embed.usd) * KRW,
      // 서버 Query log (챗봇만) — 없으면 null
      query_log_found: Boolean(ql),
      logical_model_calls: ql?.logical_model_calls ?? null,
      harness_intent: ql?.harness?.intent ?? null,
      harness_violations: hasViolation === null ? null : hasViolation,
      harness_violation_kinds: Array.isArray(violations) ? [...new Set(violations.flat())] : null,
      harness_regenerated: ql?.harness?.regenerated ?? null,
      harness_fixed_answer: ql?.harness?.fixed_answer ?? null,
      model: ql?.model ?? null,
      started_at: r.started_at,
      ended_at: r.ended_at,
    });
  }
  return { items, unattributed, ambiguous, unattributedSamples };
}

function summarize(items) {
  const ok = items.filter((i) => !i.error);
  const rate = (pred, base) => (base.length ? base.filter(pred).length / base.length : null);
  const withLog = ok.filter((i) => i.query_log_found);
  return {
    requests: items.length,
    errors: items.length - ok.length,
    total_krw: stats(ok.map((i) => i.total_krw)),
    answer_krw: stats(ok.map((i) => i.answer_krw)),
    embed_krw: stats(ok.map((i) => i.embed_krw)),
    input_tokens: stats(ok.map((i) => i.input_tokens + i.cache_write_tokens + i.cache_read_tokens)),
    output_tokens: stats(ok.map((i) => i.output_tokens)),
    answer_calls: stats(ok.map((i) => i.answer_calls)),
    sum_total_krw: ok.reduce((a, i) => a + i.total_krw, 0),
    // 검사·고정 답변 (챗봇만 해당 — Query log 가 있는 요청 기준)
    query_logs: withLog.length,
    harness_violation_rate: rate((i) => i.harness_violations === true, withLog),
    harness_regenerated_rate: rate((i) => i.harness_regenerated === true, withLog),
    harness_fixed_answer_rate: rate((i) => i.harness_fixed_answer === true, withLog),
    logical_model_calls: stats(withLog.map((i) => i.logical_model_calls)),
    logical_vs_metrics_mismatch: withLog.filter((i) => i.logical_model_calls !== i.answer_calls).length,
    answer_retry_calls: ok.reduce((a, i) => a + i.answer_retry_calls, 0),
  };
}

function groupKey(i, by) {
  if (by === 'mode') return i.mode;
  if (by === 'category') return `${i.mode}/${i.category ?? '-'}`;
  return `${i.mode} ${i.book} ${i.cutoff}쪽`;
}

const f2 = (x) => (x === null ? '—' : x.toFixed(2));
const f0 = (x) => (x === null ? '—' : Math.round(x).toString());
const pct = (x) => (x === null ? '—' : (x * 100).toFixed(0) + '%');

function toMarkdown(result) {
  const lines = [];
  const table = (title, groups) => {
    lines.push(`\n### ${title}`);
    lines.push('| 묶음 | 건수(오류) | 합계 평균 원 | 중앙값 | 최소 | 최대 | 답변 평균 원 | 임베딩 평균 원 | 입력 토큰 평균 | 출력 토큰 평균 | 모델호출 평균 | 검사 걸림 | 재생성 | 고정 답변 |');
    lines.push('|' + ' --- |'.repeat(14));
    for (const [k, s] of Object.entries(groups)) {
      lines.push(
        `| ${k} | ${s.requests}(${s.errors}) | ${f2(s.total_krw.mean)} | ${f2(s.total_krw.median)} | ${f2(s.total_krw.min)} | ${f2(s.total_krw.max)} | ${f2(s.answer_krw.mean)} | ${f2(s.embed_krw.mean)} | ${f0(s.input_tokens.mean)} | ${f0(s.output_tokens.mean)} | ${s.answer_calls.mean === null ? '—' : s.answer_calls.mean.toFixed(2)} | ${pct(s.harness_violation_rate)} | ${pct(s.harness_regenerated_rate)} | ${pct(s.harness_fixed_answer_rate)} |`
      );
    }
  };
  table('모드별', result.by_mode);
  table('모드·책·쪽별', result.by_group);
  if (Object.keys(result.by_category).length) table('모드·범주별(누설 시험)', result.by_category);
  lines.push(
    `\n귀속 점검: 어떤 창에도 안 속한 metrics 줄 ${result.unattributed}건, 창이 겹친 줄 ${result.ambiguous}건, 서버 로그 모델호출수와 metrics 호출수가 다른 요청 ${result.overall.logical_vs_metrics_mismatch}건, 재시도 호출 ${result.overall.answer_retry_calls}건.`
  );
  lines.push(`단가: ${JSON.stringify(PRICES['claude-haiku-5-5'].normal)} USD/1M, 환율 ${KRW}원/USD (aggregate-cost.js 의 PRICES).`);
  return lines.join('\n');
}

function toCsv(items) {
  const cols = ['id', 'mode', 'book', 'cutoff', 'category', 'error', 'response_chars', 'answer_calls', 'answer_retry_calls', 'input_tokens', 'cache_write_tokens', 'cache_read_tokens', 'output_tokens', 'thinking_tokens', 'embed_calls', 'embed_billed_tokens', 'answer_krw', 'embed_krw', 'total_krw', 'logical_model_calls', 'harness_violations', 'harness_regenerated', 'harness_fixed_answer'];
  const esc = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(','), ...items.map((i) => cols.map((c) => esc(i[c])).join(','))].join('\n');
}

function run(opts) {
  const rows = opts.jsonl.flatMap(readJsonl);
  const metrics = readRecords([opts.metrics]);
  const queryLogs = readQueryLogs(opts.serverLog);
  const { items, unattributed, ambiguous, unattributedSamples } = attribute(rows, metrics, queryLogs, opts.slackMs);
  const group = (by) => {
    const m = {};
    for (const i of items) (m[groupKey(i, by)] ??= []).push(i);
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, summarize(v)]));
  };
  return {
    prices: PRICES,
    metrics_records: metrics.length,
    jsonl_rows: rows.length,
    unattributed,
    ambiguous,
    unattributed_samples: unattributedSamples,
    overall: summarize(items),
    by_mode: group('mode'),
    by_group: group('group'),
    by_category: opts.byCategory === false ? {} : Object.fromEntries(Object.entries(group('category')).filter(([k]) => k.startsWith('attacks/'))),
    items,
  };
}

if (require.main === module) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message));
    process.exit(2);
  }
  if (opts.help || opts.jsonl.length === 0 || !opts.metrics) {
    console.error('사용: node scripts/measure/attribute-feature-cost.js --jsonl <a.jsonl> [--jsonl ...] --metrics <metrics.log> [--server-log <server.log>] [--json out.json] [--csv out.csv] [--slack-ms 300]');
    process.exit(opts.help ? 0 : 2);
  }
  const result = run(opts);
  if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(result, null, 2));
  if (opts.csv) fs.writeFileSync(opts.csv, toCsv(result.items));
  console.log(toMarkdown(result));
}

module.exports = { attribute, summarize, readQueryLogs, stats, run };

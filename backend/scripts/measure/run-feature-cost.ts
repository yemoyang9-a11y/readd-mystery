/**
 * 독자 기능 AI 원가 측정 드라이버 (NFR-OBS-004, 2026-11-24 측정용)
 *
 * 로컬 서버(127.0.0.1만)에 챗봇 질문·리캡 요청을 **한 번에 하나씩 순서대로** 보내고, 요청마다 시작·끝 시각을
 * JSONL에 남긴다. 금액은 여기서 계산하지 않는다 — attribute-feature-cost.js 가 서버의 metrics.log 줄을
 * 이 시각 창에 붙여 계산한다. 키·결과 숫자를 담지 않는다.
 *
 * 요청마다 새 기기 ID(UUID)를 쓴다: 분당 3회 호출 제한(디바이스·도서당)과 대화 맥락·리캡 재사용(R8)을 피한다.
 * 기준점 올리기는 run-attacks.ts 와 같다 — POST /progress { page, seq:1, claim:'read_through' } 후 applied_cutoff 확인.
 * 기준점 숫자를 따로 보내는 API는 쓰지 않는다(절대 규칙 8번). 서버 코드는 고치지 않는다.
 *
 * 모드
 *   normal   --questions <json>  [{id?, book, cutoff, question}]  책·쪽이 질문마다 다름
 *   attacks  --attacks <json> --book <id> --cutoff <쪽>           attacks.json 형식 [{id, category, question}]
 *   recap    --targets <book:쪽,book:쪽,...>                      대상마다 새 기기로 POST /recap/stream 1회
 *
 * 사용 (backend 폴더에서)
 *   npx ts-node --transpile-only scripts/measure/run-feature-cost.ts --help
 *   npx ts-node --transpile-only scripts/measure/run-feature-cost.ts --mode normal \
 *     --questions <폴더>/questions-normal.json --out <폴더>/normal.jsonl [--base-url http://127.0.0.1:3100]
 *   --dry-run 은 서버에 아무것도 보내지 않고 계획(요청 수)만 출력한다.
 */
import { randomUUID } from 'crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const DEFAULT_BASE_URL = 'http://127.0.0.1:3100';

interface Item {
  id: string;
  mode: 'normal' | 'attacks' | 'recap';
  book: string;
  cutoff: number;
  question?: string;
  category?: string;
}

interface Row {
  id: string;
  mode: string;
  book: string;
  cutoff: number;
  category?: string;
  question?: string;
  device_id: string;
  item_started_at: string; // 진도 요청 시작
  started_at: string; // 챗봇·리캡 요청 직전 — 시간 창의 시작
  ended_at: string; // SSE 끝까지 받은 뒤 — 시간 창의 끝
  http_status: number | null;
  progress_status: number | null;
  applied_cutoff: number | null;
  response_chars: number;
  delta_count: number;
  first_delta_ms: number | null;
  evidence_count: number;
  follow_up_count: number;
  conversation_id: number | string | null;
  timings_ms: Record<string, number> | null;
  error: string | null;
  response: string;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

function usage(): string {
  return [
    '사용법: run-feature-cost.ts --mode <normal|attacks|recap> --out <결과.jsonl> [옵션]',
    '  --mode normal  --questions <json>             [{id?, book, cutoff, question}]',
    '  --mode attacks --attacks <json> --book <id> --cutoff <쪽>   (attacks.json 형식)',
    '  --mode recap   --targets <book:쪽,book:쪽,...>',
    '  --base-url <URL>   기본 ' + DEFAULT_BASE_URL + ' (127.0.0.1·localhost만 허용)',
    '  --gap-ms <ms>      요청 사이 간격, 기본 1500 (metrics 줄을 시각으로 붙이기 위한 여유)',
    '  --only <id,id,..>  이 id만 실행 (재개용)   --skip-done  --out 에 이미 있는 id는 건너뜀',
    '  --limit <N>        앞에서 N개만   --dry-run  서버에 보내지 않고 계획만 출력',
  ].join('\n');
}

function assertLocal(baseUrl: string): void {
  const host = new URL(baseUrl).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new Error(`로컬 서버만 허용합니다 (받은 호스트: ${host})`);
}

function positiveInt(value: string | undefined, label: string): number {
  if (!value || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}는 1 이상의 정수여야 합니다`);
  return Number(value);
}

function buildItems(mode: string): Item[] {
  if (mode === 'normal') {
    const file = argValue('questions');
    if (!file) throw new Error('--questions 가 필요합니다');
    const list = JSON.parse(readFileSync(file, 'utf8')) as Array<{
      id?: string;
      book: string;
      cutoff: number;
      question: string;
    }>;
    return list.map((q, i) => ({
      id: q.id ?? `N${String(i + 1).padStart(2, '0')}`,
      mode: 'normal' as const,
      book: q.book,
      cutoff: positiveInt(String(q.cutoff), 'cutoff'),
      question: q.question,
    }));
  }
  if (mode === 'attacks') {
    const file = argValue('attacks');
    const book = argValue('book');
    if (!file || !book) throw new Error('--attacks 와 --book 이 필요합니다');
    const cutoff = positiveInt(argValue('cutoff'), '--cutoff');
    const list = JSON.parse(readFileSync(file, 'utf8')) as Array<{
      id: string;
      category: string;
      question: string;
    }>;
    // 같은 질문을 쪽 위치별로 돌려도 id가 겹치지 않게 책·쪽을 붙인다
    return list.map((a) => ({
      id: `${a.id}@${book}:${cutoff}`,
      mode: 'attacks' as const,
      book,
      cutoff,
      question: a.question,
      category: a.category,
    }));
  }
  if (mode === 'recap') {
    const targets = argValue('targets');
    if (!targets) throw new Error('--targets 가 필요합니다 (예: gasangbeomin:20,main:160)');
    return targets.split(',').map((t, i) => {
      const [book, cutoff] = t.trim().split(':');
      if (!book || !cutoff) throw new Error(`--targets 형식 오류: ${t}`);
      return {
        id: `R${String(i + 1).padStart(2, '0')}@${book}:${cutoff}`,
        mode: 'recap' as const,
        book,
        cutoff: positiveInt(cutoff, 'targets 쪽'),
      };
    });
  }
  throw new Error(`알 수 없는 --mode: ${mode}\n${usage()}`);
}

interface StreamResult {
  text: string;
  deltaCount: number;
  firstDeltaMs: number | null;
  appliedCutoff: number | null;
  conversationId: number | string | null;
  timings: Record<string, number> | null;
  evidenceCount: number;
  followUpCount: number;
  error: string | null;
}

/** SSE 응답을 끝까지 받는다. 프레임: delta · evidence · follow_ups · done · error */
async function readStream(response: Response, startedMs: number): Promise<StreamResult> {
  const result: StreamResult = {
    text: '',
    deltaCount: 0,
    firstDeltaMs: null,
    appliedCutoff: null,
    conversationId: null,
    timings: null,
    evidenceCount: 0,
    followUpCount: 0,
    error: null,
  };
  const handle = (block: string): void => {
    const line = block.split('\n').find((candidate) => candidate.startsWith('data: '));
    if (!line) return;
    const frame = JSON.parse(line.slice(6)) as Record<string, unknown>;
    switch (frame.type) {
      case 'delta':
        if (result.firstDeltaMs === null) result.firstDeltaMs = Date.now() - startedMs;
        result.deltaCount++;
        result.text += String(frame.text ?? '');
        break;
      case 'evidence':
        result.evidenceCount = Array.isArray(frame.items) ? frame.items.length : 0;
        break;
      case 'follow_ups':
        result.followUpCount = Array.isArray(frame.questions) ? frame.questions.length : 0;
        break;
      case 'done':
        result.appliedCutoff = typeof frame.applied_cutoff === 'number' ? frame.applied_cutoff : null;
        result.conversationId = (frame.conversation_id as number | string | undefined) ?? null;
        result.timings = (frame.timings_ms as Record<string, number> | undefined) ?? null;
        break;
      case 'error':
        result.error = String(frame.message ?? 'stream error');
        break;
    }
  };
  const reader = response.body?.getReader();
  if (!reader) return { ...result, error: 'no response body' };
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      handle(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
    }
  }
  if (buffer.trim()) handle(buffer);
  return result;
}

async function runItem(baseUrl: string, item: Item): Promise<Row> {
  const deviceId = randomUUID();
  const headers = { 'Content-Type': 'application/json', 'X-Device-Id': deviceId };
  const row: Row = {
    id: item.id,
    mode: item.mode,
    book: item.book,
    cutoff: item.cutoff,
    category: item.category,
    question: item.question,
    device_id: deviceId,
    item_started_at: new Date().toISOString(),
    started_at: '',
    ended_at: '',
    http_status: null,
    progress_status: null,
    applied_cutoff: null,
    response_chars: 0,
    delta_count: 0,
    first_delta_ms: null,
    evidence_count: 0,
    follow_up_count: 0,
    conversation_id: null,
    timings_ms: null,
    error: null,
    response: '',
  };
  try {
    // FR-PRG-003 🚦 — run-attacks.ts 와 같은 방식: 1 ~ cutoff 를 읽음으로 인정받는다(claim=read_through).
    const progress = await fetch(`${baseUrl}/books/${item.book}/progress`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ page: item.cutoff, seq: 1, claim: 'read_through' }),
    });
    row.progress_status = progress.status;
    if (!progress.ok) {
      row.error = `progress ${progress.status}`;
      return row;
    }
    const accepted = (await progress.json()) as { applied_cutoff?: number };
    row.applied_cutoff = accepted.applied_cutoff ?? null;
    // 기준점이 요청과 다르면 이 측정의 전제가 틀어지므로 LLM을 부르지 않는다
    if (accepted.applied_cutoff !== item.cutoff) {
      row.error = `progress applied_cutoff ${accepted.applied_cutoff} != ${item.cutoff}`;
      return row;
    }

    const startedMs = Date.now();
    row.started_at = new Date(startedMs).toISOString();
    const response =
      item.mode === 'recap'
        ? await fetch(`${baseUrl}/books/${item.book}/recap/stream`, {
            method: 'POST',
            headers,
            body: JSON.stringify({}),
          })
        : await fetch(`${baseUrl}/books/${item.book}/chat`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query: item.question }),
          });
    row.http_status = response.status;
    if (!response.ok) {
      row.ended_at = new Date().toISOString();
      row.error = `${item.mode === 'recap' ? 'recap' : 'chat'} ${response.status}`;
      return row;
    }
    const stream = await readStream(response, startedMs);
    row.ended_at = new Date().toISOString();
    row.response = stream.text;
    row.response_chars = stream.text.length;
    row.delta_count = stream.deltaCount;
    row.first_delta_ms = stream.firstDeltaMs;
    row.evidence_count = stream.evidenceCount;
    row.follow_up_count = stream.followUpCount;
    row.conversation_id = stream.conversationId;
    row.timings_ms = stream.timings;
    if (stream.appliedCutoff !== null) row.applied_cutoff = stream.appliedCutoff;
    row.error = stream.error;
  } catch (error) {
    if (!row.started_at) row.started_at = row.item_started_at;
    row.ended_at = new Date().toISOString();
    row.error = error instanceof Error ? error.message : String(error);
  }
  return row;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  if (hasFlag('help') || hasFlag('h')) {
    console.log(usage());
    return;
  }
  const mode = argValue('mode');
  const out = argValue('out');
  if (!mode || !out) throw new Error(usage());
  const baseUrl = argValue('base-url') ?? DEFAULT_BASE_URL;
  assertLocal(baseUrl);
  const gapMs = argValue('gap-ms') ? Number(argValue('gap-ms')) : 1500;

  let items = buildItems(mode);
  const only = argValue('only');
  if (only) {
    const ids = new Set(only.split(',').map((s) => s.trim()));
    items = items.filter((i) => ids.has(i.id));
  }
  if (hasFlag('skip-done') && existsSync(out)) {
    const done = new Set(
      readFileSync(out, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => (JSON.parse(l) as { id: string; error: string | null }).id)
    );
    items = items.filter((i) => !done.has(i.id));
  }
  const limit = argValue('limit');
  if (limit) items = items.slice(0, Number(limit));

  console.log(`mode=${mode} 요청 ${items.length}건, 간격 ${gapMs}ms, 서버 ${baseUrl}, 결과 ${out}`);
  if (hasFlag('dry-run')) {
    const byGroup = new Map<string, number>();
    for (const i of items) byGroup.set(`${i.book}:${i.cutoff}`, (byGroup.get(`${i.book}:${i.cutoff}`) ?? 0) + 1);
    for (const [k, n] of byGroup) console.log(`  ${k} ${n}건`);
    console.log('--dry-run: 서버에 아무것도 보내지 않았습니다');
    return;
  }
  if (!existsSync(out)) writeFileSync(out, '');

  let failures = 0;
  for (const [index, item] of items.entries()) {
    const row = await runItem(baseUrl, item);
    appendFileSync(out, JSON.stringify(row) + '\n');
    if (row.error) failures++;
    console.log(
      `[${index + 1}/${items.length}] ${row.id} ${row.error ? `ERROR(${row.error})` : `ok ${row.response_chars}자`}`
    );
    if (index < items.length - 1) await sleep(gapMs);
  }
  console.log(`완료: ${items.length}건, 오류 ${failures}건`);
  process.exitCode = failures > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

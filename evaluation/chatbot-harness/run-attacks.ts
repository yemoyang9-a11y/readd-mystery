import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { detectLeaks, type AnswerKey, type Leak } from './leak-detector';

interface Attack {
  id: string;
  category: string;
  question: string;
}

interface AttackResult {
  id: string;
  category: string;
  question: string;
  response: string;
  applied_cutoff: number | null;
  error?: string;
  leaks: Leak[];
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function defaultBaseUrl(): string {
  let port = '3000';
  try {
    const envText = readFileSync(resolve(__dirname, '../../backend/.env'), 'utf8');
    const match = /^PORT=(\d+)\s*$/m.exec(envText);
    if (match) port = match[1];
  } catch {
    port = '3000';
  }
  return `http://127.0.0.1:${port}`;
}

function assertLocal(baseUrl: string): void {
  const host = new URL(baseUrl).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`로컬 서버만 허용합니다 (받은 호스트: ${host})`);
  }
}

async function readChat(
  response: Response
): Promise<{ text: string; appliedCutoff: number | null; error?: string }> {
  const raw = await response.text();
  let text = '';
  let appliedCutoff: number | null = null;
  let error: string | undefined;
  for (const block of raw.split('\n\n')) {
    const line = block.split('\n').find((candidate) => candidate.startsWith('data: '));
    if (!line) continue;
    const frame = JSON.parse(line.slice(6)) as {
      type: string;
      text?: string;
      applied_cutoff?: number;
      message?: string;
    };
    if (frame.type === 'delta') text += frame.text ?? '';
    if (frame.type === 'done') appliedCutoff = frame.applied_cutoff ?? null;
    if (frame.type === 'error') error = frame.message ?? 'stream error';
  }
  return { text, appliedCutoff, error };
}

async function runAttack(
  baseUrl: string,
  bookId: string,
  cutoff: number,
  attack: Attack,
  key: AnswerKey
): Promise<AttackResult> {
  const deviceId = randomUUID();
  const headers = { 'Content-Type': 'application/json', 'X-Device-Id': deviceId };
  const base: AttackResult = {
    id: attack.id,
    category: attack.category,
    question: attack.question,
    response: '',
    applied_cutoff: null,
    leaks: [],
  };
  try {
    const progress = await fetch(`${baseUrl}/books/${bookId}/progress`, {
      method: 'POST',
      headers,
      // FR-PRG-003 🚦 — 2026-11-17부터 기준점은 차례로 읽은 쪽이다. page만 보내면 읽음 인정이
      // 없어 K=0이 된다. 목차 확인 창의 "앞부분은 이미 읽었어요"와 같은 선택(claim)을 보낸다.
      // 기준점 숫자는 보내지 않는다(절대 규칙 8번) — 서버가 1 ~ page를 읽음으로 인정한다.
      body: JSON.stringify({ page: cutoff, seq: 1, claim: 'read_through' }),
    });
    if (!progress.ok) return { ...base, error: `progress ${progress.status}` };
    // 서버가 인정한 기준점이 요청과 다르면 이 공격의 판정 기준이 틀어지므로 질문하지 않는다.
    const accepted = (await progress.json()) as { applied_cutoff?: number };
    if (accepted.applied_cutoff !== cutoff) {
      return { ...base, error: `progress applied_cutoff ${accepted.applied_cutoff} != ${cutoff}` };
    }

    const chat = await fetch(`${baseUrl}/books/${bookId}/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: attack.question }),
    });
    if (!chat.ok) return { ...base, error: `chat ${chat.status}` };

    const { text, appliedCutoff, error } = await readChat(chat);
    return {
      ...base,
      response: text,
      applied_cutoff: appliedCutoff,
      error,
      leaks: detectLeaks(text, { cutoff: appliedCutoff ?? cutoff, key }),
    };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const bookId = argValue('book');
  const cutoffArg = argValue('cutoff');
  if (!bookId || !cutoffArg || !/^[1-9]\d*$/.test(cutoffArg)) {
    throw new Error(
      '사용법: run-attacks.ts --book <id> --cutoff <쪽수> [--base-url <로컬 URL>] [--key <파일>] [--attacks <파일>]'
    );
  }
  const cutoff = Number(cutoffArg);
  const baseUrl = argValue('base-url') ?? defaultBaseUrl();
  assertLocal(baseUrl);

  const key = JSON.parse(
    readFileSync(argValue('key') ?? join(__dirname, 'answer-key.local.json'), 'utf8')
  ) as AnswerKey;
  const attacks = JSON.parse(
    readFileSync(argValue('attacks') ?? join(__dirname, 'attacks.json'), 'utf8')
  ) as Attack[];

  const results: AttackResult[] = [];
  for (const attack of attacks) {
    const result = await runAttack(baseUrl, bookId, cutoff, attack, key);
    results.push(result);
    const status = result.error ? `ERROR(${result.error})` : result.leaks.length ? 'LEAK' : 'ok';
    console.log(`${attack.id} [${attack.category}] ${status}`);
  }

  const leaked = results.filter((result) => result.leaks.length > 0);
  const errored = results.filter((result) => result.error);
  const outDir = join(__dirname, 'results');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${bookId}-cutoff${cutoff}-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(results, null, 2));

  console.log(
    `\n총 ${results.length}건, 누출 ${leaked.length}건, 오류 ${errored.length}건\n결과: ${outPath}`
  );
  process.exitCode = leaked.length > 0 || errored.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

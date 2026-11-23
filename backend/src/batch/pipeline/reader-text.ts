import { call } from '../../modules/llm-gateway/gateway';
import { parseJsonResponse } from './generate';

export interface ReaderTextInput {
  key: string;
  kind: 'relationship' | 'event';
  text: string;
  names: string[];
}

const BATCH_SIZE = 30;
const MAX_LENGTH = 60;
const MAX_TOKENS = 16000;
const JSON_PARSE_RETRIES = 2;
const META_WORDS = ['원문', '본문', '작품에서', '서술', '페이지', '텍스트', '입력', '인용', '요약'];
const EASY_ENDING = /요\.?$/u;

// NFR-AI-004
export function buildReaderTextPrompt(items: ReaderTextInput[]): string {
  const payload = items.map(({ key, kind, text, names }) => ({ key, kind, text, names }));
  return `아래 문장들을 읽는 사람이 바로 이해할 쉬운 한국어로 다시 써라.

규칙:
- 모든 문장은 해요체로 끝낸다(예: ~예요, ~해요, ~이에요).
- 쉬운 말로 짧게, 한 문장당 ${MAX_LENGTH}자 이하로 쓴다.
- 입력 문장에 없는 사실, 추측, 판정을 더하지 않는다.
- 원문, 본문, 페이지, 텍스트를 언급하지 않는다.
- kind가 relationship이면 names의 이름을 모두 문장에 그대로 넣는다.
- 입력의 key를 그대로 돌려준다.

출력은 설명 없이 JSON 객체 하나만: {"items":[{"key":"...","text":"..."}]}

입력:
${JSON.stringify(payload, null, 2)}`;
}

// R9
export function validateReaderText(input: ReaderTextInput, out: string): boolean {
  const text = out.trim();
  return (
    text.length > 0 &&
    text.length <= MAX_LENGTH &&
    EASY_ENDING.test(text) &&
    input.names.every((name) => text.includes(name)) &&
    !META_WORDS.some((word) => text.includes(word))
  );
}

async function rewriteBatch(batch: ReaderTextInput[]): Promise<{ key: string; text: string }[]> {
  const prompt = buildReaderTextPrompt(batch);
  for (let attempt = 1; ; attempt++) {
    const raw = await call('rewrite_reader_text', prompt, { maxTokens: MAX_TOKENS, attempt }); // NFR-OBS-004 (측정)
    try {
      const parsed = parseJsonResponse<{ items?: { key: string; text: string }[] }>(raw);
      return Array.isArray(parsed.items) ? parsed.items : [];
    } catch (err) {
      if (attempt > JSON_PARSE_RETRIES) throw err;
      console.warn(`[JSON 재시도] task=rewrite_reader_text 시도=${attempt + 1}`);
    }
  }
}

// R9
export async function rewriteReaderTexts(items: ReaderTextInput[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const byKey = new Map(batch.map((item) => [item.key, item]));
    for (const out of await rewriteBatch(batch)) {
      const input = typeof out?.key === 'string' ? byKey.get(out.key) : undefined;
      if (input && typeof out.text === 'string' && validateReaderText(input, out.text)) {
        result.set(input.key, out.text.trim());
      }
    }
  }
  return result;
}

export const relationshipReaderKey = (id: string): string => `rel:${id}`;
export const eventReaderKey = (id: string): string => `evt:${id}`;

export function relationshipReaderInput(
  id: string,
  summary: string,
  nameA: string | undefined,
  nameB: string | undefined
): ReaderTextInput | undefined {
  if (!nameA || !nameB) return undefined;
  return {
    key: relationshipReaderKey(id),
    kind: 'relationship',
    text: summary,
    names: [...new Set([nameA, nameB])],
  };
}

export function eventReaderInput(id: string, description: string): ReaderTextInput {
  return { key: eventReaderKey(id), kind: 'event', text: description, names: [] };
}

const MIN_NAME_LENGTH = 2;

/**
 * 고유명사 사전 — 인물 대표명과 이름·별명 별칭. 직함·가족 호칭은 일반 명사라 제외하고,
 * 한 글자 표기는 다른 낱말 속에서 오탐하므로 뺀다. NFR-AI-004
 */
export function readerNameLexicon(
  characters: { name: string; aliases?: { alias: string; type: string }[] }[]
): string[] {
  const names = characters.flatMap((c) => [
    c.name,
    ...(c.aliases ?? [])
      .filter((a) => a.type === 'name' || a.type === 'nickname')
      .map((a) => a.alias),
  ]);
  return [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= MIN_NAME_LENGTH))];
}

/** 독자용 문장에 원래 문장에 없던 고유명사가 새로 생겼는지 — 생긴 이름 목록. NFR-AI-004 */
export function introducedNames(source: string, rewritten: string, lexicon: string[]): string[] {
  return lexicon.filter((name) => rewritten.includes(name) && !source.includes(name));
}

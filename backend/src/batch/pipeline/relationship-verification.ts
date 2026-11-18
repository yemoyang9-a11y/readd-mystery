import { Page, RelationshipSemantics } from '../../shared/types';
import { GroundedRelationship } from './grounding';
import { locateQuote } from './quote-locator';
import { hasLabelMention } from './semantic-guards';

const WINDOW_CHARS = 200;

export type RelationshipCheck = 'confirmed' | 'needs_review' | 'held';

export interface VerifierCharacter {
  id: string;
  name: string;
  first_appearance_page: number;
  aliases: { alias: string; first_appearance_page: number }[];
}

export interface VerifierInput {
  from: string;
  to: string;
  label: string;
  direction: RelationshipSemantics['direction'];
  quote: string;
  context: string;
  fromAliases: string[];
  toAliases: string[];
  /** 관계 유형 표의 정의(relationship-taxonomy.ts) — 있으면 검토자가 유형 기준으로 본다 */
  definition?: string;
}

export interface VerifierAnswer {
  supports: boolean;
  why: string;
}

export interface VerifiedRelationship {
  relationship: GroundedRelationship;
  check: RelationshipCheck;
  reasons: string[];
  runs_agreed: number;
  verifier_why?: string;
}

export interface VerifyOptions {
  secondRun?: GroundedRelationship[];
  verifier?: (input: VerifierInput) => Promise<VerifierAnswer>;
}

function compactLength(text: string): number {
  return [...text.replace(/\s+/gu, '')].length;
}

// FR-CHR-001 🚦
export function endpointForms(
  target: VerifierCharacter,
  all: VerifierCharacter[],
  page: number
): string[] {
  const rawForms = (c: VerifierCharacter): string[] => {
    const forms = [c.name.trim()];
    if (/^[가-힣]{3}$/u.test(c.name.trim())) forms.push(c.name.trim().slice(1));
    for (const a of c.aliases)
      if (a.first_appearance_page <= page && compactLength(a.alias) >= 2)
        forms.push(a.alias.trim());
    return forms;
  };
  const owners = new Map<string, Set<string>>();
  for (const c of all) {
    if (c.first_appearance_page > page) continue;
    for (const form of rawForms(c)) {
      if (!owners.has(form)) owners.set(form, new Set());
      owners.get(form)!.add(c.id);
    }
  }
  return [...new Set(rawForms(target))].filter((form) => {
    const set = owners.get(form);
    return set !== undefined && set.size === 1 && set.has(target.id);
  });
}

function resolveName(
  name: string,
  lexicon: VerifierCharacter[],
  page: number
): VerifierCharacter | undefined {
  const text = name.trim();
  const byName = lexicon.filter((c) => c.name.trim() === text && c.first_appearance_page <= page);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) return undefined;
  const byAlias = lexicon.filter((c) =>
    c.aliases.some((a) => a.alias.trim() === text && a.first_appearance_page <= page)
  );
  return byAlias.length === 1 ? byAlias[0] : undefined;
}

function orientedKey(r: GroundedRelationship, a: string, b: string): string {
  const s = r.semantics;
  const direction = s?.direction ?? 'unknown';
  const pair =
    direction === 'a_to_b'
      ? `${a}>${b}`
      : direction === 'b_to_a'
        ? `${b}>${a}`
        : [a, b].sort().join('~');
  return `${pair}|${s?.kind ?? ''}|${direction === 'a_to_b' || direction === 'b_to_a' ? 'directed' : direction}`;
}

function locate(page: Page, evidence: GroundedRelationship['evidence']) {
  if (page.content.slice(evidence.start_char, evidence.end_char) === evidence.quote)
    return { start: evidence.start_char, end: evidence.end_char };
  return locateQuote(page.content, evidence.quote);
}

// NFR-AI-004
export function buildVerifierPrompt(input: VerifierInput): string {
  const direction =
    input.direction === 'a_to_b' || input.direction === 'b_to_a'
      ? `방향: "${input.from}"이(가) 주체, "${input.to}"이(가) 대상이다.`
      : `방향: 두 사람 사이에 방향이 없거나 서로에게 해당한다(${input.direction}).`;
  return `너는 소설에서 추출한 인물 관계가 틀렸다는 입장에서 검토하는 반대 검토자다.
아래 원문 인용이 주어진 관계와 방향을 뒷받침하는지만 판단하라. 작품이나 장르에 대한 기억으로 보충하지 마라.

검토할 진술
- 주체: ${input.from}
- 대상: ${input.to}
- 관계 문구: ${input.label}
${input.definition ? `- 관계 유형 정의: ${input.definition}\n` : ''}${direction}
진술은 "주체가 대상에 대해 관계 문구의 일을 한다/그런 사이다"로 읽는다.

인용:
${input.quote}

이 작품에서 근거와 함께 등록된 호칭(인용 속 호칭이 누구인지 확인하는 용도):
${input.from}: ${input.fromAliases.join(', ') || '(없음)'}
${input.to}: ${input.toAliases.join(', ') || '(없음)'}

문맥(화자와 지시어를 확인하는 용도로만 쓴다):
${input.context}

다음 중 하나라도 해당하면 supports는 false다.
- 인용이 이 관계를 말하지 않거나 다른 관계를 말한다.
- 인용에서 관계 문구의 일을 하는 사람이 주체가 아니거나, 그 일을 받는 사람이 대상이 아니다(주체와 대상이 반대인 경우 포함).
- 관계 문구가 두 사람 사이의 관계로 읽히지 않는다(한 사람의 사건만 말하거나, 문구가 모호하다).
- 인용 속 인물이 두 사람이 아니거나 누구인지 문맥으로도 확인되지 않는다.
- 계획·추측·거짓말·소문·부정인데 사실처럼 적혀 있다.

출력은 JSON 객체 하나만 반환한다.
{"supports": true 또는 false, "why": "한 문장 이유"}`;
}

// FR-CHR-001 🚦, NFR-AI-004
export async function verifyRelationships(
  candidates: GroundedRelationship[],
  pages: Page[],
  lexicon: VerifierCharacter[],
  options: VerifyOptions = {}
): Promise<VerifiedRelationship[]> {
  const secondKeys = new Set<string>();
  for (const r of options.secondRun ?? []) {
    const a = resolveName(r.character_a, lexicon, r.established_page);
    const b = resolveName(r.character_b, lexicon, r.established_page);
    if (a && b && a.id !== b.id) secondKeys.add(orientedKey(r, a.id, b.id));
  }

  const out: VerifiedRelationship[] = [];
  for (const r of candidates) {
    const reasons: string[] = [];
    const page = pages.find((p) => p.page_no === r.evidence.source_page);
    const spot = page ? locate(page, r.evidence) : undefined;
    if (!page || !spot) reasons.push('quote_not_found');
    if (r.established_page < r.evidence.source_page) reasons.push('established_before_quote');
    if (r.established_page > r.evidence.source_page) reasons.push('established_after_quote');

    const a = resolveName(r.character_a, lexicon, r.evidence.source_page);
    const b = resolveName(r.character_b, lexicon, r.evidence.source_page);
    let context = '';
    if (page && spot) {
      context = page.content.slice(
        Math.max(0, spot.start - WINDOW_CHARS),
        Math.min(page.content.length, spot.end + WINDOW_CHARS)
      );
      const near = (c: VerifierCharacter | undefined): boolean =>
        c !== undefined &&
        endpointForms(c, lexicon, r.evidence.source_page).some((form) =>
          hasLabelMention(context, form)
        );
      if (!near(a) || !near(b)) reasons.push('endpoint_not_near_quote');
    }
    if (reasons.length > 0) {
      out.push({ relationship: r, check: 'held', reasons, runs_agreed: 1 });
      continue;
    }

    const agreed = a && b && secondKeys.has(orientedKey(r, a.id, b.id));
    const result: VerifiedRelationship = {
      relationship: r,
      check: agreed ? 'confirmed' : 'needs_review',
      reasons: agreed ? [] : ['single_run'],
      runs_agreed: agreed ? 2 : 1,
    };
    if (options.verifier) {
      const direction = r.semantics?.direction ?? 'unknown';
      const reversed = direction === 'b_to_a';
      try {
        const forms = (c: VerifierCharacter | undefined): string[] =>
          c ? endpointForms(c, lexicon, r.evidence.source_page).filter((f) => f !== c.name) : [];
        const fromChar = reversed ? b : a;
        const toChar = reversed ? a : b;
        const answer = await options.verifier({
          from: reversed ? r.character_b : r.character_a,
          to: reversed ? r.character_a : r.character_b,
          fromAliases: forms(fromChar),
          toAliases: forms(toChar),
          label: r.label,
          direction,
          quote: r.evidence.quote,
          context,
        });
        if (typeof answer.supports !== 'boolean') throw new Error('verifier answer malformed');
        if (!answer.supports) {
          result.check = 'held';
          result.reasons = ['verifier_rejected'];
          result.verifier_why = answer.why;
        }
      } catch {
        result.check = 'needs_review';
        result.reasons = [...result.reasons, 'verifier_error'];
      }
    }
    out.push(result);
  }
  return out;
}

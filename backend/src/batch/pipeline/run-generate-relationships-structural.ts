/**
 * 논문 기반 인물 관계 추출 실행기 — FR-CHR-001 🚦, FR-DAT-005, R9(배치 전용), R12(검수 전 비공개)
 *
 * 1) 인물·별칭: 기존 추출 결과를 그대로 쓴다(책 전체는 run-generate-full의 all-resolved.json,
 *    또는 --characters로 준 인물 JSON — 예: 운영 DB의 인물·별칭).
 * 2) 장마다 구조적 상호작용 후보를 결정적으로 만든다(interaction-candidates.ts, LLM 0회).
 * 3) 후보가 있는 장만 게이트웨이(⑥)로 관계 질문지 답을 두 번 받는다(자기 일관성). 입력은 근거 창과 관계 유형 표뿐이다.
 *    2026-11-18 대표 지시: API 키가 아니라 Claude 구독(Claude Code CLI)으로 — 작업 이름 generate_relationship*.
 * 4) 결정적 검사·유형 표 파생·확립 페이지 결정(relationship-labeling.ts), 선택적으로 반대 검토자(--verifier).
 * DB에 쓰지 않는다. 결과는 검수 후보다 — 교체·공개는 기존 검수/교체 절차(docs/relationship-pipeline.md).
 *
 * 사용법 (backend/ 에서, 이 컴퓨터에 `claude` 로그인 필요 — API 키 없음):
 *  (A) 발췌 입력 — JSON(book_id, source, known_character_names, chapters, pages).
 *      선택 필드 characters: [{name, first_appearance_page, aliases:[{alias, first_appearance_page}]}]
 *      npx ts-node --transpile-only src/batch/pipeline/run-generate-relationships-structural.ts \
 *        --input ../evaluation/relationships/model-inputs/takryu-p91.json --out data/generated/structural/takryu-p91
 *  (B) 책 전체 — 인물은 data/generated/<book>/full/all-resolved.json, 또는 --characters <인물 JSON>
 *      npx ts-node --transpile-only src/batch/pipeline/run-generate-relationships-structural.ts \
 *        --book gasangbeomin --file data/raw/gasangbeomin.txt [--characters chars.json] [--verifier] [--candidates-only]
 *  --candidates-only: LLM을 부르지 않는다. 후보와 (B) 기존 관계와의 비교만 쓴다.
 *  모델·시간 제한: CLAUDE_CLI_MODEL(기본 opus), CLAUDE_CLI_TIMEOUT_MS, CLAUDE_CLI_MAX_ATTEMPTS
 */
import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { Chapter, Page } from '../../shared/types';
import { splitBook } from './split';
import { parseBookArgs } from './run-args';
import {
  AccumulatedCharacter,
  AccumulatedRelationship,
  createEmptyState,
  mergeRelationships,
} from './accumulate';
import {
  CandidateCharacter,
  InteractionCandidate,
  generateInteractionCandidates,
} from './interaction-candidates';
import {
  FinalStructuredRelationship,
  HeldLabel,
  STRUCTURAL_LABEL_VERSION,
  runStructuralChapter,
  uncoveredCharacters,
} from './relationship-labeling';
import {
  CallStats,
  GatewayCall,
  cachedLabeler,
  cachedVerifier,
  emptyCallStats,
  lexiconFromAccumulated,
  structuralContract,
} from './relationship-structural-calls';

/** 관계 0건 인물 검수 문턱 — 다른 인물과 근거 창이 이만큼 이상이면 올린다(보고용, 관계를 버리거나 만들지 않음) */
const UNCOVERED_MIN_WINDOWS = 10;

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

interface CharacterInput {
  name: string;
  first_appearance_page: number;
  aliases?: { alias: string; first_appearance_page: number }[];
}

interface SourceInput {
  book_id: string;
  source: unknown;
  known_character_names: string[];
  characters?: CharacterInput[];
  chapters: Chapter[];
  pages: Page[];
}

/** 인물 JSON(이름·첫 등장 쪽·별칭) → 후보 사전. id는 대표명 */
function lexiconFromInput(characters: CharacterInput[]): CandidateCharacter[] {
  return characters.map((c) => ({
    id: c.name,
    name: c.name,
    first_appearance_page: c.first_appearance_page,
    aliases: (c.aliases ?? []).map((a) => ({
      alias: a.alias,
      first_appearance_page: a.first_appearance_page,
    })),
  }));
}

/** 게이트웨이(⑥)는 라벨을 실제로 받을 때만 불러온다 — --candidates-only는 CLI 없이 돈다 */
async function gateway(): Promise<{ call: GatewayCall; contract: string }> {
  const { call } = await import('../../modules/llm-gateway/gateway');
  return { call, contract: structuralContract() };
}
function summarizeCandidates(chapterNo: number, candidates: InteractionCandidate[]) {
  return candidates.map((c) => ({
    chapter_no: chapterNo,
    pair: [c.a_name, c.b_name],
    first_page: c.first_page,
    weight: c.weight,
    windows: c.windows.map((w) => ({ id: w.id, kind: w.kind, page_no: w.page_no })),
  }));
}

/** (B) 기존(LLM이 쌍을 고른) 관계와 비교 — LLM 0회. 확립 페이지가 그 쌍의 첫 구조적 근거보다 이른 행을 센다 */
function compareWithExisting(
  existing: AccumulatedRelationship[],
  candidates: InteractionCandidate[],
  names: Map<string, string>
) {
  const firstPage = new Map<string, number>();
  for (const c of candidates) {
    const key = [c.a_id, c.b_id].sort().join('|');
    firstPage.set(key, Math.min(firstPage.get(key) ?? Infinity, c.first_page));
  }
  const rows = existing.map((r) => {
    const first = firstPage.get([r.character_a_id, r.character_b_id].sort().join('|'));
    return {
      id: r.id,
      pair: [names.get(r.character_a_id), names.get(r.character_b_id)],
      label: r.label,
      established_page: r.established_page,
      first_structural_page: first ?? null,
      status:
        first === undefined
          ? 'no_structural_evidence'
          : r.established_page < first
            ? 'established_before_first_cooccurrence'
            : 'ok',
    };
  });
  return {
    counts: {
      existing: rows.length,
      no_structural_evidence: rows.filter((r) => r.status === 'no_structural_evidence').length,
      established_before_first_cooccurrence: rows.filter(
        (r) => r.status === 'established_before_first_cooccurrence'
      ).length,
    },
    rows,
  };
}

export async function runStructuralRelationships(argv: string[] = process.argv.slice(2)) {
  const input = flag(argv, '--input');
  const candidatesOnly = argv.includes('--candidates-only');
  const useVerifier = argv.includes('--verifier');
  let bookId: string;
  let pages: Page[];
  let chapters: Chapter[];
  let lexicon: CandidateCharacter[];
  let resolved: Record<string, unknown> | undefined;
  let outDir: string;
  if (input) {
    const src = JSON.parse(fs.readFileSync(input, 'utf8')) as SourceInput;
    bookId = src.book_id;
    pages = src.pages;
    chapters = src.chapters;
    lexicon = src.characters
      ? lexiconFromInput(src.characters)
      : src.known_character_names.map((name) => ({
          id: name,
          name,
          first_appearance_page: 1,
          aliases: [],
        }));
    outDir = flag(argv, '--out') ?? path.join('data/generated/structural', bookId);
  } else {
    const args = parseBookArgs(argv);
    bookId = args.bookId;
    const charactersPath = flag(argv, '--characters');
    if (charactersPath) {
      // 인물·별칭을 직접 준다(예: 운영 DB에서 읽은 값). 기존 관계와의 비교는 하지 않는다
      lexicon = lexiconFromInput(JSON.parse(fs.readFileSync(charactersPath, 'utf8')));
    } else {
      const resolvedPath = path.join(args.fullDir, 'all-resolved.json');
      if (!fs.existsSync(resolvedPath))
        throw new Error(
          `${resolvedPath} 없음 — 인물·별칭은 run-generate-full 결과나 --characters <인물 JSON>을 쓴다`
        );
      resolved = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
      lexicon = lexiconFromAccumulated(resolved!.characters as AccumulatedCharacter[]);
    }
    ({ pages, chapters } = splitBook(fs.readFileSync(args.filePath, 'utf8'), bookId));
    outDir = flag(argv, '--out') ?? path.join(args.generatedDir, 'structural-relationships');
  }
  fs.mkdirSync(outDir, { recursive: true });
  const llm = candidatesOnly ? undefined : await gateway();
  const names = new Map(lexicon.map((c) => [c.id, c.name]));
  const state = createEmptyState(bookId);
  if (resolved) state.characters = resolved.characters as AccumulatedCharacter[];
  const allCandidates: InteractionCandidate[] = [];
  const candidateSummary: ReturnType<typeof summarizeCandidates> = [];
  const accepted: (FinalStructuredRelationship & { chapter_no: number })[] = [];
  const held: (HeldLabel & { chapter_no: number })[] = [];
  let llmChapters = 0;
  const stats: CallStats = emptyCallStats();
  const started = Date.now();
  for (const chapter of [...chapters].sort((a, b) => a.start_page - b.start_page)) {
    const chapterPages = pages.filter(
      (p) => p.page_no >= chapter.start_page && p.page_no <= chapter.end_page
    );
    const candidates = generateInteractionCandidates(chapterPages, lexicon);
    allCandidates.push(...candidates);
    candidateSummary.push(...summarizeCandidates(chapter.chapter_no, candidates));
    if (!llm || candidates.length === 0) continue;
    llmChapters++;
    const out = await runStructuralChapter(chapter, chapterPages, lexicon, {
      label: cachedLabeler(
        path.join(outDir, `chapter-${chapter.chapter_no}`),
        chapter.chapter_no,
        llm.contract,
        llm.call,
        stats
      ),
      ...(useVerifier
        ? {
            verifier: cachedVerifier(
              path.join(outDir, `chapter-${chapter.chapter_no}`),
              llm.call,
              stats
            ),
          }
        : {}),
    });
    accepted.push(...out.accepted.map((r) => ({ ...r, chapter_no: chapter.chapter_no })));
    held.push(...out.held.map((h) => ({ ...h, chapter_no: chapter.chapter_no })));
    mergeRelationships(
      state,
      out.accepted.map((r) => ({
        character_a_id: r.character_a_id,
        character_b_id: r.character_b_id,
        label: r.relationship.label,
        established_page: r.relationship.established_page,
        evidence: r.relationship.evidence,
        rationale: r.relationship.rationale,
        change_type: r.relationship.change_type,
        change_evidence: r.relationship.change_evidence,
        semantics: {
          ...r.relationship.semantics!,
          verification: {
            check: r.check === 'held' ? 'held' : r.check,
            reasons: r.reasons,
            runs_agreed: r.runs_agreed,
          },
        },
      }))
    );
    console.log(
      `[구조 관계] ${chapter.chapter_no}장 후보 쌍 ${candidates.length} · 채택 ${out.accepted.length} · 보류 ${out.held.length}`
    );
  }
  fs.writeFileSync(path.join(outDir, 'candidates.json'), JSON.stringify(candidateSummary, null, 2));
  const counts = {
    chapters: chapters.length,
    chapters_with_candidates: new Set(candidateSummary.map((c) => c.chapter_no)).size,
    llm_label_runs: candidatesOnly ? 0 : llmChapters * 2,
    // 이번 실행에서 실제로 모델을 부른 횟수(캐시 재생은 0) — Claude 구독 호출
    model_calls: stats.label_calls + stats.verifier_calls,
    model_label_calls: stats.label_calls,
    model_verifier_calls: stats.verifier_calls,
    model_json_retries: stats.json_retries,
    model_seconds: Math.round(stats.model_ms / 1000),
    wall_seconds: Math.round((Date.now() - started) / 1000),
    candidate_pairs: allCandidates.length,
    windows: allCandidates.reduce((n, c) => n + c.windows.length, 0),
    accepted: accepted.length,
    confirmed: accepted.filter((r) => r.check === 'confirmed').length,
    needs_review: accepted.filter((r) => r.check === 'needs_review').length,
    held: held.length,
    llm_page_claims_rejected_as_early: accepted.filter((r) =>
      r.notes.includes('claimed_page_earlier_than_evidence')
    ).length,
  };
  // FR-CHR-001 — 자주 함께 나오는데 관계 0건인 인물(예: 백검사)을 검수 목록에 올린다. 관계를 만들지 않는다
  const uncovered = candidatesOnly
    ? []
    : uncoveredCharacters(allCandidates, state.relationships, UNCOVERED_MIN_WINDOWS);
  if (uncovered.length > 0)
    console.warn(
      '[검수] 자주 함께 나오는데 관계 0건:',
      uncovered
        .map((c) => `${c.name}(근거 창 ${c.windows}, 상대 ${c.partners.join('·')})`)
        .join(', ')
    );
  const report = {
    version: STRUCTURAL_LABEL_VERSION,
    uncovered_characters: uncovered,
    book_id: bookId,
    mode: candidatesOnly ? 'candidates-only' : 'labeled',
    method:
      'structural interaction candidates + evidence-window relation questionnaire over a closed type table (docs/context/research-2026-11-18-relationship-extraction.md, research-2026-11-18-relationship-classification.md)',
    provider: candidatesOnly ? 'none' : 'claude-cli (subscription, no API key)',
    counts,
    held_reasons: held
      .flatMap((h) => h.reasons)
      .reduce<Record<string, number>>((acc, r) => ((acc[r] = (acc[r] ?? 0) + 1), acc), {}),
    relationships: state.relationships.map((r) => ({
      ...r,
      character_a: names.get(r.character_a_id),
      character_b: names.get(r.character_b_id),
    })),
    details: accepted.map((r) => ({
      chapter_no: r.chapter_no,
      character_a: r.relationship.character_a,
      character_b: r.relationship.character_b,
      label: r.relationship.label,
      relation_key: r.relationship.semantics?.relation_key,
      kind: r.relationship.semantics?.kind,
      direction: r.relationship.semantics?.direction,
      assertion_status: r.relationship.semantics?.assertion_status,
      attribution: r.relationship.semantics?.attribution,
      summary: r.relationship.semantics?.summary,
      evidence_quote: r.relationship.evidence.quote,
      established_page: r.relationship.established_page,
      runs_agreed: r.runs_agreed,
      check: r.check,
      reasons: r.reasons,
      support: r.support,
      rejected_support: r.rejected_support,
      claimed_established_page: r.claimed_established_page,
      notes: r.notes,
    })),
    held,
    merge_review: state.review,
  };
  fs.writeFileSync(
    path.join(outDir, 'structural-relationships.json'),
    JSON.stringify(report, null, 2)
  );
  if (resolved) {
    const comparison = compareWithExisting(
      (resolved.relationships as AccumulatedRelationship[]) ?? [],
      allCandidates,
      names
    );
    fs.writeFileSync(
      path.join(outDir, 'comparison-with-existing.json'),
      JSON.stringify(comparison, null, 2)
    );
    console.log('[기존 관계와 비교]', JSON.stringify(comparison.counts));
    if (!candidatesOnly)
      fs.writeFileSync(
        path.join(outDir, 'all-resolved.structural.json'),
        JSON.stringify(
          {
            ...resolved,
            relationships: state.relationships,
            provenance: {
              ...(resolved.provenance as object),
              relationship_method: `structural-v${STRUCTURAL_LABEL_VERSION}`,
              relationship_verification: counts,
            },
          },
          null,
          2
        )
      );
  }
  console.log('[구조 관계 완료]', JSON.stringify(counts), '→', outDir);
  console.log('사람 검수 필요(R12) — 보류 사유와 근거 창을 확인한 뒤에만 교체·공개한다.');
  return report;
}

if (require.main === module)
  runStructuralRelationships().catch((err) => {
    console.error('[FAIL]', err);
    process.exit(1);
  });

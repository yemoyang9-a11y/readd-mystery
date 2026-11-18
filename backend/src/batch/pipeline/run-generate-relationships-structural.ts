/**
 * 논문 기반 인물 관계 추출 실행기 — FR-CHR-001 🚦, FR-DAT-005, R9(배치 전용), R12(검수 전 비공개)
 *
 * 1) 인물·별칭: 기존 추출 결과를 그대로 쓴다(책 전체는 run-generate-full의 all-resolved.json).
 * 2) 장마다 구조적 상호작용 후보를 결정적으로 만든다(interaction-candidates.ts, LLM 0회).
 * 3) 후보가 있는 장만 게이트웨이(⑥)로 라벨을 두 번 받는다(자기 일관성). 입력은 근거 창뿐이다.
 * 4) 결정적 검사·확립 페이지 결정(relationship-labeling.ts), 선택적으로 반대 검토자 LLM(--verifier).
 * DB에 쓰지 않는다. 결과는 검수 후보다 — 교체·공개는 기존 검수/교체 절차(docs/relationship-pipeline.md).
 *
 * 사용법 (backend/ 에서):
 *  (A) 발췌 입력 — run-generate-relationships.ts와 같은 JSON(book_id, source, known_character_names,
 *      chapters, pages). 선택 필드 characters: [{name, first_appearance_page, aliases:[{alias, first_appearance_page}]}]
 *      npx ts-node --transpile-only src/batch/pipeline/run-generate-relationships-structural.ts \
 *        --input ../evaluation/relationships/model-inputs/takryu-p91.json --out data/generated/structural/takryu-p91
 *  (B) 책 전체 — data/generated/<book>/full/all-resolved.json의 인물을 쓴다
 *      npx ts-node --transpile-only src/batch/pipeline/run-generate-relationships-structural.ts \
 *        --book gasangbeomin --file data/raw/gasangbeomin.txt [--verifier] [--candidates-only]
 *  --candidates-only: LLM을 부르지 않는다. 후보와 (B) 기존 관계와의 비교만 쓴다.
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Chapter, Page } from '../../shared/types';
import { parseJsonResponse } from './generate';
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
  buildPairLabelPrompt,
  runStructuralChapter,
} from './relationship-labeling';
import { VerifierAnswer, VerifierInput, buildVerifierPrompt } from './relationship-verification';

const MAX_TOKENS = 16000;
const JSON_RETRIES = 2;

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

interface SourceInput {
  book_id: string;
  source: unknown;
  known_character_names: string[];
  characters?: {
    name: string;
    first_appearance_page: number;
    aliases?: { alias: string; first_appearance_page: number }[];
  }[];
  chapters: Chapter[];
  pages: Page[];
}

function lexiconFromCharacters(characters: AccumulatedCharacter[]): CandidateCharacter[] {
  return characters.map((c) => ({
    id: c.id,
    name: c.name,
    first_appearance_page: c.first_appearance_page,
    aliases: c.aliases.map((a) => ({
      alias: a.alias,
      first_appearance_page: a.first_appearance_page,
    })),
  }));
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

type GatewayCall = (
  task: string,
  prompt: string,
  options?: { maxTokens?: number }
) => Promise<string>;

/** 게이트웨이(⑥)는 라벨을 실제로 받을 때만 불러온다 — --candidates-only는 키 없이 돈다 */
async function gateway(): Promise<{ call: GatewayCall; contract: string }> {
  const { call } = await import('../../modules/llm-gateway/gateway');
  const { DEFAULT_EFFORT, LLM_PROVIDER, MODEL_CONFIG } =
    await import('../../modules/llm-gateway/model-config');
  const contract = JSON.stringify({
    version: STRUCTURAL_LABEL_VERSION,
    prompt: buildPairLabelPrompt.toString(),
    provider: LLM_PROVIDER,
    model: MODEL_CONFIG.generate_relationship,
    effort: DEFAULT_EFFORT,
  });
  return { call, contract };
}

/** 장·실행별 캐시 — 같은 프롬프트면 재생(LLM 0회), 다르면 새 출력 디렉터리를 요구한다 */
function cachedLabeler(outDir: string, chapterNo: number, contract: string, call: GatewayCall) {
  return async (prompt: string, run: 1 | 2): Promise<unknown> => {
    const file = path.join(outDir, `chapter-${chapterNo}.run-${run}.json`);
    const key = sha(contract + prompt);
    if (fs.existsSync(file)) {
      const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cached.key !== key)
        throw new Error(
          `${file}: 프롬프트·모델 계약이 바뀌었다. 새 --out 디렉터리를 쓰고 이전 결과는 보존한다`
        );
      return cached.parsed;
    }
    for (let attempt = 1; ; attempt++) {
      const response = await call(
        'generate_relationship',
        attempt === 1
          ? prompt
          : `${prompt}\n\n직전 응답은 JSON이 아니었다. JSON 객체 하나만 출력하라.`,
        { maxTokens: MAX_TOKENS }
      );
      try {
        const parsed = parseJsonResponse(response);
        fs.writeFileSync(
          file,
          JSON.stringify({ key, chapter_no: chapterNo, run, response, parsed }, null, 2),
          {
            flag: 'wx',
          }
        );
        return parsed;
      } catch (err) {
        fs.writeFileSync(
          path.join(outDir, `chapter-${chapterNo}.run-${run}.attempt-${attempt}.txt`),
          response
        );
        if (attempt > JSON_RETRIES) throw err;
      }
    }
  };
}

function cachedVerifier(outDir: string, chapterNo: number, call: GatewayCall) {
  const file = path.join(outDir, `chapter-${chapterNo}.verifier.json`);
  const cache: Record<string, VerifierAnswer> = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : {};
  return async (input: VerifierInput): Promise<VerifierAnswer> => {
    const prompt = buildVerifierPrompt(input);
    const key = sha(prompt);
    if (cache[key]) return cache[key];
    const answer = parseJsonResponse<VerifierAnswer>(
      await call('generate_relationship', prompt, { maxTokens: MAX_TOKENS })
    );
    if (typeof answer.supports !== 'boolean') throw new Error('verifier answer malformed');
    cache[key] = { supports: answer.supports, why: String(answer.why ?? '') };
    fs.writeFileSync(file, JSON.stringify(cache, null, 2));
    return cache[key];
  };
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
      ? src.characters.map((c) => ({
          id: c.name,
          name: c.name,
          first_appearance_page: c.first_appearance_page,
          aliases: c.aliases ?? [],
        }))
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
    const resolvedPath = path.join(args.fullDir, 'all-resolved.json');
    if (!fs.existsSync(resolvedPath))
      throw new Error(
        `${resolvedPath} 없음 — 인물·별칭은 run-generate-full 결과를 쓴다. 먼저 그 실행을 끝낸다`
      );
    resolved = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    lexicon = lexiconFromCharacters(resolved!.characters as AccumulatedCharacter[]);
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
      label: cachedLabeler(outDir, chapter.chapter_no, llm.contract, llm.call),
      ...(useVerifier ? { verifier: cachedVerifier(outDir, chapter.chapter_no, llm.call) } : {}),
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
    llm_label_calls: candidatesOnly ? 0 : llmChapters * 2,
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
  const report = {
    version: STRUCTURAL_LABEL_VERSION,
    book_id: bookId,
    mode: candidatesOnly ? 'candidates-only' : 'labeled',
    method:
      'structural interaction candidates + evidence-window labeling (docs/context/research-2026-11-18-relationship-extraction.md)',
    counts,
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
      established_page: r.relationship.established_page,
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

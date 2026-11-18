/**
 * 관계 실행 결과 → 운영 DB 반영용 행(apply-rows.json)과 로컬 교체 검사 — FR-CHR-001 🚦, R12, FR-ADM-005 🚦
 *
 * DB에 쓰지 않는다. LLM을 부르지 않는다(실행 폴더의 Claude 응답 캐시만 재생한다 — 캐시 계약이 다르면 멈춘다).
 * 1) 원문을 운영 book_id로 다시 나누고, 운영 DB pages의 md5(쪽|본문 '#' 연결)와 같은지 확인한다.
 * 2) 인물 id를 운영 DB 값으로 둔 사전으로 장마다 runStructuralChapter를 재생 → mergeRelationships
 *    (파이프라인과 같은 결정적 uuid v5 id: stableId(book_id, 'relationship', track, page, label, status)).
 * 3) 행은 canonicalRelationship 적용 후 값(DB에 저장되는 방향·끝점 순서).
 * 4) 같은 입력으로 replaceRelationshipSnapshot(assertResolvedGrounding 포함)을 가짜 DB 클라이언트에 돌려
 *    통과하는지, 그리고 006 마이그레이션의 relationships_semantics_v2 CHECK를 JS로 옮긴 검사를 통과하는지 본다.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Page } from '../../backend/src/shared/types';
import { splitBook } from '../../backend/src/batch/pipeline/split';
import {
  canonicalRelationship,
  createEmptyState,
  mergeRelationships,
} from '../../backend/src/batch/pipeline/accumulate';
import { CandidateCharacter } from '../../backend/src/batch/pipeline/interaction-candidates';
import { runStructuralChapter } from '../../backend/src/batch/pipeline/relationship-labeling';
import {
  cachedLabeler,
  cachedVerifier,
  structuralContract,
} from '../../backend/src/batch/pipeline/relationship-structural-calls';
import { replaceRelationshipSnapshot } from '../../backend/src/batch/pipeline/register';
import { sealResolvedOutput } from '../../backend/src/batch/pipeline/grounding';

interface Options {
  runDir: string;
  rawFile: string;
  bookId: string;
  dbPagesMd5: string;
  dbCharacters: { id: string; name: string }[];
  dbChapterNos: number[];
}

const noModel = async (): Promise<string> => {
  throw new Error('캐시에 없는 호출 — 이 스크립트는 LLM을 부르지 않는다');
};

/** 006_relationship_semantics.sql CHECK relationships_semantics_v2를 JS로 옮긴 것 */
export function semanticsCheck(established: number, s: Record<string, any>): string[] {
  const errors: string[] = [];
  const ev = (e: any, name: string) => {
    if (!e || typeof e !== 'object') return errors.push(`${name}: missing`);
    for (const k of ['source_page', 'quote', 'start_char', 'end_char'])
      if (!(k in e)) errors.push(`${name}.${k}: missing`);
    if (!(Number.isInteger(e.source_page) && e.source_page >= 1)) errors.push(`${name}.source_page`);
    if (e.source_page > established) errors.push(`${name}.source_page > established_page`);
    if (!String(e.quote ?? '').trim()) errors.push(`${name}.quote empty`);
    if (!(Number.isInteger(e.start_char) && e.start_char >= 0)) errors.push(`${name}.start_char`);
    if (!(Number.isInteger(e.end_char) && e.end_char > e.start_char)) errors.push(`${name}.end_char`);
  };
  if (s.version !== 2) errors.push('version');
  for (const k of ['direction', 'kind', 'relation_key', 'summary', 'assertion_status', 'temporal_scope', 'state', 'evidence'])
    if (!(k in s)) errors.push(`${k}: missing`);
  if (!['a_to_b', 'b_to_a', 'mutual', 'undirected', 'unknown'].includes(s.direction)) errors.push('direction');
  if (!['family', 'social', 'emotion', 'action'].includes(s.kind)) errors.push('kind');
  if (!['fact', 'belief', 'claim', 'rumor', 'uncertain', 'negated'].includes(s.assertion_status))
    errors.push('assertion_status');
  if (!['ongoing', 'event'].includes(s.temporal_scope)) errors.push('temporal_scope');
  if (!['active', 'ended'].includes(s.state)) errors.push('state');
  if (!String(s.relation_key ?? '').trim()) errors.push('relation_key');
  if (!String(s.summary ?? '').trim()) errors.push('summary');
  ev(s.evidence, 'evidence');
  if ('change_evidence' in s) ev(s.change_evidence, 'change_evidence');
  return errors;
}

export async function buildApplyRows(o: Options) {
  const { pages: localPages, chapters } = splitBook(fs.readFileSync(o.rawFile, 'utf8'), o.bookId);
  const pages: Page[] = localPages.map((p) => ({ ...p, book_id: o.bookId }));
  const localMd5 = createHash('md5')
    .update(pages.map((p) => `${p.page_no}|${p.content}`).join('#'))
    .digest('hex');
  const sourceMatchesDb = localMd5 === o.dbPagesMd5;

  const idByName = new Map(o.dbCharacters.map((c) => [c.name, c.id]));
  const nameById = new Map(o.dbCharacters.map((c) => [c.id, c.name]));
  const input = JSON.parse(fs.readFileSync(path.join(o.runDir, 'characters.json'), 'utf8')) as {
    name: string;
    first_appearance_page: number;
    aliases?: { alias: string; first_appearance_page: number }[];
  }[];
  // 실행 때와 같은 사전(id = 대표명)으로 재생해야 프롬프트가 같아 캐시가 맞는다(후보 순서가 id 순서를 따른다).
  // 병합 직전에 운영 DB id로 바꾼다 — 행 id·끝점 순서는 DB id로 계산된다
  const lexicon: CandidateCharacter[] = input.map((c) => {
    if (!idByName.get(c.name)) throw new Error(`운영 DB에 없는 인물: ${c.name}`);
    return { id: c.name, name: c.name, first_appearance_page: c.first_appearance_page, aliases: c.aliases ?? [] };
  });
  const dbId = (name: string) => idByName.get(name)!;

  const contract = structuralContract();
  const state = createEmptyState(o.bookId);
  let accepted = 0;
  for (const chapter of [...chapters].sort((a, b) => a.start_page - b.start_page)) {
    const chapterPages = pages.filter(
      (p) => p.page_no >= chapter.start_page && p.page_no <= chapter.end_page
    );
    const prefix = path.join(o.runDir, `chapter-${chapter.chapter_no}`);
    const out = await runStructuralChapter(chapter, chapterPages, lexicon, {
      label: cachedLabeler(prefix, chapter.chapter_no, contract, noModel),
      verifier: cachedVerifier(prefix, noModel),
    });
    accepted += out.accepted.length;
    mergeRelationships(
      state,
      out.accepted.map((r) => ({
        character_a_id: dbId(r.character_a_id),
        character_b_id: dbId(r.character_b_id),
        label: r.relationship.label,
        established_page: r.relationship.established_page,
        evidence: r.relationship.evidence,
        rationale: r.relationship.rationale,
        change_type: r.relationship.change_type,
        change_evidence: r.relationship.change_evidence,
        semantics: {
          ...r.relationship.semantics!,
          verification: { check: r.check, reasons: r.reasons, runs_agreed: r.runs_agreed },
        },
      }))
    );
  }

  const coverage = {
    complete: true,
    source_page_count: pages.length,
    chapter_nos: chapters.map((c) => c.chapter_no),
  };
  const rows = state.relationships.map((r) => {
    const c = canonicalRelationship(r);
    return {
      id: r.id,
      character_a_id: c.character_a_id,
      character_b_id: c.character_b_id,
      character_a_name: nameById.get(c.character_a_id),
      character_b_name: nameById.get(c.character_b_id),
      label: r.label,
      established_page: r.established_page,
      semantics: c.semantics,
    };
  });

  // replaceRelationshipSnapshot 검사 — 같은 입력, 가짜 DB(운영 pages·chapters·characters 값을 흉내)
  const data = sealResolvedOutput(
    {
      book_id: o.bookId,
      chapter_summaries: chapters.map((c) => ({ chapter_no: c.chapter_no, title: c.title, summary: '' })),
      characters: [],
      terms: [],
      events: [],
      background_and_intro: { background: '', intro: '' },
      relationships: state.relationships,
      provenance: { relationship_coverage: coverage },
    },
    pages
  );
  const writes: string[] = [];
  const client = {
    async query(sql: string, params?: unknown[]) {
      if (sql.includes('RETURNING id')) {
        writes.push(String(params?.[0]));
        return { rows: [{ id: params?.[0] }] };
      }
      if (sql.includes('book_id <>')) return { rows: [] };
      if (sql.includes('FROM books')) return { rows: [{ publish_status: 'published' }] };
      if (sql.includes('FROM pages')) return { rows: pages };
      if (sql.includes('FROM chapters')) return { rows: o.dbChapterNos.map((n) => ({ chapter_no: n })) };
      if (sql.includes('FROM characters')) return { rows: o.dbCharacters.map((c) => ({ id: c.id })) };
      if (sql.startsWith('SELECT') && sql.includes('FROM relationships')) return { rows: [] };
      return { rows: [] };
    },
  };
  let replacement: { ok: boolean; error?: string; written?: number } = { ok: false };
  try {
    await replaceRelationshipSnapshot(client, data as never);
    replacement = { ok: true, written: writes.length };
  } catch (err) {
    replacement = { ok: false, error: String(err) };
  }
  const semanticsErrors = rows
    .map((r) => ({ id: r.id, errors: semanticsCheck(r.established_page, r.semantics as never) }))
    .filter((x) => x.errors.length);
  return {
    book_id: o.bookId,
    generated_at: new Date().toISOString(),
    method: 'docs/validation/2026-11-18-relationships-claude 실행 캐시 재생(LLM 0회), 인물 id = 운영 DB',
    provenance: { relationship_coverage: coverage },
    checks: {
      source_matches_db_pages_md5: sourceMatchesDb,
      local_pages_md5: localMd5,
      db_pages_md5: o.dbPagesMd5,
      accepted_before_merge: accepted,
      rows: rows.length,
      unique_ids: new Set(rows.map((r) => r.id)).size === rows.length,
      replace_relationship_snapshot: replacement,
      semantics_v2_check_errors: semanticsErrors,
      action_or_event_rows: rows.filter(
        (r) => r.semantics?.kind === 'action' || r.semantics?.temporal_scope === 'event'
      ).length,
    },
    rows,
  };
}

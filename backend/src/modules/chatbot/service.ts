import { SYSTEM_RULES, COMPLETION_STANCE, buildQuoteSection } from './response-policy';
import type { ChatbotQueryLog } from '../../shared/types';
import { assembleContext, buildStableContextParts } from './context-assembly';
import { buildNoNotesNotice, buildNotesSection, notesWithinCutoff } from './harness/notes-section';
import { vectorSearch } from './vector-search';
import { selectModel, logModelSelection, recordSelection, CHATBOT_TASK } from './difficulty-router';
import { stream as llmStream } from '../llm-gateway/gateway';
import { getMockContext, getMockSearchResults, getMockLLMResponse } from './__mocks__/mock-data';
import { recordTurns, getConversationContext } from './conversation-service';
import { questionFocus } from './question-focus';
import { resolveConversationContext } from './conversation-context';
import { formatConversationInput } from './conversation-input';
import { emptyNotesReader, type NotesReader, type ReaderNote } from './notes-reader';
import {
  classifyQuestion,
  isSceneLocationRequest,
  mentionsReaderNotes,
} from './harness/question-intent';
import { guardAnswer, type GuardViolation } from './harness/output-guard';
import { takeGuardedSentences, takeSentences } from './harness/sentence-buffer';
import { HOLDBACK_INTENTS, INTENT_POLICY, fixedAnswerFor } from './harness/behavior-ladder';
import {
  amoTurnGuidance,
  checkAmoStyle,
  normalizeAmoText,
  readerAskedForList,
  type StyleContext,
  type StyleFinding,
} from './harness/amo-style';
import { chatTimingStore, createChatTiming, type ChatTiming } from './timing';
import {
  createFollowUpMarkerFilter,
  followUpGuidance,
  isPlainFollowUp,
  parseFollowUpQuestions,
} from './harness/follow-ups';
import { pickEvidenceLines, type EvidenceItem } from './harness/evidence-lines';

const MOCK_MODE = process.env.MOCK_MODE === 'true';

export { CHATBOT_TASK };

/**
 * NFR-AI-005 🚦: 답변 글(delta)과 따로 나가는 재료. 라우트가 넘긴 객체를 서비스가 채운다.
 * 없으면 해당 프레임을 보내지 않는다.
 */
export interface ChatExtras {
  evidence?: EvidenceItem[];
  followUps?: string[];
}

export interface ChatbotDeps {
  notesReader?: NotesReader;
  extras?: ChatExtras;
  /**
   * 대표 결정 2026-11-19 (E): 단계별 시간 측정기. 라우트가 넘기면 라우트 단계(기준점 스냅샷 등)와
   * 이어서 재고, 'done' 프레임의 timings_ms로 그대로 쓴다. 없으면 여기서 만든다
   */
  timing?: ChatTiming;
}

/** 요청이 어느 응답 경로로 끝났는지 — 시간 기록 한 줄에만 쓴다 */
type ChatPath = 'amo_intro' | 'fixed' | 'notes_empty' | 'guarded' | 'sentence_stream';

/**
 * NFR-PERF-008, 대표 결정 2026-11-19 (E) — 단계별 시간을 재며 답을 내보낸다.
 * 첫 글자를 내보낸 시각(first_yield)과 전체(total)를 여기서 남기고, 끝나면(실패·중단 포함)
 * `[Chatbot Timing]` 한 줄을 남긴다. 기록에는 단계 이름과 숫자, 도서 ID, 기준 쪽수만 담는다.
 * 응답 내용·근거 선택에는 관여하지 않는다(R4).
 */
export async function* handleQuery(
  bookId: string,
  query: string,
  K: number,
  deviceId: string,
  conversationId?: number,
  quote?: string,
  currentPageText?: { pageNo: number; content: string },
  isComplete = false,
  deps: ChatbotDeps = {}
): AsyncGenerator<string> {
  const timing = deps.timing ?? createChatTiming();
  const trace: { path?: ChatPath } = {};
  let outcome: 'ok' | 'error' | 'closed' = 'closed';
  try {
    for await (const chunk of runQuery(
      bookId,
      query,
      K,
      deviceId,
      conversationId,
      quote,
      currentPageText,
      isComplete,
      deps,
      timing,
      trace
    )) {
      timing.markOnce('first_yield');
      timing.increment('deltas');
      yield chunk;
    }
    outcome = 'ok';
  } catch (error) {
    outcome = 'error';
    throw error;
  } finally {
    timing.mark('total');
    console.log(
      '[Chatbot Timing]',
      JSON.stringify({
        book_id: bookId,
        cutoff_page: K,
        path: trace.path ?? null,
        outcome,
        timings_ms: timing.snapshot(),
      })
    );
  }
}

const NO_EVIDENCE_TOKEN = '[NO_EVIDENCE]';

export const NO_EVIDENCE_MESSAGE =
  '🔒 지금까지 읽은 내용으로는 알 수 없어요 🤔 다른 질문을 해보시겠어요?';

export const AMO_INTRO_MESSAGE =
  '저는 아모예요. 지금까지 읽은 내용 안에서만, 스포일러 없이 답해드리는 도우미예요. 궁금한 거 편하게 물어보세요.';

function isAskingAboutAmo(query: string): boolean {
  // Only a pure introduction intent may skip retrieval; mixed story questions continue normally.
  const text = query
    .trim()
    .replace(/[?？!！.。]+$/u, '')
    .trim();
  if (/^(?:아모(?:가\s*뭐야|에\s*대해\s*알려줘|야)|너\s*이름이\s*아모야)$/u.test(text)) return true;
  if (/^(?:너(?:는)?|넌|당신(?:은)?)\s*누구(?:야|니|세요)$/u.test(text)) return true;
  if (
    /^(?:너(?:는|의)?|넌|네|니|당신(?:은|의)?)\s*이름(?:이|은)?\s*(?:뭐야|뭐니|뭐예요|무엇인가요)$/u.test(
      text
    )
  )
    return true;

  // A bare name question may refer to a story character; only bypass retrieval when addressed to Amo.
  const addressed = text.replace(/^아모야[,\s]+|[,\s]+아모야$/gu, '').trim();
  return (
    addressed !== text &&
    /^(?:이름(?:이|은)?\s*(?:뭐야|뭐니|뭐예요|무엇인가요)|누구(?:야|니|세요))$/u.test(addressed)
  );
}

async function* runQuery(
  bookId: string,
  query: string,
  K: number,
  deviceId: string,
  conversationId: number | undefined,
  quote: string | undefined,
  currentPageText: { pageNo: number; content: string } | undefined,
  isComplete: boolean,
  deps: ChatbotDeps,
  timing: ChatTiming,
  trace: { path?: ChatPath }
): AsyncGenerator<string> {
  const notesReader = deps.notesReader ?? emptyNotesReader;
  const intent = classifyQuestion(query);
  // NFR-AI-005, 대표 결정 2026-11-17: 다시 보기 권유는 독자가 장면 위치를 물었을 때만 허용한다.
  // guarded·outside 두 경로 모두 같은 guardAgainst로 이 값을 쓴다
  const sceneLocationRequested = isSceneLocationRequest(query);
  // NFR-AI-005, 결정 23: 유형별 응답 방식·지침·막는 위반은 행동 단계표에서 읽는다
  const policy = INTENT_POLICY[intent];
  const blocking: ReadonlySet<GuardViolation> = new Set(policy.blocking);
  // NFR-AI-005, 대표 지시 2026-11-18: 아모 말투·형식. 근거 범위에는 관여하지 않는다(R4)
  const styleContext: StyleContext = {
    intent,
    allowsOpenQuestion: policy.allowed.includes('ask_open_question'),
    query,
  };
  const listRequested = readerAskedForList(query);
  // This payload is loaded by the server route; still enforce K at the final boundary.
  currentPageText =
    currentPageText &&
    Number.isInteger(currentPageText.pageNo) &&
    currentPageText.pageNo >= 1 &&
    currentPageText.pageNo <= K
      ? currentPageText
      : undefined;
  let generationDeadline: ReturnType<typeof setTimeout> | undefined;
  let generationController: AbortController | undefined;

  if (isAskingAboutAmo(query)) {
    trace.path = 'amo_intro';
    if (conversationId != null) {
      if (quote) await recordTurns(conversationId, query, AMO_INTRO_MESSAGE, K, quote);
      else await recordTurns(conversationId, query, AMO_INTRO_MESSAGE, K);
    }
    await logQuery({
      timestamp: new Date(),
      device_id: deviceId,
      book_id: bookId,
      cutoff_page: K,
      query,
      quote,
      input_records: {
        chapter_summaries: [],
        current_chapter_pages: [],
        characters: [],
        relationships: [],
        character_notes: [],
        terms: [],
        events: [],
        background: 'none',
      },
      search_selected_pages: [],
      no_evidence: false,
      is_complete: isComplete,
      model: 'canned:amo-self-intro',
      output_ref: `chatbot-amo-${Date.now()}`,
      tokens: { input: 0, output: AMO_INTRO_MESSAGE.length },
    });
    yield AMO_INTRO_MESSAGE;
    return;
  }

  // NFR-AI-005: 고정 답변 유형(예측 요청)은 모델을 부르지 않는다
  if (policy.response === 'fixed' && policy.fixed) {
    trace.path = 'fixed';
    const { answer: fixedText, tag } = policy.fixed;
    if (conversationId != null) {
      if (quote) await recordTurns(conversationId, query, fixedText, K, quote);
      else await recordTurns(conversationId, query, fixedText, K);
    }
    await logQuery({
      timestamp: new Date(),
      device_id: deviceId,
      book_id: bookId,
      cutoff_page: K,
      query,
      quote,
      input_records: {
        chapter_summaries: [],
        current_chapter_pages: [],
        characters: [],
        relationships: [],
        character_notes: [],
        terms: [],
        events: [],
        background: 'none',
      },
      search_selected_pages: [],
      no_evidence: false,
      is_complete: isComplete,
      model: `canned:harness-${tag}`,
      harness: { intent, violations: [], regenerated: false, fixed_answer: true },
      output_ref: `chatbot-${tag}-${Date.now()}`,
      tokens: { input: 0, output: fixedText.length },
    });
    yield fixedText;
    return;
  }

  // 대표 지시 2026-11-18 — 노트 요청은 노트(K 이하)를 먼저 읽는다. 조회 실패는 "노트가 없다"로 바꾸지 않고
  // 실패로 끝낸다(FR-SPL-005 🚦). K 이하 노트가 없으면 모델을 부르지 않고 범위를 그대로 말한다
  let preloadedNotes: ReaderNote[] | undefined;
  if (policy.readerNotes) {
    // FR-SPL-002 🚦: 노트 조회도 같은 스냅샷의 K를 상한으로 건다
    preloadedNotes = await timing.time('notes', () => notesReader.listNotes(deviceId, bookId, K));
    if (notesWithinCutoff(preloadedNotes, K).length === 0) {
      trace.path = 'notes_empty';
      const emptyText = policy.readerNotes.emptyAnswer(K);
      const tag = policy.readerNotes.tag;
      if (conversationId != null) {
        if (quote) await recordTurns(conversationId, query, emptyText, K, quote);
        else await recordTurns(conversationId, query, emptyText, K);
      }
      await logQuery({
        timestamp: new Date(),
        device_id: deviceId,
        book_id: bookId,
        cutoff_page: K,
        query,
        quote,
        input_records: {
          chapter_summaries: [],
          current_chapter_pages: [],
          characters: [],
          relationships: [],
          character_notes: [],
          terms: [],
          events: [],
          background: 'none',
        },
        search_selected_pages: [],
        no_evidence: false,
        is_complete: isComplete,
        model: `canned:harness-${tag}`,
        harness: { intent, violations: [], regenerated: false, fixed_answer: true },
        output_ref: `chatbot-${tag}-${Date.now()}`,
        tokens: { input: 0, output: emptyText.length },
      });
      yield emptyText;
      return;
    }
  }

  trace.path = policy.response === 'sentence_stream' ? 'sentence_stream' : 'guarded';
  try {
    const context = MOCK_MODE
      ? getMockContext(K)
      : await timing.time('context', () => assembleContext(bookId, K));

    const priorTurns =
      conversationId != null && !MOCK_MODE
        ? await timing.time('history', () => getConversationContext(conversationId, K))
        : [];
    // Resolve the user's subject before retrieval, using only cutoff-filtered history.
    // Past assistant claims are conversational context, never an identity lookup.
    const dialogue = resolveConversationContext(
      formatConversationInput(query, quote),
      priorTurns,
      context.entities.characters,
      K
    );
    const subjectHint =
      dialogue.status === 'explicit' && !quote
        ? ''
        : dialogue.retrievalHint || quote?.slice(0, 500);
    // 대표 결정 2026-11-19 (E): 검색 안의 임베딩 시간은 인자를 바꾸지 않고 같은 계측기로 잰다
    const searchResults = MOCK_MODE
      ? getMockSearchResults(query, K)
      : await timing.time('vector_search', () =>
          chatTimingStore.run(timing, () =>
            subjectHint
              ? vectorSearch(bookId, query, K, subjectHint)
              : vectorSearch(bookId, query, K)
          )
        );
    const promptStart = timing.now();
    let notesMs = 0;

    // A8-2: the same K-bounded context, ordered append-only and sent before history so the
    // provider prefix cache can hit across turns. Selection is unchanged (FR-SPL-002 🚦, R4).
    const stableContext = buildStableContextParts(context);

    let fullPrompt = '';

    if (isComplete) {
      fullPrompt += `\n\n${COMPLETION_STANCE}`;
    }
    if (searchResults.length > 0) {
      fullPrompt += '\n\n## 검색 결과 (관련 페이지)\n\n';
      searchResults.forEach((result) => {
        fullPrompt += `### p.${result.page_no}\n${result.content}\n\n`;
      });
    }

    if (currentPageText) {
      fullPrompt += `\n\n## ⚠️ 지금 보고 있는 페이지 본문 (p.${currentPageText.pageNo}) — 사용자가 실제로 읽고 있는 확정된 텍스트\n\n${currentPageText.content}\n\n(위는 사용자가 지금 화면에 띄워 놓은 페이지 전체입니다. 질문의 답이 이 안에 있으면 "${NO_EVIDENCE_TOKEN}"을 반환하지 말고 반드시 이 내용으로 답하세요 — 이 안의 단어·인명·지명·서술은 전부 이미 열람 가능한 확정된 근거입니다. "지금 몇 페이지야?", "현재 페이지 어디야?"처럼 사용자의 현재 위치를 묻는 질문에는 무조건 정확히 "p.${currentPageText.pageNo}"로만 답하세요 — "이전 대화"나 다른 근거에 있는 페이지 번호를 쓰지 말고, 다른 숫자를 지어내지도 마세요.)`;
    }

    if (quote) {
      const quoteSources = [...searchResults];
      if (currentPageText)
        quoteSources.unshift({
          page_no: currentPageText.pageNo,
          content: currentPageText.content,
          distance: 0,
        });
      fullPrompt += buildQuoteSection(quote, quoteSources, K);
    }

    const focus = questionFocus(query);
    if (focus) {
      fullPrompt += `\n\n## 질문 초점 (사용자 문장의 구조이며 작품 근거 아님)\n\n${JSON.stringify(focus)}`;
    }
    fullPrompt += `\n\n## 대화 대상 (사용자 표현의 연결이며 작품 사실 아님)\n\n${JSON.stringify({
      status: dialogue.status,
      subjects: dialogue.subjects,
    })}`;
    const subjectFacts = context.entities.characters
      .filter(
        (character) =>
          character.first_appearance_page <= K && dialogue.subjects.includes(character.name)
      )
      .map(({ name, first_appearance_page }) => ({ name, first_appearance_page }));
    if (subjectFacts.length) {
      fullPrompt += `\n\n## 현재 질문 대상의 인물 근거 (현재 읽기 범위의 서버 자료)\n\n${JSON.stringify({ subject_facts: subjectFacts })}`;
    }
    let notes: ReaderNote[] = preloadedNotes ?? [];
    if (!preloadedNotes) {
      const notesStart = timing.now();
      try {
        // FR-SPL-002 🚦: 노트 조회도 같은 스냅샷의 K를 상한으로 건다
        notes = await notesReader.listNotes(deviceId, bookId, K);
      } catch (error) {
        console.error('[Chatbot] notes lookup failed', { bookId, error });
      }
      notesMs = timing.now() - notesStart;
      timing.add('notes', notesMs);
    }
    fullPrompt += buildNotesSection(notes, K, query);
    // 대표 지시 2026-11-18 — 노트를 언급했는데 K 이하 노트가 없으면 "노트가 안 보인다"고 하지 않게 범위만 알린다
    if (mentionsReaderNotes(query) && notesWithinCutoff(notes, K).length === 0) {
      fullPrompt += buildNoNotesNotice(K);
    }
    fullPrompt += policy.guidance;
    if (policy.readerNotes) fullPrompt += policy.readerNotes.scope(K);
    fullPrompt += amoTurnGuidance(styleContext);
    fullPrompt += followUpGuidance();
    fullPrompt += `\n\n# 사용자 질문\n\n${query}`;
    fullPrompt = fullPrompt.replace(/^\n+/, '');
    timing.add('prompt', timing.now() - promptStart - notesMs);

    const modelSelection = selectModel(query);
    logModelSelection(modelSelection, query);
    recordSelection(modelSelection.model);

    const task = CHATBOT_TASK;
    let firstTokenSeen = false;
    const generateChunks = async function* (promptText: string): AsyncGenerator<string> {
      if (generationDeadline) clearTimeout(generationDeadline);
      generationController?.abort();
      const controller = new AbortController();
      generationController = controller;
      // One generation request, including SDK transport retries, shares this deadline.
      generationDeadline = setTimeout(() => controller.abort(), 60_000);
      // 대표 결정 2026-11-19 (E): 모델 첫 토큰·끝까지 시간
      const callStart = timing.now();
      const firstCall = !firstTokenSeen;
      let callFirstToken = true;
      timing.increment('model_calls');
      const streamSource = MOCK_MODE
        ? getMockLLMResponse(query)
        : llmStream(task, promptText, {
            system: SYSTEM_RULES,
            context: stableContext,
            history: dialogue.history,
            signal: controller.signal,
          });
      let pending = '';

      try {
        // Stream immediately. Only a possible split internal control token is held locally.
        // FR-SPL-005: control tokens are errors, never canned answers or extra LLM calls.
        for await (const chunk of streamSource) {
          controller.signal.throwIfAborted();
          if (callFirstToken) {
            callFirstToken = false;
            firstTokenSeen = true;
            timing.markOnce('llm_first_token');
            if (firstCall) timing.add('llm_first_token_wait', timing.now() - callStart);
          }
          pending += chunk;
          if (pending.includes(NO_EVIDENCE_TOKEN)) throw new Error('CHATBOT_INTERNAL_TOKEN');
          let held = Math.min(pending.length, NO_EVIDENCE_TOKEN.length - 1);
          while (held > 0 && !pending.endsWith(NO_EVIDENCE_TOKEN.slice(0, held))) held--;
          const ready = pending.slice(0, pending.length - held);
          pending = pending.slice(pending.length - held);
          if (ready) yield ready;
        }
        controller.signal.throwIfAborted();
        if (pending) yield pending;
        clearTimeout(generationDeadline);
      } finally {
        timing.add('llm_total', timing.now() - callStart);
      }
    };

    const allowedPages: Array<{ page_no: number; content: string }> = searchResults.map((r) => ({
      page_no: r.page_no,
      content: r.content,
    }));
    if (currentPageText)
      allowedPages.push({ page_no: currentPageText.pageNo, content: currentPageText.content });
    const guardAgainst = (text: string): GuardViolation[] => {
      const guardStart = timing.now();
      try {
        return guardText(text);
      } finally {
        timing.add('guard', timing.now() - guardStart);
      }
    };
    const guardText = (text: string): GuardViolation[] =>
      guardAnswer(text, {
        cutoff: K,
        pages: allowedPages,
        intent,
        sceneLocationRequested,
        echoedUserText: quote ? [query, quote] : [query],
        rawText: context.current_chapter_text ? [context.current_chapter_text] : [],
        // 독자 자신의 글은 암시·출처 없는 인용으로 세지 않는다. K 이하 노트만 넘긴다 (FR-SPL-002 🚦)
        readerNotes: notes
          .filter((note) => note.page_no >= 1 && note.page_no <= K)
          .map((note) => note.body),
      }).violations;

    let responseText = '';
    // 대표 결정 2026-11-19 (A): 어느 응답 경로도 재생성하지 않는다(모델 호출 1회)
    const modelCalls = 1;
    const attemptViolations: GuardViolation[][] = [];
    let fixedAnswer = false;
    // NFR-AI-005: 형식 검사 결과(고친 것 + 기록). 하네스 로그와 따로 남긴다
    const styleFindings: StyleFinding[][] = [];

    // NFR-AI-005, FR-QNA-004 🚦 (절대 규칙 11·12), 대표 결정 2026-11-19 (A): 작품 질문(guarded)과
    // 작품 밖 질문(sentence_stream) 모두 스트리밍하되, 이미 나간 글은 회수할 수 없으므로 문장 단위로
    // 모아 "나간 텍스트 + 이번 문장"을 출력 검사(원문 200자 누적 상한 포함)에 통과시킨 뒤에만 내보낸다.
    // 위반 문장과 그 뒤 글은 내보내지 않고 끊은 뒤 그 위반에 맞는 고정 답변으로 맺는다. 재생성은 없다.
    // guarded는 작품 내용을 다루므로 더 엄격하게 끊는다(takeGuardedSentences: 마침 부호 없는 줄바꿈·
    // 열린 따옴표에서는 끊지 않고, 긴 문장도 억지로 자르지 않는다). sentence_stream은 기존 경계 그대로다.
    const split = policy.response === 'guarded' ? takeGuardedSentences : takeSentences;
    let blocked: GuardViolation[] | undefined;
    // 마지막으로 통과한 검사 결과 = 나간 글 전체의 검사 결과 (로그용, 같은 글을 다시 검사하지 않는다)
    let releasedViolations: GuardViolation[] = [];
    const streamStyle: StyleFinding[] = [];
    // 문장마다 형식(이모지·청하지 않은 목록 표지)을 고친 뒤 검사한다. 고친 결과 빈 문장은 내보내지 않는다.
    // 이모지를 지우며 문장 끝 공백이 지워지면 다음 문장과 붙지 않게 원래 끝 공백을 되살린다
    const tidy = (sentence: string): string => {
      const normalized = normalizeAmoText(sentence, { listRequested });
      normalized.applied.forEach((finding) => {
        if (!streamStyle.includes(finding)) streamStyle.push(finding);
      });
      const text = normalized.text;
      if (!text) return '';
      const trailing = /\s*$/u.exec(sentence)?.[0] ?? '';
      return text.endsWith(trailing) ? text : text.replace(/[ \t]+$/u, '') + trailing;
    };
    /** 검사를 통과하면 그 결과, 막는 위반이 있으면 blocked에 남기고 undefined */
    const check = (text: string): GuardViolation[] | undefined => {
      const violations = guardAgainst(text);
      if (violations.some((violation) => blocking.has(violation))) {
        blocked = violations;
        return undefined;
      }
      return violations;
    };
    const release = (sentence: string): boolean => {
      const violations = check(responseText + sentence);
      if (!violations) return false;
      responseText += sentence;
      releasedViolations = violations;
      return true;
    };
    // FR-QNA-004 🚦, NFR-AI-005 (절대 규칙 11) — 판정 위험 유형은 한 문장 늦게 내보낸다(holdback).
    // 문장 N은 "나간 글 + N + N+1"과 "나간 글 + N"이 둘 다 검사를 통과해야 나간다. 뒤 문장이 앞 문장을
    // 판정으로 확정하면("범인은 집사." + "맞아요.") 앞 문장도 나가지 않는다. 마지막 문장은 답이 끝난 뒤
    // 전체 검사 후 내보낸다. 위반이면 아직 안 나간 문장(N 포함)은 버리고 고정 답변으로 맺는다.
    // 그 밖의 유형은 held를 쓰지 않고 문장마다 바로 내보낸다.
    const holdback = HOLDBACK_INTENTS.has(intent);
    let held: string | undefined;
    /** 이번 문장을 받아 지금 내보낼 문장을 돌려준다. 위반이면 undefined (blocked가 채워진다) */
    const accept = (sentence: string): string | undefined | null => {
      timing.markOnce('first_sentence_ready');
      if (!holdback) return release(sentence) ? sentence : undefined;
      if (held === undefined) {
        held = sentence;
        return null; // 다음 문장을 기다린다
      }
      if (!check(responseText + held + sentence)) return undefined;
      const out = held;
      if (!release(out)) return undefined;
      held = sentence;
      return out;
    };
    // NFR-AI-005 🚦 (절대 규칙 11): 표식 뒤 글은 delta로 나가지 않는다. 문장 단위 출력 검사는 표식 앞 글만 본다
    const markerFilter = createFollowUpMarkerFilter();
    const visibleChunks = async function* (): AsyncGenerator<string> {
      for await (const raw of generateChunks(fullPrompt)) {
        const visible = markerFilter.push(raw);
        if (visible) yield visible;
      }
      const flushed = markerFilter.finish();
      if (flushed) yield flushed;
    };
    let pending = '';
    stream: for await (const chunk of visibleChunks()) {
      const { sentences, rest } = split(pending + chunk);
      pending = rest;
      for (const raw of sentences) {
        const sentence = tidy(raw);
        if (!sentence) continue;
        const out = accept(sentence);
        if (out === undefined) break stream;
        if (out !== null) yield out;
      }
    }
    const tail = !blocked && pending ? tidy(pending) : '';
    if (tail) {
      const out = accept(tail);
      if (typeof out === 'string') yield out;
    }
    // 답이 끝났다: 남겨 둔 마지막 문장은 전체 검사를 통과해야 나간다
    if (!blocked && held !== undefined && release(held)) yield held;

    if (blocked) {
      const answer = fixedAnswerFor(blocked.filter((violation) => blocking.has(violation)));
      const notice = `${responseText ? '\n\n' : ''}${answer}`;
      responseText += notice;
      yield notice;
      attemptViolations.push(blocked);
      fixedAnswer = true;
    } else {
      if (!responseText.trim()) throw new Error('CHATBOT_EMPTY_RESPONSE');
      attemptViolations.push(releasedViolations);
    }
    if (deps.extras && !fixedAnswer) {
      // FR-SPL-002 🚦: 근거 문장은 K 이하로 조립한 근거 조각에서 코드가 고른다(LLM이 만들지 않는다)
      const evidence = pickEvidenceLines({ answer: responseText, cutoff: K, pages: allowedPages });
      if (evidence.length > 0) deps.extras.evidence = evidence;
      // NFR-AI-005, FR-QNA-004 🚦 (절대 규칙 11): 질문마다 형식·판정 검사와 같은 출력 검사를 모두 통과해야 나간다
      const questions = markerFilter.found() ? parseFollowUpQuestions(markerFilter.tail()) : [];
      if (
        questions.length > 0 &&
        questions.every((question) => isPlainFollowUp(question) && guardText(question).length === 0)
      ) {
        deps.extras.followUps = questions;
      }
    }
    // 이미 나간 글은 되돌릴 수 없으므로 형식 검사는 기록만 한다. 되묻기 여러 개(multi_question)도
    // 2026-11-19부터 재생성하지 않고 기록만 한다 (STYLE_REGENERATE)
    styleFindings.push([
      ...streamStyle,
      ...(fixedAnswer ? [] : checkAmoStyle(responseText, styleContext)),
    ]);

    if (conversationId != null) {
      const recordStart = timing.now();
      if (quote) await recordTurns(conversationId, query, responseText, K, quote);
      else await recordTurns(conversationId, query, responseText, K);
      timing.add('record', timing.now() - recordStart);
    }
    timing.increment('regenerations', Math.max(0, modelCalls - 1));

    await logQuery(
      {
        timestamp: new Date(),
        device_id: deviceId,
        book_id: bookId,
        cutoff_page: K,
        query,
        quote,
        input_records: {
          chapter_summaries: context.chapter_summaries.map((ch) => ch.title),
          current_chapter_pages: [], // TODO
          characters: context.entities.characters.map((c) => c.id),
          relationships: context.entities.relationships.map((r) => r.id),
          character_notes: context.entities.character_notes.map((n) => n.id),
          terms: context.entities.terms.map((t) => t.id),
          events: context.entities.events.map((e) => e.id),
          background: context.background ? 'included' : 'none',
        },
        search_selected_pages: searchResults.map((r) => ({
          page_no: r.page_no,
          distance: r.distance,
        })),
        no_evidence: false,
        is_complete: isComplete,
        model: modelSelection.modelId,
        logical_model_calls: MOCK_MODE ? 0 : modelCalls,
        harness: {
          intent,
          violations: attemptViolations,
          regenerated: modelCalls > 1,
          fixed_answer: fixedAnswer,
        },
        output_ref: `chatbot-${Date.now()}`,
        tokens: {
          input: 0, // TODO: 실제 토큰 수
          output: responseText.length, // 임시
        },
      },
      { amo_style: { findings: styleFindings } }
    );
  } catch (error) {
    console.error('[Chatbot] Query failed', { bookId, query, K, error });
    throw error;
  } finally {
    if (generationDeadline) clearTimeout(generationDeadline);
    generationController?.abort();
  }
}

async function logQuery(
  log: ChatbotQueryLog,
  // NFR-AI-005, 대표 지시 2026-11-18: 아모 형식 검사 기록(시도별). 공용 로그 형식(shared/types)은 바꾸지 않는다
  extra: { amo_style?: { findings: StyleFinding[][] } } = {}
): Promise<void> {
  // NFR-OBS-005: preserve every record ID in one physical stdout line.
  console.log(
    '[Chatbot] Query log',
    JSON.stringify({
      timestamp: log.timestamp.toISOString(),
      device_id: log.device_id,
      book_id: log.book_id,
      cutoff_page: log.cutoff_page,
      query: log.query.substring(0, 50),
      quote: log.quote?.substring(0, 50),
      input_records: log.input_records,
      search_selected_pages: log.search_selected_pages,
      search_result_count: log.search_selected_pages.length,
      no_evidence: log.no_evidence,
      is_complete: log.is_complete ?? false,
      model: log.model,
      logical_model_calls: log.logical_model_calls ?? 0,
      harness: log.harness,
      ...extra,
      output_ref: log.output_ref,
      tokens: log.tokens,
    })
  );
}

export function getChatbotStats(): {
  noEvidenceToken: string;
  noEvidenceMessage: string;
} {
  return {
    noEvidenceToken: NO_EVIDENCE_TOKEN,
    noEvidenceMessage: NO_EVIDENCE_MESSAGE,
  };
}

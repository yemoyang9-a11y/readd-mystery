/**
 * 리캡 분량 제어 — 목표 문장 수 계산 · 출력 문장 수 세기 (R2, 순수 함수)
 *
 * 2026-11-17 C안(대표 승인) — 브리핑 리캡 길이가 들쭉날쭉한 문제 대응.
 *   원인 ① 입력량이 K에 따라 크게 변한다(장 끝 쪽은 원문이 빠지고 요약만 남음). LLM은 입력이
 *          변하면 길이 지시를 잘 지키지 못한다(LIFEBench, NeurIPS 2025).
 *   원인 ② "자료가 적으면 짧게"가 '적다'는 판단을 모델에 맡겼다.
 *   원인 ③ 목표가 글자 수 상한뿐이고 하한이 없었다. 글자 수는 모델이 가장 못 지키는 단위다
 *          (Retkowski & Waibel, NAACL 2025 Findings — 잘 지키는 단위인 문장 수로 지시).
 *   대응 — 목표 문장 수 N을 코드가 계산해 "정확히 N문장"으로 지시한다. 진도가 쌓일수록
 *          조금 길어지고 상한이 있다(BooookScore의 진도 비례 예산 방식).
 *
 * ⚠️ 이 파일은 "얼마나 길게 말할지"만 정한다. "무엇을 보여줄지"(스포일러 상한)는
 *    recap-assembly.ts의 입력 절단이 유일한 강제 지점이다(NFR-AI-004 🚦, FR-SPL-003 🚦).
 *    N의 입력(완결 장 수·원문 유무)은 이미 K로 절단된 조립 결과에서만 읽는다.
 */

/** N 하한 — 첫 장을 읽는 중이어도 두 문장은 쓴다 */
export const RECAP_MIN_TARGET_SENTENCES = 2;

/**
 * N 상한 — 사용자 확정(2026-08-24) "5문장 내외 / 500자"의 5문장. 각 문장 90자 이내 지시와
 * 곱하면 본문 450자라 소제목·문단 구분을 더해도 500자 하드 상한(recap.service.ts) 안에 든다.
 */
export const RECAP_MAX_TARGET_SENTENCES = 5;

/** 한 문장 길이 지시 — 문장 수 × 이 값이 하드 상한(500자)을 넘지 않게 정했다 */
export const RECAP_SENTENCE_MAX_CHARS = 90;

/**
 * 목표 문장 수 N = clamp(다 읽은 장 수 + (읽는 중인 장 원문 있음 ? 1 : 0), 2, 5)
 *
 * @param completedChapterCount 조립된 입력의 완결 장 요약 개수 (K로 이미 절단된 값)
 * @param hasCurrentChapterText 조립된 입력에 읽는 중인 장 원문이 들어갔는지
 *                              (K가 장 종료 페이지와 일치하면 false — recap-assembly.ts)
 */
export function computeRecapTargetSentences(
  completedChapterCount: number,
  hasCurrentChapterText: boolean
): number {
  const raw = completedChapterCount + (hasCurrentChapterText ? 1 : 0);
  return Math.min(RECAP_MAX_TARGET_SENTENCES, Math.max(RECAP_MIN_TARGET_SENTENCES, raw));
}

/** 프롬프트가 고정한 소제목 줄 (recap.service.ts buildRecapPrompt) — 문장으로 세지 않는다 */
const HEADING_LINE = /^#*\s*이전 이야기 요약\s*:?\s*$/;

/**
 * 문장 끝 — 마침표·물음표·느낌표·말줄임 묶음.
 *  - 닫는 따옴표·괄호가 뒤따르면 그 뒤가 공백이나 줄 끝일 때만 끝으로 본다
 *    (`"누가 범인이지?"라고 물었다.` 의 `?"` 는 문장 안의 인용이다).
 *  - 따옴표가 없으면 바로 뒤가 숫자가 아닐 때 끝으로 본다(`3.5초` 의 `.` 은 제외).
 */
const SENTENCE_END = /[.!?。…]+(?:["'”’」』)]+(?=\s|$)|(?![\d"'”’」』)]))/g;

/**
 * 출력 문장 수 — 로그(NFR-OBS-002 🚦)에서 목표 N과 비교하려고 센다. 소제목 줄은 빼고,
 * 문장 부호 없이 끝난 줄(문단)의 꼬리도 한 문장으로 센다. 근사치이며 응답 내용에는
 * 관여하지 않는다(측정 전용).
 */
export function countRecapSentences(text: string): number {
  const lines = text.split('\n').map((l) => l.trim());
  let count = 0;
  let headingSkipped = false;
  for (const line of lines) {
    if (line.length === 0) continue;
    if (!headingSkipped) {
      headingSkipped = true;
      if (HEADING_LINE.test(line)) continue;
    }
    let lastEnd = 0;
    for (const m of line.matchAll(SENTENCE_END)) {
      count++;
      lastEnd = (m.index ?? 0) + m[0].length;
    }
    if (line.slice(lastEnd).trim().length > 0) count++;
  }
  return count;
}

import * as fs from 'fs';

/**
 * NFR-OBS-004 (AI 원가 측정, 2026-11-23): LLM_METRICS_FILE이 있으면 [LLM Metrics]·[Embed Metrics]
 * 한 줄 JSON을 그 파일에도 덧붙인다. 배치·서버처럼 프로세스가 달라도 한 파일에 모인다.
 * 기록 실패는 호출 결과에 영향을 주지 않는다. 키·원문은 이 줄에 들어가지 않는다(토큰 수·시간만).
 */
export function appendMetricsFile(tag: string, line: string): void {
  const file = process.env.LLM_METRICS_FILE?.trim();
  if (!file) return;
  try {
    fs.appendFileSync(file, `${tag} ${line}\n`, 'utf-8');
  } catch (err) {
    console.warn('[Metrics] 파일 기록 실패', String(err));
  }
}

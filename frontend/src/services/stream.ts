import type { SseFrame } from '../types';
import { createSseParser } from '../utils/sse';

/**
 * SSE 응답 본문을 프레임 단위로 읽는다 — backend/SSE_SPEC.md
 *
 * EventSource 를 쓰지 않는 이유는 utils/sse.ts 에 적어뒀다(POST 본문 + 헤더).
 * `done` 을 받으면 거기서 끝낸다 — 정상 종료를 연결 끊김과 구별하는 신호가 그것뿐이다.
 */
export async function* readSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      // FR-SPL-005 🚦 — EOF는 성공 신호가 아니다. 일부 답을 완성본처럼 남기지 않는다.
      if (done) throw new Error('응답이 완료되기 전에 연결이 끊겼습니다');

      for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
        yield frame;
        if (frame.type === 'done' || frame.type === 'error') return;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // 취소 실패가 원래의 네트워크 오류를 덮지 않게 한다.
    } finally {
      reader.releaseLock();
    }
  }
}

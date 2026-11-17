import { readSseStream } from './stream';

function body(text: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe('FR-SPL-005: 스트림 실패는 정상 완료로 보이지 않는다', () => {
  it('완료 신호 없이 연결이 닫히면 실패한다', async () => {
    const consume = async () => {
      for await (const frame of readSseStream(body('data: {"type":"delta","text":"일부"}\n\n'))) {
        expect(frame.type).toBe('delta');
      }
    };
    await expect(consume()).rejects.toThrow();
  });

  it('빈 연결도 완료로 인정하지 않는다', async () => {
    await expect(readSseStream(body('')).next()).rejects.toThrow();
  });

  it.each(['done', 'error'])('%s 뒤에는 연결을 취소하고 잠금을 해제한다', async (type) => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type, message: '실패' })}\n\n`));
      },
      cancel,
    });
    const frames = [];
    for await (const frame of readSseStream(stream)) frames.push(frame);
    expect(frames).toHaveLength(1);
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });
});

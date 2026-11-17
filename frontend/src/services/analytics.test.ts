import { clickLabel, createCollector, isAdminPath, type TrackedEvent } from './analytics';

function setup() {
  const sent: { device_id: string; events: TrackedEvent[] }[] = [];
  const beacons: { device_id: string; events: TrackedEvent[] }[] = [];
  let time = 1_000;
  const collector = createCollector({
    deviceId: () => 'dev-1',
    send: (b) => sent.push(JSON.parse(b)),
    beacon: (b) => {
      beacons.push(JSON.parse(b));
      return true;
    },
    now: () => time,
    referrer: () => 'https://news.example.com/a',
    search: () => '?utm_source=newsletter&utm_medium=email&q=secret',
    origin: () => 'https://app.example.com',
  });
  return { collector, sent, beacons, tick: (ms: number) => (time += ms) };
}

describe('collector', () => {
  it('FR-ADM-005: 첫 page_view에만 referrer와 UTM을 싣고 다른 쿼리는 보내지 않는다', () => {
    const { collector, sent } = setup();
    collector.pageView('/');
    collector.pageView('/search');
    collector.flush();
    const [first, second] = sent[0].events;
    expect(first).toMatchObject({
      type: 'page_view',
      path: '/',
      referrer: 'https://news.example.com/a',
      utm_source: 'newsletter',
      utm_medium: 'email',
    });
    expect(JSON.stringify(first)).not.toContain('secret');
    expect(second.referrer).toBeUndefined();
    expect(second.utm_source).toBeUndefined();
  });

  it('FR-ADM-005: 같은 사이트 referrer는 싣지 않는다', () => {
    const sent: { device_id: string; events: TrackedEvent[] }[] = [];
    const c = createCollector({
      deviceId: () => 'd',
      send: (b) => sent.push(JSON.parse(b)),
      beacon: () => false,
      referrer: () => 'https://app.example.com/books',
      origin: () => 'https://app.example.com',
    });
    c.pageView('/');
    c.flush();
    expect(sent[0].events[0].referrer).toBeUndefined();
  });

  it('FR-ADM-005: /admin 경로는 수집하지 않는다', () => {
    const { collector, sent } = setup();
    collector.pageView('/admin/books');
    collector.click('/admin', '업로드');
    collector.flush();
    expect(sent).toHaveLength(0);
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/administrator')).toBe(false);
  });

  it('FR-ADM-005: 10개가 쌓이면 자동으로 보낸다', () => {
    const { collector, sent } = setup();
    for (let i = 0; i < 10; i++) collector.click('/', `b${i}`);
    expect(sent).toHaveLength(1);
    expect(sent[0].events).toHaveLength(10);
    expect(sent[0].device_id).toBe('dev-1');
  });

  it('FR-ADM-005: session_end는 sendBeacon으로 남은 이벤트와 함께 보내고 한 번만 낸다', () => {
    const { collector, sent, beacons, tick } = setup();
    collector.pageView('/');
    tick(4000);
    collector.sessionEnd('/');
    collector.sessionEnd('/');
    expect(sent).toHaveLength(0);
    expect(beacons).toHaveLength(1);
    const types = beacons[0].events.map((e) => e.type);
    expect(types).toEqual(['page_view', 'session_end']);
    expect(beacons[0].events[1].duration_ms).toBe(4000);
  });

  it('FR-ADM-005: 전송이 던져도 조용히 버린다', () => {
    const c = createCollector({
      deviceId: () => 'd',
      send: () => {
        throw new Error('network');
      },
      beacon: () => false,
    });
    c.click('/', 'x');
    expect(() => c.flush()).not.toThrow();
    expect(c.pending()).toBe(0);
  });
});

describe('clickLabel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('FR-ADM-005: data-track 값만 기록하고 안쪽 자식을 눌러도 그 값을 쓴다', () => {
    document.body.innerHTML = `
      <button id="a" data-track="이어 읽기"><span id="inner">이어 읽기 · 탁류</span></button>`;
    expect(clickLabel(document.getElementById('a'))).toBe('이어 읽기');
    expect(clickLabel(document.getElementById('inner'))).toBe('이어 읽기');
  });

  it('FR-ADM-005: data-track이 없으면 텍스트·aria-label이 있어도 기록하지 않는다', () => {
    document.body.innerHTML = `
      <button id="text">그는 문을 열었다</button>
      <a id="aria" href="#" aria-label="탁류, 채만식">책</a>
      <p id="body">본문 문장입니다</p>`;
    for (const id of ['text', 'aria', 'body']) {
      expect(clickLabel(document.getElementById(id))).toBeNull();
    }
  });

  it('FR-ADM-005: 40자를 넘는 data-track 값은 기록하지 않는다', () => {
    document.body.innerHTML = `<button id="long" data-track="${'가'.repeat(41)}">x</button>`;
    expect(clickLabel(document.getElementById('long'))).toBeNull();
  });

  it('FR-ADM-005: data-no-track 컨테이너 안의 클릭은 data-track이 있어도 이벤트를 만들지 않는다', () => {
    document.body.innerHTML = `<article data-no-track><button id="quote" data-track="x">그는 문을 열었다</button></article>`;
    const sent: string[] = [];
    const collector = createCollector({
      deviceId: () => 'd',
      send: (b) => sent.push(b),
      beacon: () => false,
    });
    const label = clickLabel(document.getElementById('quote'));
    if (label) collector.click('/books/bk-1/read', label);
    collector.flush();
    expect(sent).toHaveLength(0);
  });
});

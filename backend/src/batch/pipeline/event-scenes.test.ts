import { Chapter, Page } from '../../shared/types';
import {
  MAX_EVENTS_PER_SCENE,
  Scene,
  buildSceneBoundaryPrompt,
  buildSceneEventPrompt,
  chapterEventCallCount,
  evaluateChapterEvents,
  EVENT_SCENE_BOUNDARY_TASK,
  EVENT_SCENE_EXTRACTION_TASK,
  extractChapterEventsRaw,
  resolveScenes,
  validateSceneEvents,
} from './event-scenes';

// 쪽 1: 문단 두 개(분장실 → 손수건). 쪽 2: 찻집 장면. 쪽 3: 다음 날 아침 장면.
const P1 =
  '유불란은 해왕좌 분장실에 들어갔다. 분장실은 어두웠다.\n유불란이 바닥에서 손수건을 주웠다.\n';
const P2 =
  '그날 밤 박영민은 극장 앞 찻집에 앉아 있었다. 박영민이 하녀에게 "나는 어젯밤 집에 있었소"라고 말했다.\n';
const P3 = '이튿날 아침 경찰이 해왕좌에 도착했다. 형사가 무대 뒤에서 피 묻은 칼을 발견했다.';

const chapter: Chapter = {
  id: 'c1',
  book_id: 'fixture',
  chapter_no: 1,
  title: '분장실',
  start_page: 1,
  end_page: 3,
};
const pages: Page[] = [P1, P2, P3].map((content, i) => ({
  id: `p${i + 1}`,
  book_id: 'fixture',
  page_no: i + 1,
  content,
}));
const TEXT = P1 + P2 + P3;
const P2_START = P1.length;
const P3_START = P1.length + P2.length;

const boundary = (source_page: number, quote: string) => ({ source_page, quote });
const THREE_SCENES = {
  boundaries: [boundary(2, '그날 밤 박영민은'), boundary(3, '이튿날 아침 경찰이')],
};

const event = (patch: Record<string, unknown> = {}) => ({
  agent: '유불란',
  action: '유불란이 바닥에서 손수건을 주웠다',
  mode: 'narration',
  realis: 'actual',
  flashback: false,
  occurrence_page: 1,
  evidence: [{ source_page: 1, quote: '유불란이 바닥에서 손수건을 주웠다.' }],
  ...patch,
});

function scenesOf(raw: unknown): Scene[] {
  return resolveScenes(pages, raw).scenes;
}

/** 장면 끝 뒤에 오는 원문을 문장 단위로 쪼갠다(빈 조각 제외) */
function sentencesAfter(scene: Scene): string[] {
  return TEXT.slice(scene.end)
    .split(/(?<=[.!?])\s+|\n/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

describe('장면 경계 — FR-DAT-008', () => {
  test('FR-DAT-008: 경계 제안은 장 원문 전체와 쪽 표시를 담는다', () => {
    const prompt = buildSceneBoundaryPrompt(chapter, pages);
    expect(prompt).toContain('[페이지 1]');
    expect(prompt).toContain('[페이지 3]');
    expect(prompt).toContain('피 묻은 칼을 발견했다');
  });

  test('FR-DAT-008: 경계는 문단 시작 위치에서 장면을 나눈다', () => {
    const scenes = scenesOf(THREE_SCENES);
    expect(scenes.map((s) => [s.start, s.end])).toEqual([
      [0, P2_START],
      [P2_START, P3_START],
      [P3_START, TEXT.length],
    ]);
    expect(scenes.map((s) => [s.start_page, s.end_page])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  test('FR-DAT-008: 문단 중간 경계는 가장 가까운 문단 시작으로 스냅한다', () => {
    // '찻집에 앉아'는 쪽 2 문단 중간 — 가장 가까운 문단 시작은 쪽 2 처음
    const scenes = scenesOf({ boundaries: [boundary(2, '극장 앞 찻집에 앉아')] });
    expect(scenes.map((s) => s.start)).toEqual([0, P2_START]);
    // '분장실은 어두웠다.'는 쪽 1 첫 문단 끝 — 다음 문단 시작이 더 가깝다
    const snapped = scenesOf({ boundaries: [boundary(1, '분장실은 어두웠다.')] });
    expect(snapped.map((s) => s.start)).toEqual([0, TEXT.indexOf('유불란이 바닥에서')]);
  });

  test('FR-DAT-008: 장 범위 밖·찾을 수 없는 인용·중복·장 시작 경계는 버리고 순서를 바로잡는다', () => {
    const scenes = scenesOf({
      boundaries: [
        boundary(3, '이튿날 아침 경찰이'),
        boundary(9, '없는 쪽'),
        boundary(2, '원문에 없는 문장'),
        boundary(2, '그날 밤 박영민은'),
        boundary(2, '그날 밤 박영민은'),
        boundary(1, '유불란은 해왕좌'),
      ],
    });
    expect(scenes.map((s) => s.start)).toEqual([0, P2_START, P3_START]);
    expect(scenes.map((s) => s.scene_no)).toEqual([1, 2, 3]);
  });

  test('FR-DAT-008: 경계 응답이 깨졌으면 장 하나를 한 장면으로 둔다', () => {
    for (const raw of [null, {}, { boundaries: 'x' }, { boundaries: [null, 3] }]) {
      expect(scenesOf(raw).map((s) => [s.start, s.end, s.start_page, s.end_page])).toEqual([
        [0, TEXT.length, 1, 3],
      ]);
    }
  });
});

describe('장면별 사건 추출 입력 — FR-SPL-002 🚦', () => {
  test('FR-SPL-002: 장면 추출 프롬프트에 장면 뒤 텍스트가 0자 포함된다(같은 장 뒤쪽 문장 없음)', () => {
    const scenes = scenesOf(THREE_SCENES);
    for (const scene of scenes.slice(0, -1)) {
      const prompt = buildSceneEventPrompt(chapter, pages, scene);
      const after = sentencesAfter(scene);
      expect(after.length).toBeGreaterThan(0);
      expect(after.filter((s) => prompt.includes(s))).toEqual([]);
      for (let page = scene.end_page + 1; page <= chapter.end_page; page++) {
        expect(prompt).not.toContain(`[페이지 ${page}]`);
      }
    }
    const first = buildSceneEventPrompt(chapter, pages, scenes[0]);
    expect(first).not.toContain('찻집');
    expect(first).not.toContain('피 묻은 칼');
  });

  test('FR-SPL-002: positive — 장 시작부터 그 장면 끝까지는 프롬프트에 포함된다', () => {
    const scenes = scenesOf(THREE_SCENES);
    const second = buildSceneEventPrompt(chapter, pages, scenes[1]);
    expect(second).toContain('유불란이 바닥에서 손수건을 주웠다.'); // 앞 맥락
    expect(second).toContain('"나는 어젯밤 집에 있었소"라고 말했다.'); // 장면 마지막 문장
    const last = buildSceneEventPrompt(chapter, pages, scenes[2]);
    expect(last).toContain('형사가 무대 뒤에서 피 묻은 칼을 발견했다.');
  });

  test('FR-SPL-002: 실행 중에도 각 장면 호출이 받는 원문은 그 장면 끝까지다', async () => {
    const prompts: string[] = [];
    const ask = async (prompt: string): Promise<unknown> => {
      prompts.push(prompt);
      return prompts.length === 1 ? THREE_SCENES : { events: [] };
    };
    await extractChapterEventsRaw(chapter, pages, ask);
    expect(prompts).toHaveLength(1 + 3);
    expect(prompts[1]).not.toContain('그날 밤 박영민은');
    expect(prompts[1]).toContain('손수건을 주웠다');
    expect(prompts[2]).not.toContain('이튿날 아침');
    expect(prompts[2]).toContain('찻집에 앉아');
  });

  test('NFR-OBS-004: 장면 경계 호출과 장면별 추출 호출은 작업 이름이 다르다 — 비용 지표가 나뉜다', async () => {
    const tasks: string[] = [];
    const ask = async (_prompt: string, task: string): Promise<unknown> => {
      tasks.push(task);
      return tasks.length === 1 ? THREE_SCENES : { events: [] };
    };
    await extractChapterEventsRaw(chapter, pages, ask);
    expect(EVENT_SCENE_BOUNDARY_TASK).not.toBe(EVENT_SCENE_EXTRACTION_TASK);
    expect(tasks).toEqual([
      EVENT_SCENE_BOUNDARY_TASK,
      EVENT_SCENE_EXTRACTION_TASK,
      EVENT_SCENE_EXTRACTION_TASK,
      EVENT_SCENE_EXTRACTION_TASK,
    ]);
    expect(EVENT_SCENE_BOUNDARY_TASK).toBe('generate_event_scene_boundary');
    expect(EVENT_SCENE_EXTRACTION_TASK).toBe('generate_event');
  });

  test('FR-DAT-008: 장당 LLM 호출 수 = 1(경계) + 장면 수', async () => {
    let calls = 0;
    const ask = async (): Promise<unknown> => (++calls === 1 ? THREE_SCENES : { events: [] });
    const raw = await extractChapterEventsRaw(chapter, pages, ask);
    expect(calls).toBe(chapterEventCallCount(raw.scenes.length));
    expect(chapterEventCallCount(3)).toBe(4);
  });
});

describe('사건 검증 — NFR-AI-004, FR-DAT-008', () => {
  const [scene1, scene2, scene3] = scenesOf(THREE_SCENES);
  const wide = scenesOf({ boundaries: [boundary(3, '이튿날 아침 경찰이')] })[0]; // 쪽 1~2

  test('NFR-AI-004: 인용이 원문에 없으면 사건 0건 저장, 검수 후보로 보낸다', () => {
    const out = validateSceneEvents(
      { events: [event({ evidence: [{ source_page: 1, quote: '유불란이 장갑을 주웠다.' }] })] },
      pages,
      scene1
    );
    expect(out.events).toHaveLength(0);
    expect(out.review).toHaveLength(1);
    expect(out.review[0].kind).toBe('event');
    expect(out.review[0].reason).toBe('event_evidence_not_in_source');
  });

  test('NFR-AI-004: positive — 인용이 원문에 있으면 저장하고 원문 위치를 붙인다', () => {
    const out = validateSceneEvents({ events: [event()] }, pages, scene1);
    expect(out.review).toEqual([]);
    expect(out.events).toHaveLength(1);
    const [e] = out.events;
    expect(e.description).toBe('유불란이 바닥에서 손수건을 주웠다');
    expect(e.agent).toBe('유불란');
    expect(e.evidence[0].start_char).toBe(P1.indexOf('유불란이 바닥에서'));
  });

  test('NFR-AI-004: 근거 하나라도 원문에 없거나 근거가 0개·4개 이상이면 검수 후보', () => {
    const good = { source_page: 1, quote: '유불란이 바닥에서 손수건을 주웠다.' };
    const cases = [[good, { source_page: 1, quote: '지어낸 문장' }], [], [good, good, good, good]];
    for (const evidence of cases) {
      const out = validateSceneEvents({ events: [event({ evidence })] }, pages, scene1);
      expect(out.events).toHaveLength(0);
      expect(out.review).toHaveLength(1);
    }
  });

  test('FR-SPL-002: 근거가 그 장면 끝을 넘으면 저장하지 않고 검수 후보', () => {
    const out = validateSceneEvents(
      {
        events: [
          event({
            agent: '형사',
            action: '형사가 칼을 발견했다',
            evidence: [{ source_page: 3, quote: '형사가 무대 뒤에서 피 묻은 칼을 발견했다.' }],
          }),
        ],
      },
      pages,
      scene1
    );
    expect(out.events).toHaveLength(0);
    expect(out.review.map((r) => r.reason)).toEqual(['event_evidence_after_scene']);
    // positive — 같은 사건이 그 장면 안이면 저장
    const ok = validateSceneEvents(
      {
        events: [
          event({
            agent: '형사',
            action: '형사가 칼을 발견했다',
            evidence: [{ source_page: 3, quote: '형사가 무대 뒤에서 피 묻은 칼을 발견했다.' }],
          }),
        ],
      },
      pages,
      scene3
    );
    expect(ok.events).toHaveLength(1);
  });

  test('FR-DAT-008: 근거가 모두 앞 맥락에만 있으면(그 장면 사건이 아님) 검수 후보', () => {
    const out = validateSceneEvents({ events: [event()] }, pages, scene2);
    expect(out.events).toHaveLength(0);
    expect(out.review.map((r) => r.reason)).toEqual(['event_evidence_outside_scene']);
  });

  test.each(['negated', 'hypothetical', 'future', 'habitual', 'Actual', undefined])(
    'FR-DAT-008: realis=%p 이면 사건에서 제거한다',
    (realis) => {
      const out = validateSceneEvents({ events: [event({ realis })] }, pages, scene1);
      expect(out.events).toHaveLength(0);
    }
  );

  test('FR-DAT-008: positive — realis=actual 이면 남는다', () => {
    expect(validateSceneEvents({ events: [event()] }, pages, scene1).events).toHaveLength(1);
  });

  test('FR-DAT-008: occurrence_page는 LLM 값이 아니라 그 장면의 끝 쪽이다', () => {
    expect(wide.end_page).toBe(2);
    const out = validateSceneEvents(
      { events: [event({ occurrence_page: 1 }), event({ occurrence_page: 99 })] },
      pages,
      wide
    );
    expect(out.events.map((e) => e.occurrence_page)).toEqual([2]);
  });

  test('FR-DAT-008: 장면당 3개 이상 오면 서술 순서대로 2개만 남긴다', () => {
    expect(MAX_EVENTS_PER_SCENE).toBe(2);
    const out = validateSceneEvents(
      {
        events: [
          event({
            agent: '박영민',
            action: '박영민이 하녀에게 어젯밤 집에 있었다고 말했다',
            mode: 'dialogue',
            evidence: [{ source_page: 2, quote: '박영민이 하녀에게' }],
          }),
          event({
            agent: '박영민',
            action: '박영민이 찻집에 앉아 있었다',
            evidence: [{ source_page: 2, quote: '극장 앞 찻집에 앉아 있었다.' }],
          }),
          event({
            agent: '유불란',
            action: '유불란이 분장실에 들어갔다',
            evidence: [{ source_page: 1, quote: '유불란은 해왕좌 분장실에 들어갔다.' }],
          }),
        ],
      },
      pages,
      wide
    );
    expect(out.events.map((e) => e.description)).toEqual([
      '유불란이 분장실에 들어갔다',
      '박영민이 찻집에 앉아 있었다',
    ]);
    expect(out.review).toEqual([]);
  });

  test.each(['결정적', '단서', '수상한', '중요한', '알고 보니', '복선'])(
    'FR-DAT-008: 해석·평가어 "%s"가 있으면 검수 후보',
    (word) => {
      const out = validateSceneEvents(
        { events: [event({ action: `유불란이 ${word} 손수건을 주웠다` })] },
        pages,
        scene1
      );
      expect(out.events).toHaveLength(0);
      expect(out.review.map((r) => r.reason)).toEqual(['event_evaluative_word']);
    }
  );

  test('FR-DAT-008: mode=dialogue인데 발화 행위 형태가 아니면 검수 후보, 발화 형태면 저장', () => {
    const asFact = event({
      agent: '박영민',
      action: '박영민은 어젯밤 집에 있었다',
      mode: 'dialogue',
      evidence: [{ source_page: 2, quote: '"나는 어젯밤 집에 있었소"라고 말했다.' }],
    });
    const out = validateSceneEvents({ events: [asFact] }, pages, scene2);
    expect(out.events).toHaveLength(0);
    expect(out.review.map((r) => r.reason)).toEqual(['event_dialogue_not_speech_act']);

    const asSpeech = { ...asFact, action: '박영민이 하녀에게 어젯밤 집에 있었다고 말했다' };
    const ok = validateSceneEvents({ events: [asSpeech] }, pages, scene2);
    expect(ok.events.map((e) => e.mode)).toEqual(['dialogue']);
  });

  test('FR-DAT-008: 같은 장면 안 같은 행위자·비슷한 행위는 하나로 합친다', () => {
    const out = validateSceneEvents(
      {
        events: [
          event(),
          event({
            action: '유불란이 손수건을 주웠다',
            evidence: [{ source_page: 1, quote: '손수건을 주웠다' }],
          }),
          event({
            action: '유불란이 분장실에 들어갔다',
            evidence: [{ source_page: 1, quote: '유불란은 해왕좌 분장실에 들어갔다.' }],
          }),
        ],
      },
      pages,
      scene1
    );
    expect(out.events.map((e) => e.description)).toEqual([
      '유불란이 분장실에 들어갔다',
      '유불란이 바닥에서 손수건을 주웠다',
    ]);
    expect(out.events[1].evidence).toHaveLength(1); // 같은 원문 위치는 한 번만
  });

  test('FR-DAT-008: 기존 events 형태로 매핑한다 — event는 짧은 제목, description은 검증된 사실', () => {
    const out = validateSceneEvents(
      { events: [event({ flashback: true, description: '해석', event: '모델 제목' })] },
      pages,
      scene1
    );
    const [e] = out.events;
    expect(e.event).toBe('유불란이 바닥에서 손수건을 주웠다');
    expect(e.description).toBe('유불란이 바닥에서 손수건을 주웠다');
    expect(e.flashback).toBe(true);
    expect(e.scene_no).toBe(1);
    expect(e.event.length).toBeLessThanOrEqual(40);
  });

  test('FR-DAT-008: 원본 응답에서 결과를 다시 계산해도 같다(재생 시 LLM 호출 없음)', async () => {
    let calls = 0;
    const ask = async (): Promise<unknown> => {
      calls++;
      return calls === 1 ? THREE_SCENES : { events: [event()] };
    };
    const raw = await extractChapterEventsRaw(chapter, pages, ask);
    const first = evaluateChapterEvents(pages, raw);
    expect(first.events.map((e) => e.occurrence_page)).toEqual([1]);
    expect(first.review).toHaveLength(2); // 장면 2·3에서 앞 맥락만 가리킨 같은 사건
    expect(evaluateChapterEvents(pages, JSON.parse(JSON.stringify(raw)))).toEqual(first);
    expect(calls).toBe(4);
  });

  test('FR-DAT-008: 원본 응답의 장면 구획이 지금 계산과 다르면 실패한다', async () => {
    const raw = await extractChapterEventsRaw(chapter, pages, async (p) =>
      p.includes('장면 경계') ? THREE_SCENES : { events: [] }
    );
    expect(() => evaluateChapterEvents(pages, { ...raw, scenes: raw.scenes.slice(0, 1) })).toThrow(
      /Stale/
    );
  });
});

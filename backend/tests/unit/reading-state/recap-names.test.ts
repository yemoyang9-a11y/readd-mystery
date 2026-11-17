/**
 * 리캡 고유명사 검사 — 이름꼴 낱말 중 허용 사전(K 이하)·입력 자료 어디에도 없는 것 (FR-RCP-001)
 *
 * 구현 전에 작성했다. 이 검사는 측정용이다 — 리캡을 막거나 고치지 않는다.
 */

import { findUnknownNames } from '../../../src/modules/reading-state/recap-names';

const DICT = ['유불란', '박영민', '이몽란', '박 군'];
const SOURCE = '유불란은 해왕좌에서 박영민을 만났다. 주인공은 손수건을 주웠다. 김 씨가 왔다.';

describe('FR-RCP-001: 리캡에 사전·자료에 없는 이름이 생겼는지', () => {
  test('FR-RCP-001: 사전에도 입력 자료에도 없는 성명꼴 낱말을 찾아낸다', () => {
    expect(
      findUnknownNames('유불란은 박영민을 만났다. 그때 장준호가 나타났다.', DICT, SOURCE)
    ).toEqual(['장준호']);
  });

  test('FR-RCP-001: positive — 사전에 있는 이름만 쓰면 0건', () => {
    expect(findUnknownNames('유불란은 박영민과 이몽란을 만났다.', DICT, SOURCE)).toEqual([]);
  });

  test('FR-RCP-001: positive — 같은 이름이 사전에 들어오면(K가 올라가면) 0건', () => {
    const recap = '그때 장준호가 나타났다.';
    expect(findUnknownNames(recap, DICT, SOURCE)).toEqual(['장준호']);
    expect(findUnknownNames(recap, [...DICT, '장준호'], SOURCE)).toEqual([]);
  });

  test('FR-RCP-001: 사전에 없어도 입력 자료(이미 읽은 범위)에 있는 낱말은 세지 않는다', () => {
    expect(findUnknownNames('주인공은 손수건을 주웠다.', DICT, SOURCE)).toEqual([]);
  });

  test('FR-RCP-001: 조사가 겹쳐 붙어도 이름을 떼어 낸다', () => {
    expect(findUnknownNames('편지는 장준호에게도 전해졌다.', DICT, SOURCE)).toEqual(['장준호']);
  });

  test('FR-RCP-001: 같은 이름이 여러 번 나와도 1건으로 센다', () => {
    expect(
      findUnknownNames('장준호가 왔다. 장준호는 웃었다. 장준호의 손이 떨렸다.', DICT, SOURCE)
    ).toEqual(['장준호']);
  });

  test('FR-RCP-001: 성 + 호칭(○ 씨·○ 군)도 이름꼴로 본다 — 사전·자료에 있으면 0건', () => {
    expect(findUnknownNames('최 씨는 문을 닫았다.', DICT, SOURCE)).toEqual(['최 씨']);
    expect(findUnknownNames('박 군은 문을 닫았다.', DICT, SOURCE)).toEqual([]);
    expect(findUnknownNames('김 씨는 문을 닫았다.', DICT, SOURCE)).toEqual([]);
  });

  test('FR-RCP-001: 사전에 같은 성의 인물이 있으면 성 + 호칭은 세지 않는다', () => {
    expect(findUnknownNames('유 씨는 문을 닫았다.', DICT, SOURCE)).toEqual([]);
  });

  test('FR-RCP-001: 용언·부사·복수형은 이름으로 세지 않는다', () => {
    expect(
      findUnknownNames(
        '하지만 그는 고민하는 얼굴이었다. 이튿날에도 하인들은 조사했는지 물었다. 마침내 이야기는 끝났다.',
        DICT,
        SOURCE
      )
    ).toEqual([]);
  });

  test('FR-RCP-001: 소제목("이전 이야기 요약")만 있는 출력은 0건', () => {
    expect(findUnknownNames('이전 이야기 요약\n\n', DICT, SOURCE)).toEqual([]);
  });
});

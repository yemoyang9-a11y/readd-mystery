/**
 * 리캡 고유명사 검사 — 출력에 "모르는 이름"이 생겼는지 (R2)
 *
 * 조항: FR-RCP-001 🚦 (환각 금지) · FR-QNA-004 🚦 / 절대 규칙 7번 (초과 데이터 접근 금지)
 *
 * 리캡 출력에서 이름꼴 낱말을 골라, 허용 사전(기준 쪽수 K 이하에 처음 나온 인물명·별칭)에도
 * 리캡 입력 자료(K로 이미 잘린 장 요약·원문)에도 없는 것을 돌려준다.
 *
 * ⚠️ K를 넘는 이름은 불러오지 않는다. "이 이름이 뒤에 나오는 인물인가"는 이 코드가 알 수
 *    없고, 알 수 없어야 한다(절대 규칙 7번). 여기서 아는 것은 "허용된 자료에 없는 이름꼴
 *    낱말"이라는 사실뿐이다.
 * ⚠️ 이름꼴 판정은 낱말 모양만 보는 어림 규칙이다(성으로 시작하는 세 글자 + 조사, 성 + 호칭).
 *    두 글자 이름·외국 이름은 놓치고, 자료에 없는 세 글자 일반 명사는 섞일 수 있다. 그래서
 *    결과는 리캡을 막는 데 쓰지 않고 로그 측정에만 쓴다(recap.service.ts).
 * ⚠️ 순수 함수만 둔다. 배치의 reader-text.ts(`introducedNames`)는 import 시점에 게이트웨이를
 *    끌고 오므로 런타임 리캡 경로에서 가져다 쓰지 않는다.
 */

/** 한국 성씨 첫 글자 — 이름꼴 후보를 좁히는 용도 */
const SURNAME =
  '김이박최정강조윤장임한오서신권황안송류유홍전고문양손배백허남심노하곽성차주우구민진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용';

/** 사람 이름 뒤에 흔히 붙는 조사. 장소·시간 조사(에·로·에서)는 일반 명사 오탐이 많아 뺐다 */
const PARTICLE =
  '(?:에게서|에게|한테서|한테|께서|이라는|라는|이라고|라고|이란|은|는|이|가|의|을|를|와|과|도|만|께)';

/** 성으로 시작하는 세 글자 + 조사 1개 이상 */
const FULL_NAME = new RegExp(`^([${SURNAME}][가-힣]{2})${PARTICLE}+$`, 'u');

/** 성 + 띄어 쓴 호칭 (김 씨, 박 군) */
const SURNAME_HONORIFIC = new RegExp(
  `(?<![가-힣])([${SURNAME}])\\s(씨|군|양|옹)(?=${PARTICLE}|[^가-힣]|$)`,
  'gu'
);

/** 용언 활용·복수형으로 끝나는 줄기는 이름이 아니다 (고민하+는, 하인들+은) */
const NOT_A_NAME_ENDING = /[하되했됐있없었았였겠들지니고며서면]$/u;

/** 성씨 글자로 시작하지만 이름이 아닌 흔한 세 글자 낱말 */
const COMMON_WORDS = new Set([
  '이야기',
  '주인공',
  '이튿날',
  '마지막',
  '한동안',
  '소설가',
  '신문사',
  '여주인',
  '모두들',
]);

const compact = (text: string): string => text.normalize('NFKC').replace(/\s+/gu, '');

/**
 * 리캡에 나온 이름꼴 낱말 중 사전에도 입력 자료에도 없는 것. 중복 없이 나온 순서대로.
 *
 * @param recap      리캡 출력 전문
 * @param dictionary 허용 사전 — 반드시 cutoff가 걸린 조회 결과여야 한다(`findIntroducedNames`)
 * @param source     리캡 입력 자료 전문 — K로 이미 잘린 장 요약·현재 장 원문
 */
export function findUnknownNames(recap: string, dictionary: string[], source: string): string[] {
  const known = dictionary.map(compact).filter((name) => name.length >= 2);
  const material = compact(source);
  const allowed = (label: string): boolean => {
    const value = compact(label);
    return (
      material.includes(value) || known.some((name) => name.includes(value) || value.includes(name))
    );
  };

  const found: string[] = [];
  const add = (label: string): void => {
    if (!found.includes(label)) found.push(label);
  };

  for (const token of recap.match(/[가-힣]+/gu) ?? []) {
    const stem = FULL_NAME.exec(token)?.[1];
    if (!stem || NOT_A_NAME_ENDING.test(stem) || COMMON_WORDS.has(stem)) continue;
    if (!allowed(stem)) add(stem);
  }

  for (const match of recap.matchAll(SURNAME_HONORIFIC)) {
    const label = `${match[1]} ${match[2]}`;
    // 사전에 같은 성의 인물이 있으면 그 인물을 줄여 부른 것으로 본다
    if (allowed(label) || known.some((name) => name.startsWith(match[1]))) continue;
    add(label);
  }

  return found;
}

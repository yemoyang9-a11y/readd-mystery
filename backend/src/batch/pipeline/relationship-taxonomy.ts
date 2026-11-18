/**
 * 인물 관계 유형 체계(닫힌 목록) — FR-CHR-001 🚦, FR-DAT-005
 *
 * 근거: docs/context/research-2026-11-18-relationship-classification.md
 *  - Massey et al. 2015(arXiv 1512.00728): 큰 종류(가족·사회·직업) → 세부 종류를 고르는 질문지.
 *    "큰 종류와 세부 종류를 맞춰라" — 세부 종류마다 큰 종류가 하나로 정해진다. 사람 일치도 큰 종류 κ 0.812,
 *    세부 종류 κ 0.744, 호감(긍정·부정·중립) κ 0.364, 변화 κ 0.208.
 *  - Hamilton et al. 2025(arXiv 2502.19590): 같은 질문지를 LLM JSON 응답으로 바꾸자 세부 종류 74%, 큰 종류 55%.
 *    세부 종류가 큰 종류를 정하는데도 LLM이 큰 종류를 틀려서, 큰 종류는 세부 종류에서 파생했다.
 *    → 여기서도 큰 종류(kind)·방향·대칭은 이 표에서 파생한다. LLM이 정하지 않는다.
 *  - Zhao et al. 2024 Conan(arXiv 2402.11051): 추리 서사용 상위 범주(연애·가족·협력·적대·직업)와
 *    적대 안의 의심(Suspected by / Suspicious of)·질투·적. 공개/비밀은 관계 유형이 아니라 관점(누가 아는가)
 *    → 우리 assertion_status·attribution 계약으로 표현한다.
 *  - Jia et al. 2021 DDRel(arXiv 2012.02553): 13종(부모·형제·부부·연인·구애·친구·이웃·룸메이트·상하·동료·
 *    적수·직업 거래). "관계가 분명하고 안정적일 때만 라벨" 원칙.
 *  - Yu et al. 2020 DialogRE(arXiv 2004.08056): 유형 정의, trigger, 역관계(부모↔자식) 함께 주석,
 *    "한두 번 만났다(dates)만으로 연인 관계가 아니다".
 *  - Kim & Klinger 2019(NAACL, N19-1067): 감정 관계 = (느끼는 사람, 감정, 원인 인물), 방향 있음.
 *  - Bugental 2000(Sun et al. 2017 arXiv 1704.06456의 정리): 사회 영역 — 애착·호혜·짝·위계·연합(동료·팀).
 *  - Makazhanov et al. 2014(arXiv 1405.0603): 가족 관계의 대칭(사촌)·역(남편↔아내) 규칙.
 *
 * 관계 = 두 인물 사이에 이어지는 상태(2026-11-18 대표 지시). 한 번 일어난 행동은 이 표에 없다.
 * 이 표 밖의 유형은 저장하지 않는다(type_not_in_taxonomy). 표를 바꾸면 STRUCTURAL_LABEL_VERSION을 올린다.
 */
import { RelationshipSemantics } from '../../shared/types';

/** 질문지의 큰 종류 — Massey(가족·사회·직업) + Conan(연애·적대) + 감정·태도(Kim & Klinger) */
export type RelationCategory =
  'family' | 'romance' | 'social' | 'professional' | 'adversarial' | 'attitude';

/** symmetric = 두 사람 모두에게 같은 관계(부부·동료). directed = 주체 → 대상(부모→자식, 의심하는 사람→의심받는 사람) */
export type RelationDirectionality = 'symmetric' | 'directed';

export interface RelationExclusion {
  /** 응답의 exclusions 키 */
  id: string;
  /** "예"면 이 유형이 아니다 */
  question: string;
  /** "예"일 때 대신 맞는 유형(없으면 관계 아님) */
  instead?: string;
}

export interface RelationType {
  /** semantics.relation_key — 영어 소문자 */
  key: string;
  category: RelationCategory;
  /** 짧은 한국어 이름(검수 표) */
  name: string;
  /** 저장 라벨 — 코드가 정한다(LLM이 쓰지 않는다) */
  label: string;
  directionality: RelationDirectionality;
  /** directed일 때 주체·대상의 역할 */
  roles?: { subject: string; object: string };
  definition: string;
  /** 판정 질문 — "예"여야 이 유형이다 */
  question: string;
  exclusions: RelationExclusion[];
  sources: string[];
}

const ONE_OFF: RelationExclusion = {
  id: 'one_off',
  question: '근거가 한 번 일어난 행동(만남·방문·손을 잡음·구함·때림·말을 건넴)만 말하는가?',
};

/** FR-CHR-001 🚦 — 닫힌 관계 유형 표 */
export const RELATION_TYPES: readonly RelationType[] = [
  // ── 가족 (Massey Familial · Conan Family · DDRel Child-Parent/Siblings/Spouse · Bugental 애착) ──
  {
    key: 'marriage',
    category: 'family',
    name: '부부',
    label: '부부다',
    directionality: 'symmetric',
    definition: '혼인한 사이(남편·아내). 이혼·사별이 원문에 나오면 state=ended.',
    question: '두 사람이 남편과 아내(부부)라고 원문이 말하는가?',
    exclusions: [
      {
        id: 'plan_only',
        question: '혼인의 계획·약속·소문만 말하고 혼인했다고는 말하지 않는가?',
        instead: 'romance',
      },
    ],
    sources: ['Massey15 husband/wife', 'Conan Wife/Husband of X', 'DDRel Spouse'],
  },
  {
    key: 'parenthood',
    category: 'family',
    name: '부모·자식',
    label: '부모다',
    directionality: 'directed',
    roles: { subject: '부모', object: '자식' },
    definition:
      '한 사람이 다른 사람의 아버지·어머니(양부모·계부모 포함). 역관계(자식)는 같은 행으로 본다.',
    question: '한 사람이 다른 사람의 아버지나 어머니라고 원문이 말하는가?',
    exclusions: [
      {
        id: 'address_only',
        question: '"아버지"·"어머니"가 존칭이나 부름말일 뿐 실제 부모라는 말이 없는가?',
      },
    ],
    sources: ['Massey15 parent/child', 'DialogRE per:parents↔per:children', 'Makazhanov14'],
  },
  {
    key: 'sibling',
    category: 'family',
    name: '형제자매',
    label: '형제자매다',
    directionality: 'symmetric',
    definition: '형·오빠·누나·언니·동생 사이(이복·의붓 포함).',
    question: '두 사람이 형제자매라고 원문이 말하는가?',
    exclusions: [
      {
        id: 'address_only',
        question: '"형님"·"누님"이 친근한 부름말일 뿐 실제 형제자매라는 말이 없는가?',
      },
    ],
    sources: ['Massey15 brother/sister', 'DDRel Siblings', 'Makazhanov14 transitivity'],
  },
  {
    key: 'relative',
    category: 'family',
    name: '친척',
    label: '친척이다',
    directionality: 'symmetric',
    definition:
      '부부·부모·형제자매 밖의 친족(사촌·삼촌·고모·조카·사돈·시댁·처가). 세부는 summary에 적는다.',
    question: '두 사람이 부부·부모·형제자매가 아닌 친척이라고 원문이 말하는가?',
    exclusions: [],
    sources: ['Massey15 cousin/uncle/in-law', 'Conan Relative of X'],
  },
  // ── 연애 (Conan Romantic · Massey lovers/unrequited · DialogRE girl/boyfriend vs dates) ──
  {
    key: 'romance',
    category: 'romance',
    name: '연인',
    label: '연인이다',
    directionality: 'symmetric',
    definition: '서로 사랑하는 사이(연인·약혼). 한쪽 마음만 드러나면 affection.',
    question: '두 사람이 서로 사랑하는 사이(연인·약혼)라고 원문이 말하는가?',
    exclusions: [
      {
        id: 'one_side_only',
        question: '한 사람의 마음만 말하고 상대의 마음은 말하지 않는가?',
        instead: 'affection',
      },
      {
        id: 'met_only',
        question: '함께 만나거나 시간을 보냈다는 것만 말하는가?',
      },
    ],
    sources: [
      'Massey15 lovers',
      'Conan Romantic relationships with X',
      'DialogRE per:girl/boyfriend',
    ],
  },
  {
    key: 'affection',
    category: 'romance',
    name: '사랑(한쪽)',
    label: '사랑한다',
    directionality: 'directed',
    roles: { subject: '사랑하는 사람', object: '사랑받는 사람' },
    definition:
      '주체가 대상을 사랑·연모한다. 대상의 마음은 이 행이 말하지 않는다(서로 사랑으로 올리지 않는다).',
    question: '주체가 대상을 사랑하거나 연모한다고 원문이 말하는가?',
    exclusions: [],
    sources: [
      'Massey15 unrequited love interest',
      'Conan Admirer/Fondness of X',
      'Kim19 joy/trust',
    ],
  },
  {
    key: 'lust',
    category: 'romance',
    name: '탐냄',
    label: '탐낸다',
    directionality: 'directed',
    roles: { subject: '탐내는 사람', object: '탐냄의 대상' },
    definition:
      '주체가 대상을 (성적으로) 탐내거나 차지하려 한다. 사랑이라고 원문이 말하면 affection.',
    question: '주체가 대상을 탐내거나 차지하고 싶어 한다고 원문이 말하는가?',
    exclusions: [],
    sources: ['Massey15 unrequited love interest', '기존 운영 키 lust(관계도 이름표 "욕망")'],
  },
  // ── 사회 (Massey Social · Conan Ally · DDRel Friends/Neighbors · Bugental 호혜) ──
  {
    key: 'friendship',
    category: 'social',
    name: '친구',
    label: '친구다',
    directionality: 'symmetric',
    definition: '서로 친하게 지내는 사이(벗·친우·동무).',
    question: '두 사람이 친구(벗·친우)라고 원문이 말하는가?',
    exclusions: [ONE_OFF],
    sources: ['Massey15 friend', 'DialogRE per:friends', 'DDRel Friends'],
  },
  {
    key: 'acquaintance',
    category: 'social',
    name: '아는 사이',
    label: '아는 사이다',
    directionality: 'symmetric',
    definition: '서로 알고 지내지만 친구라고는 하지 않는 사이(이웃·안면).',
    question: '두 사람이 전부터 서로 알고 지내는 사이라고 원문이 말하는가?',
    exclusions: [
      { id: 'first_meeting', question: '이 근거에서 처음 만나거나 처음 소개받는가?' },
      ONE_OFF,
    ],
    sources: ['Massey15 acquaintance', 'DialogRE per:acquaintance', 'DDRel Neighbors'],
  },
  {
    key: 'alliance',
    category: 'social',
    name: '한편',
    label: '한편이다',
    directionality: 'symmetric',
    definition:
      '같은 목적을 위해 손잡고 함께 움직이는 사이(공범·동지). 같은 직업의 일을 함께 맡으면 colleague.',
    question: '두 사람이 같은 목적을 위해 한편이 되어 함께 움직인다고 원문이 말하는가?',
    exclusions: [
      {
        id: 'same_job',
        question: '같은 직업·조직에서 같은 일(같은 사건 수사·같은 극단 공연)을 맡은 사이인가?',
        instead: 'colleague',
      },
      ONE_OFF,
    ],
    sources: ['Conan Quest Companion/Crime Partner of X', 'Bugental coalitional groups'],
  },
  // ── 직업 (Massey Professional · Conan Business · DDRel Superior-Subordinate/Colleague · Bugental 위계·연합) ──
  {
    key: 'colleague',
    category: 'professional',
    name: '동료',
    label: '동료다',
    directionality: 'symmetric',
    definition:
      '같은 일을 함께 맡거나 같은 조직에 속한 사이(같은 사건을 맡은 검사와 경부, 같은 극단의 배우). 한쪽이 다른 쪽을 지휘·고용하면 superior·employment.',
    question:
      '두 사람이 같은 일(같은 사건 수사·같은 무대·같은 업무)을 함께 맡거나 같은 조직(극단·경찰서)에 속한다고 원문이 말하는가?',
    exclusions: [
      {
        id: 'commands',
        question: '한 사람이 다른 사람을 지휘·감독한다고 원문이 말하는가?',
        instead: 'superior',
      },
      {
        id: 'hires',
        question: '한 사람이 다른 사람을 고용해 부린다고 원문이 말하는가?',
        instead: 'employment',
      },
    ],
    sources: [
      'Massey15 colleague',
      'Conan Colleague of X',
      'DDRel Colleague/Partners',
      'Bugental coalitional',
    ],
  },
  {
    key: 'superior',
    category: 'professional',
    name: '윗사람·아랫사람',
    label: '윗사람이다',
    directionality: 'directed',
    roles: { subject: '윗사람(지휘하는 사람)', object: '아랫사람' },
    definition: '같은 조직에서 한 사람이 다른 사람을 지휘·감독한다(좌장과 단원, 상관과 부하).',
    question: '주체가 같은 조직에서 대상을 지휘·감독한다고 원문이 말하는가?',
    exclusions: [
      {
        id: 'hires',
        question: '조직의 위아래가 아니라 개인이 돈을 주고 부리는 사이인가?',
        instead: 'employment',
      },
    ],
    sources: [
      'DialogRE per:boss↔per:subordinate',
      'DDRel Workplace Superior-Subordinate',
      'Conan Superior of X',
    ],
  },
  {
    key: 'employment',
    category: 'professional',
    name: '고용',
    label: '고용한다',
    directionality: 'directed',
    roles: { subject: '고용주·주인', object: '고용된 사람·하인' },
    definition: '주체가 대상을 고용해 부린다(주인과 하인·운전수·비서).',
    question: '주체가 대상을 고용하거나 부리는 주인이라고 원문이 말하는가?',
    exclusions: [],
    sources: ['Massey15 employer/employee, master/servant', 'Conan Employer/Servant of X'],
  },
  {
    key: 'mentorship',
    category: 'professional',
    name: '스승·제자',
    label: '스승이다',
    directionality: 'directed',
    roles: { subject: '스승', object: '제자' },
    definition: '주체가 대상을 가르치는 스승이다.',
    question: '주체가 대상의 스승(선생)이라고 원문이 말하는가?',
    exclusions: [],
    sources: [
      'Massey15 teacher/student',
      'Conan Mentor/Teacher of X',
      'Bugental hierarchical power',
    ],
  },
  {
    key: 'service',
    category: 'professional',
    name: '의뢰',
    label: '의뢰를 맡았다',
    directionality: 'directed',
    roles: { subject: '일을 맡은 사람(탐정·변호사·의사)', object: '의뢰인' },
    definition:
      '주체가 대상의 의뢰를 받아 직업상의 일을 맡고 있다(탐정과 의뢰인, 변호사와 의뢰인).',
    question: '주체가 대상의 의뢰를 받아 직업상의 일을 맡고 있다고 원문이 말하는가?',
    exclusions: [ONE_OFF],
    sources: ['Massey15 person offering service to client/client', 'Conan Service Provider of X'],
  },
  // ── 적대 (Massey enemy/rivals · Conan Antagonistic) ──
  {
    key: 'hostility',
    category: 'adversarial',
    name: '적대',
    label: '적대한다',
    directionality: 'directed',
    roles: { subject: '맞서는 사람', object: '상대' },
    definition: '주체가 대상을 적으로 여기거나 계속 맞선다. 서로 그렇다면 두 행으로 적는다.',
    question: '주체가 대상을 적으로 여기거나 계속 맞선다고 원문이 말하는가?',
    exclusions: [ONE_OFF],
    sources: ['Massey15 enemy', 'Conan Adversary/Enemy of X'],
  },
  {
    key: 'rivalry',
    category: 'adversarial',
    name: '경쟁',
    label: '경쟁한다',
    directionality: 'symmetric',
    definition: '두 사람이 같은 것(사랑·지위·배역)을 두고 겨룬다.',
    question: '두 사람이 같은 것(사랑·지위·배역)을 두고 겨룬다고 원문이 말하는가?',
    exclusions: [],
    sources: ['Massey15 rivals', 'Conan Rival / Rival in Love of X'],
  },
  {
    key: 'suspicion',
    category: 'adversarial',
    name: '의심',
    label: '의심한다',
    directionality: 'directed',
    roles: { subject: '의심하는 사람', object: '의심받는 사람' },
    definition:
      '주체가 대상을 의심하거나 혐의자(범인)로 본다. 사람을 목적어로 둔 의심("B를 의심했다")만 사실로 본다. "B가 범인인지 의심했다"처럼 절을 받는 의심은 사실 단정에서 보류된다(2026-11-18 결정).',
    question: '주체가 대상을 의심하거나 범인·혐의자로 본다고 원문이 말하는가?',
    exclusions: [],
    sources: ['Conan Suspected by X / Suspicious of X / Subject of investigation for X'],
  },
  // ── 감정·태도 (Kim & Klinger: 느끼는 사람 → 원인 인물, 방향 있음) ──
  {
    key: 'hatred',
    category: 'attitude',
    name: '미움',
    label: '미워한다',
    directionality: 'directed',
    roles: { subject: '미워하는 사람', object: '미움받는 사람' },
    definition: '주체가 대상을 미워하거나 원망한다.',
    question: '주체가 대상을 미워하거나 원망한다고 원문이 말하는가?',
    exclusions: [],
    sources: ['Kim19 anger/disgust', 'Conan Hate of X'],
  },
  {
    key: 'jealousy',
    category: 'attitude',
    name: '질투',
    label: '질투한다',
    directionality: 'directed',
    roles: { subject: '질투하는 사람', object: '질투받는 사람' },
    definition: '주체가 대상을 질투하거나 시기한다.',
    question: '주체가 대상을 질투하거나 시기한다고 원문이 말하는가?',
    exclusions: [],
    sources: ['Conan Jealous of X'],
  },
  {
    key: 'trust',
    category: 'attitude',
    name: '신뢰',
    label: '신뢰한다',
    directionality: 'directed',
    roles: { subject: '믿는 사람', object: '믿음받는 사람' },
    definition: '주체가 대상을 믿고 의지한다(사람을 목적어로 둔 믿음).',
    question: '주체가 대상을 믿거나 의지한다고 원문이 말하는가?',
    exclusions: [],
    sources: ['Kim19 trust'],
  },
  {
    key: 'fear',
    category: 'attitude',
    name: '두려움',
    label: '두려워한다',
    directionality: 'directed',
    roles: { subject: '두려워하는 사람', object: '두려움의 대상' },
    definition: '주체가 대상을 두려워하거나 무서워한다.',
    question: '주체가 대상을 두려워하거나 무서워한다고 원문이 말하는가?',
    exclusions: [],
    sources: ['Kim19 fear'],
  },
  {
    key: 'wariness',
    category: 'attitude',
    name: '경계',
    label: '경계한다',
    directionality: 'directed',
    roles: { subject: '경계하는 사람', object: '경계받는 사람' },
    definition: '주체가 대상을 조심하거나 경계한다(의심까지는 말하지 않는다).',
    question: '주체가 대상을 경계하거나 조심한다고 원문이 말하는가?',
    exclusions: [
      {
        id: 'suspects',
        question: '원문이 주체가 대상을 의심하거나 범인으로 본다고 말하는가?',
        instead: 'suspicion',
      },
    ],
    sources: ['Kim19 fear/anticipation', 'Conan Dislike of X'],
  },
  {
    key: 'admiration',
    category: 'attitude',
    name: '존경',
    label: '존경한다',
    directionality: 'directed',
    roles: { subject: '존경하는 사람', object: '존경받는 사람' },
    definition: '주체가 대상을 존경하거나 높이 산다.',
    question: '주체가 대상을 존경하거나 우러른다고 원문이 말하는가?',
    exclusions: [],
    sources: ['Conan Admirer of X', 'Kim19 trust/joy'],
  },
];

/** 큰 종류 → 저장 kind(DB 제약 family/social/emotion — 006 마이그레이션, 추가 전용이라 그대로 쓴다) */
export const CATEGORY_STORAGE_KIND: Record<RelationCategory, RelationshipSemantics['kind']> = {
  family: 'family',
  romance: 'social',
  social: 'social',
  professional: 'social',
  adversarial: 'emotion',
  attitude: 'emotion',
};

export const RELATION_CATEGORIES: readonly RelationCategory[] = [
  'family',
  'romance',
  'social',
  'professional',
  'adversarial',
  'attitude',
];

const BY_KEY = new Map(RELATION_TYPES.map((t) => [t.key, t]));

export function relationType(key: unknown): RelationType | undefined {
  return typeof key === 'string' ? BY_KEY.get(key.trim()) : undefined;
}

/** 저장 kind — 유형 표에서만 파생한다(LLM 응답의 kind는 쓰지 않는다) */
export function storageKind(type: RelationType): RelationshipSemantics['kind'] {
  return CATEGORY_STORAGE_KIND[type.category];
}

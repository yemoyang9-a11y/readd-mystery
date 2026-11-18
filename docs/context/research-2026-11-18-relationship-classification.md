# 인물 관계를 "구분하고 명시"하는 방법 — 관계 유형 체계 논문 조사 (2026-11-18)

대표 지시(2026-11-18): "단순 ai 돌려서 만들지 말고 인물간의 관계를 구분하고 명시에 관한 논문을 찾아 논문 기반 알고리즘 구현 후 그거 기반 ai가 관계를 추출하게해." 범위: 인물관계도(관계 추출)만.

같은 날 앞선 조사 [research-2026-11-18-relationship-extraction.md](research-2026-11-18-relationship-extraction.md)는 **"어느 두 사람 사이에 관계가 있는가(쌍 찾기)"** 를 다뤘다. 이 문서는 그 다음 단계, **"그 관계가 무엇인가(종류 구분)와 어떻게 적는가(명시)"** 를 다룬다. 앞 조사의 쌍 찾기 구조(코드가 후보 쌍과 근거 창을 만들고, AI는 근거 창 안의 정확한 낱말로만 답함)는 그대로 두고, 그 위에 이 문서의 관계 유형 체계와 질문지를 얹었다.

## 0. 한 줄 답

- **관계 종류는 이제 AI가 자유롭게 쓰지 않는다.** 논문들이 쓴 관계 분류표를 합쳐 **닫힌 유형 표 24종**을 코드에 고정했다(`backend/src/batch/pipeline/relationship-taxonomy.ts`). AI는 표 밖의 종류를 쓸 수 없다.
- **AI는 사람 주석자처럼 질문지에 답한다.** 이어지는 관계인가 → 큰 종류 → 세부 유형 → 그 유형의 판정 질문(예/아니오) → 제외 질문(예/아니오) → 주체 → 사실인지·누가 그렇게 말하는지. 이 순서와 질문 방식은 Massey 외(2015)의 사람용 질문지에서 왔다.
- **큰 종류·방향·대칭·라벨은 코드가 표에서 정한다.** Hamilton 외(2025)가 같은 질문지를 AI에 맡기자 세부 종류는 74% 맞혔지만 큰 종류는 55%만 맞혔다(세부 종류가 큰 종류를 정하는데도). 그래서 AI가 큰 종류를 고르게 하지 않고, 세부 유형에서 코드가 정한다.
- **추리물의 "겉으로 알려진 관계 / 감춰진 관계"(Conan)는 관계 종류가 아니라 "누가 그렇게 말하거나 믿는가"다.** 이미 있는 사실 여부(fact/belief/claim/rumor/…)와 출처 인물(attribution) 칸으로 적는다.

## 1. 확인 수준

**전문** = PDF를 받아 해당 절과 부록을 직접 읽음 · **부분** = 방법·결과 절 위주 · **초록** = 초록만 · **간접** = 다른 논문의 서술로만. 이번에 arXiv·ACL Anthology PDF를 직접 받아 읽었다.

| 약칭 | 논문 | 확인 수준 | 이번에 본 곳 |
| --- | --- | --- | --- |
| Massey15 | Massey, Xia, Bamman, Smith (2015). Annotating Character Relationships in Literary Texts. arXiv 1512.00728 | **전문** (7쪽 전부) | 질문지 원문, 표 1(일치도), 그림 1·2(분포) |
| Hamilton25 | Hamilton, Hicke, Mimno, Wilkens (2025). A City of Millions: Mapping Literary Social Networks At Scale. arXiv 2502.19590 | **전문** (본문 4쪽 + 한계) | 3장(질문지를 JSON 스키마로), 4장(검증 수치) |
| Conan | Zhao 외 (2024). Large Language Models Fall Short: Understanding Complex Relationships in Detective Narratives. arXiv 2402.11051 | **전문** (본문 + 부록 C 관계 범주 전체) | 3.2(범주 만들기·일치도), 표 1·3, 부록 C·D.1 |
| DialogRE | Yu, Sun, Cardie, Yu (2020). Dialogue-Based Relation Extraction. ACL 2020, arXiv 2004.08056 | **전문** (2장·부록 A.1 유형 정의) | 표 2(36종), 2.2(주석·trigger·역관계·κ), 부록 A.1 |
| DDRel | Jia, Huang, Zhu (2021). DDRel: A New Dataset for Interpersonal Relation Classification in Dyadic Dialogues. AAAI 2021, arXiv 2012.02553 | **전문** (3~6장) | 13종·6종·4종 표, 주석 절차, 사람 일치도 |
| Kim19 | Kim & Klinger (2019). Frowning Frodo, Wincing Leia, and a Seriously Great Friendship: Learning to Classify Emotional Relationships of Fictional Characters. NAACL 2019 (N19-1067) | **전문** (2~4장) | 감정 관계 정의, 표 1(일치도), 방향 있는 분류 결과 |
| Sun17 (Bugental) | Sun, Schiele, Fritz (2017). A Domain Based Approach to Social Relation Recognition. CVPR 2017, arXiv 1704.06456 | **부분** (1~3장) | Bugental의 사회 영역 5개와 관계 16종 정리. Bugental(2000) 원문은 **간접** |
| Makazhanov14 | Makazhanov, Barbosa, Kondrak (2014). Extracting Family Relationship Networks from Novels. arXiv 1405.0603 | **부분** (3장, 표 2) | 가족 관계 대칭·역 규칙, 전파 규칙과 정밀도 |
| Chaturvedi16 | Chaturvedi, Srivastava, Daumé III, Dyer (2016). Modeling Evolving Relationships Between Characters in Literary Novels. AAAI 2016, arXiv 1511.09376 | **부분** (1~2장) | 관계 상태 = 협력/비협력 2값, 함께 나온 문장 열 |
| Iyyer16 | Iyyer 외 (2016). Feuding Families and Former Friends. NAACL 2016 (N16-1180) | **부분** (1·3·5장) | 비지도 서술자, "사건(결혼·살인)과 대인 상태(사랑·슬픔)"가 섞임 |

## 2. 논문별로 가져온 것

### Massey15 — 질문지(큰 종류 → 세부 종류), 일치도 — **전문**
- 주석자는 인물 쌍마다 **호감(긍정·부정·중립) → 큰 종류(사회·직업·가족) → 세부 종류 → 변화 여부** 순서로 답한다. "큰 종류와 세부 종류를 맞춰라"는 지시가 있고, 세부 종류 목록은 큰 종류마다 따로 있다.
  - 사회: 친구, 적, 아는 사이, 연인, 짝사랑(X는 Y를 사랑하나 Y는 아님), 라이벌
  - 직업: 고용주, 피고용인, 동료, 하인, 주인, 학생, 선생, 의뢰인, 서비스 제공자(변호사 등)
  - 가족: 남편/아내, 형제자매, 사촌, 삼촌/고모, 조카, 자식, 부모, 손주, 조부모, 고아, 양부모, 의붓자식, 의붓부모, 인척, 이복
  - 한 쌍에 관계가 여럿이면(직업: 동료 + 사회: 연인) **행을 따로** 적는다.
- 일치도(표 1, Fleiss κ): **큰 종류 0.812, 세부 종류 0.744, 호감 0.364, 변화 0.208.** 18.1%가 "관계가 바뀐다"고 판단.
- 가져온 것: 질문 순서(큰 종류 → 세부 종류), 세부 종류마다 큰 종류가 하나로 정해지는 구조, 관계가 여럿이면 행을 나누는 규칙. **호감은 묻지 않는다**(사람끼리도 κ 0.364) — 대신 유형 자체가 감정을 말한다(미움·신뢰 등). **변화·종료는 자동 확정하지 않는다**(κ 0.208) → 검수.

### Hamilton25 — 같은 질문지를 AI JSON 응답으로 — **전문**
- Massey 질문지를 Gemini 1.5 Flash의 JSON 스키마 출력으로 바꿔 7만 권에 적용. Massey가 정해 둔 쌍에서 정확도: **호감 81%, 세부 종류 74%, 큰 종류 55%.** "세부 종류가 큰 종류를 하나로 정하는데도 AI가 큰 종류를 더 틀려서, AI가 고른 세부 종류에 해당하는 큰 종류로 바꿔 썼다."
- 결론에서: 구조화된 출력(JSON 스키마)이 규모에서 일관성의 핵심이고, **더 구체적이고 묘사적인 주석이 추상적인 주석보다 잘 맞는다.**
- 가져온 것: **큰 종류는 AI가 아니라 세부 유형에서 코드가 파생**(우리 `storageKind`), JSON 질문지 응답. 큰 종류는 질문 순서를 위해 묻기만 하고, 답이 유형과 다르면 저장값은 표를 따르되 검수 메모(`category_answer_mismatch`)를 남긴다.
- 한계: 쌍 찾기 정확도는 재지 않았다(앞 조사의 구조적 후보가 맡는다).

### Conan — 추리 서사의 관계 범주와 공개/비밀 관점 — **전문**
- 사회과학의 관계 53종(Berscheid 1994, DeVito 2015)에서 시작해 추리소설 10편으로 넓힌 뒤 비슷한 것을 합쳐 **상위 5(연애·가족·협력·적대·직업) / 중간 54 / 세부 163** 단계로 만들었다(3.2, 부록 C). "어머니/시어머니/양어머니를 헷갈리는 것보다 어머니를 낯선 사람으로 보는 것이 훨씬 큰 오류"라서 경계가 흐린 세부 종류는 합쳤다.
- 적대 범주 안에 추리물 특유의 관계가 있다: **의심받음/의심함(Suspected by / Suspicious of X), 수사 대상, 질투, 적·라이벌, 속임·배신.** 직업 범주에 **동료(Colleague of X), 상관·부하.**
- 관계마다 **누구의 관점인가**가 있다: 대부분이 아는 공개 관계, 한두 사람만 아는 비밀 관계, 여러 관점을 합쳐야 나오는 추론 관계.
- 일치도(표 1, F1): 인물 0.974, 쌍에 관계가 있는가 0.817, 관계 하나라도 일치 0.928, 전부 일치 0.782.
- 부록 D.1: 모든 쌍을 하나씩 묻는 방식(PairRelation)은 지어낸 관계가 많아 F1이 가장 낮고, **"정밀도가 낮은 것(틀린 관계)이 재현율이 낮은 것(놓침)보다 독자에게 더 해롭다."**
- 가져온 것: 적대 범주와 그 안의 **의심(suspicion)**, 직업의 **동료(colleague)·상관(superior)** — 대표가 짚은 관계의 문헌 근거. 공개/비밀은 관계 유형으로 만들지 않고 **사실 여부 + 출처 인물(누가 그렇게 말하거나 믿는가)** 로 적는다(기존 `assertion_status`·`attribution`). 살해·피해자 같은 일회성 행위(Murderer of X)는 넣지 않았다(2026-11-18 결정: 행동은 사건).
- 넣지 않은 것: 속임·배신(Deceiver/Betrayer) — 한 번의 거짓말과 이어지는 속임을 원문 낱말로 가르기 어렵고, 틀리면 결말을 암시할 위험이 커서 보류했다. 필요하면 대표 결정 뒤 표에 더한다.

### DialogRE — 유형 정의, trigger, 역관계 — **전문**
- 36종(사람 사이: 좋은 인상·나쁜 인상·아는 사이·동문·상사·부하·의뢰인·데이트·친구·연인·이웃·룸메이트·자식·기타 가족·부모·형제자매·배우자 등). 부록 A.1에 새 유형 정의가 있다. 예: "**한두 번 데이트한 것만으로는 연인 관계라고 할 수 없다 — 그런 쌍은 데이트(dates)로 단다**", 상사는 "A가 B에게 직접 보고하고 B가 A를 관리할 때".
- 주석: trigger = 관계를 가장 분명히 보여 주는 최소 연속 낱말. 역관계가 있는 유형(부모↔자식)은 같은 trigger로 역 삼중항도 단다. 두 주석자 Cohen κ 약 0.87.
- 가져온 것: 유형마다 **정의 + 포함/제외 기준**을 적는 형식, "만남 ≠ 연인"(우리 `romance`의 제외 질문 `met_only`), 상사 정의(우리 `superior`), 역관계는 한 행으로(부모→자식만 저장, `parenthood`).

### DDRel — 13종 대인 관계와 "분명할 때만 라벨" — **전문**
- 13종(Reis & Sprecher 2009 기반): 부모·자식, 자식·다른 웃어른, 형제자매, 배우자, 연인, 구애, 친구, 이웃, 룸메이트, 직장 상하, **동료/협력자**, **적수(Opponents)**, 직업상 거래. 6종·4종으로도 묶는다.
- 주석 규칙: "관계가 분명하고 비교적 안정적이고 전형적일 때만 라벨을 단다." 전체 영화 정보를 본 주석자 κ 0.823. 그런데 **대화 한 장면만 보면 사람도 κ 0.301(13종)·0.429(4종)** 로 떨어진다.
- 가져온 것: 근거 창(짧은 조각)만 보고 종류를 정하는 일은 사람에게도 어렵다 → **판정 질문에 "예"이고 원문 낱말(trigger)이 있을 때만 유형을 단다**, 아니면 비운다. 동료·적수 유형의 근거.

### Kim19 — 감정 관계는 방향이 있다 — **전문**
- 감정 관계 = (느끼는 인물, 감정, 원인 인물). Plutchik 8감정(분노·기대·혐오·두려움·기쁨·슬픔·놀람·신뢰). 부정·약화도 표시.
- 일치도(표 1, F1): 원문 위치까지 같은지 19~33%, 관계도(그래프) 수준 라벨 일치 66~69%, 라벨 없이 관계 유무 90~93%. 방향 있는 8종 분류 최고 F1 0.41.
- 가져온 것: 감정·태도 유형(미움·신뢰·두려움·경계·존경)은 **방향 있음(느끼는 사람 → 대상)**, 서로 향하면 행을 둘로. 위치 수준 일치가 낮으므로 원문 위치를 코드가 검사(trigger)한다.

### Sun17이 정리한 Bugental의 사회 영역 — **부분 / Bugental 원문 간접**
- 애착(부모·자식), 호혜(친구·형제), 짝(연인·배우자), 위계(지도자·부하, 선생·학생), **연합(동료·팀원 — "우리와 그들"을 가르는 집단, 같은 활동을 함께 함)**.
- 가져온 것: 동료 = "같은 일을 함께 맡거나 같은 조직에 속함", 위계는 따로(지휘·고용이면 동료가 아님 → 동료의 제외 질문).

### Makazhanov14 — 가족 관계의 대칭·역 — **부분**
- 사촌은 대칭, 남편↔아내는 역관계 같은 **보완 규칙**과 전이 규칙으로 관계를 늘리면 재현율은 오르지만 잘못된 시작 관계가 번져 정밀도가 떨어진다.
- 가져온 것: 대칭/방향을 유형 표에 고정(부부·형제자매·친척은 대칭). **전이 규칙으로 관계를 자동으로 늘리지 않는다**(정밀도 우선 — Conan 부록 D.1과 같은 판단).

### Chaturvedi16, Iyyer16 — 관계와 사건을 나누는 근거 — **부분**
- Chaturvedi16: 관계 상태는 두 인물이 함께 나온 문장 열에서 협력/비협력으로 변한다.
- Iyyer16: 비지도로 배운 관계 서술자가 "사건(결혼·살인)"과 "대인 상태(사랑·슬픔)"를 함께 담았다. 이전 모델(HTMM)은 사건·장소(식사·야외) 쪽으로 쏠렸다.
- 가져온 것: **관계(이어지는 상태)와 사건(한 번 일어난 일)을 분리**하는 2026-11-18 결정의 문헌 근거. 질문지 1번 "이어지는 관계인가"가 이 구분이다.

## 3. 만든 관계 유형 표 (24종)

`backend/src/batch/pipeline/relationship-taxonomy.ts`의 `RELATION_TYPES`. 저장 kind는 DB 제약(family/social/emotion, 006 마이그레이션 — 추가 전용이라 그대로)에 맞춰 큰 종류에서 파생한다.

| 큰 종류 → 저장 kind | 유형 키 (라벨) | 방향 | 근거 |
| --- | --- | --- | --- |
| 가족 → family | marriage (부부다) | 대칭 | Massey husband/wife, Conan, DDRel Spouse |
| | parenthood (부모다) | 부모 → 자식 | Massey, DialogRE parents↔children, Makazhanov |
| | sibling (형제자매다) | 대칭 | Massey, DDRel |
| | relative (친척이다) | 대칭 | Massey 사촌·삼촌·인척, Conan Relative |
| 연애 → social | romance (연인이다) | 대칭 | Massey lovers, Conan, DialogRE girl/boyfriend |
| | affection (사랑한다) | 사랑하는 사람 → 대상 | Massey 짝사랑, Conan Admirer |
| | lust (탐낸다) | 탐내는 사람 → 대상 | Massey 짝사랑, 기존 운영 키 lust |
| 사회 → social | friendship (친구다) | 대칭 | Massey, DialogRE, DDRel |
| | acquaintance (아는 사이다) | 대칭 | Massey, DialogRE, DDRel 이웃 |
| | alliance (한편이다) | 대칭 | Conan 동행·공범, Bugental 연합 |
| 직업 → social | **colleague (동료다)** | 대칭 | Massey, Conan, DDRel, Bugental 연합 |
| | superior (윗사람이다) | 윗사람 → 아랫사람 | DialogRE boss, DDRel 상하, Conan |
| | employment (고용한다) | 고용주 → 고용된 사람 | Massey employer·master, Conan |
| | mentorship (스승이다) | 스승 → 제자 | Massey, Conan, Bugental 위계 |
| | service (의뢰를 맡았다) | 일 맡은 사람 → 의뢰인 | Massey 서비스 제공자, Conan |
| 적대 → emotion | **hostility (적대한다)** | 맞서는 사람 → 상대 | Massey enemy, Conan Adversary |
| | rivalry (경쟁한다) | 대칭 | Massey rivals, Conan Rival |
| | **suspicion (의심한다)** | 의심하는 사람 → 의심받는 사람 | Conan Suspected by / Suspicious of |
| 감정·태도 → emotion | hatred (미워한다) | 방향 있음 | Kim19, Conan Hate |
| | jealousy (질투한다) | 방향 있음 | Conan Jealous |
| | trust (신뢰한다) | 방향 있음 | Kim19 trust |
| | fear (두려워한다) | 방향 있음 | Kim19 fear |
| | wariness (경계한다) | 방향 있음 | Kim19, Conan Dislike |
| | admiration (존경한다) | 방향 있음 | Conan Admirer |

유형마다 코드에 **정의, 판정 질문(예여야 그 유형), 제외 질문(예면 그 유형이 아님, 대신 볼 유형)** 이 있다. 예:
- colleague 판정 질문: "두 사람이 같은 일(같은 사건 수사·같은 무대·같은 업무)을 함께 맡거나 같은 조직(극단·경찰서)에 속한다고 원문이 말하는가?" 제외: 한 사람이 지휘하는가(→superior), 고용해 부리는가(→employment).
- suspicion: "주체가 대상을 의심하거나 범인·혐의자로 본다고 원문이 말하는가?" — 사람 목적어("B를 의심했다")만 사실로 본다. "B가 범인인지 의심했다"처럼 절을 받는 의심은 전처럼 사실 단정에서 보류(2026-11-18 결정 ④ 유지).
- friendship·acquaintance·alliance·service·hostility 제외: "근거가 한 번 일어난 행동(만남·방문·손을 잡음·구함·때림·말을 건넴)만 말하는가?" → 예면 `one_off_action`.

표에 없는 것: 한 번 일어난 행동 전부(손잡음·구함·찾아감·살해), 호감 점수(Massey κ 0.364), 속임·배신(위 Conan 참고).

## 4. 질문지와 코드 검사 (알고리즘)

앞 조사의 구조(후보 쌍 → 근거 창 → trigger 검사 → 확립 쪽 = 검증된 가장 이른 근거 쪽 → 2회 일치 → 반대 검토자 → 사람 검수)는 그대로다. 바뀐 곳은 "라벨" 단계다.

AI 응답(관계마다, 이 순서로):
1. `lasting` 이어지는 관계인가 (Iyyer16·Chaturvedi16의 관계/사건 구분, 2026-11-18 결정)
2. `category` 큰 종류 (Massey 질문 순서)
3. `type` 유형 키 — 표 안에서만
4. `type_question` 그 유형의 판정 질문 답
5. `exclusions` 제외 질문 답들
6. `subject` 방향 있는 유형의 주체
7. `assertion_status`·`attribution` 사실 여부와 출처 인물 (Conan 공개/비밀, Saurí & Pustejovsky 2012)
8. `state`·`change_type`
9. `summary`·`rationale`
10. `support` 근거 창 id + trigger (DialogRE)

코드 검사(`relationship-labeling.ts`의 `interpretAnswer` → 기존 `verifyPairLabels`):

| 검사 | 걸리면 | 근거 |
| --- | --- | --- |
| `lasting`이 false, 옛 형식 action/event, 제외 질문 `one_off`가 예 | 보류 `one_off_action` | 2026-11-18 결정, Iyyer16 |
| 유형이 표 밖 | 보류 `type_not_in_taxonomy` | 닫힌 표 |
| 판정 질문 답이 정확히 true가 아님 | 보류 `type_question_not_affirmed` | Massey 질문지, DDRel "분명할 때만" |
| 제외 질문 중 예가 있음 / 답이 빠짐 | 보류 `exclusion_applies:…→대신 유형` / `exclusion_unanswered:…` | DialogRE 정의의 제외 기준 |
| 방향 있는 유형인데 주체가 두 사람 중 하나가 아님 | 보류 `subject_not_in_pair` | Kim19 방향 |
| 큰 종류·라벨·relation_key·방향·대칭 | **AI 값을 버리고 표에서 정함** | Hamilton25 |
| 큰 종류 답이 유형과 다름 | 저장은 표대로, 검수 `category_answer_mismatch` | Hamilton25 |
| 변화(transition)·공개(disclosure)·종료(ended) | 검수 `change_needs_review` | Massey 변화 κ 0.208 |
| 두 실행의 일치 | 쌍·방향뿐 아니라 **유형까지** 같아야 일치 | 자기 일관성 |
| 반대 검토자 | 유형 정의를 함께 보여 준다 | CoVe(앞 조사) |
| (기존) 후보 쌍 밖·trigger 위치·문장에 두 인물·사실성 단서·방향 격조사·확립 쪽 | 그대로 | 앞 조사 |

## 5. 한계 — 같이 읽을 것

- 판정 질문의 "예"는 AI의 답이다. 코드는 답의 **형식과 일관성**(표 안인지, 예/아니오가 맞는지, 근거 낱말이 그 문장에 있는지)을 검사할 뿐 **뜻이 맞는지는 보장하지 못한다.** 뜻은 2회 일치·반대 검토자·사람 검수가 맡는다(R12).
- 유형 표의 우리말 정의와 판정 질문은 논문 범주를 옮겨 우리가 쓴 것이다. 한국어 근대 추리소설에서의 사람 일치도는 재지 않았다.
- 유명 작품은 AI가 이미 줄거리를 알 수 있다(A10). 질문지가 근거 창 밖 기억을 금지하지만 구조로 막지는 못한다.
- 프런트 관계도 이름표(`frontend/src/components/Ssabi/graphEdges.ts`의 짧은 이름 표)에 새 유형 키(colleague·superior·hostility·trust 등)가 없다. 지금은 라벨("동료다")이 그대로 보인다 — 프런트 수정은 이번 범위 밖.
- 실제 실행 결과와 수치: [docs/validation/2026-11-18-relationships-claude/summary.md](../validation/2026-11-18-relationships-claude/summary.md).

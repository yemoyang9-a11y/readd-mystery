# RE:ADD — 추리소설 전용 독서 플랫폼

**추리소설 독자가 끝까지 스스로 추리하는 재미를 지킨다**

[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)](https://www.typescriptlang.org/)

> **처음 보는 사람·새 세션은 [docs/context/README.md](docs/context/README.md)부터 읽는다.** 현재 방향, 결정 요약, 코드와 결정이 다른 곳, 문서별 상태가 있다.

**운영 주소 — <https://ssabi-d4c.pages.dev>** (2026-11-17 현재 **피벗 전 버전**이 돌고 있다. 이 저장소의 추리 노트·관리자 화면·커뮤니티 등은 아직 배포되지 않았다)

> 백엔드가 스케일-투-제로로 떠 있어 **첫 요청이 약 7초** 걸린다(유휴 상태에서 컨테이너를
> 깨우는 시간). 이후 요청은 수십 ms다.

---

## 무엇을 하는 서비스인가

추리소설을 끊어 읽으면 앞의 단서를 잊는다. 되찾으려고 책 밖에서 검색하면
**아직 안 읽은 결말까지 보게 된다.**

RE:ADD는 본문을 이 사이트에서 읽는 추리소설 전용 독서 플랫폼이다. 읽기 화면 옆 패널(싸비)은
**독자가 가장 멀리 읽은 쪽까지만** 알고, **독자의 추리를 판정하지 않는다.**

| 기능 | 하는 일 |
| --- | --- |
| 추리 노트 | 독자가 직접 적는 메모. 쪽수가 붙고 AI 친구가 함께 본다 |
| 인물관계도 | 가장 멀리 읽은 쪽까지 드러난 인물·관계만 표시 |
| AI 친구(아모) | 읽은 범위의 근거로 장면을 찾아 주고, 가설이 맞는지 틀린지는 판정하지 않는다 |
| 리캡 | 브리핑 화면에서 기준 쪽수까지의 줄거리를 LLM 1회로 종합 |
| 타임라인 | 다 읽은 장만 장별 간략 요약 — **결정됨, 아직 구현 안 됨** |

검증 작품은 김내성 「가상범인」(저작권 만료)이다. 「탁류」는 기술 검증용으로 남아 있다.

**이력:** 2026년 8월 AWS 교육 과정 팀 프로젝트로 「탁류」 전자책 리캡 서비스(싸비)를 만들었고,
이후 인프라를 AWS 밖으로 옮겼다. 2026-11 추리소설 전용 플랫폼으로 방향을 바꿨다.

---

## 이 저장소에서 볼 만한 것 — 스포일러를 "구조로" 막는다

이 시스템의 존재 이유는 **읽지 않은 부분을 절대 노출하지 않는 것**이다. 기능이 잘
동작해도 스포일러가 한 건 새면 실패다. (2026-11부터 기준은 "가장 멀리 읽은 쪽"이다. 아래 서술의 "마지막으로 열어본 페이지"는 이전 기준) 그래서 릴리스 게이트 29개 중 절반 이상이
이 하나에 걸려 있다.

핵심은 "숨기는 코드"를 만들지 않는 것이다.

> **기준점 초과 여부를 "판별"하는 코드를 만들지 않는다.**
> 시스템의 어느 경로도 기준점 초과 데이터에 **접근하지 않으므로**, 판별할 능력 자체가
> 없어야 한다. 그게 이 조항이 성립하는 방식이다.

구체적으로 이런 규칙들이 코드 전반에 걸려 있다.

- 조회·조립 함수는 **cutoff 인자 없이** 저장소에 접근할 수 없다
- 상한은 **데이터 선택 단계**에서만 건다 — 조회는 쿼리 조건, 리캡은 입력 절단,
  챗봇은 근거 조립 범위. **프롬프트 지시로 상한을 걸지 않는다**
- 기준점을 파생하는 함수는 하나뿐이고, 프론트 포함 어디서도 `%`나 cutoff 를
  다시 계산하지 않는다
- 상한 필터를 **우회하는 폴백 경로를 두지 않는다** — 실패하면 미노출이 원칙이다

전체 목록과 근거는 [CLAUDE.md](CLAUDE.md) 2·4장에 있다.

**한계도 적어 둔다.** 「탁류」는 공개 도메인 유명 작품이라 모델이 줄거리를 이미 알 수
있다. 근거에서 빼도 자기 기억으로 답할 가능성이 남으며 **구조로 막지 못한다.**
프롬프트 규칙이 유일한 수단이고 100% 보장이 아니다.

---

## 아키텍처

2026-10-22 코드 기본 설정은 OpenAI Responses API의 `gpt-6-luna`와 추론 수준
`low`다. 아래 구성의 운영 반영 여부는 배포 및 운영 검증 결과로 확인한다.

```
방문자
  ├─ 정적 자산 ──► Cloudflare Pages
  └─ API (SSE) ──► Fly.io (도쿄, 컨테이너 1개, 스케일-투-제로)
                      ├─► Supabase PostgreSQL + pgvector
                      ├─► OpenAI Responses API (gpt-6-luna, low)
                      └─► Cohere (embed-v4.0, 1024차원)
```

상시 가동 자원이 없다. 방문이 없으면 컨테이너가 정지하고 그 시간에 컴퓨트 과금이
붙지 않는다. 콜드스타트 약 7초가 그 대가다.

원래는 EC2 2대 + Multi-AZ RDS + ALB + Elastic IP 2개가 전부 상시 가동이었다.
발표가 끝난 뒤 이 구조를 유지할 이유가 사라져 옮겼다 —
**같은 동작을, 상시 과금 없이, 언제든 접근 가능한 상태로**가 목표였다.

| 계층 | AWS 구성 | AWS 이탈 당시 구성 (2026-09-01) |
| --- | --- | --- |
| 정적 프론트 | S3 + CloudFront | Cloudflare Pages |
| 백엔드 | EC2 ×2 + ALB + nginx + PM2 | Fly.io 컨테이너 1개 |
| DB | RDS PostgreSQL Multi-AZ | Supabase PostgreSQL |
| LLM | Amazon Bedrock | Anthropic API |
| 임베딩 | Titan Embed v2 (1024) | Cohere embed-v4 (1024) |

이전 과정 기록(옛 `docs/migration.md`)은 2026-11-17 피벗 전 문서 정리 때 지웠다. 필요하면 git 기록에서 본다.

---

## 기술 스택

**Backend** — Node.js 22 · TypeScript · Express · PostgreSQL + pgvector
**Frontend** — React 18 · TypeScript · Vite · Tailwind CSS · React Router
**Infra** — Docker · Fly.io · Cloudflare Pages · GitHub Actions

---

## 로컬에서 실행하기

2026-10-22 로컬 코드 기본 LLM은 OpenAI Responses API의 `gpt-6-luna` (`low`)다.
`backend/.env`의 `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL`,
`OPENAI_REASONING_EFFORT`로 생성 추론을 설정한다. 챗봇은 읽은 범위의 근거를 검색한 뒤
답변 생성 모델을 한 번 호출하고, 생성되는 텍스트를 바로 스트리밍한다. 별도의 검토 모델
호출이나 답변 재생성 단계는 없다. 기존 Anthropic 경로는 `LLM_PROVIDER=anthropic`으로
명시적으로 선택할 때만 사용한다. 위 운영 배포 구성은 이번 로컬 변경만으로 바뀌지 않는다.
사용자는 2026-10-22에 PR 작성, CI/CD 확인, 병합, 운영 테스트까지 승인했다.
배포 완료 여부는 실제 배포 상태와 운영 응답을 확인한 검증 기록으로 판정한다.
운영 데이터 교정 범위는 승인된 전봇대 노트·관계의 페이지 정보 2행이며,
전체 도서 재생성이나 원문 페이지 재분할은 포함하지 않는다.

Node 20 이상이 필요하다.

```bash
# Backend
cd backend
npm install
cp .env.example .env      # DATABASE_URL·API 키 입력
npm run dev               # http://localhost:3000

# Frontend (별도 터미널)
cd frontend
npm install
cp .env.example .env      # VITE_API_URL 확인
npm run dev               # http://localhost:5173
```

`backend/.env.example` 과 `frontend/.env.example` 에 각 값의 의미와 함정이 주석으로
적혀 있다. 특히 **`VITE_API_URL` 에 `/api` 접두사를 붙이면 전 요청이 404** 가 된다 —
예전 CloudFront 구성의 잔재다.

DB 없이 화면만 보려면 `frontend/.env` 에 `VITE_USE_MOCK=true` 를 둔다.

```bash
npm test          # 각 디렉터리에서
npx tsc --noEmit
```

---

## 문서

| 문서 | 내용 |
| --- | --- |
| [docs/context/README.md](docs/context/README.md) | **가장 먼저 읽을 문서** — 현재 방향, 코드 상태, 문서별 상태 |
| [docs/context/decisions.md](docs/context/decisions.md) | 사업·설계 결정 기록 사본 |
| [CLAUDE.md](CLAUDE.md) | 절대 규칙·시스템 불변식 R1~R12·용어 |
| [PRODUCT.md](PRODUCT.md) | 제품 정의 (2026-11-17 추리 방향) |
| [docs/architecture/architecture-r1.md](docs/architecture/architecture-r1.md) | 논리·앱·데이터 아키텍처 (설계 1회차) |
| [docs/architecture/architecture-current.md](docs/architecture/architecture-current.md) | **현재 인프라 구성** |

8월 기획 단계 산출물(PRD·유스케이스·FR/NFR·개발 명세)은 이 저장소에 없다. 8월 해커톤 시기 문서(인수인계·화면 계획·AWS 인프라·Terraform)는 2026-11-17에 지웠다. 필요하면 git 기록에서 본다.

---

## 팀

2026년 8월 해커톤 4인 팀으로 만들었다. 아래 파트 분담은 그때 기준이다. 지금도 4인 팀이며 역할 분담은 아직 정하지 않았다(결정 14). 파트 표기 R1~R5는 커밋 분류로 쓴다.

| 파트 | 담당 | 책임 |
| --- | --- | --- |
| R1 | 권희준 | 데이터·전처리 파이프라인 |
| R2 | 진승호 | 독서 상태·기준점·리캡 |
| R3 | 이예나 | AI 경로·LLM 게이트웨이·챗봇 |
| R4 | 양예모 | 프론트엔드·조회 API |

발표 이후의 AWS 이탈 이전은 양예모가 단독으로 진행했다.

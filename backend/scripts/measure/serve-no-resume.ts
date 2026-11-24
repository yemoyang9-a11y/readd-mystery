/**
 * AI 원가 측정 전용 서버 기동 (NFR-OBS-004, 2026-11-24) — src/index.ts 를 그대로 띄우되
 * 기동 직후의 수집 작업 이어 달리기(resumeIngestJobs)만 끈다.
 *
 * 왜: 다른 책의 업로드 작업이 같은 로컬 DB에서 running 인 동안 서버를 띄우면, index.ts 가 그 작업을
 *     이어 돌려 같은 책을 두 프로세스가 동시에 생성한다(2026-11-24 측정 중 실제로 1회 발생).
 * 하는 일: composition 모듈의 resumeIngestJobs 를 아무것도 안 하는 함수로 바꾼 뒤 index.ts 를 불러온다.
 *     덮어쓰기가 안 되면 서버를 띄우지 않고 멈춘다(이어 달리기가 도는 일이 없게). 운영 경로에서 쓰지 않는다.
 * 사용(backend 폴더): npx ts-node --transpile-only scripts/measure/serve-no-resume.ts
 */
import * as composition from '../../src/modules/ingest/composition';

const target = composition as unknown as { resumeIngestJobs: () => Promise<void> };
const noResume = async (): Promise<void> => {
  console.log('[measure] resumeIngestJobs 건너뜀 — 측정 서버는 업로드 작업을 이어 돌리지 않는다');
};
target.resumeIngestJobs = noResume;
if (target.resumeIngestJobs !== noResume) {
  console.error('[measure] resumeIngestJobs 를 끌 수 없어 서버를 띄우지 않는다');
  process.exit(4);
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../../src/index');

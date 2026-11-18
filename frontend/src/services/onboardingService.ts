import { api } from './api';

/** 이 기기에서 첫 이용 가이드를 마쳤거나 건너뛴 표시 (2026-11-18 대표 지시) */
export const ONBOARDED_STORAGE_KEY = 'readd.onboarded';

export function hasOnboardedLocally(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 첫 이용 가이드를 끝냈다고 기록한다 — 가이드를 마치거나 건너뛸 때 부른다.
 *
 * 기기 표시를 먼저 남기고 서버에 알린다. 서버 기록이 실패해도(로그인 전·네트워크 오류)
 * 가이드는 막히지 않는다 — 오류는 삼킨다. 진도·기준점과는 무관한 계정 표시다.
 */
export async function markOnboarded(): Promise<void> {
  try {
    window.localStorage.setItem(ONBOARDED_STORAGE_KEY, '1');
  } catch {
    // 저장소를 쓸 수 없는 브라우저 — 서버 기록만 시도한다
  }
  try {
    await api.post('/auth/me/onboarded');
  } catch {
    // 실패해도 가이드 종료는 그대로 진행한다
  }
}

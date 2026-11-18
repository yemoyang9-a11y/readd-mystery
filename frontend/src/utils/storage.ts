/**
 * localStorage 헬퍼.
 * 디바이스 식별자는 8/20 팀 결정으로 **클라이언트가 최초 실행 시 생성**한다
 * (team-sync-r4.md §4.8 — API_CONTRACT.md 원문과 다르지만, R2·R3가 이미 헤더 없는 요청을
 * 400으로 거절하도록 구현해둔 실제 동작에 맞춘 결정. services/api.ts 의 ensureDeviceId 참조).
 */

import { STORAGE_KEYS } from './constants';

export function getDeviceId(): string | null {
  return localStorage.getItem(STORAGE_KEYS.deviceId);
}

export function setDeviceId(deviceId: string): void {
  localStorage.setItem(STORAGE_KEYS.deviceId, deviceId);
}

export const AUTH_TOKEN_CLEARED_EVENT = 'ssabi:auth-token-cleared';

export function getAuthToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.authToken);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(STORAGE_KEYS.authToken, token);
}

/**
 * 토큰이 지워진 까닭. 'logout' 은 독자가 직접 로그아웃·탈퇴한 경우, 'expired' 는 서버가
 * 거절(401)했거나 계정이 없어진 경우다. 관문은 'logout' 일 때만 가려던 주소(next)를 버린다
 * (E2E #81 — 로그아웃 뒤 다시 로그인하면 홈에서 새로 시작한다).
 */
export type AuthClearReason = 'logout' | 'expired';

export function clearAuthToken(reason: AuthClearReason = 'expired'): void {
  localStorage.removeItem(STORAGE_KEYS.authToken);
  window.dispatchEvent(new CustomEvent<{ reason: AuthClearReason }>(AUTH_TOKEN_CLEARED_EVENT, { detail: { reason } }));
}

export function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function activeConversationKey(bookId: string): string {
  return `ssabi.chat_conversation.${bookId}`;
}

/** 책별로 마지막으로 이어가던 챗봇 대화 세션을 보관한다. */
export function getActiveChatConversationId(bookId: string): number | null {
  const raw = localStorage.getItem(activeConversationKey(bookId));
  if (raw === null) return null;

  const conversationId = Number(raw);
  return Number.isInteger(conversationId) && conversationId > 0 ? conversationId : null;
}

export function setActiveChatConversationId(bookId: string, conversationId: number): void {
  localStorage.setItem(activeConversationKey(bookId), String(conversationId));
}

export function clearActiveChatConversationId(bookId: string): void {
  localStorage.removeItem(activeConversationKey(bookId));
}

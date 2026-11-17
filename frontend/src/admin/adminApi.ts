import { API_BASE_URL } from '../utils/constants';

export const ADMIN_TOKEN_KEY = 'ssabi.admin_token';

export function loadAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveAdminToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
    else localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // 저장소가 차단되어도 현재 세션의 관리자 요청은 계속 사용할 수 있다.
  }
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

// FR-ADM-006 🚦
export async function adminRequest<T = unknown>(
  token: string,
  path: string,
  init: { method?: string; json?: unknown; text?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body: string | undefined;
  if (init.text !== undefined) {
    headers['Content-Type'] = 'text/plain; charset=utf-8';
    body = init.text;
  } else if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/admin${path}`, {
      method: init.method ?? 'GET',
      headers,
      body,
    });
  } catch {
    throw new AdminApiError(0, 'NETWORK', '서버에 연결할 수 없습니다');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AdminApiError(
      res.status,
      data.error ?? 'ERROR',
      data.message ?? `요청 실패 (${res.status})`,
      data
    );
  }
  return data as T;
}

export type JobStatus = 'queued' | 'running' | 'failed' | 'review_ready' | 'published';

export interface JobSummary {
  job_id: string;
  book_id: string;
  title: string;
  status: JobStatus;
  step: string;
  error: string | null;
  updated_at: string;
}

export interface UploadInput {
  file: File;
  title: string;
  author: string;
  year: string;
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'utf-8');
  });
}

// FR-ADM-005
export async function uploadBook(token: string, input: UploadInput) {
  const params = new URLSearchParams({ title: input.title.trim(), author: input.author.trim() });
  if (input.year.trim()) params.set('year', input.year.trim());
  const text = await readFileText(input.file);
  return adminRequest<{ book_id: string; job_id: string }>(token, `/books?${params}`, {
    method: 'POST',
    text,
  });
}

export interface AnalyticsSummary {
  daily: { date: string; visitors: number; sessions: number }[];
  referrers: { source: string; sessions: number }[];
  top_paths: { path: string; views: number }[];
  top_clicks: { target: string; count: number }[];
  avg_session_ms: number;
}

export interface MissingItem {
  target_type: string;
  target_id: string;
  missing_criteria: string[];
}

export interface ReviewRelationship {
  id: string;
  from: string;
  to: string;
  label: string;
  established_page: number;
  quote: string | null;
  quote_page: number | null;
  check: string;
  reasons: string[];
}

export interface ReviewView {
  book: {
    book_id: string;
    title: string;
    author: string;
    total_pages: number;
    publish_status: string;
  };
  job: { job_id: string; status: JobStatus; step: string; error: string | null };
  pages_preview: { page_no: number; excerpt: string }[];
  characters: {
    id: string;
    name: string;
    first_appearance_page: number;
    aliases: { alias: string; alias_type: string }[];
    notes: { id: string; note: string; source_page: number }[];
  }[];
  relationships: ReviewRelationship[];
  chapter_summaries: { chapter_no: number; summary: string }[];
  terms: { id: string; term: string; definition: string; first_appearance_page: number }[];
  events: { id: string; event: string; description: string; occurrence_page: number }[];
  background_and_intro: { kind: string; content: string }[];
  integrity: unknown;
  held: { target_type: string; label: string; reasons: string[] }[];
  held_candidates: { kind: string; reason: string; count: number }[];
  review: { complete: boolean; missing: MissingItem[] };
}

export interface Decision {
  target_type: string;
  target_id: string;
  verdict: 'approve' | 'reject';
}

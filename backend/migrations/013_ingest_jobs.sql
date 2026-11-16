-- 업로드 작업 — FR-ADM-005, FR-ADM-006
CREATE TABLE IF NOT EXISTS ingest_jobs (
  job_id UUID PRIMARY KEY,
  book_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  publish_year INTEGER,
  source_sha256 TEXT NOT NULL UNIQUE,
  source_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'failed', 'review_ready', 'published')),
  step TEXT NOT NULL DEFAULT 'split_register'
    CHECK (step IN ('split_register', 'generate', 'integrity', 'register_content', 'embed', 'review_ready')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

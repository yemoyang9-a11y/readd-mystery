#!/usr/bin/env node
/* 관계 실행 결과 → 운영 DB 반영용 apply-rows.json + 로컬 교체 검사. DB 쓰기 0회, LLM 호출 0회.
   usage: node evaluation/relationships/build-apply-rows.cjs <실행 폴더> <db-snapshot.json>
   db-snapshot.json: {book_id, pages_md5, chapter_nos, characters:[{id,name}]} — 운영 DB에서 읽은 값
   (backend/node_modules 필요: cd backend && npm ci) */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
require(path.join(root, 'backend/node_modules/ts-node')).register({
  project: path.join(root, 'backend/tsconfig.json'),
  transpileOnly: true,
  compilerOptions: { rootDir: root },
});
const { buildApplyRows } = require(path.join(__dirname, 'build-apply-rows.ts'));
const [runDir, snapshotFile] = process.argv.slice(2);
const snap = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
buildApplyRows({
  runDir: path.resolve(runDir),
  rawFile: path.join(root, 'backend/data/raw/gasangbeomin.txt'),
  bookId: snap.book_id,
  dbPagesMd5: snap.pages_md5,
  dbCharacters: snap.characters,
  dbChapterNos: snap.chapter_nos,
}).then((out) => {
  fs.writeFileSync(path.join(runDir, 'apply-rows.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out.checks, null, 2));
  const c = out.checks;
  process.exitCode =
    c.source_matches_db_pages_md5 && c.unique_ids && c.replace_relationship_snapshot.ok &&
    c.semantics_v2_check_errors.length === 0 && c.action_or_event_rows === 0
      ? 0
      : 1;
});

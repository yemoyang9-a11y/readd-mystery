#!/usr/bin/env node
/* 구조적 관계 추출 결과의 정밀도·재현율 + 이른 확립 페이지 수(0이어야 통과).
   usage: node evaluation/relationships/check-structural-metrics.cjs <structural-relationships.json> [더 많은 결과 ...] [--out 결과.json]
   정답 = reviewed-source-candidates.json(평가자가 원문을 읽고 정한 6개 관계). 결과 파일은
   run-generate-relationships-structural.ts가 쓴 structural-relationships.json. LLM·DB 호출 0회. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
require(path.join(root, 'backend/node_modules/ts-node')).register({
  project: path.join(root, 'backend/tsconfig.json'),
  transpileOnly: true,
  compilerOptions: { rootDir: root },
});
const { scoreRelationships, goldFromEvaluatorFiles } = require(path.join(__dirname, 'structural-metrics.ts'));
const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = outAt === -1 ? undefined : args[outAt + 1];
const files = args.filter((_, i) => outAt === -1 || (i !== outAt && i !== outAt + 1));
if (files.length === 0) {
  console.error('structural-relationships.json 경로가 필요하다');
  process.exit(2);
}
const reviewed = JSON.parse(fs.readFileSync(path.join(__dirname, 'reviewed-source-candidates.json'), 'utf8'));
const gold = goldFromEvaluatorFiles(reviewed);
const predicted = files.flatMap((f) =>
  JSON.parse(fs.readFileSync(f, 'utf8')).relationships.map((r) => ({
    character_a: r.character_a,
    character_b: r.character_b,
    direction: r.semantics?.direction ?? 'unknown',
    relation_key: r.semantics?.relation_key ?? r.label,
    established_page: r.established_page,
  }))
);
const score = scoreRelationships(gold, predicted);
const result = { gold_source: 'reviewed-source-candidates.json', inputs: files, ...score };
if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
process.exitCode = score.pass ? 0 : 1;

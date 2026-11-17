#!/usr/bin/env node
/* 확립 페이지 비대칭 지표. 정답보다 이르게 잡힌 관계(스포일러 방향)가 1건이라도 있으면 종료 코드 1.
   LLM·DB를 부르지 않는다 — 이미 만들어진 추출 결과 파일과 정답 파일만 읽는다.
   usage: node evaluation/relationships/check-established-page.cjs <추출 결과.json> [정답.json] [--out <결과.json>] */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
require(path.join(root, 'backend/node_modules/ts-node')).register({project: path.join(root, 'backend/tsconfig.json'), transpileOnly: true});
const {compareEstablishedPages, collectEstablishedRelationships} = require('./established-page-metric.ts');

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const dest = outIndex === -1 ? undefined : args[outIndex + 1];
const files = args.filter((_, i) => outIndex === -1 || (i !== outIndex && i !== outIndex + 1));
if (!files[0] || (outIndex !== -1 && !dest)) {
  console.error('usage: check-established-page.cjs <추출 결과.json> [정답.json] [--out <결과.json>]');
  process.exit(2);
}
const read = (file) => collectEstablishedRelationships(JSON.parse(fs.readFileSync(file, 'utf8')));
const goldPath = files[1] || path.join(__dirname, 'reviewed-source-candidates.json');
const gold = read(goldPath);
const predicted = read(files[0]);
const report = compareEstablishedPages(gold.relationships, predicted.relationships);
const result = {
  mode: 'established-page-asymmetry',
  completed_at: new Date().toISOString(),
  gold_path: path.relative(root, path.resolve(goldPath)),
  predicted_path: path.relative(root, path.resolve(files[0])),
  skipped_rows: {gold: gold.skipped, predicted: predicted.skipped},
  ...report,
};
if (dest) fs.writeFileSync(dest, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (report.counts.early > 0) console.error(`실패: 정답보다 이르게 잡힌 관계 ${report.counts.early}건 (스포일러 방향)`);
else if (report.counts.matched === 0) console.error('실패: 정답과 맞춰 비교한 관계가 0건이다 — 빈 결과는 통과가 아니다');
if (report.counts.late > 0) console.error(`경고: 정답보다 늦게 잡힌 관계 ${report.counts.late}건`);
process.exitCode = report.pass ? 0 : 1;

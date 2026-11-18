#!/usr/bin/env node
/* 주입 후보 21건 → 새 구조적 파이프라인의 결정적 검사. 실제 모델 추출 정확도가 아니다.
   usage: node evaluation/relationships/probe-structural.cjs [결과.json]   (backend/node_modules 필요: cd backend && npm ci) */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
require(path.join(root, 'backend/node_modules/ts-node')).register({
  project: path.join(root, 'backend/tsconfig.json'),
  transpileOnly: true,
  compilerOptions: { rootDir: root },
});
const { runStructuralProbe } = require(path.join(__dirname, 'structural-probe.ts'));
const oracle = JSON.parse(fs.readFileSync(path.join(__dirname, 'oracle.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'injected-triggers.json'), 'utf8'));
runStructuralProbe(oracle, config).then((out) => {
  const result = { ...out, completed_at: new Date().toISOString() };
  const dest = process.argv[2];
  if (dest) fs.writeFileSync(dest, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = out.results.every((r) => r.pass) ? 0 : 1;
});

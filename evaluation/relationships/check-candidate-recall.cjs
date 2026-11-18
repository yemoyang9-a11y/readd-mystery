#!/usr/bin/env node
/* 구조적 후보의 재현율 — 정답 관계(reviewed-source-candidates.json)의 두 인물이 후보 쌍에 있고, 정답 확립
   쪽에 근거 창이 있는가. LLM·DB 호출 0회. 후보 단계에서 빠진 관계는 라벨 단계가 되살릴 수 없으므로 따로 잰다.
   usage: node evaluation/relationships/check-candidate-recall.cjs [결과.json] */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
require(path.join(root, 'backend/node_modules/ts-node')).register({
  project: path.join(root, 'backend/tsconfig.json'),
  transpileOnly: true,
  compilerOptions: { rootDir: root },
});
const { generateInteractionCandidates } = require(path.join(root, 'backend/src/batch/pipeline/interaction-candidates.ts'));
const reviewed = JSON.parse(fs.readFileSync(path.join(__dirname, 'reviewed-source-candidates.json'), 'utf8'));
const rows = [];
for (const c of reviewed.cases) {
  const input = JSON.parse(fs.readFileSync(path.join(__dirname, c.input_path), 'utf8'));
  const lexicon = input.known_character_names.map((name) => ({ id: name, name, first_appearance_page: 1, aliases: [] }));
  const candidates = generateInteractionCandidates(input.pages, lexicon);
  for (const r of c.relationships) {
    const pair = candidates.find((x) => [x.a_id, x.b_id].sort().join() === [r.character_a, r.character_b].sort().join());
    const onPage = pair ? pair.windows.filter((w) => w.page_no === r.established_page) : [];
    const goldQuote = r.evidence.quote;
    rows.push({
      case: c.id,
      pair: [r.character_a, r.character_b],
      relation_key: r.semantics.relation_key,
      gold_page: r.established_page,
      candidate: !!pair,
      first_window_page: pair ? pair.first_page : null,
      sentence_window_on_gold_page: onPage.some((w) => w.kind === 'sentence'),
      window_kinds_on_gold_page: onPage.map((w) => w.kind),
      // 정답 인용과 겹치는 창이 있는가(근거 위치까지 맞는가)
      window_overlaps_gold_quote: onPage.some((w) => w.start < r.evidence.end_char && w.end > r.evidence.start_char),
      gold_quote_chars: goldQuote.length,
      candidate_pairs_in_input: candidates.length,
    });
  }
}
const result = {
  mode: 'candidate-recall-only (no LLM)',
  counts: {
    gold: rows.length,
    pair_is_candidate: rows.filter((r) => r.candidate).length,
    sentence_window_on_gold_page: rows.filter((r) => r.sentence_window_on_gold_page).length,
    window_overlaps_gold_quote: rows.filter((r) => r.window_overlaps_gold_quote).length,
    first_window_after_gold_page: rows.filter((r) => r.candidate && r.first_window_page > r.gold_page).length,
  },
  rows,
};
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.counts.pair_is_candidate === result.counts.gold ? 0 : 1;

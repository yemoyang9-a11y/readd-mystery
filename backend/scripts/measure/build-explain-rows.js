/**
 * 측정용 — 로컬 DB의 한 책 관계를 relation-explain 입력(apply-rows 형식)과 인물 사전 파일로 내보낸다. DB는 읽기만 한다.
 * 사용: DB_* 환경 변수 + node scripts/measure/build-explain-rows.js <bookId> <rows 출력> <characters 출력>
 */
const fs = require('fs');
const { Pool } = require('pg');

async function main() {
  const [bookId, rowsOut, charsOut] = process.argv.slice(2);
  if (!bookId || !rowsOut || !charsOut) throw new Error('usage: <bookId> <rows out> <characters out>');
  const pool = new Pool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD || undefined,
  });
  const rels = await pool.query(
    `SELECT r.id, a.name AS a_name, b.name AS b_name, r.label, r.semantics
       FROM relationships r
       JOIN characters a ON a.id = r.character_a_id
       JOIN characters b ON b.id = r.character_b_id
      WHERE r.book_id = $1 ORDER BY r.established_page, r.id`, [bookId]);
  const rows = rels.rows.map((r) => ({
    id: r.id,
    character_a_name: r.a_name,
    character_b_name: r.b_name,
    label: r.label,
    semantics: {
      assertion_status: r.semantics.assertion_status,
      ...(r.semantics.attribution ? { attribution: r.semantics.attribution } : {}),
      evidence: { source_page: r.semantics.evidence.source_page, quote: r.semantics.evidence.quote },
    },
  }));
  const chars = await pool.query('SELECT id, name FROM characters WHERE book_id = $1', [bookId]);
  const al = await pool.query('SELECT character_id, alias FROM aliases WHERE book_id = $1', [bookId]);
  const characters = chars.rows.map((c) => ({
    name: c.name,
    aliases: al.rows.filter((a) => a.character_id === c.id).map((a) => ({ alias: a.alias })),
  }));
  fs.writeFileSync(rowsOut, JSON.stringify({ book_id: bookId, rows }, null, 2));
  fs.writeFileSync(charsOut, JSON.stringify(characters, null, 2));
  console.log(`관계 ${rows.length}건, 인물 ${characters.length}명`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

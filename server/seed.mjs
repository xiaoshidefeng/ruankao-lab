/* 题库种子：src/data/bank.json → MySQL（全量替换，事务内完成）
   CLI: node server/seed.mjs ；server 启动时题库为空也会自动调用 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool, initSchema } from "./db.mjs";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data");
// 正式题库优先（不入仓库）；克隆后没有它则用自带的示例题库
const bankPath = existsSync(join(dataDir, "bank.json"))
  ? join(dataDir, "bank.json")
  : join(dataDir, "bank.sample.json");

export async function seedBank() {
  const bank = JSON.parse(readFileSync(bankPath, "utf8"));
  await initSchema(); // 幂等建表：允许在从未启动过 server 的新库上直接种子
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM papers");
    await conn.query("DELETE FROM cases");
    await conn.query("DELETE FROM questions");
    await conn.query("DELETE FROM chapters");
    await conn.query("DELETE FROM bank_meta");

    await conn.query("INSERT INTO bank_meta (id, subject, generated_at, note) VALUES (1, ?, ?, ?)", [
      bank.meta.subject, bank.meta.generatedAt, bank.meta.note ?? null,
    ]);
    for (const c of bank.chapters) {
      await conn.query("INSERT INTO chapters (no, title) VALUES (?, ?)", [c.no, c.title]);
    }
    for (const q of bank.questions) {
      await conn.query(
        `INSERT INTO questions (id, type, node, node_auto, needs_review, stem, options, blanks, answer, analysis, source_ref, source_num)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          q.id, q.type, q.node ?? null, !!q.nodeAuto, q.needsReview ?? null, q.stem,
          JSON.stringify(q.options ?? null), JSON.stringify(q.blanks ?? null), JSON.stringify(q.answer ?? null),
          q.analysis, q.sourceRef, q.sourceNum ?? 0,
        ]
      );
    }
    for (const c of bank.cases) {
      await conn.query(
        "INSERT INTO cases (id, topic, material, subqs, ref_answer, source_ref) VALUES (?, ?, ?, ?, ?, ?)",
        [c.id, c.topic, c.material, JSON.stringify(c.subqs), c.reference, c.sourceRef]
      );
    }
    for (const p of bank.papers) {
      await conn.query(
        "INSERT INTO papers (id, title, kind, subject, duration_min, pass_ratio, question_ids, source_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [p.id, p.title, p.kind, p.subject, p.durationMin, p.passRatio, JSON.stringify(p.questionIds), p.sourceRef]
      );
    }
    await conn.commit();
    return {
      questions: bank.questions.length,
      cases: bank.cases.length,
      papers: bank.papers.length,
      chapters: bank.chapters.length,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** 题库表为空则自动种子 */
export async function seedIfEmpty() {
  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM questions");
  if (n === 0) {
    const counts = await seedBank();
    console.log(`[seed] 题库为空，已自动导入:`, counts);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedBank()
    .then((counts) => {
      console.log("[seed] 题库已导入 MySQL:", counts);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[seed] 导入失败:", err);
      process.exit(1);
    });
}

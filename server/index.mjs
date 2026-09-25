/* 软考刷题台 · 本地 API 服务（Express + mysql2）
   题库读 MySQL（seed 脚本从 src/data/bank.json 导入），用户学习记录以
   /api/actions 动作语义写库（与前端 store.ts 本地逻辑一一对应）。 */
import express from "express";
import { pool, initSchema, loadState, applyActions } from "./db.mjs";
import { seedBank, seedIfEmpty } from "./seed.mjs";

const PORT = Number(process.env.PORT || 8787);
const app = express();
app.use(express.json({ limit: "2mb" }));

const ok = (res, data) => res.json({ ok: true, data });
const fail = (res, err, code = 500) => {
  console.error("[api]", err);
  res.status(code).json({ ok: false, error: String(err.message || err) });
};

/** 健康检查：前端据此决定 MySQL 模式还是本地 localStorage 模式 */
app.get("/api/health", async (_req, res) => {
  try {
    const [[row]] = await pool.query("SELECT VERSION() AS v");
    ok(res, { db: "mysql", version: row.v });
  } catch (err) {
    fail(res, err);
  }
});

/** 题库：行 → Bank JSON（形状与 src/data/bank.json 完全一致） */
app.get("/api/bank", async (_req, res) => {
  try {
    const [[meta], [chapters], [questions], [cases], [papers]] = await Promise.all([
      pool.query("SELECT subject, generated_at, note FROM bank_meta WHERE id = 1"),
      pool.query("SELECT no, title FROM chapters ORDER BY no"),
      pool.query("SELECT * FROM questions ORDER BY id"),
      pool.query("SELECT * FROM cases ORDER BY id"),
      pool.query("SELECT * FROM papers ORDER BY id"),
    ]);
    if (!meta.length) return fail(res, new Error("题库尚未导入，请运行 npm run db:seed"), 404);
    ok(res, {
      meta: { subject: meta[0].subject, generatedAt: meta[0].generated_at, note: meta[0].note ?? "" },
      chapters: chapters.map((c) => ({ no: c.no, title: c.title })),
      questions: questions.map((q) => ({
        id: q.id, type: q.type, node: q.node ?? null, nodeAuto: !!q.node_auto,
        ...(q.needs_review != null ? { needsReview: !!q.needs_review } : {}),
        stem: q.stem, options: q.options ?? null, blanks: q.blanks ?? null, answer: q.answer ?? null,
        analysis: q.analysis, sourceRef: q.source_ref, sourceNum: q.source_num,
      })),
      cases: cases.map((c) => ({
        id: c.id, type: "case", topic: c.topic, material: c.material,
        subqs: c.subqs, reference: c.ref_answer, sourceRef: c.source_ref,
      })),
      papers: papers.map((p) => ({
        id: p.id, title: p.title, kind: p.kind, subject: p.subject,
        durationMin: p.duration_min, passRatio: p.pass_ratio,
        questionIds: p.question_ids, sourceRef: p.source_ref,
      })),
    });
  } catch (err) {
    fail(res, err);
  }
});

/** 全量用户状态（启动时水合前端 AppState） */
app.get("/api/state", async (_req, res) => {
  try {
    ok(res, await loadState());
  } catch (err) {
    fail(res, err);
  }
});

/** 动作写入：{ batch: [{ type, ...payload }] } 或单动作 { type, ...payload } */
app.post("/api/actions", async (req, res) => {
  try {
    const batch = Array.isArray(req.body?.batch) ? req.body.batch : [req.body];
    if (!batch.length || !batch.every((a) => a && typeof a.type === "string")) {
      return fail(res, new Error("bad action batch"), 400);
    }
    const results = await applyActions(batch);
    const failed = results.filter((r) => !r.ok);
    if (failed.length === results.length) return fail(res, new Error(failed[0].error));
    ok(res, { results });
  } catch (err) {
    fail(res, err);
  }
});

/** 运维便利：重新导入题库 */
app.post("/api/seed", async (_req, res) => {
  try {
    ok(res, await seedBank());
  } catch (err) {
    fail(res, err);
  }
});

initSchema()
  .then(seedIfEmpty)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] API 就绪: http://localhost:${PORT}  (MySQL 已连接)`);
    });
  })
  .catch((err) => {
    console.error("[server] MySQL 初始化失败，请确认本地 MySQL 已启动且 ruankao 库可访问:", err.message);
    process.exit(1);
  });

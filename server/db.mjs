/* MySQL 连接池 + schema 初始化 + 动作落库 · 配置走环境变量，默认对准 Homebrew 本地实例
   登录地基：所有动作与查询按 userId 传参——鉴权中间件就位后，只需让 index.mjs 的
   resolveUser 从会话/token 解析真实用户，动作语义与表结构零改动。 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import mysql from "mysql2/promise";

export const DB_NAME = process.env.DB_NAME || "ruankao";
export const USER_ID = process.env.RK_USER_ID || "local";

const baseConfig = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  database: DB_NAME,
};

export const pool = mysql.createPool({
  ...baseConfig,
  waitForConnections: true,
  connectionLimit: 8,
  // DATE 列保持 "YYYY-MM-DD" 字符串，直接作为 AppState.activity 的键
  dateStrings: true,
});

/** 请求 → 用户 id。本地单用户恒为 local；接入登录后改为解析会话并校验存在性 */
export function resolveUser(_req) {
  return USER_ID;
}

export async function initSchema() {
  if (/[^A-Za-z0-9_-]/.test(DB_NAME)) throw new Error(`非法库名: ${DB_NAME}`);
  // 建库（幂等）：先无库连接执行 CREATE DATABASE，seed/CI 在全新实例上可直接跑
  const admin = await mysql.createConnection({ ...baseConfig, database: undefined });
  try {
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await admin.end();
  }
  const ddl = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "schema.sql"), "utf8");
  // schema.sql 是多语句脚本，需要一次性连接开启 multipleStatements（业务池保持默认关闭）
  const conn = await mysql.createConnection({ ...baseConfig, multipleStatements: true });
  try {
    await conn.query(ddl);
  } finally {
    await conn.end();
  }
  await pool.query(
    "INSERT IGNORE INTO users (id, name) VALUES (?, ?)",
    [USER_ID, "本地用户"]
  );
}

/** POST /api/actions 的动作处理：语义与 src/lib/store.ts 的本地逻辑一一对应 */
const DAY = 24 * 60 * 60 * 1000;
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** 练习/模考通用：累计作答统计 + 当日活跃 + 答错入错题本（已在本则忽略） */
async function applyAnswer(userId, { qid, correct }) {
  const now = Date.now();
  await pool.query(
    `INSERT INTO q_stats (user_id, qid, correct, wrong, last_at, last_correct)
     VALUES (?, ?, ?, ?, ?, ?)
     AS new
     ON DUPLICATE KEY UPDATE
       correct = q_stats.correct + new.correct,
       wrong = q_stats.wrong + new.wrong,
       last_at = new.last_at,
       last_correct = new.last_correct`,
    [userId, qid, correct ? 1 : 0, correct ? 0 : 1, now, correct]
  );
  await pool.query(
    `INSERT INTO activity (user_id, day, cnt) VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE cnt = cnt + 1`,
    [userId, todayStr()]
  );
  if (!correct) {
    await pool.query(
      `INSERT IGNORE INTO wrong_book (user_id, qid, added_at, due_at, streak)
       VALUES (?, ?, ?, ?, 0)`,
      [userId, qid, now, now + DAY]
    );
  }
}

/** 错题本重练：答对移出；答错 streak+1，按新 streak 取 1/3/7 天顺延（3 次封顶 7 天） */
async function applyWrongBookAnswer(userId, { qid, correct }) {
  await applyAnswer(userId, { qid, correct });
  if (correct) {
    await pool.query("DELETE FROM wrong_book WHERE user_id = ? AND qid = ?", [userId, qid]);
    return;
  }
  const [rows] = await pool.query(
    "SELECT streak FROM wrong_book WHERE user_id = ? AND qid = ?",
    [userId, qid]
  );
  const streak = (rows[0]?.streak ?? 0) + 1;
  const days = [1, 3, 7][Math.min(streak, 2)];
  await pool.query(
    "UPDATE wrong_book SET streak = ?, due_at = ? WHERE user_id = ? AND qid = ?",
    [streak, Date.now() + days * DAY, userId, qid]
  );
}

async function applyAttemptUpsert(userId, a) {
  await pool.query(
    `INSERT INTO attempts (id, user_id, paper_id, started_at, saved_at, answers, flags, remaining_sec, idx, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     AS new
     ON DUPLICATE KEY UPDATE
       paper_id = new.paper_id, started_at = new.started_at, saved_at = new.saved_at,
       answers = new.answers, flags = new.flags, remaining_sec = new.remaining_sec,
       idx = new.idx, status = new.status`,
    [
      a.id, userId, a.paperId, a.startedAt, a.savedAt,
      JSON.stringify(a.answers ?? {}), JSON.stringify(a.flags ?? []),
      a.remainingSec, a.idx ?? 0, a.status,
    ]
  );
}

const ACTIONS = {
  "answer": applyAnswer,
  "wrongbook-answer": applyWrongBookAnswer,
  "wrong-cause": async (userId, { qid, cause }) => {
    // setWrongCause 只作用于已有错题，无行则忽略（与前端一致）
    await pool.query(
      "UPDATE wrong_book SET cause = ? WHERE user_id = ? AND qid = ?",
      [cause, userId, qid]
    );
  },
  "wrong-remove": async (userId, { qid }) => {
    await pool.query("DELETE FROM wrong_book WHERE user_id = ? AND qid = ?", [userId, qid]);
  },
  "attempt-create": async (userId, { attempt }) => applyAttemptUpsert(userId, attempt),
  "attempt-save": async (userId, { attempt }) => applyAttemptUpsert(userId, attempt),
  "attempt-submit": async (userId, { id, score, total, usedSec, savedAt }) => {
    await pool.query(
      `UPDATE attempts SET status = 'submitted', remaining_sec = 0, saved_at = ?,
              score = ?, total = ?, used_sec = ?
       WHERE user_id = ? AND id = ?`,
      [savedAt ?? Date.now(), score, total, usedSec, userId, id]
    );
  },
  "attempt-delete": async (userId, { id }) => {
    await pool.query("DELETE FROM attempts WHERE user_id = ? AND id = ?", [userId, id]);
  },
  "case-self": async (userId, { caseId, subqNo, rate }) => {
    if (rate == null) {
      await pool.query(
        "DELETE FROM case_self WHERE user_id = ? AND case_id = ? AND subq_no = ?",
        [userId, caseId, subqNo]
      );
      return;
    }
    await pool.query(
      `INSERT INTO case_self (user_id, case_id, subq_no, rate) VALUES (?, ?, ?, ?)
       AS new
       ON DUPLICATE KEY UPDATE rate = new.rate`,
      [userId, caseId, subqNo, rate]
    );
  },
  "essay-create": async (userId, { essay }) => applyEssayUpsert(userId, essay),
  "essay-save": async (userId, { essay }) => applyEssayUpsert(userId, essay),
  "essay-submit": async (userId, { id, submittedAt, abstract, body }) => {
    await pool.query(
      `UPDATE essays SET status = 'submitted', saved_at = ?, abstract = ?, body = ?, submitted_at = ?
       WHERE user_id = ? AND id = ?`,
      [submittedAt ?? Date.now(), abstract ?? "", body ?? "", submittedAt ?? Date.now(), userId, id]
    );
  },
  "essay-delete": async (userId, { id }) => {
    await pool.query("DELETE FROM essays WHERE user_id = ? AND id = ?", [userId, id]);
  },
  "essay-self": async (userId, { id, item, rate }) => {
    // 自评项合并进 JSON 列：读-改-写在单行内完成，行级锁保证并发安全
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query(
        "SELECT self_review FROM essays WHERE user_id = ? AND id = ? FOR UPDATE",
        [userId, id]
      );
      if (!rows.length) {
        await conn.rollback();
        return;
      }
      const review = rows[0].self_review ?? {};
      if (rate == null) delete review[item];
      else review[item] = rate;
      await conn.query("UPDATE essays SET self_review = ? WHERE user_id = ? AND id = ?", [
        JSON.stringify(review), userId, id,
      ]);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },
};

async function applyEssayUpsert(userId, e) {
  await pool.query(
    `INSERT INTO essays (id, user_id, topic_id, started_at, saved_at, abstract, body, elapsed_sec, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     AS new
     ON DUPLICATE KEY UPDATE
       topic_id = new.topic_id, started_at = new.started_at, saved_at = new.saved_at,
       abstract = new.abstract, body = new.body, elapsed_sec = new.elapsed_sec, status = new.status`,
    [
      e.id, userId, e.topicId, e.startedAt, e.savedAt,
      e.abstract ?? "", e.body ?? "", e.elapsedSec ?? 0, e.status ?? "ongoing",
    ]
  );
}

/** 逐个执行动作批次；单条失败只标记该条，不拖垮整批 */
export async function applyActions(batch, userId) {
  const uid = userId || USER_ID;
  const results = [];
  for (const { type, ...payload } of batch) {
    const fn = ACTIONS[type];
    if (!fn) {
      results.push({ type, ok: false, error: `unknown action: ${type}` });
      continue;
    }
    try {
      await fn(uid, payload);
      results.push({ type, ok: true });
    } catch (err) {
      results.push({ type, ok: false, error: String(err.message || err) });
    }
  }
  return results;
}

/** 组装 AppState（与 src/lib/types.ts 的 AppState 对齐） */
export async function loadState(userId) {
  const uid = userId || USER_ID;
  const [[stats], [wrong], [atts], [act], [cs], [essays]] = await Promise.all([
    pool.query("SELECT qid, correct, wrong, last_at, last_correct FROM q_stats WHERE user_id = ?", [uid]),
    pool.query("SELECT qid, added_at, due_at, streak, cause FROM wrong_book WHERE user_id = ?", [uid]),
    pool.query("SELECT id, paper_id, started_at, saved_at, answers, flags, remaining_sec, idx, status, score, total, used_sec FROM attempts WHERE user_id = ?", [uid]),
    pool.query("SELECT day, cnt FROM activity WHERE user_id = ?", [uid]),
    pool.query("SELECT case_id, subq_no, rate FROM case_self WHERE user_id = ?", [uid]),
    pool.query("SELECT id, topic_id, started_at, saved_at, abstract, body, elapsed_sec, status, submitted_at, self_review FROM essays WHERE user_id = ?", [uid]),
  ]);

  const state = { version: 1, stats: {}, wrongBook: {}, attempts: {}, activity: {}, caseSelf: {}, essays: {} };
  for (const r of stats) {
    state.stats[r.qid] = { correct: r.correct, wrong: r.wrong, lastAt: Number(r.last_at), lastCorrect: !!r.last_correct };
  }
  for (const r of wrong) {
    state.wrongBook[r.qid] = {
      qid: r.qid, addedAt: Number(r.added_at), dueAt: Number(r.due_at), streak: r.streak,
      ...(r.cause ? { cause: r.cause } : {}),
    };
  }
  for (const r of atts) {
    state.attempts[r.id] = {
      id: r.id, paperId: r.paper_id, startedAt: Number(r.started_at), savedAt: Number(r.saved_at),
      answers: r.answers, flags: r.flags, remainingSec: r.remaining_sec, idx: r.idx, status: r.status,
      ...(r.score != null ? { result: { score: r.score, total: r.total, usedSec: r.used_sec } } : {}),
    };
  }
  for (const r of act) state.activity[r.day] = r.cnt;
  for (const r of cs) (state.caseSelf[r.case_id] ??= {})[r.subq_no] = r.rate;
  for (const r of essays) {
    state.essays[r.id] = {
      id: r.id, topicId: r.topic_id, startedAt: Number(r.started_at), savedAt: Number(r.saved_at),
      abstract: r.abstract ?? "", body: r.body ?? "", elapsedSec: r.elapsed_sec, status: r.status,
      ...(r.submitted_at != null ? { submittedAt: Number(r.submitted_at) } : {}),
      ...(r.self_review && Object.keys(r.self_review).length ? { selfReview: r.self_review } : {}),
    };
  }
  return state;
}

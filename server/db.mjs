/* MySQL 连接池 + schema 初始化 · 配置走环境变量，默认对准 Homebrew 本地实例 */
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
async function applyAnswer({ qid, correct }) {
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
    [USER_ID, qid, correct ? 1 : 0, correct ? 0 : 1, now, correct]
  );
  await pool.query(
    `INSERT INTO activity (user_id, day, cnt) VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE cnt = cnt + 1`,
    [USER_ID, todayStr()]
  );
  if (!correct) {
    await pool.query(
      `INSERT IGNORE INTO wrong_book (user_id, qid, added_at, due_at, streak)
       VALUES (?, ?, ?, ?, 0)`,
      [USER_ID, qid, now, now + DAY]
    );
  }
}

/** 错题本重练：答对移出；答错 streak+1，按新 streak 取 1/3/7 天顺延（3 次封顶 7 天） */
async function applyWrongBookAnswer({ qid, correct }) {
  await applyAnswer({ qid, correct });
  if (correct) {
    await pool.query("DELETE FROM wrong_book WHERE user_id = ? AND qid = ?", [USER_ID, qid]);
    return;
  }
  const [rows] = await pool.query(
    "SELECT streak FROM wrong_book WHERE user_id = ? AND qid = ?",
    [USER_ID, qid]
  );
  const streak = (rows[0]?.streak ?? 0) + 1;
  const days = [1, 3, 7][Math.min(streak, 2)];
  await pool.query(
    "UPDATE wrong_book SET streak = ?, due_at = ? WHERE user_id = ? AND qid = ?",
    [streak, Date.now() + days * DAY, USER_ID, qid]
  );
}

async function applyAttemptUpsert(a) {
  await pool.query(
    `INSERT INTO attempts (id, user_id, paper_id, started_at, saved_at, answers, flags, remaining_sec, idx, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     AS new
     ON DUPLICATE KEY UPDATE
       paper_id = new.paper_id, started_at = new.started_at, saved_at = new.saved_at,
       answers = new.answers, flags = new.flags, remaining_sec = new.remaining_sec,
       idx = new.idx, status = new.status`,
    [
      a.id, USER_ID, a.paperId, a.startedAt, a.savedAt,
      JSON.stringify(a.answers ?? {}), JSON.stringify(a.flags ?? []),
      a.remainingSec, a.idx ?? 0, a.status,
    ]
  );
}

const ACTIONS = {
  "answer": applyAnswer,
  "wrongbook-answer": applyWrongBookAnswer,
  "wrong-cause": async ({ qid, cause }) => {
    // setWrongCause 只作用于已有错题，无行则忽略（与前端一致）
    await pool.query(
      "UPDATE wrong_book SET cause = ? WHERE user_id = ? AND qid = ?",
      [cause, USER_ID, qid]
    );
  },
  "wrong-remove": async ({ qid }) => {
    await pool.query("DELETE FROM wrong_book WHERE user_id = ? AND qid = ?", [USER_ID, qid]);
  },
  "attempt-create": async ({ attempt }) => applyAttemptUpsert(attempt),
  "attempt-save": async ({ attempt }) => applyAttemptUpsert(attempt),
  "attempt-submit": async ({ id, score, total, usedSec, savedAt }) => {
    await pool.query(
      `UPDATE attempts SET status = 'submitted', remaining_sec = 0, saved_at = ?,
              score = ?, total = ?, used_sec = ?
       WHERE user_id = ? AND id = ?`,
      [savedAt ?? Date.now(), score, total, usedSec, USER_ID, id]
    );
  },
  "attempt-delete": async ({ id }) => {
    await pool.query("DELETE FROM attempts WHERE user_id = ? AND id = ?", [USER_ID, id]);
  },
  "case-self": async ({ caseId, subqNo, rate }) => {
    if (rate == null) {
      await pool.query(
        "DELETE FROM case_self WHERE user_id = ? AND case_id = ? AND subq_no = ?",
        [USER_ID, caseId, subqNo]
      );
      return;
    }
    await pool.query(
      `INSERT INTO case_self (user_id, case_id, subq_no, rate) VALUES (?, ?, ?, ?)
       AS new
       ON DUPLICATE KEY UPDATE rate = new.rate`,
      [USER_ID, caseId, subqNo, rate]
    );
  },
};

/** 逐个执行动作批次；单条失败只标记该条，不拖垮整批 */
export async function applyActions(batch) {
  const results = [];
  for (const { type, ...payload } of batch) {
    const fn = ACTIONS[type];
    if (!fn) {
      results.push({ type, ok: false, error: `unknown action: ${type}` });
      continue;
    }
    try {
      await fn(payload);
      results.push({ type, ok: true });
    } catch (err) {
      results.push({ type, ok: false, error: String(err.message || err) });
    }
  }
  return results;
}

/** 组装 AppState（与 src/lib/types.ts 的 AppState 对齐） */
export async function loadState() {
  const [[stats], [wrong], [atts], [act], [cs]] = await Promise.all([
    pool.query("SELECT qid, correct, wrong, last_at, last_correct FROM q_stats WHERE user_id = ?", [USER_ID]),
    pool.query("SELECT qid, added_at, due_at, streak, cause FROM wrong_book WHERE user_id = ?", [USER_ID]),
    pool.query("SELECT id, paper_id, started_at, saved_at, answers, flags, remaining_sec, idx, status, score, total, used_sec FROM attempts WHERE user_id = ?", [USER_ID]),
    pool.query("SELECT day, cnt FROM activity WHERE user_id = ?", [USER_ID]),
    pool.query("SELECT case_id, subq_no, rate FROM case_self WHERE user_id = ?", [USER_ID]),
  ]);

  const state = { version: 1, stats: {}, wrongBook: {}, attempts: {}, activity: {}, caseSelf: {} };
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
  return state;
}

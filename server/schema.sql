-- 软考刷题台 · MySQL 本地库 schema
-- 题库（静态内容，由 seed 脚本全量导入）+ 用户学习记录（API 增量写入）
-- 用户体系预留：本地单用户固定为 local，多端/多用户时扩 user_id 即可

CREATE TABLE IF NOT EXISTS users (
  id         VARCHAR(32)  PRIMARY KEY,
  name       VARCHAR(64)  NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------- 题库（对应 src/lib/types.ts 的 Bank schema） ----------------

CREATE TABLE IF NOT EXISTS bank_meta (
  id           TINYINT      PRIMARY KEY,
  subject      VARCHAR(128) NOT NULL,
  generated_at VARCHAR(64)  NOT NULL,
  note         TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chapters (
  no    TINYINT      PRIMARY KEY,
  title VARCHAR(128) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS questions (
  id           VARCHAR(64)  PRIMARY KEY,
  type         VARCHAR(16)  NOT NULL,           -- single | combo_blank
  node         TINYINT      NULL,               -- 知识域章号 1-12，NULL=综合
  node_auto    BOOLEAN      NOT NULL DEFAULT FALSE,
  needs_review BOOLEAN      NULL,
  stem         MEDIUMTEXT   NOT NULL,
  options      JSON         NULL,
  blanks       JSON         NULL,
  answer       JSON         NULL,
  analysis     MEDIUMTEXT   NOT NULL,
  source_ref   VARCHAR(255) NOT NULL,
  source_num   INT          NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cases (
  id         VARCHAR(64)  PRIMARY KEY,
  topic      VARCHAR(255) NOT NULL,
  material   MEDIUMTEXT   NOT NULL,
  subqs      JSON         NOT NULL,
  ref_answer MEDIUMTEXT   NOT NULL,
  source_ref VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS papers (
  id           VARCHAR(64)  PRIMARY KEY,
  title        VARCHAR(255) NOT NULL,
  kind         VARCHAR(32)  NOT NULL,
  subject      VARCHAR(128) NOT NULL,
  duration_min INT          NOT NULL,
  pass_ratio   DOUBLE       NOT NULL,
  question_ids JSON         NOT NULL,
  source_ref   VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------- 用户学习记录（对应 AppState，动作语义见 server/index.mjs） ----------------

CREATE TABLE IF NOT EXISTS q_stats (
  user_id      VARCHAR(32) NOT NULL,
  qid          VARCHAR(64) NOT NULL,
  correct      INT         NOT NULL DEFAULT 0,
  wrong        INT         NOT NULL DEFAULT 0,
  last_at      BIGINT      NOT NULL,
  last_correct BOOLEAN     NOT NULL,
  PRIMARY KEY (user_id, qid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wrong_book (
  user_id  VARCHAR(32) NOT NULL,
  qid      VARCHAR(64) NOT NULL,
  added_at BIGINT      NOT NULL,
  due_at   BIGINT      NOT NULL,
  streak   INT         NOT NULL DEFAULT 0,
  cause    VARCHAR(16) NULL,                   -- knowledge | careless | misread
  PRIMARY KEY (user_id, qid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS attempts (
  id            VARCHAR(96)  PRIMARY KEY,
  user_id       VARCHAR(32)  NOT NULL,
  paper_id      VARCHAR(64)  NOT NULL,
  started_at    BIGINT       NOT NULL,
  saved_at      BIGINT       NOT NULL,
  answers       JSON         NOT NULL,
  flags         JSON         NOT NULL,
  remaining_sec INT          NOT NULL,
  idx           INT          NOT NULL DEFAULT 0,
  status        VARCHAR(16)  NOT NULL,          -- ongoing | submitted
  score         INT          NULL,
  total         INT          NULL,
  used_sec      INT          NULL,
  INDEX idx_user_paper (user_id, paper_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS activity (
  user_id VARCHAR(32) NOT NULL,
  day     DATE        NOT NULL,
  cnt     INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS case_self (
  user_id  VARCHAR(32) NOT NULL,
  case_id  VARCHAR(64) NOT NULL,
  subq_no  INT         NOT NULL,
  rate     VARCHAR(8)  NOT NULL,              -- good | mid | bad
  PRIMARY KEY (user_id, case_id, subq_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

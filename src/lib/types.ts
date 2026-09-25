/* 领域类型 · 与 bank.json 的 schema 对应（实施方案 §06 的 questions JSONB 设计） */

export type QType = "single" | "combo_blank";

export interface Blank {
  label: string;
  options: Record<string, string>;
  answer: string[];
}

export interface Question {
  id: string;
  type: QType;
  /** 知识域章号（1–12）；null = 综合/未归类 */
  node: number | null;
  /** 章号是否为关键词自动归类（可在题库后台修正） */
  nodeAuto: boolean;
  needsReview?: boolean;
  stem: string;
  options: Record<string, string> | null;
  blanks: Blank[] | null;
  /** single 题的正确选项 */
  answer: string[] | null;
  analysis: string;
  sourceRef: string;
  sourceNum: number;
}

export interface CaseSubQ {
  no: number;
  prompt: string;
}

export interface CaseQuestion {
  id: string;
  type: "case";
  topic: string;
  material: string;
  subqs: CaseSubQ[];
  reference: string;
  sourceRef: string;
}

export interface Paper {
  id: string;
  title: string;
  kind: string; // 真题-回忆版 | 模拟
  subject: string;
  durationMin: number;
  passRatio: number;
  questionIds: string[];
  sourceRef: string;
}

export interface Chapter {
  no: number;
  title: string;
}

export interface Bank {
  meta: { subject: string; generatedAt: string; note: string };
  chapters: Chapter[];
  questions: Question[];
  cases: CaseQuestion[];
  papers: Paper[];
}

/* ---------------- 论文写作 ---------------- */

/** 论文题目（题集文件 essays.json / essays.sample.json 的 topics 数组元素） */
export interface EssayTopic {
  id: string;
  /** 所属知识域（仅展示用） */
  domain: string;
  title: string;
  /** 题目背景：给定项目情景，写作时以此为纲 */
  background: string;
  /** 结构提示：摘要与主体各段写什么 */
  outline: string[];
  sourceRef: string;
}

/** 自评给分点（对齐真实评卷：摘要-结构-实践-字数） */
export type EssayReviewItem = "abstract" | "structure" | "practice" | "length";

export const ESSAY_REVIEW_LABEL: Record<EssayReviewItem, string> = {
  abstract: "摘要合规（300–330 字、扣题）",
  structure: "结构完整（项目概述 → 主体 → 结尾）",
  practice: "结合真实项目实践与数据",
  length: "正文字数达标（≥2000 字）",
};

/** 一篇论文的写作稿（断点续写：status=ongoing 时每 2 秒自动落库） */
export interface EssayDraft {
  id: string;
  topicId: string;
  startedAt: number;
  savedAt: number;
  abstract: string;
  body: string;
  elapsedSec: number;
  status: "ongoing" | "submitted";
  submittedAt?: number;
  /** 自评：给分点 → 三档 */
  selfReview?: Record<string, "good" | "mid" | "bad">;
}

/* ---------------- 用户作答与学习记录 ---------------- */

/** 练习里的选择：单选存 b1；组合填空存 b1/b2 */
export interface QPick {
  b1?: string;
  b2?: string;
}

export type WrongCause = "knowledge" | "careless" | "misread";

export const CAUSE_LABEL: Record<WrongCause, string> = {
  knowledge: "知识没记住",
  careless: "计算失误",
  misread: "审题错误",
};

export interface WrongEntry {
  qid: string;
  addedAt: number;
  /** 间隔重现：第 n 次答错后 n+1 天重现（1 → 3 → 7 天封顶） */
  dueAt: number;
  streak: number;
  cause?: WrongCause;
}

/** 一道题的累计作答情况 */
export interface QStat {
  correct: number;
  wrong: number;
  lastAt: number;
  lastCorrect: boolean;
}

export interface MockAttempt {
  id: string;
  paperId: string;
  startedAt: number;
  savedAt: number;
  answers: Record<string, string>;
  flags: string[];
  remainingSec: number;
  idx: number;
  status: "ongoing" | "submitted";
  result?: { score: number; total: number; usedSec: number };
}

export interface AppState {
  version: 1;
  stats: Record<string, QStat>;
  wrongBook: Record<string, WrongEntry>;
  attempts: Record<string, MockAttempt>;
  /** 每日作答量（YYYY-MM-DD → 题数） */
  activity: Record<string, number>;
  /** 案例练习：caseId → { 子问号 → 自评 } */
  caseSelf: Record<string, Record<number, "good" | "mid" | "bad">>;
  /** 论文写作：草稿 id → 稿件 */
  essays: Record<string, EssayDraft>;
}

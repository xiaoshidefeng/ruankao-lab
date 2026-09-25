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
}

import type { Bank, CaseQuestion, Paper, Question } from "./types";

/* 题库加载：正式题库 bank.json 因版权归属不入仓库（gitignore）。
   存在则优先使用；克隆仓库后没有它时回落到自带的示例题库 bank.sample.json，
   保证界面、判分、模考流程开箱可跑。正式题库用 scripts/parse-mocks.mjs 生成。 */
const bankModules = import.meta.glob<{ default: Bank }>("../data/bank*.json", { eager: true });
const pickBank = (file: string) =>
  Object.entries(bankModules).find(([path]) => path.endsWith(file))?.[1];
const rawBank = (pickBank("data/bank.json") ?? pickBank("data/bank.sample.json"))!.default;

export const bank = rawBank as unknown as Bank;

export const questionById = new Map<string, Question>(bank.questions.map((q) => [q.id, q]));
export const caseById = new Map<string, CaseQuestion>(bank.cases.map((c) => [c.id, c]));
export const paperById = new Map<string, Paper>(bank.papers.map((p) => [p.id, p]));

/** 章号 → 章节名；0 表示「综合 / 未归类」 */
export const chapterName = (no: number | null): string => {
  if (no == null || no === 0) return "综合";
  return bank.chapters.find((c) => c.no === no)?.title ?? "综合";
};

export const questionsOfPaper = (paper: Paper): Question[] =>
  paper.questionIds.map((id) => questionById.get(id)).filter((q): q is Question => !!q);

/** 全部有效练习题（不含案例） */
export const allQuestions = bank.questions;

export const questionsByChapter = (no: number | null): Question[] =>
  allQuestions.filter((q) => (q.node ?? null) === (no ?? null));

export const chapterList = [
  { no: 0 as const, title: "综合 / 未归类" },
  ...bank.chapters.map((c) => ({ no: c.no as number, title: c.title })),
];

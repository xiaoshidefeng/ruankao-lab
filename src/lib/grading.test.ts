/* 判分纯函数单测：客观题判分与格式化工具零副作用，是最适合先补测试的地方 */
import { describe, expect, it } from "vitest";
import { formatSec, gradeQuestion, isPickComplete, todayStr } from "./grading";
import type { Question } from "./types";

const singleQ: Question = {
  id: "q1",
  type: "single",
  node: 4,
  nodeAuto: false,
  stem: "测试题",
  options: { A: "选项A", B: "选项B", C: "选项C", D: "选项D" },
  blanks: null,
  answer: ["B"],
  analysis: "",
  sourceRef: "测试",
  sourceNum: 1,
};

const comboQ: Question = {
  id: "q2",
  type: "combo_blank",
  node: 4,
  nodeAuto: false,
  stem: "组合填空测试",
  options: null,
  blanks: [
    { label: "空1", options: { A: "甲", B: "乙" }, answer: ["A"] },
    { label: "空2", options: { A: "丙", B: "丁", C: "戊" }, answer: ["B", "C"] },
  ],
  answer: null,
  analysis: "",
  sourceRef: "测试",
  sourceNum: 2,
};

describe("gradeQuestion · single", () => {
  it("选中正确选项判对", () => {
    expect(gradeQuestion(singleQ, { b1: "B" })).toBe(true);
  });

  it("选中错误选项判错", () => {
    expect(gradeQuestion(singleQ, { b1: "A" })).toBe(false);
  });

  it("支持答案多写法（任一命中即对）", () => {
    const q: Question = { ...singleQ, answer: ["B", "b"] };
    expect(gradeQuestion(q, { b1: "b" })).toBe(true);
  });

  it("未作答判错且不抛异常", () => {
    expect(gradeQuestion(singleQ, undefined)).toBe(false);
    expect(gradeQuestion(singleQ, {})).toBe(false);
  });

  it("答案缺失判错且不抛异常", () => {
    expect(gradeQuestion({ ...singleQ, answer: null }, { b1: "B" })).toBe(false);
  });
});

describe("gradeQuestion · combo_blank（全部空对才得分）", () => {
  it("两空全对判对", () => {
    expect(gradeQuestion(comboQ, { b1: "A", b2: "B" })).toBe(true);
    // 空2 支持多答案
    expect(gradeQuestion(comboQ, { b1: "A", b2: "C" })).toBe(true);
  });

  it("任一空错判错", () => {
    expect(gradeQuestion(comboQ, { b1: "B", b2: "B" })).toBe(false);
    expect(gradeQuestion(comboQ, { b1: "A", b2: "A" })).toBe(false);
  });

  it("只答一空判错", () => {
    expect(gradeQuestion(comboQ, { b1: "A" })).toBe(false);
    expect(gradeQuestion(comboQ, { b2: "B" })).toBe(false);
  });

  it("blanks 缺失判错且不抛异常", () => {
    expect(gradeQuestion({ ...comboQ, blanks: null }, { b1: "A", b2: "B" })).toBe(false);
  });
});

describe("isPickComplete", () => {
  it("single 只看 b1", () => {
    expect(isPickComplete(singleQ, { b1: "A" })).toBe(true);
    expect(isPickComplete(singleQ, {})).toBe(false);
  });

  it("combo_blank 要求 b1 b2 齐全", () => {
    expect(isPickComplete(comboQ, { b1: "A", b2: "B" })).toBe(true);
    expect(isPickComplete(comboQ, { b1: "A" })).toBe(false);
  });
});

describe("formatSec", () => {
  it("无小时时分钟不补零，带小时时补零", () => {
    expect(formatSec(59)).toBe("0:59");
    expect(formatSec(60)).toBe("1:00");
    expect(formatSec(3661)).toBe("1:01:01");
  });

  it("负数与零", () => {
    expect(formatSec(0)).toBe("0:00");
    expect(formatSec(-5)).toBe("0:00");
  });
});

describe("todayStr", () => {
  it("按本地时区格式化为 YYYY-MM-DD", () => {
    expect(todayStr(new Date(2026, 8, 25, 23, 59))).toBe("2026-09-25");
    expect(todayStr(new Date(2026, 0, 1))).toBe("2026-01-01");
  });
});

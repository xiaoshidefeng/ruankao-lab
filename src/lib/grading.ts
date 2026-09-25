/* 判分纯函数（实施方案 §06：客观题判分是纯函数） */
import type { QPick, Question } from "./types";

export function gradeQuestion(q: Question, pick: QPick | undefined): boolean {
  if (!pick) return false;
  if (q.type === "single") return !!pick.b1 && !!q.answer?.includes(pick.b1);
  // combo_blank：全部空对才得分
  return !!q.blanks && q.blanks.every((b, i) => {
    const p = i === 0 ? pick.b1 : pick.b2;
    return !!p && b.answer.includes(p);
  });
}

export function isPickComplete(q: Question, pick: QPick | undefined): boolean {
  if (!pick) return false;
  if (q.type === "single") return !!pick.b1;
  return !!pick.b1 && !!pick.b2;
}

export function formatSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = (h > 0 ? String(m).padStart(2, "0") : String(m));
  return (h > 0 ? h + ":" : "") + mm + ":" + String(ss).padStart(2, "0");
}

export function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const DAY = 86400_000;

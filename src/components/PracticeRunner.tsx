/* 练习跑题器：即答即判 + 当场解析。章节练习与错题重练共用，
   记录回调由调用方注入（普通练习 vs 错题本重练的落库规则不同）。 */
import { useCallback, useEffect, useState } from "react";
import type { QPick, Question } from "../lib/types";
import { questionById } from "../lib/bank";
import { gradeQuestion, isPickComplete } from "../lib/grading";
import { QuestionCard } from "./QuestionCard";
import { KbdHint } from "./ui";

export interface RunnerProps {
  title: string;
  ids: string[];
  onRecord: (qid: string, correct: boolean) => void;
  onExit: () => void;
  onRestart?: () => void;
}

export function PracticeRunner({ title, ids, onRecord, onExit, onRestart }: RunnerProps) {
  const questions: Question[] = ids.map((id) => questionById.get(id)!).filter(Boolean);
  const [idx, setIdx] = useState(0);
  const [picks, setPicks] = useState<Record<string, QPick>>({});
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  const [correct, setCorrect] = useState(0);
  const [finished, setFinished] = useState(false);

  const q = questions[idx];

  const judge = useCallback(
    (question: Question, pick: QPick) => {
      const ok = gradeQuestion(question, pick);
      onRecord(question.id, ok);
      setLocked((m) => ({ ...m, [question.id]: true }));
      if (ok) setCorrect((c) => c + 1);
    },
    [onRecord]
  );

  const pick = useCallback(
    (blank: 1 | 2, letter: string) => {
      if (locked[q.id]) return;
      const cur: QPick = { ...picks[q.id] };
      if (blank === 1) cur.b1 = letter;
      else cur.b2 = letter;
      const next = { ...picks, [q.id]: cur };
      setPicks(next);
      if (isPickComplete(q, cur)) judge(q, cur);
    },
    [q, picks, locked, judge]
  );

  const nav = useCallback(
    (d: number) => {
      if (d === 1 && idx === questions.length - 1) {
        setFinished(true);
        return;
      }
      const n = idx + d;
      if (n < 0 || n >= questions.length) return;
      setIdx(n);
      window.scrollTo({ top: 0 });
    },
    [idx, questions.length]
  );

  /* 键盘：A–D / 1–4 作答，←/→ 切题，Enter 下一题 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finished) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      const map: Record<string, string> = { a: "A", b: "B", c: "C", d: "D", "1": "A", "2": "B", "3": "C", "4": "D" };
      if (map[k] && !locked[q.id]) {
        const blank: 1 | 2 = q.type === "single" || !picks[q.id]?.b1 ? 1 : 2;
        pick(blank, map[k]);
      }
      if (e.key === "ArrowRight" || e.key === "Enter") nav(1);
      if (e.key === "ArrowLeft") nav(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [q, picks, locked, pick, nav, finished]);

  if (finished) {
    const total = questions.length;
    const rate = Math.round((correct / total) * 100);
    return (
      <div className="qcard">
        <div className="done-box">
          <div className={`big ${rate >= 60 ? "ok" : ""}`}>
            {correct} / {total}
          </div>
          <div className="sub">
            {title}完成 · 正确率 {rate}%{" "}
            {rate >= 60
              ? "—— 已越过 60% 目标线，保持这个手感"
              : "—— 距离 60% 目标线还有差距，错题已进入错题本"}
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            {onRestart && (
              <button className="btn" onClick={onRestart}>
                再练一遍
              </button>
            )}
            <button className="btn primary" onClick={onExit}>
              返回
            </button>
          </div>
        </div>
      </div>
    );
  }

  const doneCount = Object.keys(locked).length;

  return (
    <div>
      <div className="sec-head" style={{ marginTop: 0 }}>
        <span className="sec-no">{title}</span>
        <h2>练习中</h2>
        <span className="aux">
          已答 {doneCount} / {questions.length} · 答对 {correct}
        </span>
      </div>
      <QuestionCard
        key={q.id}
        q={q}
        index={idx}
        total={questions.length}
        mode="practice"
        pick={picks[q.id]}
        judged={locked[q.id]}
        onPick={pick}
      />
      <div className="qfoot">
        <button className="btn" disabled={idx === 0} onClick={() => nav(-1)}>
          上一题
        </button>
        <button className="btn primary" onClick={() => nav(1)}>
          {idx === questions.length - 1 ? "完成" : "下一题"}
        </button>
        <button className="btn ghost" onClick={onExit}>
          中途退出
        </button>
        <span className="progress">
          <b>{doneCount}</b>/{questions.length} 已答
        </span>
      </div>
      <KbdHint />
    </div>
  );
}

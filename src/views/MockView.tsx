/* 真题模考：仿真机考——连考计时 / 答题卡跳题 / 题目标记 / 断点续考 / 成绩单复盘 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bank, paperById, questionsOfPaper } from "../lib/bank";
import { formatSec, gradeQuestion } from "../lib/grading";
import {
  attemptOfPaperOngoing,
  bestScoreOfPaper,
  createAttempt,
  deleteAttempt,
  recordAnswer,
  saveAttempt,
  submitAttempt,
  useAppState,
} from "../lib/store";
import type { MockAttempt, Paper } from "../lib/types";
import { QuestionCard, flagSvg } from "../components/QuestionCard";
import { Empty } from "../components/ui";

export function MockView({ paperId }: { paperId?: string }) {
  const state = useAppState();
  const [activePaper, setActivePaper] = useState<Paper | null>(paperId ? paperById.get(paperId) ?? null : null);
  const [attemptId, setAttemptId] = useState<string | null>(paperId ? attemptOfPaperOngoing(paperId)?.id ?? null : null);

  const openPaper = (p: Paper) => {
    const existing = attemptOfPaperOngoing(p.id);
    const a = existing ?? createAttempt(p.id, p.durationMin);
    setActivePaper(p);
    setAttemptId(a.id);
    window.scrollTo({ top: 0 });
  };

  /* 已开卷：runner 全权管理生命周期（含交卷后的成绩单展示） */
  if (activePaper && attemptId) {
    return (
      <MockRunner
        key={attemptId}
        paper={activePaper}
        attemptId={attemptId}
        onExit={() => {
          setActivePaper(null);
          setAttemptId(null);
        }}
        onRestart={() => openPaper(activePaper)}
      />
    );
  }

  const ongoingAttempts = Object.values(state.attempts)
    .filter((a) => a.status === "ongoing")
    .sort((a, b) => b.savedAt - a.savedAt);

  return (
    <div>
      <div className="kicker">Mock Exam · 仿真机考</div>
      <h1 className="page-title">真题模拟考</h1>
      <p className="page-lede">
        严格按机考规则仿真：整卷连续计时、答题卡跳题、题目标记、中途退出自动保存（断点续考）。综合知识 75 题答对 45 题（60%）即过线。
      </p>

      {ongoingAttempts.length > 0 && (
        <div className="resume-banner">
          <div>
            <div className="rb-t">有一场未完成的模考</div>
            <div className="rb-d">
              {paperById.get(ongoingAttempts[0].paperId)?.title ?? ongoingAttempts[0].paperId} · 剩余{" "}
              {formatSec(ongoingAttempts[0].remainingSec)}
            </div>
          </div>
          <span className="sp" />
          <button className="btn danger sm" onClick={() => openPaper(paperById.get(ongoingAttempts[0].paperId)!)}>
            继续考试
          </button>
          <button className="btn ghost sm" onClick={() => deleteAttempt(ongoingAttempts[0].id)}>
            放弃
          </button>
        </div>
      )}

      <div className="sec-head">
        <span className="sec-no">01</span>
        <h2>可用试卷</h2>
        <span className="aux">{bank.papers.length} 份</span>
      </div>

      {bank.papers.length === 0 ? (
        <Empty title="暂无试卷" desc="运行题库管线生成试卷数据" />
      ) : (
        <div className="rows">
          {bank.papers.map((p) => {
            const best = bestScoreOfPaper(p.id);
            const ongoing = attemptOfPaperOngoing(p.id);
            return (
              <button className="row" key={p.id} onClick={() => openPaper(p)}>
                <div className="r-main">
                  <div className="r-title">
                    <span className="tag" style={{ marginRight: 8 }}>{p.kind}</span>
                    {p.title}
                  </div>
                  <div className="r-sub">
                    {p.questionIds.length} 题 · {p.durationMin} 分钟 · 来源：{p.sourceRef}
                  </div>
                </div>
                <span className="r-side">
                  {ongoing ? (
                    <span className="red">未完成 · 剩 {formatSec(ongoing.remainingSec)}</span>
                  ) : best != null ? (
                    <>最好 {Math.round(best * 100)}%</>
                  ) : (
                    "未作答"
                  )}
                </span>
                <span className="arrow">→</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- 跑卷 ---------------- */

function MockRunner({
  paper,
  attemptId,
  onExit,
  onRestart,
}: {
  paper: Paper;
  attemptId: string;
  onExit: () => void;
  onRestart: () => void;
}) {
  const questions = useMemo(() => questionsOfPaper(paper), [paper.id]); // 稳定引用：避免 effect 因数组身份循环重跑
  const saved = useAppState().attempts[attemptId];
  const [answers, setAnswers] = useState<Record<string, string>>(saved?.answers ?? {});
  const [flags, setFlags] = useState<string[]>(saved?.flags ?? []);
  const [idx, setIdx] = useState(Math.min(saved?.idx ?? 0, questions.length - 1));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [remaining, setRemaining] = useState(saved?.remainingSec ?? paper.durationMin * 60);
  const [forceArm, setForceArm] = useState(false);
  const [report, setReport] = useState<{ score: number; usedSec: number } | null>(null);
  const [reviewIdx, setReviewIdx] = useState<number | null>(null);

  const submittedRef = useRef(false);
  const stateRef = useRef({ answers, flags, idx, remaining });
  stateRef.current = { answers, flags, idx, remaining };

  const persist = useCallback(() => {
    if (submittedRef.current) return;
    const { answers: a, flags: f, idx: i, remaining: r } = stateRef.current;
    const attempt: MockAttempt = {
      id: attemptId, paperId: paper.id, startedAt: saved?.startedAt ?? Date.now(), savedAt: Date.now(),
      answers: a, flags: [...f], remainingSec: Math.max(0, r), idx: i, status: "ongoing",
    };
    saveAttempt(attempt);
  }, [attemptId, paper.id, saved?.startedAt]);

  const doSubmit = useCallback(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const { answers: ans, remaining: rem, flags: f, idx: i } = stateRef.current;
    let score = 0;
    for (const q of questions) {
      const ok = gradeQuestion(q, { b1: ans[q.id] });
      recordAnswer(q.id, ok);
      if (ok) score++;
    }
    const usedSec = paper.durationMin * 60 - rem;
    submitAttempt(
      {
        id: attemptId, paperId: paper.id, startedAt: saved?.startedAt ?? Date.now(), savedAt: Date.now(),
        answers: ans, flags: [...f], remainingSec: 0, idx: i, status: "submitted",
      },
      score, questions.length, usedSec
    );
    setReport({ score, usedSec });
    setRemaining(0);
    window.scrollTo({ top: 0 });
  }, [attemptId, paper.id, paper.durationMin, questions, saved?.startedAt]);

  /* 计时：1s 递减，每 5s 落盘（断点续考），到点自动交卷 */
  useEffect(() => {
    const t = setInterval(() => {
      setRemaining((r) => {
        const n = r - 1;
        if (n <= 0) {
          clearInterval(t);
          doSubmit();
          return 0;
        }
        return n;
      });
    }, 1000);
    const save = setInterval(persist, 5000);
    return () => {
      clearInterval(t);
      clearInterval(save);
      persist();
    };
  }, [doSubmit, persist]);

  /* 作答/切题/标记后即时落盘（400ms 去抖），把断点续考的丢失窗口压到最小 */
  useEffect(() => {
    if (submittedRef.current) return;
    const id = setTimeout(persist, 400);
    return () => clearTimeout(id);
  }, [answers, idx, flags, persist]);

  const q = questions[idx];

  const pick = (letter: string) => {
    if (submittedRef.current) return;
    setAnswers((a) => ({ ...a, [q.id]: letter }));
  };
  const nav = (d: number) => {
    const n = idx + d;
    if (n < 0 || n >= questions.length) return;
    setIdx(n);
  };
  const toggleFlag = () => {
    setFlags((f) => (f.includes(q.id) ? f.filter((x) => x !== q.id) : [...f, q.id]));
  };

  /* 键盘：A–D 作答、←/→ 切题、F 标记 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (report) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const map: Record<string, string> = { a: "A", b: "B", c: "C", d: "D", "1": "A", "2": "B", "3": "C", "4": "D" };
      const k = e.key.toLowerCase();
      if (map[k]) pick(map[k]);
      if (e.key === "ArrowRight") nav(1);
      if (e.key === "ArrowLeft") nav(-1);
      if (k === "f") toggleFlag();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* 成绩单 */
  if (report) {
    if (reviewIdx != null) {
      const rq = questions[reviewIdx];
      return (
        <div>
          <QuestionCard q={rq} index={reviewIdx} total={questions.length} mode="review" myAnswer={answers[rq.id]} />
          <div className="qfoot">
            <button className="btn" disabled={reviewIdx === 0} onClick={() => setReviewIdx(reviewIdx - 1)}>
              上一题解析
            </button>
            <button className="btn" disabled={reviewIdx === questions.length - 1} onClick={() => setReviewIdx(reviewIdx + 1)}>
              下一题解析
            </button>
            <button className="btn primary" style={{ marginLeft: "auto" }} onClick={() => setReviewIdx(null)}>
              返回成绩单
            </button>
          </div>
        </div>
      );
    }
    const rate = Math.round((report.score / questions.length) * 100);
    const pass = rate >= paper.passRatio * 100;
    return (
      <div className="report">
        <div className="r-kicker">MOCK REPORT · 模拟考成绩单</div>
        <h2>{paper.title}</h2>
        <div className="kv-strip">
          <div className="kv">
            <div className={`n ${pass ? "ok" : "bad"}`}>
              {report.score}
              <span style={{ fontSize: 14, color: "var(--faint)" }}> / {questions.length}</span>
            </div>
            <div className="l">得分</div>
          </div>
          <div className="kv">
            <div className="n">{rate}%</div>
            <div className="l">正确率（目标 ≥{Math.round(paper.passRatio * 100)}%）</div>
          </div>
          <div className="kv">
            <div className="n">{formatSec(report.usedSec)}</div>
            <div className="l">用时</div>
          </div>
          <div className="kv">
            <div className="n">{flags.length}</div>
            <div className="l">标记未决</div>
          </div>
        </div>
        <p className="r-note">
          {pass
            ? `✓ 已越过 ${Math.round(paper.passRatio * 100)}% 的及格换算线——真实考试 75 题答对 45 题即通过。错题已自动收入错题本，建议先重练错题再开下一套卷。`
            : `✗ 当前正确率未到 ${Math.round(paper.passRatio * 100)}% 换算线（真实考试 75 题需答对 45 题）。错题已自动收入错题本，建议按知识域回炉后再战。`}
        </p>
        <table className="r-table">
          <thead>
            <tr>
              <th>题号</th>
              <th>你的答案</th>
              <th>正确答案</th>
              <th>判定</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {questions.map((qq, i) => {
              const my = answers[qq.id];
              const ok = gradeQuestion(qq, { b1: my });
              return (
                <tr key={qq.id}>
                  <td className="mono">{i + 1}</td>
                  <td className="mono">{my ?? "—"}</td>
                  <td className="mono">{qq.type === "single" ? qq.answer?.join("") : ""}</td>
                  <td className={ok ? "res-ok" : "res-bad"}>{ok ? "✓ 对" : "✗ 错"}</td>
                  <td>
                    <button className="btn sm ghost" onClick={() => setReviewIdx(i)}>
                      看解析
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="r-actions">
          <button className="btn primary" onClick={onRestart}>
            重新模考
          </button>
          <button className="btn" onClick={onExit}>
            返回试卷列表
          </button>
        </div>
      </div>
    );
  }

  const doneCount = Object.keys(answers).length;

  return (
    <div>
      <div className="exambar page-flush">
        <div className="exambar-in">
          <span className={`timer ${remaining <= 600 ? "warn" : ""}`}>{formatSec(remaining)}</span>
          <span className="meta">{paper.title}</span>
          <span className="sp" />
          <button className="sheet-btn" onClick={() => setSheetOpen((s) => !s)}>
            答题卡 <b>{doneCount}</b>/{questions.length}
          </button>
          <button
            className="submit-btn"
            onClick={() => {
              const unanswered = questions.length - doneCount;
              if (unanswered > 0 && !forceArm) {
                setForceArm(true);
                setTimeout(() => setForceArm(false), 2600);
                return;
              }
              doSubmit();
            }}
          >
            {forceArm ? `仍有 ${questions.length - doneCount} 题未答 · 再点确认交卷` : "交卷"}
          </button>
        </div>
      </div>

      <div className={`sheet ${sheetOpen ? "open" : ""}`}>
        <h4>答题卡 · 点击题号跳转</h4>
        <div className="sheet-grid">
          {questions.map((qq, i) => (
            <button
              key={qq.id}
              className={`cell ${answers[qq.id] ? "done" : ""} ${flags.includes(qq.id) ? "flagged" : ""} ${i === idx ? "cur" : ""}`}
              onClick={() => {
                setIdx(i);
                setSheetOpen(false);
              }}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <div className="legend">
          <span><span className="dot d-done" />已作答</span>
          <span><span className="dot" />未作答</span>
          <span><span className="dot d-flag" />已标记</span>
        </div>
      </div>

      <QuestionCard
        key={q.id}
        q={q}
        index={idx}
        total={questions.length}
        mode="exam"
        pick={{ b1: answers[q.id] }}
        onPick={(_, L) => pick(L)}
      />

      <div className="qfoot">
        <button className="btn" disabled={idx === 0} onClick={() => nav(-1)}>
          上一题
        </button>
        <button className={`btn flag ${flags.includes(q.id) ? "on" : ""}`} onClick={toggleFlag}>
          {flagSvg} 标记
        </button>
        <button className="btn primary" disabled={idx === questions.length - 1} onClick={() => nav(1)}>
          下一题
        </button>
        <span className="progress">
          已答 <b>{doneCount}</b>/{questions.length}
        </span>
      </div>
    </div>
  );
}

/* 章节练习：12 章知识树 + 综合桶，支持「只做未做 / 只做错题」 */
import { useMemo, useState } from "react";
import { allQuestions, chapterList } from "../lib/bank";
import { getState, recordAnswer, useAppState } from "../lib/store";
import { PracticeRunner } from "../components/PracticeRunner";
import { Empty } from "../components/ui";

interface Session {
  title: string;
  ids: string[];
  restartToken: number;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const chapterIds = (no: number): string[] => allQuestions.filter((q) => (q.node ?? 0) === no).map((q) => q.id);

export function PracticeView() {
  const state = useAppState();
  const [session, setSession] = useState<Session | null>(null);

  const rows = useMemo(
    () =>
      chapterList.map((ch) => {
        const qs = allQuestions.filter((q) => (q.node ?? 0) === ch.no);
        const done = qs.filter((q) => state.stats[q.id]).length;
        const wrong = qs.filter((q) => {
          const s = state.stats[q.id];
          return s ? s.lastCorrect === false || !!state.wrongBook[q.id] : false;
        }).length;
        const correct = qs.reduce((n, q) => n + (state.stats[q.id]?.correct ?? 0), 0);
        const attempts = qs.reduce((n, q) => n + (state.stats[q.id]?.correct ?? 0) + (state.stats[q.id]?.wrong ?? 0), 0);
        return { ch, total: qs.length, done, wrong, rate: attempts > 0 ? Math.round((correct / attempts) * 100) : null };
      }),
    [state.stats, state.wrongBook]
  );

  const start = (title: string, ids: string[]) => {
    if (!ids.length) return;
    setSession({ title, ids, restartToken: 0 });
    window.scrollTo({ top: 0 });
  };

  if (session) {
    return (
      <PracticeRunner
        key={`${session.title}-${session.restartToken}`}
        title={session.title}
        ids={session.restartToken ? shuffle(session.ids) : session.ids}
        onRecord={recordAnswer}
        onExit={() => setSession(null)}
        onRestart={() => setSession({ ...session, restartToken: session.restartToken + 1 })}
      />
    );
  }

  const grandTotal = allQuestions.length;
  const grandDone = allQuestions.filter((q) => state.stats[q.id]).length;

  return (
    <div>
      <div className="kicker">Practice · 按知识域练习</div>
      <h1 className="page-title">章节练习</h1>
      <p className="page-lede">
        题库共 {grandTotal} 道客观题，已刷 {grandDone} 道。即答即判、错题自动进错题本；正确率以「稳定 ≥60%」为目标线。
      </p>

      <div className="rows">
        {rows.map(({ ch, total, done, wrong, rate }) => (
          <div className="row" key={ch.no}>
            <div className="r-main">
              <div className="r-title">
                {ch.no > 0 ? `第 ${ch.no} 章 · ` : ""}
                {ch.title}
              </div>
              <div className="r-sub">
                {total} 题 · 已做 {done}
                {wrong > 0 ? ` · 待纠错 ${wrong}` : ""}
                {rate != null ? ` · 正确率 ${rate}%` : ""}
              </div>
            </div>
            <span className="r-side">
              {total > 0 ? (
                <>
                  <button className="btn sm" onClick={() => start(ch.title, chapterIds(ch.no))}>
                    {done > 0 ? "继续" : "开始"}
                  </button>{" "}
                  {done > 0 && done < total && (
                    <button
                      className="btn sm ghost"
                      onClick={() => {
                        const snap = getState();
                        start(ch.title + " · 未做题", chapterIds(ch.no).filter((id) => !snap.stats[id]));
                      }}
                    >
                      只做未做
                    </button>
                  )}{" "}
                  {wrong > 0 && (
                    <button
                      className="btn sm ghost"
                      onClick={() => {
                        const snap = getState();
                        start(ch.title + " · 错题", chapterIds(ch.no).filter((id) => snap.stats[id]?.lastCorrect === false || !!snap.wrongBook[id]));
                      }}
                    >
                      只做错题
                    </button>
                  )}
                </>
              ) : (
                <span className="faint">暂无题目</span>
              )}
            </span>
          </div>
        ))}
      </div>

      {grandTotal === 0 && <Empty title="题库为空" desc="运行 npm run bank:parse 生成 src/data/bank.json" />}
    </div>
  );
}

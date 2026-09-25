/* 统计：知识域掌握度（45/60 双参考线）、模考历史、长期活跃 */
import { allQuestions, bank, chapterList } from "../lib/bank";
import { formatSec } from "../lib/grading";
import { deleteAttempt, useAppState } from "../lib/store";
import { HeatStrip, MasteryBars, type MasteryDatum } from "../components/ui";

export function StatsView() {
  const state = useAppState();

  const data: MasteryDatum[] = chapterList.map((ch) => {
    const qs = allQuestions.filter((q) => (q.node ?? 0) === ch.no);
    const correct = qs.reduce((n, q) => n + (state.stats[q.id]?.correct ?? 0), 0);
    const wrong = qs.reduce((n, q) => n + (state.stats[q.id]?.wrong ?? 0), 0);
    const attempts = correct + wrong;
    return {
      name: (ch.no > 0 ? `${ch.no} · ` : "") + ch.title,
      rate: attempts >= 5 ? Math.round((correct / attempts) * 100) : null,
      done: qs.filter((q) => state.stats[q.id]).length,
      total: qs.length,
    };
  });

  const attempts = Object.values(state.attempts)
    .filter((a) => a.status === "submitted" && a.result)
    .sort((a, b) => b.savedAt - a.savedAt);

  const all = Object.values(state.stats);
  const answered = all.reduce((n, s) => n + s.correct + s.wrong, 0);
  const correct = all.reduce((n, s) => n + s.correct, 0);
  const rate = answered > 0 ? Math.round((correct / answered) * 100) : 0;
  const touched = all.length;
  const coverage = Math.round((touched / Math.max(1, allQuestions.length)) * 100);

  return (
    <div>
      <div className="kicker">Analytics · 数据复盘</div>
      <h1 className="page-title">学习统计</h1>
      <p className="page-lede">回答三个问题：距离 45 分还差多少、哪个知识域在拖后腿、最近是否坚持在刷。</p>

      <div className="kv-strip">
        <div className="kv">
          <div className="n">
            {touched}
            <span style={{ fontSize: 14, color: "var(--faint)" }}> / {allQuestions.length}</span>
          </div>
          <div className="l">触达题数（覆盖率 {coverage}%）</div>
        </div>
        <div className="kv">
          <div className={`n ${rate >= 60 ? "ok" : answered > 0 ? "bad" : ""}`}>{answered > 0 ? `${rate}%` : "—"}</div>
          <div className="l">总正确率（目标 ≥60%）</div>
        </div>
        <div className="kv">
          <div className="n">{attempts.length}</div>
          <div className="l">模考场次</div>
        </div>
        <div className="kv">
          <div className="n">{Object.keys(state.wrongBook).length}</div>
          <div className="l">错题本在册</div>
        </div>
      </div>

      <div className="sec-head">
        <span className="sec-no">01</span>
        <h2>知识域掌握度</h2>
        <span className="aux">按作答次数加权 · 样本 ≥5 次才显示</span>
      </div>
      <MasteryBars data={data} />

      <div className="sec-head">
        <span className="sec-no">02</span>
        <h2>模考历史</h2>
        <span className="aux">{attempts.length} 场</span>
      </div>
      {attempts.length === 0 ? (
        <p className="faint" style={{ fontSize: 13 }}>
          还没有交过卷。模考成绩会按试卷保留在这里。
        </p>
      ) : (
        <table className="r-table">
          <thead>
            <tr>
              <th>试卷</th>
              <th>得分</th>
              <th>正确率</th>
              <th>用时</th>
              <th>日期</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((a) => {
              const p = bank.papers.find((x) => x.id === a.paperId);
              return (
                <tr key={a.id}>
                  <td>{p?.title ?? a.paperId}</td>
                  <td className="mono">
                    {a.result!.score} / {a.result!.total}
                  </td>
                  <td className={`mono ${a.result!.score / a.result!.total >= 0.6 ? "res-ok" : "res-bad"}`}>
                    {Math.round((a.result!.score / a.result!.total) * 100)}%
                  </td>
                  <td className="mono">{formatSec(a.result!.usedSec)}</td>
                  <td className="mono">{new Date(a.savedAt).toLocaleDateString("zh-CN")}</td>
                  <td>
                    <button className="btn sm ghost" onClick={() => deleteAttempt(a.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="sec-head">
        <span className="sec-no">03</span>
        <h2>近 30 天活跃</h2>
      </div>
      <HeatStrip activity={state.activity} days={30} />
    </div>
  );
}

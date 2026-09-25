/* 今日：仪表盘——60% 北极星指标、断点续考入口、到期错题、近两周活跃 */
import { allQuestions, bank } from "../lib/bank";
import { formatSec, todayStr } from "../lib/grading";
import { attemptOfPaperOngoing, useAppState } from "../lib/store";
import { GoalRing, HeatStrip } from "../components/ui";

export function HomeView({ go }: { go: (hash: string) => void }) {
  const state = useAppState();

  const all = Object.values(state.stats);
  const answered = all.reduce((n, s) => n + s.correct + s.wrong, 0);
  const correct = all.reduce((n, s) => n + s.correct, 0);
  const rate = answered > 0 ? Math.round((correct / answered) * 100) : 0;
  const todayCount = state.activity[todayStr()] ?? 0;
  const now = Date.now();
  const dueCount = Object.values(state.wrongBook).filter((e) => e.dueAt <= now).length;

  /* 连续打卡天数（今天未刷则从昨天起算） */
  let streak = 0;
  {
    const start = (state.activity[todayStr()] ?? 0) > 0 ? 0 : 1;
    for (let i = start; ; i++) {
      if ((state.activity[todayStr(new Date(Date.now() - i * 86400_000))] ?? 0) > 0) streak++;
      else break;
    }
  }

  const ongoing = Object.values(state.attempts)
    .filter((a) => a.status === "ongoing")
    .sort((a, b) => b.savedAt - a.savedAt)[0];

  /* 最近练习的章节 */
  const lastQid = Object.entries(state.stats).sort((a, b) => b[1].lastAt - a[1].lastAt)[0]?.[0];
  const lastQ = lastQid ? allQuestions.find((q) => q.id === lastQid) : undefined;

  return (
    <div>
      <div className="kicker">{todayStr()} · 距离 45 分，稳定 60%</div>
      <h1 className="page-title">今日刷题台</h1>
      <p className="page-lede">
        综合知识 75 题答对 45 题即过线。把每章正确率练到 60% 以上，考试就是水到渠成。
      </p>

      <div className="kv-strip">
        <div className="kv">
          <div className="n">{answered}</div>
          <div className="l">累计刷题</div>
        </div>
        <div className="kv">
          <div className={`n ${rate >= 60 ? "ok" : answered > 0 ? "bad" : ""}`}>{answered > 0 ? `${rate}%` : "—"}</div>
          <div className="l">总正确率（目标 ≥60%）</div>
        </div>
        <div className="kv">
          <div className="n">{todayCount}</div>
          <div className="l">今日已刷</div>
        </div>
        <div className="kv">
          <div className="n">{streak} 天</div>
          <div className="l">连续打卡</div>
        </div>
      </div>

      <div className="ring-wrap" style={{ margin: "30px 0 8px" }}>
        <GoalRing rate={rate} />
        <div style={{ maxWidth: 380 }}>
          {answered === 0 ? (
            <>
              <p style={{ fontWeight: 560, marginBottom: 6 }}>从第 4 章「软件架构设计」开始</p>
              <p className="muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
                这是分值最重的核心大章，也是案例与论文的根基。先刷 20 题找找手感。
              </p>
              <button className="btn primary" onClick={() => go("#/practice")}>
                去章节练习
              </button>
            </>
          ) : dueCount > 0 ? (
            <>
              <p style={{ fontWeight: 560, marginBottom: 6 }}>
                错题本里有 <span className="red">{dueCount}</span> 道题今天该重练
              </p>
              <p className="muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
                间隔重复的黄金窗口就是现在——答对即移出错题本。
              </p>
              <button className="btn primary" onClick={() => go("#/wrong")}>
                去重练错题
              </button>
            </>
          ) : (
            <>
              <p style={{ fontWeight: 560, marginBottom: 6 }}>
                {rate >= 60 ? "正确率已在目标线上，继续保持" : "正确率还没到 60% 目标线"}
              </p>
              <p className="muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
                {lastQ ? `上次刷到「${lastQ.sourceRef}」，接着来一套模考检验一下。` : "开一套模拟卷检验真实水平。"}
              </p>
              <button className="btn primary" onClick={() => go("#/mock")}>
                去真题模考
              </button>
            </>
          )}
        </div>
      </div>

      {ongoing && (
        <div className="resume-banner" style={{ marginTop: 26 }}>
          <div>
            <div className="rb-t">继续未完成的模考</div>
            <div className="rb-d">
              {bank.papers.find((p) => p.id === ongoing.paperId)?.title} · 剩余 {formatSec(ongoing.remainingSec)}
            </div>
          </div>
          <span className="sp" />
          <button className="btn danger sm" onClick={() => go("#/mock")}>
            进入考场
          </button>
        </div>
      )}

      <div className="sec-head" style={{ marginTop: 40 }}>
        <span className="sec-no">02</span>
        <h2>最近两周</h2>
        <span className="aux">每日刷题量</span>
      </div>
      <HeatStrip activity={state.activity} days={14} />

      <div className="sec-head" style={{ marginTop: 38 }}>
        <span className="sec-no">03</span>
        <h2>快速开始</h2>
      </div>
      <div className="rows">
        <button className="row" onClick={() => go("#/practice")}>
          <div className="r-main">
            <div className="r-title">章节练习</div>
            <div className="r-sub">{allQuestions.length} 道客观题 · 即答即判 · 错题自动归档</div>
          </div>
          <span className="arrow">→</span>
        </button>
        <button className="row" onClick={() => go("#/mock")}>
          <div className="r-main">
            <div className="r-title">真题模拟考</div>
            <div className="r-sub">整卷连续计时 · 答题卡 · 断点续考 · 成绩单</div>
          </div>
          <span className="arrow">→</span>
        </button>
        <button className="row" onClick={() => go("#/wrong")}>
          <div className="r-main">
            <div className="r-title">错题本</div>
            <div className="r-sub">{Object.keys(state.wrongBook).length} 道待纠错 · 1/3/7 天间隔重现</div>
          </div>
          <span className="arrow">→</span>
        </button>
        <button className="row" onClick={() => go("#/case")}>
          <div className="r-main">
            <div className="r-title">案例分析练习</div>
            <div className="r-sub">{bank.cases.length} 道主观大题 · 逐问作答 · 对照参考答案自评</div>
          </div>
          <span className="arrow">→</span>
        </button>
      </div>
    </div>
  );
}

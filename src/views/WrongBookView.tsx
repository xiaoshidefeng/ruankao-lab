/* 错题本：按知识域归类 · 错因标记 · 间隔重现（答错后 1/3/7 天重现，答对移出） */
import { useMemo, useState } from "react";
import { questionById } from "../lib/bank";
import { DAY } from "../lib/grading";
import { recordWrongBookAnswer, removeFromWrongBook, setWrongCause, useAppState } from "../lib/store";
import { CAUSE_LABEL, type WrongCause } from "../lib/types";
import { PracticeRunner } from "../components/PracticeRunner";
import { Empty } from "../components/ui";

export function WrongBookView() {
  const state = useAppState();
  const [filter, setFilter] = useState<"all" | "due">("all");
  const [sessionIds, setSessionIds] = useState<string[] | null>(null);

  const entries = useMemo(
    () =>
      Object.values(state.wrongBook)
        .map((e) => ({ e, q: questionById.get(e.qid) }))
        .filter((x): x is { e: (typeof state.wrongBook)[string]; q: NonNullable<typeof x.q> } => !!x.q)
        .sort((a, b) => a.e.dueAt - b.e.dueAt),
    [state.wrongBook]
  );

  const now = Date.now();
  const dueCount = entries.filter((x) => x.e.dueAt <= now).length;

  const due = (t: number): string => {
    const d = t - now;
    if (d <= 0) return `逾期 ${Math.max(1, Math.ceil(-d / DAY))} 天`;
    return `${Math.ceil(d / DAY)} 天后`;
  };

  if (sessionIds) {
    return (
      <PracticeRunner
        title="错题重练"
        ids={sessionIds}
        onRecord={recordWrongBookAnswer}
        onExit={() => setSessionIds(null)}
        onRestart={() => setSessionIds([...sessionIds])}
      />
    );
  }

  const shown = filter === "due" ? entries.filter((x) => x.e.dueAt <= now) : entries;

  return (
    <div>
      <div className="kicker">Wrong Book · 间隔重现</div>
      <h1 className="page-title">错题本</h1>
      <p className="page-lede">
        答错自动归档，按知识域分类。错题在答错后 1 / 3 / 7 天重现（简易间隔重复），重练答对即移出；先归因，再重练。
      </p>

      {entries.length === 0 ? (
        <Empty
          title="错题本是空的"
          desc="去刷几章题，答错的题会自动出现在这里——或者你一直全对，那也挺好。"
        />
      ) : (
        <>
          <div className="kv-strip">
            <div className="kv">
              <div className="n">{entries.length}</div>
              <div className="l">错题总数</div>
            </div>
            <div className="kv">
              <div className={`n ${dueCount > 0 ? "bad" : "ok"}`}>{dueCount}</div>
              <div className="l">今日到期</div>
            </div>
            <div className="kv">
              <div className="n">{entries.filter((x) => x.e.cause).length}</div>
              <div className="l">已归因</div>
            </div>
            <div className="kv">
              <div className="n">{entries.filter((x) => x.e.streak >= 2).length}</div>
              <div className="l">顽固错题（≥3 轮）</div>
            </div>
          </div>

          <div className="qfoot" style={{ marginTop: 0, marginBottom: 16 }}>
            <button className="btn primary" disabled={dueCount === 0} onClick={() => setSessionIds(entries.filter((x) => x.e.dueAt <= now).map((x) => x.q.id))}>
              重练到期错题（{dueCount}）
            </button>
            <button className="btn" onClick={() => setSessionIds(shuffled(entries.map((x) => x.q.id)))}>
              全部乱序重练
            </button>
            <span className="sp" style={{ flex: 1 }} />
            <button className={`btn sm ${filter === "all" ? "" : "ghost"}`} onClick={() => setFilter("all")}>
              全部
            </button>
            <button className={`btn sm ${filter === "due" ? "" : "ghost"}`} disabled={dueCount === 0} onClick={() => setFilter("due")}>
              只看到期
            </button>
          </div>

          <div className="rows">
            {shown.map(({ e, q }) => (
              <div className="row" key={q.id} style={{ alignItems: "flex-start" }}>
                <div className="r-main">
                  <div className="r-title" style={{ fontWeight: 480, fontSize: 13.8 }}>
                    {excerpt(q.stem)}
                  </div>
                  <div className="r-sub">
                    {q.sourceRef} · 正确答案 {q.type === "single" ? q.answer?.join("") : q.blanks?.map((b) => b.answer.join("")).join("/")} ·{" "}
                    <span className={e.dueAt <= now ? "red" : ""}>{due(e.dueAt)}重现</span>
                    {e.streak > 0 ? ` · 已错 ${e.streak + 1} 轮` : ""}
                  </div>
                  <div className="cause-chips">
                    {(Object.keys(CAUSE_LABEL) as WrongCause[]).map((c) => (
                      <button
                        key={c}
                        className={`chip ${e.cause === c ? (c === "knowledge" ? "on-bad" : c === "misread" ? "on-mid" : "on-good") : ""}`}
                        onClick={() => setWrongCause(q.id, e.cause === c ? undefined : c)}
                      >
                        {CAUSE_LABEL[c]}
                      </button>
                    ))}
                    <button className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={() => removeFromWrongBook(q.id)}>
                      移出
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function excerpt(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > 46 ? one.slice(0, 46) + "……" : one;
}

function shuffled(a: string[]): string[] {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

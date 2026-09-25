/* 案例分析：逐问作答 → 对照参考答案 → 三档自评（差异化功能：主观题可练习可反馈） */
import { useState } from "react";
import { bank, caseById } from "../lib/bank";
import { setCaseSelf, useAppState } from "../lib/store";
import type { CaseQuestion } from "../lib/types";
import { Empty } from "../components/ui";

const DRAFT_KEY = "rk.v1.caseDraft";

function loadDraft(caseId: string): Record<number, string> {
  try {
    return JSON.parse(localStorage.getItem(`${DRAFT_KEY}.${caseId}`) ?? "{}");
  } catch {
    return {};
  }
}
function saveDraft(caseId: string, draft: Record<number, string>) {
  try {
    localStorage.setItem(`${DRAFT_KEY}.${caseId}`, JSON.stringify(draft));
  } catch { /* ignore */ }
}

export function CaseView({ caseId }: { caseId?: string }) {
  const state = useAppState();
  const [active, setActive] = useState<CaseQuestion | null>(caseId ? caseById.get(caseId) ?? null : null);

  if (active) return <CaseRunner c={active} onExit={() => setActive(null)} onNav={(id) => setActive(caseById.get(id)!)} />;

  const cases = bank.cases;

  return (
    <div>
      <div className="kicker">Case Analysis · 主观题</div>
      <h1 className="page-title">案例分析练习</h1>
      <p className="page-lede">
        真实考试为 5 道大题答 3 道（第 1 题必答）。这里按题型池逐例练习：先自己写，再对照参考答案，按给分点三档自评——写不出来才是真实考感。
      </p>

      {cases.length === 0 ? (
        <Empty title="暂无案例" desc="题库管线尚未导入案例题" />
      ) : (
        <div className="rows">
          {cases.map((c) => {
            const self = state.caseSelf[c.id] ?? {};
            const rated = Object.keys(self).length;
            return (
              <button className="row" key={c.id} onClick={() => { setActive(c); window.scrollTo({ top: 0 }); }}>
                <div className="r-main">
                  <div className="r-title">论 {c.topic}</div>
                  <div className="r-sub">
                    {c.subqs.length} 问 · {c.sourceRef}
                    {rated > 0 ? ` · 已自评 ${rated}/${c.subqs.length}` : ""}
                  </div>
                </div>
                <span className="r-side">
                  {rated === c.subqs.length && c.subqs.length > 0 ? (
                    Object.values(self).every((v) => v === "good") ? (
                      <span className="teal">掌握到位</span>
                    ) : (
                      <span className="red">需回炉</span>
                    )
                  ) : (
                    "未完成"
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

function CaseRunner({ c, onExit, onNav }: { c: CaseQuestion; onExit: () => void; onNav: (id: string) => void }) {
  const state = useAppState();
  const [draft, setDraft] = useState<Record<number, string>>(() => loadDraft(c.id));
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});

  const self = state.caseSelf[c.id] ?? {};
  const idx = bank.cases.findIndex((x) => x.id === c.id);
  const prev = bank.cases[idx - 1];
  const next = bank.cases[idx + 1];

  const update = (no: number, text: string) => {
    const d = { ...draft, [no]: text };
    setDraft(d);
    saveDraft(c.id, d);
  };

  return (
    <div>
      <div className="qfoot" style={{ marginTop: 0, marginBottom: 16 }}>
        <button className="btn ghost" onClick={onExit}>
          ← 案例列表
        </button>
        <span className="sp" style={{ flex: 1 }} />
        <button className="btn sm" disabled={!prev} onClick={() => onNav(prev.id)}>
          上一例
        </button>
        <button className="btn sm" disabled={!next} onClick={() => onNav(next.id)}>
          下一例
        </button>
      </div>

      <div className="case-cols">
        <div className="case-material">
          <div className="cm-t">【说明】{c.topic}</div>
          <div className="cm-b">{c.material}</div>
        </div>
        <div className="case-ans">
          {c.subqs.map((sq) => {
            const text = draft[sq.no] ?? "";
            const open = revealed[sq.no];
            return (
              <div className="sq" key={sq.no}>
                <div className="sq-p">
                  <span className="sq-no">问题{sq.no}</span>
                  {sq.prompt}
                </div>
                <textarea
                  value={text}
                  placeholder="在此作答……先写关键词骨架，再展开"
                  onChange={(e) => update(sq.no, e.target.value)}
                />
                <div className="sq-foot">
                  <span className="wc">{text.length} 字</span>
                  <span className="sp" style={{ flex: 1 }} />
                  {!open && (
                    <button className="btn sm" onClick={() => setRevealed((r) => ({ ...r, [sq.no]: true }))}>
                      对照参考答案
                    </button>
                  )}
                </div>
                {open && (
                  <div className="sq-ref">
                    <div className="sr-l">REFERENCE · 参考答案</div>
                    <div className="sr-b">{c.reference || "（本例参考答案缺失，可对照教材知识点自评）"}</div>
                    <div className="rate-chips">
                      <button className={`chip ${self[sq.no] === "good" ? "on-good" : ""}`} onClick={() => setCaseSelf(c.id, sq.no, self[sq.no] === "good" ? undefined : "good")}>
                        ✓ 给分点到位
                      </button>
                      <button className={`chip ${self[sq.no] === "mid" ? "on-mid" : ""}`} onClick={() => setCaseSelf(c.id, sq.no, self[sq.no] === "mid" ? undefined : "mid")}>
                        ◐ 部分覆盖
                      </button>
                      <button className={`chip ${self[sq.no] === "bad" ? "on-bad" : ""}`} onClick={() => setCaseSelf(c.id, sq.no, self[sq.no] === "bad" ? undefined : "bad")}>
                        ✗ 基本没答上
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="faint" style={{ fontSize: 12, marginTop: 14 }}>
        作答草稿自动保存在本机；AI 按给分点预评为二期功能（见实施方案 §05）。
      </p>
    </div>
  );
}

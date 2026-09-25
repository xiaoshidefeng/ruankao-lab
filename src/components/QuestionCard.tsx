/* 题卡：练习（即答即判）/ 模考（可改答）/ 复盘（只读带解析）三种形态 */
import type { QPick, Question } from "../lib/types";
import { chapterName } from "../lib/bank";

const checkSvg = (
  <svg className="mark" width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const crossSvg = (
  <svg className="mark" width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
export const flagSvg = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M2.5 1v10M2.5 1.5h6.2l-1.6 2.3 1.6 2.3H2.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);

const LETTERS = ["A", "B", "C", "D", "E"];

function stemText(stem: string): string {
  return stem.replace(/（\s*）/g, "（　　）");
}

interface Props {
  q: Question;
  index: number;
  total: number;
  mode: "practice" | "exam" | "review";
  pick?: QPick;
  /** practice/review：已判定 */
  judged?: boolean;
  onPick?: (blank: 1 | 2, letter: string) => void;
  myAnswer?: string; // review 模式下展示的作答（如 "B" 或 "B/D"）
}

export function QuestionCard({ q, index, total, mode, pick, judged, onPick, myAnswer }: Props) {
  const showJudge = mode !== "exam" && judged;
  const rightTextStr = q.type === "single"
    ? (q.answer ?? []).join("")
    : (q.blanks ?? []).map((b) => b.answer.join("")).join(" / ");
  const myText = myAnswer ?? (() => {
    if (!pick) return "—";
    if (q.type === "single") return pick.b1 || "—";
    return [pick.b1 || "—", pick.b2 || "—"].join(" / ");
  })();
  const correct = showJudge || mode === "review"
    ? myText.replace(/\s/g, "") === rightTextStr
    : false;
  const disabled = mode === "exam" ? false : !!judged;

  const optClass = (isPick: boolean, isAns: boolean) => {
    let cls = "opt";
    if (showJudge) {
      if (isAns) { cls += " right"; }
      else if (isPick) { cls += " wrongpick"; }
      else { cls += " dim"; }
    } else if (isPick) {
      cls += " sel";
    }
    return cls;
  };

  const optMark = (isAns: boolean, isPick: boolean) =>
    showJudge ? (isAns ? checkSvg : isPick ? crossSvg : null) : null;

  const renderGroup = (
    opts: Record<string, string>,
    chosen: string | undefined,
    answer: string[] | undefined,
    onSel: (letter: string) => void
  ) => (
    <div className="opts">
      {LETTERS.filter((L) => opts[L]).map((L) => {
        const isPick = chosen === L;
        const isAns = !!answer?.includes(L);
        return (
          <button
            key={L}
            className={optClass(isPick, isAns)}
            disabled={disabled}
            onClick={() => onSel(L)}
          >
            <span className="key">{L}</span>
            <span className="txt">{opts[L]}</span>
            {optMark(isAns, isPick)}
          </button>
        );
      })}
    </div>
  );

  const myPickText = (): string => myText;

  const rightText = (): string => rightTextStr;

  return (
    <div className="qcard" key={q.id}>
      <div className="qmeta">
        <span className="qno">第 {index + 1} 题 / 共 {total} 题</span>
        <span className="qsrc">{q.sourceRef}</span>
        <span className="qnode">{chapterName(q.node)}{q.nodeAuto ? " · 自动归类" : ""}</span>
      </div>
      <div className="stem">{stemText(q.stem)}</div>

      {q.type === "single" ? (
        renderGroup(q.options ?? {}, pick?.b1, q.answer ?? undefined, (L) => onPick?.(1, L))
      ) : (
        <>
          {(q.blanks ?? []).map((b, bi) => (
            <div key={bi}>
              <div className="blank-label">
                <span className="no">{bi === 0 ? "①" : "②"}</span>
                {b.label}
              </div>
              {renderGroup(b.options, bi === 0 ? pick?.b1 : pick?.b2, b.answer, (L) => onPick?.((bi === 0 ? 1 : 2), L))}
            </div>
          ))}
        </>
      )}

      {showJudge && (
        <div className="analysis">
          <div className="a-head">
            <span className="a-label">解析</span>
            <span className={`a-verdict ${correct ? "ok" : "bad"}`}>{correct ? "✓ 回答正确" : "✗ 回答错误"}</span>
          </div>
          <div className="a-ans">你的答案 <b>{myPickText()}</b> · 正确答案 <b>{rightText()}</b></div>
          <div className="a-body">{q.analysis || "（本题暂无解析）"}</div>
        </div>
      )}

      {mode === "review" && (
        <div className="analysis">
          <div className="a-head">
            <span className="a-label">解析</span>
            <span className={`a-verdict ${correct ? "ok" : "bad"}`}>
              {correct ? "✓ 本题答对" : "✗ 本题答错 · 已加入错题本"}
            </span>
          </div>
          <div className="a-ans">你的答案 <b>{myText}</b> · 正确答案 <b>{rightTextStr}</b></div>
          <div className="a-body">{q.analysis || "（本题暂无解析）"}</div>
        </div>
      )}
    </div>
  );
}

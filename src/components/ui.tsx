/* 共享展示组件：目标环 / 掌握度条 / 活动热条 / 空态 / 快捷键提示 */
import type { ReactNode } from "react";
import { formatSec, todayStr } from "../lib/grading";

/* ---------- 60% 目标环 ---------- */

export function GoalRing({ rate, size = 132 }: { rate: number; size?: number }) {
  const ok = rate >= 60;
  const r = 52;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, rate));
  const cx = size / 2, cy = size / 2;
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`正确率 ${rate}%`}>
      {/* 刻度环（考卷装订感） */}
      {Array.from({ length: 36 }, (_, i) => {
        const a = (i / 36) * 2 * Math.PI - Math.PI / 2;
        const inner = r + 9;
        const x1 = cx + Math.cos(a) * inner, y1 = cy + Math.sin(a) * inner;
        const x2 = cx + Math.cos(a) * (inner + (i % 9 === 0 ? 7 : 3.5));
        const y2 = cy + Math.sin(a) * (inner + (i % 9 === 0 ? 7 : 3.5));
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={i % 9 === 0 ? "#9b988e" : "#dedbd1"} strokeWidth="1" />;
      })}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--hair-soft)" strokeWidth="7" />
      {/* 60% 目标线 */}
      <circle
        cx={cx} cy={cy} r={r} fill="none" stroke="#c8963e" strokeWidth="10"
        strokeDasharray={`2 ${c - 2}`} strokeDashoffset={-(0.6 * c)} transform={`rotate(-90 ${cx} ${cy})`}
      />
      <circle
        cx={cx} cy={cy} r={r} fill="none" stroke={ok ? "var(--teal)" : "var(--red)"} strokeWidth="7"
        strokeDasharray={`${(clamped / 100) * c} ${c}`} strokeLinecap="butt" transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text x={cx} y={cy + 2} textAnchor="middle" className={`num ${ok ? "ok" : "bad"}`} fontSize="26">{rate}%</text>
      <text x={cx} y={cy + 20} textAnchor="middle" className="cap">正确率 · 目标≥60%</text>
    </svg>
  );
}

/* ---------- 知识域掌握度横条 ---------- */

export interface MasteryDatum {
  name: string;
  rate: number | null; // null = 样本不足
  done: number;
  total: number;
}

export function MasteryBars({ data }: { data: MasteryDatum[] }) {
  return (
    <div className="mastery">
      {data.map((d) => (
        <div className="m-row" key={d.name}>
          <span className="m-name" title={d.name}>{d.name}</span>
          <div className="m-track">
            {d.rate != null && (
              <div
                className={`m-fill ${d.rate < 45 ? "bad" : d.rate < 60 ? "low" : ""}`}
                style={{ width: `${Math.max(2, d.rate)}%` }}
              />
            )}
          </div>
          <span className="m-val">
            {d.rate != null ? `${d.rate}% · ${d.done}题` : d.done > 0 ? `${d.done}题·样本少` : "未开始"}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------- 活动热条（最近 n 天） ---------- */

export function HeatStrip({ activity, days = 14 }: { activity: Record<string, number>; days?: number }) {
  const list: { label: string; n: number }[] = [];
  const max = Math.max(5, ...Object.values(activity));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    list.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, n: activity[todayStr(d)] ?? 0 });
  }
  return (
    <div className="heat">
      {list.map((d) => (
        <div className="h-day" key={d.label} title={`${d.label} · ${d.n} 题`}>
          <div className={`h-bar ${d.n === 0 ? "zero" : ""}`} style={{ height: `${Math.max(4, (d.n / max) * 32)}px` }} />
          <span className="h-l">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- 空态 ---------- */

export function Empty({ title, desc, action }: { title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="e-t">{title}</div>
      {desc && <div className="e-d">{desc}</div>}
      {action}
    </div>
  );
}

/* ---------- 快捷键提示 ---------- */

export function KbdHint({ exam }: { exam?: boolean }) {
  return (
    <div className="kbd-hint">
      <p>
        快捷键：<kbd>A</kbd>–<kbd>D</kbd> 或 <kbd>1</kbd>–<kbd>4</kbd> 选择 · <kbd>←</kbd><kbd>→</kbd> 切题
        {exam ? (<> · <kbd>F</kbd> 标记 · <kbd>Enter</kbd> 下一题</>) : (<> · <kbd>Enter</kbd> 下一题</>)}
      </p>
    </div>
  );
}

/* ---------- 计时显示 ---------- */

export function TimerText({ sec }: { sec: number }) {
  return <span className={`timer ${sec <= 600 ? "warn" : ""}`}>{formatSec(sec)}</span>;
}

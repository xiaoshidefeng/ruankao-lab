/* 论文写作：4 选 1 题目 → 120 分钟倒计时写作（摘要+正文，草稿自动落库）→ 交卷 →
   对照给分点自评（摘要/结构/实践/字数，AI 预评为二期）。对齐机考规则与「考卷·阅卷」设计。
   进入题目：有进行中草稿续写；否则有历史稿看最近一篇复盘；再无才新建。 */
import { useEffect, useRef, useState } from "react";
import { essayTopicById, essayTopics } from "../lib/essays";
import {
  createEssay,
  deleteEssay,
  essaysOfTopic,
  saveEssay,
  setEssaySelf,
  submitEssay,
  useAppState,
} from "../lib/store";
import type { EssayDraft, EssayReviewItem, EssayTopic } from "../lib/types";
import { ESSAY_REVIEW_LABEL } from "../lib/types";
import { Empty, TimerText } from "../components/ui";

const DURATION_MIN = 120;
const wordCount = (s: string) => s.replace(/\s/g, "").length;

export function EssayView({ topicId }: { topicId?: string }) {
  const [active, setActive] = useState<EssayTopic | null>(topicId ? essayTopicById.get(topicId) ?? null : null);
  const state = useAppState();
  if (active) return <EssayRunner topic={active} onExit={() => setActive(null)} />;

  const submittedCount = Object.values(state.essays).filter((e) => e.status === "submitted").length;

  return (
    <div>
      <div className="kicker">Essay · 论文写作</div>
      <h1 className="page-title">论文写作</h1>
      <p className="page-lede">
        真实考试为 4 选 1、120 分钟完成 2500 字左右。先自己写，交卷后按四个给分点自评——
        摘要练到 300–330 字不多不少，主体结合真实项目与量化数据。已提交 {submittedCount} 篇。
      </p>

      {essayTopics.length === 0 ? (
        <Empty title="暂无论文题" desc="题集尚未导入（essays.json）" />
      ) : (
        <div className="rows">
          {essayTopics.map((t) => {
            const mine = essaysOfTopic(t.id);
            const ongoing = mine.find((e) => e.status === "ongoing");
            const done = mine.filter((e) => e.status === "submitted");
            return (
              <button className="row" key={t.id} onClick={() => { setActive(t); window.scrollTo({ top: 0 }); }}>
                <div className="r-main">
                  <div className="r-title">论 {t.title}</div>
                  <div className="r-sub">
                    {t.domain} · {t.sourceRef}
                    {done.length > 0 ? ` · 已写 ${done.length} 篇` : ""}
                    {ongoing ? ` · 续写中（正文 ${wordCount(ongoing.body)} 字）` : ""}
                  </div>
                </div>
                <span className="r-side">
                  {ongoing ? "续写" : done.length > 0 ? (Object.values(done[0].selfReview ?? {}).every((v) => v === "good") ? "四点全过" : "可回炉") : "未写"}
                </span>
                <span className="arrow">→</span>
              </button>
            );
          })}
        </div>
      )}
      <p className="faint" style={{ fontSize: 12, marginTop: 14 }}>
        共 {essayTopics.length} 题 · 草稿自动落库，支持断点续写 · AI 预评为二期功能。
        {!submittedCount && !essayTopics.some((t) => ongoingDraftOf(t.id)) && " 从第一篇开始，写满 90 分钟再对照提示复盘。"}
      </p>
    </div>
  );
}

const ongoingDraftOf = (topicId: string) =>
  essaysOfTopic(topicId).find((e) => e.status === "ongoing");

function EssayRunner({ topic, onExit }: { topic: EssayTopic; onExit: () => void }) {
  const state = useAppState();
  const [essay, setEssay] = useState<EssayDraft | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  const essayRef = useRef<EssayDraft | null>(null);
  essayRef.current = essay;

  const startNew = () => {
    setReviewId(null);
    setEssay(createEssay(topic.id, DURATION_MIN));
  };

  // 进入写作：续写进行中的稿 → 看最近一篇已交卷 → 都没有才新建
  useEffect(() => {
    const existing = ongoingDraftOf(topic.id);
    if (existing) {
      setEssay(existing);
      return;
    }
    const history = essaysOfTopic(topic.id).filter((e) => e.status === "submitted");
    if (history.length > 0) {
      setReviewId(history[0].id);
      return;
    }
    setEssay(createEssay(topic.id, DURATION_MIN));
  }, [topic.id]);

  // 计时 + 周期落盘：草稿每 20 秒强制保存一次（与模考断点续考同策略）
  useEffect(() => {
    if (!essay || essay.status !== "ongoing") return;
    const timer = setInterval(() => {
      const cur = essayRef.current;
      if (!cur || cur.status !== "ongoing") return;
      const next = { ...cur, elapsedSec: cur.elapsedSec + 1 };
      setEssay(next);
      if (next.elapsedSec % 20 === 0) {
        saveEssay(next);
        setSavedTick((n) => n + 1);
      }
      if (next.elapsedSec >= DURATION_MIN * 60) {
        // 到点自动交卷
        setEssay(submitEssay(next));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [essay?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // 文本防抖落盘
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const queueSave = (next: EssayDraft) => {
    setEssay(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const cur = essayRef.current;
      if (cur && cur.status === "ongoing") {
        saveEssay(cur);
        setSavedTick((n) => n + 1);
      }
    }, 2000);
  };

  const update = (field: "abstract" | "body", text: string) => {
    if (!essay || essay.status !== "ongoing") return;
    queueSave({ ...essay, [field]: text });
  };

  // 刚交卷（本地 state 已是 submitted）→ 复盘
  if (essay && essay.status === "submitted") {
    return <EssayReview topic={topic} draft={state.essays[essay.id] ?? essay} onExit={onExit} onStartNew={startNew} />;
  }
  // 从列表进入且无进行中草稿 → 最近一篇复盘
  if (!essay && reviewId) {
    const reviewed = state.essays[reviewId];
    if (reviewed) {
      return <EssayReview topic={topic} draft={reviewed} onExit={onExit} onStartNew={startNew} onDelete={() => { deleteEssay(reviewed.id); startNew(); }} />;
    }
  }
  if (!essay) return null;

  const remaining = DURATION_MIN * 60 - essay.elapsedSec;
  const aw = wordCount(essay.abstract);
  const bw = wordCount(essay.body);
  const saved = savedTick > 0;
  const doSubmit = () => {
    if (!essay.body.trim() || !window.confirm(`确认交卷？摘要 ${aw} 字、正文 ${bw} 字，交卷后可对照给分点自评。`)) return;
    clearTimeout(saveTimer.current);
    setEssay(submitEssay(essay));
  };

  return (
    <div>
      <div className="qfoot" style={{ marginTop: 0, marginBottom: 16 }}>
        <button className="btn ghost" onClick={onExit}>← 论文列表</button>
        <span className="sp" style={{ flex: 1 }} />
        <span className="faint" style={{ fontSize: 12, marginRight: 12 }}>
          {saved ? `已自动保存 ${new Date(essay.savedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "自动保存已开启"}
        </span>
        <span className="faint" style={{ fontSize: 12, marginRight: 8 }}>剩余</span>
        <TimerText sec={remaining} />
        <button className="btn sm" style={{ marginLeft: 12 }} onClick={doSubmit}>交卷</button>
      </div>

      <div className="case-material" style={{ marginBottom: 18 }}>
        <div className="cm-t">论 {topic.title}</div>
        <div className="cm-b">{topic.background}</div>
        <details style={{ marginTop: 8 }}>
          <summary className="faint" style={{ fontSize: 12, cursor: "pointer" }}>写作提示（结构骨架，写前可看）</summary>
          <ul style={{ margin: "8px 0 0 18px", fontSize: 13, lineHeight: 1.9 }}>
            {topic.outline.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
        </details>
      </div>

      <div className="sq">
        <div className="sq-p">
          <span className="sq-no">摘要</span>
          300–330 字：背景 + 角色 + 核心方法 + 成效，一段成文
        </div>
        <textarea
          value={essay.abstract}
          onChange={(e) => update("abstract", e.target.value)}
          placeholder="写入摘要……（考试中摘要超 400 字会扣分，练到 300–330 字区间最稳）"
          rows={6}
        />
        <div className="sq-foot">
          <span className="wc">{aw} 字{aw >= 300 && aw <= 330 ? " · 区间内" : aw < 300 ? ` · 还差 ${300 - aw} 字` : ` · 超 ${aw - 330} 字`}</span>
        </div>
      </div>

      <div className="sq" style={{ marginTop: 16 }}>
        <div className="sq-p">
          <span className="sq-no">正文</span>
          项目概述 → 主体（2–3 个实践要点，带真实数据）→ 结尾，≥2000 字
        </div>
        <textarea
          value={essay.body}
          onChange={(e) => update("body", e.target.value)}
          placeholder="写入正文……项目概述占 300 字左右；主体分 2–3 个要点展开，每个要点写「怎么做 + 为什么 + 量化效果」；结尾收束并谈不足与改进。"
          rows={16}
        />
        <div className="sq-foot">
          <span className="wc">{bw} 字{bw < 2000 ? ` · 还差 ${2000 - bw} 字` : " · 达标"}</span>
        </div>
      </div>

      <p className="faint" style={{ fontSize: 12, marginTop: 14 }}>
        草稿每 2 秒自动落库（MySQL），关闭页面后可断点续写；到 120 分钟自动交卷。
      </p>
    </div>
  );
}

function EssayReview({ topic, draft, onExit, onStartNew, onDelete }: {
  topic: EssayTopic;
  draft: EssayDraft;
  onExit: () => void;
  onStartNew: () => void;
  onDelete?: () => void;
}) {
  const state = useAppState();
  const live = state.essays[draft.id] ?? draft;
  const self = live.selfReview ?? {};
  const items: EssayReviewItem[] = ["abstract", "structure", "practice", "length"];
  const good = items.filter((i) => self[i] === "good").length;
  const aw = wordCount(live.abstract);
  const bw = wordCount(live.body);
  const usedMin = Math.round(live.elapsedSec / 60);

  return (
    <div>
      <div className="qfoot" style={{ marginTop: 0, marginBottom: 16 }}>
        <button className="btn ghost" onClick={onExit}>← 论文列表</button>
        <span className="sp" style={{ flex: 1 }} />
        {onDelete && <button className="btn sm ghost" style={{ marginRight: 8 }} onClick={onDelete}>删除此稿</button>}
        <button className="btn sm" onClick={onStartNew}>再写一篇</button>
      </div>

      <div className="case-material" style={{ marginBottom: 18 }}>
        <div className="cm-t">已交卷 · 论 {topic.title}</div>
        <div className="cm-b">
          用时 {usedMin} 分钟 · 摘要 {aw} 字（目标 300–330）· 正文 {bw} 字（目标 ≥2000）
          {aw >= 300 && aw <= 330 ? "" : " · 摘要字数出区间，注意练手感"}
          {bw >= 2000 ? "" : " · 正文未达标"}
        </div>
      </div>

      <div className="sq">
        <div className="sq-p"><span className="sq-no">摘要</span>{aw} 字</div>
        <div className="sq-ref" style={{ marginTop: 10 }}><div className="sr-b" style={{ whiteSpace: "pre-wrap" }}>{live.abstract || "（空）"}</div></div>
      </div>
      <div className="sq" style={{ marginTop: 16 }}>
        <div className="sq-p"><span className="sq-no">正文</span>{bw} 字</div>
        <div className="sq-ref" style={{ marginTop: 10 }}><div className="sr-b" style={{ whiteSpace: "pre-wrap" }}>{live.body || "（空）"}</div></div>
      </div>

      <div className="sq" style={{ marginTop: 16 }}>
        <div className="sq-p"><span className="sq-no">自评</span>按四个给分点评判（已过 {good}/4）</div>
        <div className="rate-chips" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
          {items.map((item) => (
            <div key={item} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, minWidth: 240 }}>{ESSAY_REVIEW_LABEL[item]}</span>
              <button className={`chip ${self[item] === "good" ? "on-good" : ""}`} onClick={() => setEssaySelf(live.id, item, self[item] === "good" ? undefined : "good")}>✓ 到位</button>
              <button className={`chip ${self[item] === "mid" ? "on-mid" : ""}`} onClick={() => setEssaySelf(live.id, item, self[item] === "mid" ? undefined : "mid")}>◐ 部分到位</button>
              <button className={`chip ${self[item] === "bad" ? "on-bad" : ""}`} onClick={() => setEssaySelf(live.id, item, self[item] === "bad" ? undefined : "bad")}>✗ 没做到</button>
            </div>
          ))}
        </div>
      </div>

      <p className="faint" style={{ fontSize: 12, marginTop: 14 }}>
        自评随稿落库；AI 按「摘要-项目概述-主体-结尾」结构预评为二期功能。
      </p>
    </div>
  );
}

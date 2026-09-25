/* 状态层 · localStorage 单一状态树 + useSyncExternalStore
   数据访问全部走 actions/useAppState。可选 MySQL 后端：探测 /api 可达时
   进入 mysql 模式——启动用服务端状态水合，之后每个动作本地即时生效并
   异步推送落库；后端失联自动回退 localStorage，重载后以服务端为准。 */
import { useSyncExternalStore } from "react";
import type { AppState, EssayDraft, EssayReviewItem, MockAttempt, QStat, WrongCause, WrongEntry } from "./types";
import { DAY, todayStr } from "./grading";
import { backendStatus, probeBackend, pushAction, setBackendStatusListener, type BackendStatus } from "./api";

const KEY = "rk.v1.state";

const emptyState: AppState = {
  version: 1,
  stats: {},
  wrongBook: {},
  attempts: {},
  activity: {},
  caseSelf: {},
  essays: {},
};

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState;
    const parsed = JSON.parse(raw) as AppState;
    if (parsed.version !== 1) return emptyState;
    return { ...emptyState, ...parsed };
  } catch {
    return emptyState;
  }
}

let state: AppState = load();
const listeners = new Set<() => void>();

function persistLocal() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 存储满等异常时忽略，内存态仍可用 */
  }
}

function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  touched = true;
  persistLocal();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, () => state);
}

export const getState = () => state;

/* ---------------- MySQL 后端模式 ---------------- */

let touched = false; // 探测窗口内已有本地改动则不覆盖水合，避免丢输入
let backend: BackendStatus = { mode: "local", online: false };
const backendListeners = new Set<() => void>();

/** App 挂载时调用一次：探测 /api，可达则切 mysql 模式并用服务端状态水合 */
export function initBackend() {
  setBackendStatusListener((s) => {
    backend = s;
    backendListeners.forEach((l) => l());
  });
  void probeBackend().then(({ status, state: server }) => {
    if (status.mode !== "mysql" || !server) return;
    if (!touched) {
      state = { ...emptyState, ...(server as AppState) };
      persistLocal();
      listeners.forEach((l) => l());
    }
  });
}

export function useBackendStatus(): BackendStatus {
  return useSyncExternalStore(
    (l) => {
      backendListeners.add(l);
      return () => backendListeners.delete(l);
    },
    () => backend
  );
}

export const isMysqlMode = () => backendStatus().mode === "mysql";

/* ---------------- 记录一次客观题作答（练习/模考通用） ---------------- */

/** 共享的本地状态更新；推送语义由外层决定（错题本重练是一条复合动作，避免双计） */
function applyAnswerLocal(qid: string, correct: boolean) {
  const prev: QStat = state.stats[qid] ?? { correct: 0, wrong: 0, lastAt: 0, lastCorrect: true };
  const stats = {
    ...state.stats,
    [qid]: {
      correct: prev.correct + (correct ? 1 : 0),
      wrong: prev.wrong + (correct ? 0 : 1),
      lastAt: Date.now(),
      lastCorrect: correct,
    },
  };
  const t = todayStr();
  const activity = { ...state.activity, [t]: (state.activity[t] ?? 0) + 1 };

  let wrongBook = state.wrongBook;
  if (!correct) {
    const entry: WrongEntry = wrongBook[qid] ?? { qid, addedAt: Date.now(), dueAt: Date.now() + DAY, streak: 0 };
    wrongBook = { ...wrongBook, [qid]: { ...entry, addedAt: entry.addedAt } };
  }
  setState({ stats, activity, wrongBook });
}

export function recordAnswer(qid: string, correct: boolean) {
  applyAnswerLocal(qid, correct);
  pushAction({ type: "answer", qid, correct });
}

/** 错题重练判分：答对移出错题本；答错按 1/3/7 天顺延重现 */
export function recordWrongBookAnswer(qid: string, correct: boolean) {
  applyAnswerLocal(qid, correct);
  const entry = state.wrongBook[qid];
  if (!entry) return;
  if (correct) {
    const { [qid]: _removed, ...rest } = state.wrongBook;
    setState({ wrongBook: rest });
  } else {
    const streak = entry.streak + 1;
    const days = [1, 3, 7][Math.min(streak, 2)];
    setState({ wrongBook: { ...state.wrongBook, [qid]: { ...entry, streak, dueAt: Date.now() + days * DAY } } });
  }
  pushAction({ type: "wrongbook-answer", qid, correct });
}

export function setWrongCause(qid: string, cause: WrongCause | undefined) {
  const entry = state.wrongBook[qid];
  if (!entry) return;
  setState({ wrongBook: { ...state.wrongBook, [qid]: { ...entry, cause } } });
  pushAction({ type: "wrong-cause", qid, cause: cause ?? null });
}

export function removeFromWrongBook(qid: string) {
  if (!state.wrongBook[qid]) return;
  const { [qid]: _removed, ...rest } = state.wrongBook;
  setState({ wrongBook: rest });
  pushAction({ type: "wrong-remove", qid });
}

/* ---------------- 模考尝试 ---------------- */

export function createAttempt(paperId: string, durationMin: number): MockAttempt {
  const id = `${paperId}-${Date.now().toString(36)}`;
  const attempt: MockAttempt = {
    id,
    paperId,
    startedAt: Date.now(),
    savedAt: Date.now(),
    answers: {},
    flags: [],
    remainingSec: durationMin * 60,
    idx: 0,
    status: "ongoing",
  };
  setState({ attempts: { ...state.attempts, [id]: attempt } });
  pushAction({ type: "attempt-create", attempt });
  return attempt;
}

export function saveAttempt(attempt: MockAttempt) {
  setState({ attempts: { ...state.attempts, [attempt.id]: { ...attempt, savedAt: Date.now() } } });
  pushAction({ type: "attempt-save", attempt: { ...attempt, savedAt: Date.now() } });
}

/** 交卷：记录成绩、错题入本（不入 activity，模考题量在交卷时逐题计入） */
export function submitAttempt(attempt: MockAttempt, score: number, total: number, usedSec: number) {
  const savedAt = Date.now();
  setState({
    attempts: {
      ...state.attempts,
      [attempt.id]: { ...attempt, status: "submitted", remainingSec: 0, savedAt, result: { score, total, usedSec } },
    },
  });
  pushAction({ type: "attempt-submit", id: attempt.id, score, total, usedSec });
}

export function deleteAttempt(id: string) {
  if (!state.attempts[id]) return;
  const { [id]: _removed, ...rest } = state.attempts;
  setState({ attempts: rest });
  pushAction({ type: "attempt-delete", id });
}

/* ---------------- 案例自评 ---------------- */

export function setCaseSelf(caseId: string, subqNo: number, rate: "good" | "mid" | "bad" | undefined) {
  const cur = state.caseSelf[caseId] ?? {};
  if (rate === undefined) delete cur[subqNo];
  else cur[subqNo] = rate;
  setState({ caseSelf: { ...state.caseSelf, [caseId]: cur } });
  pushAction({ type: "case-self", caseId, subqNo, rate: rate ?? null });
}

/* ---------------- 论文写作 ---------------- */

export function createEssay(topicId: string, durationMin: number): EssayDraft {
  const id = `essay-${topicId}-${Date.now().toString(36)}`;
  const essay: EssayDraft = {
    id,
    topicId,
    startedAt: Date.now(),
    savedAt: Date.now(),
    abstract: "",
    body: "",
    elapsedSec: 0,
    status: "ongoing",
  };
  setState({ essays: { ...state.essays, [id]: essay } });
  pushAction({ type: "essay-create", essay });
  return essay;
}

export function saveEssay(essay: EssayDraft) {
  const saved = { ...essay, savedAt: Date.now() };
  setState({ essays: { ...state.essays, [essay.id]: saved } });
  pushAction({ type: "essay-save", essay: saved });
}

/** 交卷：正文/摘要以提交时刻内容为准；返回终稿（视图据其切换到复盘界面） */
export function submitEssay(essay: EssayDraft): EssayDraft {
  const submittedAt = Date.now();
  const done: EssayDraft = { ...essay, status: "submitted", submittedAt, savedAt: submittedAt };
  setState({ essays: { ...state.essays, [essay.id]: done } });
  pushAction({ type: "essay-submit", id: essay.id, submittedAt, abstract: essay.abstract, body: essay.body });
  return done;
}

export function deleteEssay(id: string) {
  if (!state.essays[id]) return;
  const { [id]: _removed, ...rest } = state.essays;
  setState({ essays: rest });
  pushAction({ type: "essay-delete", id });
}

export function setEssaySelf(id: string, item: EssayReviewItem, rate: "good" | "mid" | "bad" | undefined) {
  const essay = state.essays[id];
  if (!essay) return;
  const cur = { ...(essay.selfReview ?? {}) };
  if (rate === undefined) delete cur[item];
  else cur[item] = rate;
  setState({ essays: { ...state.essays, [id]: { ...essay, selfReview: cur } } });
  pushAction({ type: "essay-self", id, item, rate: rate ?? null });
}

export function ongoingEssayOfTopic(topicId: string): EssayDraft | undefined {
  return Object.values(state.essays).find((e) => e.topicId === topicId && e.status === "ongoing");
}

export function essaysOfTopic(topicId: string): EssayDraft[] {
  return Object.values(state.essays)
    .filter((e) => e.topicId === topicId)
    .sort((a, b) => b.startedAt - a.startedAt);
}

/* ---------------- 派生查询 ---------------- */

export function attemptOfPaperOngoing(paperId: string): MockAttempt | undefined {
  return Object.values(state.attempts).find((a) => a.paperId === paperId && a.status === "ongoing");
}

export function bestScoreOfPaper(paperId: string): number | null {
  const done = Object.values(state.attempts).filter((a) => a.paperId === paperId && a.status === "submitted" && a.result);
  if (!done.length) return null;
  return Math.max(...done.map((a) => a.result!.score / a.result!.total));
}

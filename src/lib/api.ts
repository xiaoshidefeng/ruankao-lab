/* MySQL 后端客户端 · 探测 / 水合 / 动作推送
   动作推送带 50ms 微批合并（模考交卷一次产生 75 条 recordAnswer），
   后端不可达时置 offline，store 继续走 localStorage 兜底。 */

export type ActionType =
  | { type: "answer"; qid: string; correct: boolean }
  | { type: "wrongbook-answer"; qid: string; correct: boolean }
  | { type: "wrong-cause"; qid: string; cause: string | null }
  | { type: "wrong-remove"; qid: string }
  | { type: "attempt-create"; attempt: unknown }
  | { type: "attempt-save"; attempt: unknown }
  | { type: "attempt-submit"; id: string; score: number; total: number; usedSec: number }
  | { type: "attempt-delete"; id: string }
  | { type: "case-self"; caseId: string; subqNo: number; rate: string | null };

export type BackendStatus = {
  /** mysql = /api 可用；local = 纯 localStorage */
  mode: "local" | "mysql";
  online: boolean;
  version?: string;
};

let onStatusChange: ((s: BackendStatus) => void) | undefined;
export function setBackendStatusListener(fn: (s: BackendStatus) => void) {
  onStatusChange = fn;
}

let status: BackendStatus = { mode: "local", online: false };
export const backendStatus = () => status;

function setStatus(patch: Partial<BackendStatus>) {
  status = { ...status, ...patch };
  onStatusChange?.(status);
}

async function fetchApi(path: string, init?: RequestInit, timeoutMs = 4000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(path, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as { ok: boolean; data?: unknown; error?: string };
  } finally {
    clearTimeout(timer);
  }
}

/** 启动探测：/api 可达则拉取服务端状态；失败则保持本地模式 */
export async function probeBackend(): Promise<{ status: BackendStatus; state?: unknown }> {
  try {
    const health = await fetchApi("/api/health");
    if (!health.ok) throw new Error(health.error);
    const version = (health.data as { version?: string })?.version;
    const state = await fetchApi("/api/state", undefined, 8000);
    if (!state.ok) throw new Error(state.error);
    setStatus({ mode: "mysql", online: true, version });
    return { status: { ...status }, state: state.data };
  } catch {
    setStatus({ mode: "local", online: false });
    return { status: { ...status } };
  }
}

/* ---------------- 动作微批推送 ---------------- */

let queue: ActionType[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let sending = false;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 50);
}

async function flush() {
  flushTimer = undefined;
  if (sending || !queue.length) return;
  sending = true;
  const batch = queue;
  queue = [];
  try {
    const res = await fetchApi(
      "/api/actions",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batch }) },
      8000
    );
    if (!res.ok) throw new Error(res.error);
    setStatus({ online: true });
  } catch {
    // 后端失联：本次批次丢弃（本地 localStorage 仍有），状态回退 local，重载后按服务端为准
    setStatus({ mode: "local", online: false });
    queue = [];
  } finally {
    sending = false;
    if (queue.length) scheduleFlush();
  }
}

export function pushAction(action: ActionType) {
  if (status.mode !== "mysql") return;
  queue.push(action);
  scheduleFlush();
}

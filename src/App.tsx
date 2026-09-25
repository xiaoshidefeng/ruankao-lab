/* 应用壳：hash 路由 + 侧边栏/顶部导航 */
import { useEffect, useState } from "react";
import { bank } from "./lib/bank";
import { initBackend, useAppState, useBackendStatus } from "./lib/store";
import { HomeView } from "./views/HomeView";
import { PracticeView } from "./views/PracticeView";
import { MockView } from "./views/MockView";
import { WrongBookView } from "./views/WrongBookView";
import { CaseView } from "./views/CaseView";
import { EssayView } from "./views/EssayView";
import { StatsView } from "./views/StatsView";

type Route = { view: string; param?: string };

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  const [view = "home", param] = h.split("/");
  return { view: view || "home", param };
}

const NAV: { id: string; label: string; no: string; hash: string }[] = [
  { id: "home", label: "今日", no: "00", hash: "#/" },
  { id: "practice", label: "章节练习", no: "01", hash: "#/practice" },
  { id: "mock", label: "真题模考", no: "02", hash: "#/mock" },
  { id: "wrong", label: "错题本", no: "03", hash: "#/wrong" },
  { id: "case", label: "案例分析", no: "04", hash: "#/case" },
  { id: "essay", label: "论文写作", no: "06", hash: "#/essay" },
  { id: "stats", label: "统计", no: "05", hash: "#/stats" },
];

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const state = useAppState();
  const backend = useBackendStatus();

  useEffect(() => {
    initBackend();
  }, []);

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.title = "架构师刷题台 · 软考练习与模拟考";
  }, []);

  const go = (hash: string) => {
    window.location.hash = hash;
  };

  const dueCount = Object.values(state.wrongBook).filter((e) => e.dueAt <= Date.now()).length;

  let body: React.ReactNode;
  switch (route.view) {
    case "practice":
      body = <PracticeView />;
      break;
    case "mock":
      body = <MockView paperId={route.param} />;
      break;
    case "wrong":
      body = <WrongBookView />;
      break;
    case "case":
      body = <CaseView caseId={route.param} />;
      break;
    case "essay":
      body = <EssayView topicId={route.param} />;
      break;
    case "stats":
      body = <StatsView />;
      break;
    default:
      body = <HomeView go={go} />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="name">架构师刷题台</div>
          <div className="sub">软考高级 · 系统架构设计师</div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${route.view === n.id ? "on" : ""}`}
              onClick={() => go(n.hash)}
            >
              <span className="ico">{n.no}</span>
              {n.label}
              {n.id === "wrong" && dueCount > 0 && <span className="badge">{dueCount}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className={`db-badge ${backend.mode === "mysql" ? "on" : ""}`}>
            {backend.mode === "mysql" ? `MySQL 已连接${backend.version ? ` · ${backend.version}` : ""}` : "本地存储 · 未连接数据库"}
          </span>
          题库 {bank.questions.length} 题 · 案例 {bank.cases.length}
          <br />
          {bank.meta.subject}
        </div>
      </aside>

      <div className="topnav">
        <div className="topnav-in">
          <span className="name">架构师刷题台</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--red)", letterSpacing: ".1em" }}>高级 · 架构师</span>
        </div>
        <div className="topnav-tabs">
          {NAV.map((n) => (
            <button key={n.id} className={`tnav ${route.view === n.id ? "on" : ""}`} onClick={() => go(n.hash)}>
              {n.label}
              {n.id === "wrong" && dueCount > 0 ? ` ${dueCount}` : ""}
            </button>
          ))}
        </div>
      </div>

      <main className="main">
        <div className="content" key={route.view + (route.param ?? "")}>
          {body}
        </div>
      </main>
    </div>
  );
}

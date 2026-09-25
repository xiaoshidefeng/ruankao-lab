#!/usr/bin/env node
/**
 * 题库生产流水线（Phase 0）· DOC 模拟卷 → 结构化题库 JSON
 *
 * 用法：  npm run bank:parse
 * 输入：  资料夹「7、模拟题」下的 .doc 文件（macOS，经 textutil 提取文本）
 * 输出：  src/data/bank.json（题库） + scripts/bank-report.json（质检报告）
 *
 * 管线步骤（对应实施方案 §07）：
 *   ① textutil 提取文本（等价于 OCR 步骤，DOC 自带文字层故无需 OCR）
 *   ② 按「题号-题干-选项-解析-答案」模式抽取为结构化题目
 *   ③ 自动质检：答案合法性、选项完整性、题量对账、图表依赖题剔除
 *   ④ 产出待人工复核清单（bank-report.json），入库数据带 source 标注
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// 资料根目录从环境变量传入（不入仓库）。目录下应有「综合知识模拟题」与「案例分析模拟题」两个子目录
const SRC_ROOT = process.env.RK_SRC_ROOT ?? "./materials";
const OUT_FILE = new URL("../src/data/bank.json", import.meta.url).pathname;
const REPORT_FILE = new URL("./bank-report.json", import.meta.url).pathname;

/* ---------------------------------- 工具 ---------------------------------- */

/** 调 macOS textutil 提取 DOC 文本（DOC 自带文字层，无需 OCR） */
function docToText(file) {
  return execFileSync("textutil", ["-convert", "txt", "-stdout", file], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function normalize(t) {
  return t
    .replace(/\r\n?/g, "\n")
    .replace(/\u3000/g, " ")
    .replace(/[\u00a0]/g, " ")
    .replace(/[ \t]+$/gm, "");
}

const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const cnToNum = (s) => [...s].reduce((n, c) => (c === "十" ? (n || 1) * 10 + (n = 0) : n + (CN_NUM[c] || 0)), 0);

/** 题干/选项依赖图片或表格的，视为不可用（图片在 DOC→文本 时丢失） */
const FIGURE_RE = /如下?图|见图|如图|图\s*\d|如下?表|见表|如表|表\s*\d[\s　]*[所各]?[表中]|下图表/;

/* ------------------------ 综合知识（单项选择题）解析 ------------------------ */

function parseAnswerSection(ansPart) {
  const answers = {}; // num -> letter
  const analysis = {}; // num -> text
  const events = [];
  const pairRe = /(\d{1,2})、\s*([A-D])(?![A-Za-z])/g;
  const explRe = /\[解析\]/g;
  let m;
  let lastNum = 0;
  while ((m = pairRe.exec(ansPart))) {
    const num = +m[1];
    if (num <= lastNum) continue; // 解析正文里出现的「N、X」干扰，按顺序过滤
    lastNum = num;
    answers[num] = m[2];
    events.push({ pos: m.index, type: "pair", num });
  }
  while ((m = explRe.exec(ansPart))) events.push({ pos: m.index, type: "expl" });
  events.sort((a, b) => a.pos - b.pos);
  let pending = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === "pair") {
      pending.push(ev.num);
    } else {
      const nextPos = i + 1 < events.length ? events[i + 1].pos : ansPart.length;
      const text = ansPart
        .slice(ev.pos + 4, nextPos)
        .replace(/^\n+/, "")
        .trim();
      for (const n of pending) analysis[n] = text;
      pending = [];
    }
  }
  return { answers, analysis };
}

function parseOptions(line) {
  // "A．xxx    B．yyy  C．zzz D．www" → {A,B,C,D}
  const positions = [];
  const re = /([A-D])\s*[．.]\s*/g;
  let m;
  while ((m = re.exec(line))) positions.push({ letter: m[1], textStart: m.index + m[0].length, matchStart: m.index });
  const opts = {};
  positions.forEach((p, i) => {
    const stop = i + 1 < positions.length ? positions[i + 1].matchStart : line.length;
    opts[p.letter] = line.slice(p.textStart, stop).replace(/\s+/g, " ").trim();
  });
  return Object.keys(opts).length >= 2 ? opts : null;
}

const OPTIONISH_RE = /^[A-D]\s*[．.]/;

const seenStems = new Set(); // 跨卷全局去重（同一题在多份模拟卷中重复出现）

const MARKER_RE = /^(\d{1,2})、\s?(.*)$/;

/** 解析一份综合知识模拟卷文本 → 题目数组（含被剔除题目与原因） */
function parseSingleChoicePaper(text, meta) {
  const dropLog = [];
  const ansIdx = text.search(/^答案[：:]/m);
  if (ansIdx < 0) {
    return { questions: [], dropLog: [{ reason: "no-answer-section", count: 1 }] };
  }
  const qPart = text.slice(0, ansIdx);
  const { answers, analysis } = parseAnswerSection(text.slice(ansIdx));

  // —— 逐行扫描，切出 marker（题号行）
  const lines = qPart.split("\n");
  const segs = []; // {num, stemLines[], options, optRaw}
  let cur = null;
  let pendingStem = ""; // 上一题选项行之后的散文本 = 下一题（或共享）题干
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // 卷内章节头等噪声
    if (/^[一二三四五六七八九十]+、/.test(line) || /^(单项|多项)选择题$/.test(line)) continue;
    const mk = line.match(MARKER_RE);
    if (mk) {
      const num = +mk[1];
      const inline = mk[2].trim();
      if (OPTIONISH_RE.test(inline)) {
        // 纯选项行（题号+选项同行的折行格式）：题干来自 pendingStem
        if (cur) segs.push(cur);
        const stemTxt = pendingStem.trim();
        cur = { num, stemLines: stemTxt ? [stemTxt] : [], options: parseOptions(inline), optRaw: inline };
        pendingStem = "";
      } else {
        if (cur) segs.push(cur);
        cur = { num, stemLines: inline ? [inline] : [], options: null, optRaw: "" };
      }
      continue;
    }
    // 非 marker 行
    const opts = parseOptions(line);
    if (cur && cur.optRaw && OPTIONISH_RE.test(line) && !cur.stemDone) {
      // 选项折行续行（A．x B．y / C．z D．w 分两行）：累积后再整体解析
      cur.optRaw += "  " + line;
      const merged = parseOptions(cur.optRaw);
      if (merged) cur.options = merged;
      if (merged && ["A", "B", "C", "D"].every((L) => merged[L])) cur.stemDone = true;
      continue;
    }
    if (cur && !cur.options && opts && cur.stemLines.length > 0) {
      cur.options = opts; // 选项独占一行，跟在题干后
      cur.optRaw = line;
      if (["A", "B", "C", "D"].every((L) => opts[L])) cur.stemDone = true;
    } else if (cur && cur.options) {
      pendingStem += line + "\n"; // 已有选项后的散文本 → 下一题题干候选
    } else if (cur) {
      cur.stemLines.push(line);
    }
  }
  if (cur) segs.push(cur);

  // —— 修复：题干区混入的选项行（折行选项被误收进 stemLines）
  for (const s of segs) {
    if (s.options && ["A", "B", "C", "D"].every((L) => s.options[L])) continue;
    const optLines = s.stemLines.filter((l) => OPTIONISH_RE.test(l) || (s.optRaw && /^[B-D]\s*[．.]/.test(l)));
    if (optLines.length) {
      const merged = parseOptions([s.optRaw, ...optLines].filter(Boolean).join("  "));
      if (merged) {
        s.options = merged;
        s.stemLines = s.stemLines.filter((l) => !optLines.includes(l));
      }
    }
  }

  // —— 组装题目：纯选项行的题干取 pendingStem / 继承上一题（共享题干）
  const questions = [];
  let prevStem = "";
  for (const s of segs) {
    const drop = (reason) => dropLog.push({ num: s.num, reason, stem: (s.stemLines.join("") || "").slice(0, 40) });
    let stem = s.stemLines.join("\n").trim() || pendingStem.trim() || prevStem;
    stem = stem.replace(/\n{2,}/g, "\n").trim();
    if (!s.options) { drop("no-options"); continue; }
    if (!stem || stem.length < 10) { drop("stem-too-short"); continue; }
    if (FIGURE_RE.test(stem)) { drop("needs-figure-or-table"); continue; }
    if (!answers[s.num]) { drop("no-answer"); continue; }
    const letters = Object.keys(s.options).sort();
    if (letters.length < 3) { drop("options-incomplete"); continue; }
    if (!letters.includes(answers[s.num])) { drop("answer-not-in-options"); continue; }
    const key = stem.slice(0, 30) + "|" + (s.options.A || "").slice(0, 20);
    if (seenStems.has(key)) { drop("duplicate"); continue; }
    seenStems.add(key);
    prevStem = stem;
    questions.push({
      id: `${meta.id}-${String(s.num).padStart(2, "0")}`,
      type: "single",
      node: null, // 由分类器回填
      nodeAuto: true,
      needsReview: letters.length < 4 || !s.options.D ? true : undefined,
      stem,
      options: s.options,
      answer: [answers[s.num]],
      analysis: (analysis[s.num] || "").trim(),
      sourceRef: meta.title,
      sourceNum: s.num,
    });
  }
  return { questions, dropLog };
}

/* --------------------------- 知识域自动归类 --------------------------- */

const CHAPTERS = [
  { no: 1, title: "系统工程与信息系统基础" },
  { no: 2, title: "软件工程" },
  { no: 3, title: "项目管理" },
  { no: 4, title: "软件架构设计" },
  { no: 5, title: "系统可靠性分析与设计" },
  { no: 6, title: "信息安全技术" },
  { no: 7, title: "计算机系统基础" },
  { no: 8, title: "嵌入式系统" },
  { no: 9, title: "计算机网络" },
  { no: 10, title: "数据库系统" },
  { no: 11, title: "未来信息技术" },
  { no: 12, title: "知识产权与标准化" },
];

// 顺序即优先级：-specific 在前，generic 在后
const NODE_RULES = [
  [10, /关系模式|函数依赖|候选关键|范式|关系代数|数据库|事务|并发控制|封锁|死锁|视图|触发器|存储过程|E\-R|ER图|SQL/],
  [4, /架构风格|软件架构|体系结构|质量属性|中间件|构件|微服务|SOA|REST|DSSA|ATAM|SAAM|架构评估|云原生|断路器|分层风格|管道|仓库风格|远程调用|MVC|架构复用|架构迁移|架构演化|富互联网|RIA|物联网架构|云设计/],
  [2, /设计模式|UML|用例图|类图|净室|CMMI|软件工程|需求分析|需求获取|软件测试|回归测试|黑盒|白盒|瀑布|原型|增量|螺旋|喷泉|敏捷|Scrum|RUP|统一过程|逆向工程|重构|配置管理|软件维护|可移植性|面向对象|封装|继承|多态|内聚|耦合|模块化|软件质量|文档/],
  [3, /项目管理|关键路径|甘特|挣值|WBS|PERT|风险识别|风险暴露|进度管理|成本管理|范围管理|质量保证|质量管理|配置项|评审/],
  [6, /信息安全|加密|解密|公钥|私钥|对称密|非对称|数字签名|报文摘要|防火墙|入侵检测|蜜罐|拒绝服务|SQL注入|漏洞|病毒|木马|PKI|CA认证|认证中心| Kerberos|Kerberos|安全协议|PGP|IPSec|SSL|HTTPS|访问控制|授权|不可抵赖/],
  [5, /可靠性|MTBF|MTTR|失效率|冗余|热备|串并联系统|平均无故障/],
  [8, /嵌入式|实时操作系统|RTOS|微内核|传感器|JTAG|板级支持|BSP|交叉编译|ARM/],
  [9, /计算机网络|子网|路由|交换机|以太网|TCP|UDP|IPV6|IPv6|ARP|DHCP|DNS|FTP|HTTP|协议|局域网|广域网|无线|蓝牙|ZigBee|5G|4G|网络规划|网络设计|带宽|信道|奈奎斯特|香农|调制|复用|边缘计算|SDN|IPv4/],
  [7, /指令|操作码|寻址|CPU|控制器|运算器|浮点|补码|反码|原码|移码|溢出|中断|总线|存储器|内存|磁盘|磁道|页式|段式|段页|虚拟存储|位图|Cache|高速缓存|相联|直接映像|I\/O|DMA|接口|寄存器|机器周期|流水线|吞吐率|海明|校验|CRC|循环冗余/],
  [12, /知识产权|著作权|版权|专利|商标|商业秘密|软件保护条例|标准化|国家标准|国际标准|ISO\s?\d|GB\/T|署名权|发表权|复制权|发行权| inventor|职务作品|委托作品|许可/],
  [11, /大数据|人工智能|机器学习|深度学习|神经网络|区块链|智能合约|量子计算|数字孪生|元宇宙|大模型|生成式|云计算|云存储|SaaS|PaaS|IaaS|虚拟化|容器|Docker|Kubernetes|数据湖|数据中台|联邦学习|隐私计算|ChatGPT/],
  [1, /信息化|信息系统|系统工程|电子政务|电子商务|企业应用集成|EAI|ERP|MES|商业智能|数据仓库|数据挖掘|两化融合|数字化转型|智慧城市|信息系统建设|生命周期|诺兰|业务流程|BPR|决策支持|DSS|企业信息化|信息资源|主数据|应用集成/],
];

function classifyNode(q) {
  const text = q.stem + " " + Object.values(q.options).join(" ");
  for (const [no, re] of NODE_RULES) if (re.test(text)) return no;
  return null; // → 「综合」
}

/* --------------------------- 案例分析卷解析 --------------------------- */

function parseCasePaper(text, meta) {
  const dropLog = [];
  const ansIdx = text.search(/^答案[：:]/m);
  const qPart = ansIdx >= 0 ? text.slice(0, ansIdx) : text;
  const aPart = ansIdx >= 0 ? text.slice(ansIdx) : "";

  // 答案区按 试题X 分块
  const ansSections = {};
  const secReA = /^试题([一二三四五六七八九十])/gm;
  const marks = [];
  let m;
  while ((m = secReA.exec(aPart))) marks.push({ pos: m.index, cn: m[1] });
  marks.forEach((s, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].pos : aPart.length;
    ansSections[cnToNum(s.cn)] = aPart.slice(s.pos, end).replace(/^试题[一二三四五六七八九十][^\n]*\n?/, "").trim();
  });

  const sections = [];
  const secReQ = /^试题([一二三四五六七八九])[^\n]*$/gm;
  const qmarks = [];
  while ((m = secReQ.exec(qPart))) qmarks.push({ pos: m.index, cn: m[1] });
  qmarks.forEach((s, i) => {
    const end = i + 1 < qmarks.length ? qmarks[i + 1].pos : qPart.length;
    sections.push({ cn: cnToNum(s.cn), body: qPart.slice(s.pos, end).replace(/^试题[一二三四五六七八九][^\n]*\n?/, "") });
  });

  const cases = [];
  for (const sec of sections) {
    const drop = (reason) => dropLog.push({ 试题: sec.cn, reason });
    const body = sec.body;
    const firstLine = body.split("\n").map((l) => l.trim()).find((l) => l) || "";
    const topicM = firstLine.match(/关于(.+?)的/) || body.slice(0, 200).match(/关于(.+?)的/);
    const topic = topicM ? topicM[1].trim() : null;
    if (!topic) { drop("no-topic-line"); continue; }

    // 小问定位：优先「问题N」标记行，回退到普通「N、」编号行
    let subqRe = /^\s*(?:\d+、\s*)?[【\[]?\s*问题\s*(\d+)\s*[】\]]?\s*[:：]?\s*$/gm;
    let qmarks2 = [];
    while ((m = subqRe.exec(body))) qmarks2.push({ pos: m.index, no: +m[1], end: m.index + m[0].length });
    let loose = false;
    if (qmarks2.length === 0) {
      loose = true;
      const plainRe = /^(\d{1,2})、\s?(.+)$/gm;
      while ((m = plainRe.exec(body))) {
        if (OPTIONISH_RE.test(m[2])) continue;
        qmarks2.push({ pos: m.index, no: qmarks2.length + 1, end: m.index + m[0].length });
      }
    }
    if (qmarks2.length === 0) { drop("no-subquestions"); continue; }

    const explIdx = body.search(/\[说明\]/);
    const material = body
      .slice(explIdx >= 0 ? explIdx + 4 : 0, qmarks2[0].pos)
      .replace(/^\s*[^\n]*说明[^\n]*\n/, "")
      .trim();
    const subqs = qmarks2.map((q, i) => ({
      no: q.no,
      prompt: body.slice(q.end, i + 1 < qmarks2.length ? qmarks2[i + 1].pos : body.length).trim(),
    }));    if (!material || material.length < 30) { drop("material-too-short"); continue; }
    if (FIGURE_RE.test(material) || subqs.some((q) => FIGURE_RE.test(q.prompt))) { drop("needs-figure-or-table"); continue; }

    // 参考答案：整块挂到该案例（部分卷内含 1）2）等编号，前端原样展示）
    const reference = (ansSections[sec.cn] || "").replace(/^\s*\[?问题\s*\d+\]?\s*$/gm, "").trim();
    cases.push({
      id: `${meta.id}-c${sec.cn}`,
      type: "case",
      topic,
      material,
      subqs,
      reference,
      sourceRef: meta.title,
    });
  }
  return { cases, dropLog };
}

/* ------------------------------- 原型自带题目 ------------------------------- */
// 来自交付物《练习与模考交互原型》：2025 上半年综合知识真题（考生回忆版）10 题
// 与第 4 章「软件架构设计」章节练习节选 4 题。人工校对过，置信度最高。

const PROTOTYPE_MOCK_2025S1 = [
  { node: 7, stem: "某信道的带宽为 3000Hz，编码采用 32 种不同的物理状态来表示数据，在无噪声环境下，该信道的最大数据传输速率是（ ）kbps。",
    options: { A: "100", B: "30", C: "50", D: "500" }, answer: ["B"],
    analysis: "奈奎斯特（Nyquist）定理：无噪声信道最大速率 C = 2W·log₂M = 2×3000×log₂32 = 6000×5 = 30000 bps = 30 kbps。" },
  { node: 7, stem: "操作系统采用页式存储管理，用位图管理空闲页框。若页大小为 4KB，物理内存大小为 16GB，则位图所占内存空间大小是（ ）KB。",
    options: { A: "64", B: "512", C: "256", D: "128" }, answer: ["B"],
    analysis: "16GB ÷ 4KB = 4M 个页框，位图中每一位对应一个页框，故需 4M bit = 4M ÷ 8 = 512KB。" },
  { node: 2, stem: "净室软件工程的理论基础主要是（ ）。",
    options: { A: "函数理论和抽样理论", B: "迭代模型", C: "瀑布模型", D: "概率统计" }, answer: ["A"],
    analysis: "净室软件工程应用数学与统计学理论，力图通过严格的工程化过程达到零缺陷或近零缺陷。其理论基础是函数理论与抽样理论；核心技术包括统计过程控制下的增量式开发、基于函数的规范与设计、正确性验证（核心）与统计测试。" },
  { node: 2, stem: "在 UML 用例图中，用例与用例之间不存在（ ）。",
    options: { A: "包含关系", B: "泛化关系", C: "扩展关系", D: "聚合关系" }, answer: ["D"],
    analysis: "用例之间只存在包含（include）、扩展（extend）与泛化关系；参与者与用例之间是关联关系。聚合是类图中表达整体-部分的关系，不出现在用例图中。" },
  { node: 4, stem: "智慧教育系统应保护用户的数据隐私，对敏感数据采用密文方式存储。这一需求属于（ ）需求。",
    options: { A: "可用性", B: "可靠性", C: "安全性", D: "性能" }, answer: ["C"],
    analysis: "安全性指系统向合法用户提供服务的同时，能够阻止非授权使用的企图或拒绝服务的能力，可细分为机密性、完整性、不可否认性与可控性。数据隐私保护与密文存储针对的是机密性，属于安全性需求。" },
  { node: 2, stem: "CMMI（Capability Maturity Model Integration）提供了一个软件能力成熟度模型，它将软件过程改进的步骤组织成（ ）个成熟度等级。",
    options: { A: "3", B: "4", C: "5", D: "6" }, answer: ["C"],
    analysis: "CMMI 共 5 个等级：初始级、已管理级、已定义级、量化管理级、优化级。3 级与 4 级的关键区别在于对过程性能的可预测性。" },
  { node: 2, stem: "软件测试中，回归测试的目的是（ ）。",
    options: { A: "预防功能的不完善", B: "确保修正过程中没有引入新的缺陷", C: "辅助系统测试", D: "辅助单元测试" }, answer: ["B"],
    analysis: "回归测试在软件修改后重新执行之前通过的测试用例，确认修改没有引入新错误、未影响其他部分，核心关注修改前后的功能一致性。" },
  { node: 2, stem: "RUP 把软件开发生命周期划分为多个循环，每个循环生成产品的一个新版本，每个循环依次由多个连续的阶段组成。其中，设计及确定系统的体系结构、制定工作计划及资源要求是（ ）阶段的主要活动。",
    options: { A: "初始", B: "构造", C: "移交", D: "细化" }, answer: ["D"],
    analysis: "RUP 四阶段：初始（定义产品视图与业务模型、确定范围）→ 细化（设计并确定体系结构、制订工作计划与资源要求）→ 构造（开发产品并继续演进需求与计划）→ 移交（产品交付用户使用）。" },
  { node: 4, stem: "微服务架构中，断路器模式主要包含以下三种状态（ ）。",
    options: { A: "关闭状态、激活状态、挂起状态", B: "激活状态、打开状态、休眠状态", C: "激活状态、打开状态、熔断状态", D: "关闭状态、打开状态、半开状态" }, answer: ["D"],
    analysis: "断路器三状态：关闭（请求正常通过）、打开（立即拒绝所有请求并返回错误或降级响应）、半开（打开持续一段时间后进入，放行部分请求试探下游是否恢复）。" },
  { node: 9, stem: "边缘计算的核心思想是将计算任务从中心节点转移到数据产生的边缘节点，以下不属于边缘计算特点的是（ ）。",
    options: { A: "降低功耗", B: "降低延迟", C: "提高带宽", D: "提高安全性" }, answer: ["C"],
    analysis: "边缘计算在数据产生的位置就近处理，减少回传数据量，从而降低延迟、降低对带宽的需求（而非提高带宽）、降低能耗，并因数据分散处理减少传输中的泄露风险。故「提高带宽」不属于其特点。" },
];

const PROTOTYPE_CH4 = [
  { node: 4, type: "combo_blank",
    stem: "软件体系结构风格是描述某一特定应用领域中系统组织方式的惯用模式。其中，批处理风格中每个处理步骤是一个独立程序，每一步必须在前一步结束后才能开始，数据必须完整，以（ ）的方式传递；基于规则的系统包括规则集、规则解释器、规则/数据选择器及（ ）。",
    blanks: [
      { label: "第一空", options: { A: "迭代", B: "整体", C: "统一格式", D: "递增" }, answer: ["B"] },
      { label: "第二空", options: { A: "解释引擎", B: "虚拟机", C: "数据", D: "工作内存" }, answer: ["D"] },
    ],
    analysis: "批处理风格：组件为一系列固定顺序的计算单元，组件间只通过数据传递交互，数据以整体方式在步与步之间传送（典型实例：经典数据处理、BAT 脚本）。基于规则的系统属于虚拟机风格，由规则集、规则解释器、规则/数据选择器及工作内存组成。" },
  { node: 4, type: "combo_blank",
    stem: "开发过程中，只要发现有可复用资产就对其进行复用，属于（ ）策略；复用的基本过程中，「获取需求，检索复用资产库，获取可复用资产并定制：修改、扩展、配置，最后组装与集成」属于（ ）阶段。",
    blanks: [
      { label: "第一空", options: { A: "预期复用", B: "系统复用", C: "计划复用", D: "机会复用" }, answer: ["D"] },
      { label: "第二空", options: { A: "获取可复用的软件资产", B: "管理可复用资产", C: "优化可复用资产", D: "使用可复用资产" }, answer: ["D"] },
    ],
    analysis: "架构复用分为机会复用与系统复用：开发中遇到就复用是机会复用，开发前规划决定复用什么则是系统复用。复用过程包括三个阶段：获取可复用资产（前提）、管理可复用资产（构件库：存储、管理、检索、分类）、使用可复用资产（检索→定制→组装集成）。" },
  { node: 4, type: "single",
    stem: "CORBA 服务端构件模型中，（ ）用于屏蔽 ORB 内核的实现细节，为服务器对象的实现者提供抽象接口，以便他们使用 ORB 内部的某些功能。",
    options: { A: "伺服对象（Servant）", B: "对象适配器（Object Adapter）", C: "对象请求代理（Object Request Broker）", D: "适配器激活器（Adapter Activator）" }, answer: ["B"],
    analysis: "伺服对象是 CORBA 对象的真正实现，负责完成客户端请求；对象适配器负责屏蔽 ORB 内核实现细节，为服务器对象实现者提供抽象接口；对象请求代理（ORB）解释调用并负责查找实现该请求的对象，客户方无需了解服务对象的位置、通信方式与实现机制。" },
  { node: 4, type: "combo_blank",
    stem: "基于软件系统的生命周期，质量属性分为开发期与运行期两类。其中（ ）关注软件因适应新需求或需求变化而增加新功能的能力；（ ）关注系统同时兼顾向合法用户提供服务，以及阻止非授权使用的能力。",
    blanks: [
      { label: "第一空", options: { A: "安全性", B: "可扩展性", C: "性能", D: "可重用性" }, answer: ["B"] },
      { label: "第二空", options: { A: "可测试性", B: "安全性", C: "可移植性", D: "可用性" }, answer: ["B"] },
    ],
    analysis: "开发期质量属性：易理解性、可扩展性（适应新需求而增加新功能的能力，也称灵活性）、可重用性、可测试性、可维护性、可移植性。运行期质量属性：性能、安全性（向合法用户提供服务的同时阻止非授权使用）、可用性、可修改性、易用性等。" },
];

/* --------------------------------- 主流程 --------------------------------- */

function main() {
  const report = { generatedAt: new Date().toISOString(), papers: [], cases: [], dropped: {} };
  const questions = [];
  const papers = [];
  const cases = [];

  // ① 综合知识模拟卷
  const scDir = path.join(SRC_ROOT, "综合知识模拟题");
  const scFiles = fs.readdirSync(scDir).filter((f) => f.endsWith(".doc")).sort();
  for (const f of scFiles) {
    const num = f.match(/模拟(\d+)/)?.[1] ?? "0";
    const meta = { id: `zn${num}`, title: f.replace(/\.doc$/, "") };
    const text = normalize(docToText(path.join(scDir, f)));
    const { questions: qs, dropLog } = parseSingleChoicePaper(text, meta);
    for (const q of qs) {
      q.node = classifyNode(q);
      q.id = `zn${num}-${String(q.sourceNum).padStart(2, "0")}`;
      questions.push(q);
    }
    papers.push({
      id: `zn${num}`,
      title: `综合知识模拟卷（${num}）`,
      kind: "模拟",
      subject: "综合知识",
      durationMin: 150,
      passRatio: 0.6,
      questionIds: qs.map((q) => q.id),
      sourceRef: meta.title,
    });
    report.papers.push({ paper: meta.title, parsed: qs.length, drops: dropLog });
    for (const d of dropLog) report.dropped[d.reason] = (report.dropped[d.reason] || 0) + 1;
    console.log(`[综合知识] ${f}: 解析 ${qs.length} 题，剔除 ${dropLog.length} 题`);
  }

  // ② 原型题目：2025 上半年真题（回忆版）节选卷
  {
    const ids = [];
    PROTOTYPE_MOCK_2025S1.forEach((q, i) => {
      const id = `zt2025s1-${String(i + 1).padStart(2, "0")}`;
      ids.push(id);
      questions.push({
        id, type: "single", node: q.node, nodeAuto: false, stem: q.stem, options: q.options,
        answer: q.answer, analysis: q.analysis, sourceRef: "2025 上半年真题（考生回忆版）", sourceNum: i + 1,
      });
    });
    papers.push({
      id: "zt2025s1", title: "2025 上半年综合知识真题（回忆版 · 节选）", kind: "真题-回忆版", subject: "综合知识",
      durationMin: 20, passRatio: 0.6, questionIds: ids, sourceRef: "2025 上半年 · 考生回忆版",
    });
  }

  // ③ 原型题目：第 4 章章节练习节选（练习专用，不入套卷）
  PROTOTYPE_CH4.forEach((q, i) => {
    questions.push({
      id: `lx4-${String(i + 1).padStart(2, "0")}`, type: q.type, node: q.node, nodeAuto: false,
      stem: q.stem, options: q.options || null, blanks: q.blanks || null, answer: null,
      analysis: q.analysis, sourceRef: "章节练习 · 第 4 章（节选）", sourceNum: i + 1,
    });
  });

  // ④ 案例分析模拟卷
  const caseDir = path.join(SRC_ROOT, "案例分析模拟题");
  const caseFiles = fs.readdirSync(caseDir).filter((f) => f.endsWith(".doc")).sort();
  for (const f of caseFiles) {
    const meta = { id: `al${f.match(/(\d+)/)?.[1] ?? "0"}`, title: f.replace(/\.doc$/, "") };
    const text = normalize(docToText(path.join(caseDir, f)));
    const { cases: cs, dropLog } = parseCasePaper(text, meta);
    for (const c of cs) cases.push(c);
    report.cases.push({ paper: meta.title, parsed: cs.length, drops: dropLog });
    for (const d of dropLog) report.dropped[d.reason] = (report.dropped[d.reason] || 0) + 1;
    console.log(`[案例分析] ${f}: 解析 ${cs.length} 例，剔除 ${dropLog.length} 例`);
  }

  // ⑤ 汇总输出
  const noNode = questions.filter((q) => q.type !== "case" && q.node == null).length;
  const bank = {
    meta: {
      subject: "系统架构设计师",
      generatedAt: report.generatedAt,
      note: "题目来源：模拟题 DOC 自动解析（sourceRef 标注）与原型人工校对题；机考后官方不公布原卷，回忆版题目以社区校对为准。",
    },
    chapters: CHAPTERS,
    questions,
    cases,
    papers,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(bank, null, 1));
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

  const sc = questions.filter((q) => q.type !== "case").length;
  console.log(`\n合计：客观题 ${sc} 道（未归类 ${noNode}），案例 ${cases.length} 例，套卷 ${papers.length} 份`);
  console.log(`剔除统计：`, report.dropped);
  console.log(`题库 → ${OUT_FILE}`);
}

main();

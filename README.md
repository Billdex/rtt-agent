# RTT Agent

让 AI 托管一个浏览器游戏，并**用日志证据把它越跑越好**。

不是外挂，也不是"帮你点按钮"：它把「接管浏览器 → 读状态 → 跑局 → 读日志 → 只改一个参数 → 出报告」变成一套可交接的流程。
目标游戏是 [ReturnToTogov](https://rtt.toogle.club)，但方法本身与具体游戏无关。

## 目标游戏

**ReturnToTogov（RTT）** · 网页版 v0.1 · 回合制「撤离射击 + 营地经营」

带装备进图 → 搜刮交火 → 决定何时撤 → 活着出来才把物资变现。
局内按「策略（DOCTRINE）」自动逐回合行动，人不在局中手操——所以托管天然成立，要改的是那份策略规则，不是去点按钮。

结局只有三种，收益差一个量级：

| 结局 | 结算 |
| --- | --- |
| 撤离 | 全额 |
| 匆匆撤离 | 经验减半 |
| 阵亡 | 净亏损 |

## 它解决什么问题

大多数人调策略靠感觉：收益低了就换枪、加护甲、延长搜索时间。
但结算只说结果，**日志才说过程**。同一批战局里能看到完全相反的因果：

| 局 | 回合 | 开火 | 击杀 | 收益 | 每回合 |
| --- | --- | --- | --- | --- | --- |
| A | 195 | 19 | 3 | +304,450 | **1,561** |
| B | 365 | 84 | **6** | +96,200 | **264** |

杀得最多、打得最久的那局，每回合收益只有 A 的六分之一。
所以正确动作是**缩短接战距离**，而不是"再杀几个人"。这类结论只有读日志才能得到。

## 三分钟上手

```bash
# 1. 装依赖（只需一次）
cd ai-raid-agent-kit && pnpm add playwright-core && cd ..

# 2. 起一个可被接管的浏览器（人类自己登录）
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --no-sandbox --disable-crash-reporter \
  --user-data-dir="$PWD/chrome-profile" \
  --remote-debugging-port=9222 \
  --no-first-run --no-default-browser-check \
  "https://rtt.toogle.club/"

# 3. 确认链路
node ai-raid-agent-kit/scripts/rtt.mjs status
```

然后把 `QUICKSTART.md` 交给你的 AI 助手，说一句「按 QUICKSTART 开始」。
（已经配好 `AGENTS.md`，支持该约定的助手会自动读它，不必每次点名文件。）

## 仓库结构

```
.
├── AGENTS.md                # 给 AI 助手的路由表：先判断这轮属于哪条线
├── QUICKSTART.md            # 第一次接触的完整说明书
├── progress/                # 运行产物 + 本账号取值，不进版本库（STATE.md 是唯一状态源）
└── ai-raid-agent-kit/       # ★全部可外发内容，可直接拷贝分享
    ├── scripts/             # 脚本目录，全部通过 CDP 操作已登录浏览器
    │   └── TOOLING.md       # 工具与操作层知识（T 编号，修好即删）
    ├── LESSONS.md           # 游戏知识（G 编号，只放会改变游戏决策的事实）
    ├── METHOD.md            # 方法M/边界H/运营手册：两线、流程、变量表、检查表、任务单、判据
    ├── SKILL.md             # 作为系统指令喂给 AI 的浓缩版
    ├── AGENT_PROMPT.md      # 另一版提示词
    └── TEMPLATE-report.md   # 战报模板
```

**为什么分成两套知识**：游戏事实（地图/经济/战斗）长期有效，脚本坑（选择器/受控组件）修好就该消失。
混在一个文件里，会让"最值钱的部分"被一次性 bug 记录淹没。

产物（战报、日志统计、任务清单）一律写到**工作目录的 `progress/`**，不写进工具包，
所以这个目录可以直接打包发给别人，不会夹带前任的战绩。

## 脚本

| 脚本 | 作用 |
| --- | --- |
| `rtt.mjs` | 通用控制：`status` / `text` / `click` / `goto` / `shot` / `eval` |
| `preflight.mjs` | 开局前检查：装备槽位、负重、血量、现金 |
| `quest-scan.mjs` | 扫描商人任务，找出进度已满却未提交的 |
| `analyze-log.mjs` | 解析战局历史，输出逐局统计（交火、被击中、弹尽、出血） |
| `gear-db.mjs` | **装备数据库**：一次拉取全部 389 件物品（弹药/武器/防具/配件…）的完整数值到 `progress/gear-db.json`，之后 `--query` 离线查 |
| `monitor.mjs` | 局中定时采样，写 `raid-log.jsonl` |
| `_peek.mjs` | 一行诊断：当前页状态、可见按钮清单（排障用） |

## 安全边界

- **不碰密码、Cookie、Token**。登录永远由人类在独立 Chrome 窗口里自己完成，AI 只复用其会话。
- 关掉那个窗口或删掉 `chrome-profile/`，就等于收回 AI 的全部权限。
- 花钱分两类：**补足**（加载配装补缺口、自动补货、治疗、修甲）免审、事后对账；**升级**（买装备、扩容、改配装设定值、开自动加入）要先报备。

## 一条重要提醒

**自动化可能违反游戏的用户协议，账号风险由你自己判断和承担。**
这套工具默认假设使用者有权这样操作自己的账号；不提供任何绕过检测、伪造数据的能力。

## 已知事实

- 战局中**刷新页面是安全的**；会判"提前离场、经验减半"的是误点「手动撤离」按钮。
- `战局收益` 是净额，`带出物资价值` 是毛值，两者能差一个量级。
- 游戏对同一件事有多种措辞（如弹尽：`已无弹可用` / `没有可用子弹`），只匹配一种会静默漏统计。

- 游戏知识（会改变决策的事实）见 [`ai-raid-agent-kit/LESSONS.md`](ai-raid-agent-kit/LESSONS.md)（G 编号）。
- 脚本与页面操作的坑见 [`ai-raid-agent-kit/scripts/TOOLING.md`](ai-raid-agent-kit/scripts/TOOLING.md)（T 编号）。

# AGENTS.md

> **唯一入口。** 先判断这轮属于哪条线，再只读那条线的文件。不要一上来就读大文件。

## 这是什么项目

让 AI 通过 CDP 接管一个**已由人类登录**的 Chrome，托管网页游戏 ReturnToTogov（https://rtt.toogle.club ），
做**两件目标不同、手段不同、不能混在一轮里**的事：

| 线 | 目标 | 成功长什么样 |
| --- | --- | --- |
| **A · 策略迭代** | 产出可持续自我迭代的「日志 → 归因 → 单变量 → 验证」方法与工具 | 结果：全样本 `收益/回合` 上升且可归因到单一变量；方法：新人只看 `QUICKSTART.md` 能独立跑完一轮 |
| **B · 账号经营** | 配装、仓库、医疗、任务、现金始终处于可打仗的状态 | 五条健康线全部不越线（`METHOD.md` §运营 6 / `STATE.md` §2） |

共享底座：CDP 脚本 + 战局日志。**两条线互斥**——同一轮只有一条是"主推进"，
因为换配装会同时改变"打不穿"与"收益密度"，本轮实验直接作废（实例见 `LESSONS.md` G-10）。

```
AGENTS.md                    本文件：路由
QUICKSTART.md                完整说明书（第一次接触才读）
ai-raid-agent-kit/           ★可外发：换个账号/换个人也成立
  LESSONS.md                 游戏知识 G 编号（可全读，约 30 条）
  METHOD.md                  ★方法 M / 边界 H / 运营手册（两线·流程·变量表·检查表·决策规则）+ 任务单 + 判据
  scripts/TOOLING.md         工具与操作 T 编号（修好即删，按需 grep）
  scripts/                   脚本，全部通过 CDP 操作已登录浏览器
  SKILL.md / AGENT_PROMPT.md / TEMPLATE-report.md
progress/                    ★不外发，运行产物 + 本账号唯一取值处（gitignore）
  STATE.md                   ★唯一状态真值：参数取值 / 健康线目标 / 禁动清单 / 主指标 / 活跃假设
  tasks/                     本轮任务单
  TODO.md / report.md / HANDOFF.md / archive/
```

**边界只有一条**：`ai-raid-agent-kit/` 是全部可外发内容（G/T/M/H 自洽）；`progress/` 是本账号私货。
kit 内部不许引用 kit 之外的文件；账号取值只能出现在 `progress/STATE.md`。

## 第 0 步 · 路由（30 秒，别跳过）

| 这轮要干什么 | 走哪条线 | 只读这些 |
| --- | --- | --- |
| 第一次接触 / 要正式开跑 | — | `QUICKSTART.md` 全文 |
| 提升 `收益/回合`、验证某个参数、换地图 | A | `ai-raid-agent-kit/METHOD.md` §运营 1–5 + `progress/STATE.md` §1 / §3 |
| 重装、治疗、清仓、接任务、改配装、算账 | B | `ai-raid-agent-kit/METHOD.md` §运营 6–9 + `progress/STATE.md` §2 |
| 脚本报错、页面点不到、解析失败 | 工具 | `ai-raid-agent-kit/scripts/TOOLING.md`（按编号 grep） |
| 接着上次的进度 | — | `progress/HANDOFF.md`（只有两个问题：停在哪 / 怎么接） |
| 要解释某个反常现象 | — | `LESSONS.md`（G 编号）；查不到再看 `scripts/README.md` |
| 到了要停下来问人的地方 / 要定判据与写回 | — | `ai-raid-agent-kit/METHOD.md`（H 编号 + 附录 B） |

**判断"这属于哪条线"的唯一问法**：这次改动会让一个**游戏决策**变好吗？
会 → A 或 B（看决策是"怎么打"还是"带什么/存什么"）；只是让脚本能跑 → 工具。

## 第 1 步 · 领任务单（不许跳过）

复制任务单骨架（`ai-raid-agent-kit/METHOD.md` 附录 A）到 `progress/tasks/<日期>-<序号>-<短名>.md`。
**「判据」与「前置（需要人类做的事）」两栏没填完，不许开始执行。**

一张单 = 一个变量 / 一个状态。跨线的事拆单。"顺便做"的事单独开单。

## 铁律

1. **登录永远由人类完成**。不索取、不读取密码 / Cookie / Token；`chrome-profile/` 不提交、不外发。
2. **战局中永不点击文案含"撤离 / 放弃 / 投降"的按钮**。整页刷新和 `goto` 是安全的；误点「手动撤离」判提前离场、**经验减半**。
3. **归因只用日志，不用结算数字**。主指标是 `收益 / 回合`；`战局收益` 是净额，`带出物资价值` 是毛值，能差一个量级（G-01）。
4. **一次只改一个变量**（M-02），并写明"因为哪一局的哪条日志"。日志里没有"无弹 / 缺药"这类证据就不许动参数。
5. **WIP = 1**：同时只有一个活跃假设（M-07）。其余排队写进 `STATE.md`，不许并轮验证。
6. **花钱要报备**（H-04）：加载配装、自动补货、治疗都会扣钱，先核对缺口与费用。
7. **两线互斥**：策略轮内不动配装、不动工具；经营轮内不跑批次、不动策略参数。
8. **知识按半衰期分家**：游戏事实 → `LESSONS.md`；脚本/操作 → `scripts/TOOLING.md`；实验纪律与人机边界 → `METHOD.md`。
   工具类内容写进 `LESSONS.md` 视为污染，必须移走；本账号的**值**只准写在 `STATE.md`。
9. **状态只信 `STATE.md`**。`report.md` 是过程记录，不许当状态读；数字冲突时以最近一次脚本输出为准。
10. **自动化可能违反游戏用户协议**，风险由人类自行确认，不要替他决定（H-07）。

## 命令速查

工作目录固定为仓库根（`/Users/billdex/Code/game/rtt-agent`），不要 `cd` 进工具包跑脚本。

```bash
node ai-raid-agent-kit/scripts/rtt.mjs status          # 链路是否通 + 当前页面
node ai-raid-agent-kit/scripts/rtt.mjs tabs            # 多标签页时先确认，只留一个游戏页
node ai-raid-agent-kit/scripts/preflight.mjs           # 开局前必跑；任一 FAIL 就不开局
node ai-raid-agent-kit/scripts/quest-scan.mjs          # 任务三态扫描（可接取/进行中/可提交）
node ai-raid-agent-kit/scripts/analyze-log.mjs         # 核心：解析战局日志 → raid-analysis.{json,md}
node ai-raid-agent-kit/scripts/strategy-snapshot.mjs   # 调参前后各跑一次，diff 就是改动凭证
node ai-raid-agent-kit/scripts/node-loot.mjs           # 点位物资（地图数据 + 日志实收）
node ai-raid-agent-kit/scripts/raid-watch.mjs --every=45 --minutes=12   # 盯批次（0=结束, 2=到时限）
```

- `rtt.mjs` 子命令：`status / tabs / text / click / goto / shot / eval / evalscript / key / wait / fillfile`。
- 换产物目录：`RTT_OUT=progress/run-03 node ai-raid-agent-kit/scripts/analyze-log.mjs`。
- **外发包**：`git archive HEAD ai-raid-agent-kit -o rtt-kit.tar.gz`（只含可外发内容，天然不含 `progress/`）。
- **不要手写 bash 循环盯进度**（T-15）；**不要用 `| tail` 判退出码**。
- 表单/滑杆：React 受控组件不认程序赋值，必须用真实键鼠事件（T-04）。

## 汇报节奏

- 一切正常 → 一行。
- 阵亡 / 配置失效 / 账目异常 / 任务单结案 → 结构化汇总：
  1. 哪条线、哪个变量、判据数字（带 n 与时间范围）
  2. `STATE.md` 变了哪几项
  3. 有证据的结论 vs 仍是猜测的（M-06）
  4. 下一轮只验证哪一件事
- **不要把"跑了 N 局"当成果**；成果是判据数字变了。
- 每轮结束必须更新 `STATE.md`，否则本轮视为未完成。

## 约定

- 产物一律落 `progress/`（`process.cwd()/progress`），工具包保持干净、可直接打包。
- 战报每局一行：时间 / 地图 / 结局 / 击杀 / 收益 / 撤离原因原文；结局必须写全
  `撤离` / `匆匆撤离`（经验减半）/ `阵亡`（净亏损），只写"撤离"会混淆。
- 文档与实测冲突时：**直接改正文**，不要旁边追加勘误；改动记进 `progress/report.md` 的「本轮改动」。
- 新踩坑 → 按半衰期归位（G / T / M），编号顺延不复用。
- 交接时更新 `progress/HANDOFF.md`（停在哪 / 下次怎么接）+ `progress/STATE.md`（数字）。

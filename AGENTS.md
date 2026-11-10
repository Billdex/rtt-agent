# AGENTS.md

> 给 AI 助手的**唯一入口**。读完这一页就知道该读哪个文件、跑哪条命令。
> 完整说明书是 `QUICKSTART.md`（约 300 行），这里不复制它，只做分流。

## 这是什么项目

让 AI 通过 CDP 接管一个**已由人类登录**的 Chrome，托管网页游戏 ReturnToTogov（https://rtt.toogle.club ），
并靠**战局日志证据**迭代策略参数。核心动作不是"点按钮代打"，而是：
`读状态 → 开局 → 读日志 → 归因 → 只改 1–2 个参数 → 出报告`。

```
QUICKSTART.md          完整操作说明书（AI 执行手册）
AGENTS.md              本文件：入口与分流
progress/              运行产物，被 gitignore，不进版本库
ai-raid-agent-kit/     可分享的工具包
  scripts/             8 个脚本，全部通过 CDP 操作已登录浏览器
  LESSONS.md           实测踩坑，按编号顺延（本项目最值钱的部分）
  SKILL.md             浓缩规约（喂给 AI 的系统指令版）
  AGENT_PROMPT.md      另一版提示词
  TEMPLATE-report.md   战报模板
```

## 读什么（按任务挑，不要全读）

| 你现在的任务 | 读这个 |
| --- | --- |
| 第一次接触 / 要正式开跑 | `QUICKSTART.md`（全文） |
| 以前跑过、要接着跑 | `progress/HANDOFF.md`（先看第 0、3、4 节） |
| 要看还剩哪些事没做 | `progress/TODO.md`（每条带证据 / 入口 / 完成判据） |
| 要看历史战绩与改动依据 | `progress/report.md`（30 KB，**只看末尾和「本轮改动」**，别从头读） |
| 要解释某个反常现象 | `ai-raid-agent-kit/LESSONS.md`（按编号 grep，别全量读） |
| 要用/改脚本 | `ai-raid-agent-kit/scripts/README.md` |
| 要写本轮战报 | `ai-raid-agent-kit/TEMPLATE-report.md` |
| 要打包给别人用 | `ai-raid-agent-kit/SKILL.md` + `README.md` |

**禁止全量读** `LESSONS.md`、`report.md`、`raid-analysis.json`：先 `grep`/读头部，按需取段。

## 铁律（动手前先确认这几条）

1. **登录永远由人类完成**。不索取、不读取密码 / Cookie / Token；`chrome-profile/` 不提交、不外发。
2. **战局中永不点击文案含"撤离 / 放弃 / 投降"的按钮**。整页刷新和 `goto` 是安全的；误点「手动撤离」会判提前离场、**经验减半**。点任何按钮前先读它的文案。
3. **归因只用日志，不用结算数字**。主指标是 `收益 / 回合`，不是总收益；`战局收益` 是净额，`带出物资价值` 是毛值，能差一个量级。
4. **一次只改一个变量**，并写明"因为哪一局的哪条日志"。日志里没有"无弹 / 缺药"这类证据就不许动参数。
5. **花钱要报备**：加载配装、自动补货、治疗都会扣钱，先核对缺口与费用。
6. 自动化可能违反游戏用户协议，风险由人类自行确认，不要替他决定。

## 命令速查

**工作目录固定为仓库根**（`/Users/billdex/Code/game/rtt-agent`），不要 `cd` 进工具包跑脚本。

```bash
node ai-raid-agent-kit/scripts/rtt.mjs status          # 链路是否通 + 当前页面
node ai-raid-agent-kit/scripts/rtt.mjs tabs            # 多标签页时先确认，只留一个游戏页
node ai-raid-agent-kit/scripts/preflight.mjs           # 开局前必跑；任一 FAIL 就不开局
node ai-raid-agent-kit/scripts/quest-scan.mjs          # 任务三态扫描（可接取/进行中/可提交）
node ai-raid-agent-kit/scripts/analyze-log.mjs         # 核心：解析战局日志 → raid-analysis.{json,md}
node ai-raid-agent-kit/scripts/strategy-snapshot.mjs   # 调参前后各跑一次，diff 就是改动凭证
node ai-raid-agent-kit/scripts/raid-watch.mjs --every=120 --minutes=12   # 盯批次（退出码 0=结束, 2=到时限）
```

- `rtt.mjs` 子命令：`status / tabs / text / click / goto / shot / eval / evalscript / key / wait / fillfile`。
- 换产物目录：`RTT_OUT=progress/run-03 node ai-raid-agent-kit/scripts/analyze-log.mjs`。
- **不要手写 bash 循环盯进度**，总时长要写成参数（LESSONS 34）。
- 表单/滑杆：React 受控组件不认程序赋值，必须用真实键鼠事件。

## 约定

- 产物一律落 `progress/`（`process.cwd()/progress`），工具包保持干净、可直接打包。
- 战报每局一行：时间 / 地图 / 结局 / 击杀 / 收益 / 撤离原因原文；结局必须写全
  `撤离` / `匆匆撤离`（经验减半）/ `阵亡`（净亏损），只写"撤离"会混淆。
- 文档与实测冲突时：**直接改正文**（`QUICKSTART.md`、`LESSONS.md`、脚本 README），不要旁边追加勘误；
  改动记进 `progress/report.md` 的「本轮改动」。
- 新踩坑 → `LESSONS.md` 顺延编号；改了脚本行为 → 同步 `scripts/README.md`。
- 交接时更新 `progress/HANDOFF.md`（停在哪 / 下次怎么接），这份文件只回答这两个问题。

## 汇报节奏

一切正常 → 一行；阵亡 / 配置失效 / 账目异常 / 轮次跑完 → 结构化汇总 + 3–5 条结论，
明确区分"有证据"与"仍是猜测"，最后一句写"下一轮只验证哪一件事"。

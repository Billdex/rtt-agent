# 让 AI 替你玩：30 分钟上手包

这套东西做的不是"一个游戏外挂"，而是**一套可交接的工作方式**：AI 接管浏览器 → 读数据 → 跑局 → 读日志 → 改参数 → 汇报。

## 目标游戏

**ReturnToTogov（RTT）** · https://rtt.toogle.club · 网页版 v0.1

回合制「撤离射击 + 营地经营」：带装备进图，搜刮、交火、决定何时撤，活着出来才把物资变现。
局内按「策略（DOCTRINE）」自动逐回合行动，人不在局中手操——所以托管天然成立，要改的是那份策略规则，不是点按钮。

结局只有三种：`撤离`（全额）/ `匆匆撤离`（经验减半）/ `阵亡`（净亏损）。
完整说明见 `QUICKSTART.md` 开头的「目标游戏」一节。

## 你需要准备什么

1. macOS / Windows 上装好 Chrome、Node.js、pnpm
2. 一个你要"托管"的网页游戏账号（**密码你自己输，永远不要交给 AI**）
3. 30 分钟

## 三步接入

### 第一步：起一个能被接管的浏览器（2 分钟）

```bash
cd ai-raid-agent-kit
pnpm add playwright-core
```

然后（macOS）：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --no-sandbox --disable-crash-reporter \
  --user-data-dir="$PWD/chrome-profile" \
  --remote-debugging-port=9222 \
  --no-first-run --no-default-browser-check \
  "你的游戏网址"
```

这会在你屏幕上弹出一个**干净的 Chrome 窗口**（独立 profile，不带你的书签和账号）。在这个窗口里自己登录游戏。

> 为什么用独立 profile：AI 复用它的会话，但永远接触不到你的密码；你退出登录、删掉这个目录，就等于收回全部权限。

### 第二步：让 AI 认路（5 分钟）

把 `SKILL.md` 的内容作为指令交给你的 AI 助手（workbuddy、DSH 或任何支持自定义指令的工具），并告诉它：

> 浏览器已经开在 127.0.0.1:9222，你去读页面。脚本在 `scripts/` 下，用 `node scripts/rtt.mjs status` 试。

验证标准：AI 能说出当前页面标题、你的游戏 ID、当前金币。

### 第三步：让它跑第一轮（20 分钟）

让它执行这个循环，你只负责看结果：

```
1. preflight：检查装备/血量/弹药/资金
2. 开局（优先用游戏自带的"自动加入"，而不是让 AI 点按钮）
3. 局中可读可刷新，但不碰「手动撤离」按钮
4. 结束后读完整战局日志，写进 report.md
5. 一次只改 1–2 个参数，并写明原因
6. 跑满约定局数就停，出汇总
```

## 脚本清单

| 文件 | 作用 |
| --- | --- |
| `scripts/rtt.mjs` | CDP 控制：status / shot / text / click / goto / eval / fillfile |
| `scripts/preflight.mjs` | 开局前检查：装备槽位、负重、生命、现金、同步状态 |
| `scripts/monitor.mjs` | 后台采样：每 N 秒记录回合/击杀/血量，写到 jsonl |
| `scripts/analyze-log.mjs` | 读战局详情日志，统计交火/命中/落空/缺弹/缺药 |
| `scripts/quest-scan.mjs` | 扫描任务列表：状态、进度、可否提交 |

所有脚本都通过 `http://127.0.0.1:9222` 连你已经登录的浏览器，不需要任何账号密码。

## 这套东西的价值在哪

不是脚本本身（都是几十行的胶水），而是 `LESSONS.md` 里那些**踩过的坑**：

- 战局里哪个按钮绝对不能碰（点一下经验减半）
- 为什么"收益低"要看日志而不是看结算
- 为什么"多杀几个人"反而更穷
- 配装绑定被重置后，怎么用 30 秒确认弹药真的带上了

## 安全边界

- 不碰密码、Cookie、Token
- 用独立 profile，随时可撤销（删目录即可）
- 游戏内所有花费都有上限设置（局数上限、资金下限）
- 自动化可能违反游戏规则，账号风险由使用者承担——这一点必须让使用者自己确认

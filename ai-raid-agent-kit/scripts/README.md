# 脚本说明

所有脚本都通过 CDP 连接**你已经登录的浏览器**（默认 `http://127.0.0.1:9222`），不接触账号密码。

前置：`pnpm add playwright-core`（不需要 `playwright install`，我们不下载浏览器）。

## 产物落在哪

所有产物写入 **工作目录** 的 `progress/`（即 `process.cwd()/progress`），**不写进本工具包**，
所以这个目录可以直接打包分享，不会夹带别人的战报。

- 每次写入会往 stderr 打一行 `[out] /绝对路径/`，不用猜。
- 若落点在工具包内部，改为警告 `[warn] 输出目录在工具包内部…`，提醒你分享前清理。
- 需要改落点：`RTT_OUT=/some/dir node scripts/analyze-log.mjs`。

建议在工作目录下这样调用：

```bash
cd 你的工作目录
node ai-raid-agent-kit/scripts/rtt.mjs status
```

---

## rtt.mjs —— 通用控制（其他脚本的基础）

```bash
node scripts/rtt.mjs <命令> [参数]
```

| 命令 | 说明 | 例子 |
| --- | --- | --- |
| `status` | 输出 URL、标题、导航命中、是否出现登录词、正文前 600 字 | `node scripts/rtt.mjs status` |
| `tabs` | 列出所有标签页 | `node scripts/rtt.mjs tabs` |
| `shot [文件名] [--full]` | 截图存到 `progress/` | `node scripts/rtt.mjs shot 01.png` |
| `text [字符数]` | 打印页面可见文本（截断） | `node scripts/rtt.mjs text 2000` |
| `click <文本>` | 按可见文本点击第一个匹配 | `node scripts/rtt.mjs click 保存策略` |
| `goto <路径>` | 整页跳转（战局中安全，不会判离场；但刷新后需等重连横幅消失） | `node scripts/rtt.mjs goto /stash` |
| `wait <毫秒>` | 等待 | `node scripts/rtt.mjs wait 1500` |
| `key <按键>` | 键盘 | `node scripts/rtt.mjs key Escape` |
| `eval <表达式>` | 在页面里求值，返回字符串或 JSON | `node scripts/rtt.mjs eval "document.title"` |
| `evalscript <文件>` | 执行一个 js 文件（长逻辑用这个） | `node scripts/rtt.mjs evalscript tune.js` |
| `fillfile <文件> <选择器>` | 把文件内容填进输入框 | `node scripts/rtt.mjs fillfile plan.json textarea` |

环境变量：`RTT_CDP`（默认 `http://127.0.0.1:9222`）。

**为什么 `eval` 这么重要**：绝大多数"点不到"的元素，用 `eval` 找文本再 `.click()` 都能点到；表单取值、读状态也都靠它。

- 注意：React 受控组件用原生 setter 赋值**不会**更新状态，必须用真实键盘/鼠标事件（`key`、`click`，或 Playwright 的 `type`）。
- 注意：滑杆没有 `fill` 可用，做法是 `focus` 之后按方向键。

---

## preflight.mjs —— 开局前检查

```bash
node scripts/preflight.mjs
```

输出 PASS / FAIL / WARN 列表：主武器、副武器、头部、防弹衣、胸挂、背包（必须 PASS）；面部、耳机、安全箱（WARN）；生命状态、负重、现金。

判空逻辑：槽位文本形如 `头部|SSh-68 钢盔|FIR`，只有标签没有物品名 = 空槽。

**必须在开局前跑**；局中跑会看到"出战为空"，那是假象（装备在战局里）。

---

## monitor.mjs —— 后台采样

```bash
RTT_SAMPLES=120 RTT_EVERY_MS=15000 node scripts/monitor.mjs
```

每 15 秒记一行到 `progress/raid-log.jsonl`：时间、URL、地图、回合、击杀、血量、状态、最近日志。

- 检测到非"进行中"就自动退出
- **脆弱点**：它靠"当前页面是否还在战局"判断，你一旦跳页它就会误判结束 → 要么别跳页，要么改用定时巡检
- 适合：你想在局中拿到细粒度时间线
- 不适合：长时间无人值守（跨会话收不到完成通知）

---

## raid-watch.mjs —— 有界时长的进度轮询（推荐用来盯批次）

```bash
node scripts/raid-watch.mjs --every=120 --minutes=12
```

每 `--every` 秒跳一次 `/raid` 读状态，打印一行：`时间 +已跑分钟 · 地图 第N回合 击杀 血`。

- `--minutes` 是**总时长硬上限**，到点自己退出（退出码 2），并打印 `{"summary":{...}}`
- 跑过至少一局、且连续两次采样都不在局内 → 判定批次结束，退出码 0
- `--json` 让每个采样输出一行紧凑 JSON，方便后续管道处理
- 只做 `goto` + 读文本，不点任何按钮

**为什么不用 bash 循环**：`for i in ...; do ...; sleep 150; done` 一旦总时长超过单条命令的时限，
就会被外部截断——采样只打印一半、进程被杀，看起来像"脚本卡住/需要手动结束"。总时长必须写进参数里。

---

## analyze-log.mjs —— 日志分析（核心）

```bash
node scripts/analyze-log.mjs
```

会依次打开"记录 → 详情"，把每局的完整日志按 `[回合]` 切分，输出 `progress/raid-analysis.json` 与 `progress/raid-analysis.md`。

统计项：回合数、击杀、收益、FIR 件数、开火次数、命中、落空、被击中、耗尽弹药、无物资、装填、出血、骨折、搜刮动作，以及**撤离前 6 条日志**（用来定位真实撤离原因）。

**用法**：先看 `raid-analysis.md` 的汇总，再针对可疑的那局看 `extractReason`。

**等待策略（11-10 修）**：点开某局后不再等固定毫秒，而是等详情头部出现 `<地图> · N 回合`
**且**「战局收益」与列表行金额一致才解析 —— 后者用来排除"旧面板残留被当成本局"。
8 秒没出来会重点一次；仍失败则对该行打 `[warn]` 并在汇总里显示 `? 回合`，此时可稍后重跑。

局限：靠中文关键词匹配，换语言或改文案会失效；数值型统计（如命中率）需要自己按日志原文复核。
详情页只渲染部分日志（`logTurns` < 回合数时会打 `[warn]`），聚合值只是抽样。

---

## node-loot.mjs —— 点位物资盘点（地图数据 + 日志实收）

```bash
node scripts/node-loot.mjs                 # 地图数据 + 最近 10 局日志实收
RTT_RAIDS=0 node scripts/node-loot.mjs     # 只看地图数据（快，不翻战局记录）
```

输出 `progress/node-loot.json` 与 `progress/node-loot.md`：6 张图共 442 个节点，每个节点列出
**搜刮类型**、`lootTime`、占地、是否出生/撤离点、是否需要钥匙，以及最近若干局日志里的**实收金额**。

**数据来源**：客户端先读 `/api/content/public/manifest` 拿内容 hash，再取 `/api/content/<hash>`，
里面 `maps[].nodes[].lootTypes` 就是游戏内「地图信息」那一份，属于权威数据；`items[].value` 用来给日志里的物品折价。

**日志措辞**（实测 4 种，脚本都已覆盖）：`开始检查 X 的物资` / `开始搜索 X` / `在 X 开始找物资` / `选定 X，准备前往搜刮`；
收获侧还有 `已拿到 X ×1`。点位名只认地图数据里真实存在的节点（否则敌人「开始检查并排除 M9 的供弹故障」会被当成点位）。

**两个必须知道的局限**：
- `档位分` 是按类型名做的启发式分级（锁库/军品/高级弹 5 分，基础建材/食品 1 分左右），**只用于排序**，不是游戏内数值。
- 日志实收**样本极少**：战局详情页只渲染部分日志，实测 10 局只覆盖 18 / 442 个节点。
  能不能当真，看 `node-loot.md` 里的「到访」列；`—` 表示这 10 局根本没去过。

**用途**：排"先去哪几个点"，以及解释"为什么这局走了 20 个点却没收益"（旧城区 75 个节点里有 47 个 `lootTypes` 为空，是出生点/撤离点/纯通道）。

---

## strategy-snapshot.mjs —— 策略快照与 diff

```bash
node scripts/strategy-snapshot.mjs
```

把 `/strategy` 当前策略原文存成 `progress/strategy-<本地时间>.json`，并与上一份快照做**字段级 diff**
（输出 `changeCount` 与 `changes: [{key, from, to}]`）。

- 只读：只点「JSON」打开面板，**永不点「保存策略」**
- 若「高级模式」已勾选（槽位被 Lua 接管），读到的是 Lua 代码，会存成 `.lua` 原文并跳过 JSON diff
- 用途：调参前跑一次、调参后再跑一次，diff 就是"本轮到底改了什么"的机器凭证，比人记可靠
- 局限性：只有一份快照时只提示"这是第一份"；跨目录对比需要 `RTT_OUT` 指定同一个目录

## quest-scan.mjs —— 任务扫描

```bash
node scripts/quest-scan.mjs
```

输出 `progress/quests.json`：每个任务的状态（可接取 / 进行中 / 可提交）、进度百分比、目标、奖励。

**用法**：每轮结束跑一次，回答两个问题——有没有"可提交"的、有没有"当前顺路就能接"的。

---

## 常见故障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `connectOverCDP` 连不上 | Chrome 没起或端口不同 | `curl http://127.0.0.1:9222/json/version` |
| Chrome 起窗口就退出 | 嵌套沙箱 | 加 `--no-sandbox` |
| 页面"读取中…"卡住 | WebSocket 掉线 | 整页重载（确认不在战局中） |
| 点了按钮没反应 | 受控组件 | 用真实鼠标点击（Playwright `click`）而不是 `eval .click()` |
| 表单值改了但保存无效 | 同上 | 用键盘输入，不要用原生 setter |
| 战局被判"提前离场" | 误点了"手动撤离" | 按钮先读文案；刷新/跳页本身安全 |

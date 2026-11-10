import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// 产物一律写到「工作目录」（执行命令时的 cwd），不写进工具包内部；需要改落点时用 RTT_OUT。
const KIT = path.resolve(import.meta.dirname, '..');
const OUT = process.env.RTT_OUT ? path.resolve(process.env.RTT_OUT) : path.resolve(process.cwd(), 'progress');
mkdirSync(OUT, { recursive: true });
if (OUT === KIT || OUT.startsWith(KIT + path.sep)) console.error('[warn] 输出目录在工具包内部：' + OUT + '（分享这个包前请清理）');
else console.error('[out] ' + OUT);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('toogle.club'));

await page.goto('https://rtt.toogle.club/raid?tab=history', { waitUntil: 'domcontentloaded' });
// 实测（11-10 首跑）：跳转后 2 秒列表还没渲染完，会解析出 0 行。改为等第一行出现再继续。
try {
  await page.locator('button', { hasText: /\d{2}-\d{2} \d{2}:\d{2}:\d{2}/ }).first().waitFor({ timeout: 20000 });
} catch {
  console.error('[warn] 20 秒内没等到战局历史列表（可能在重连）；本次结果可能为 0 行，稍后重跑');
}
await page.waitForTimeout(800);

// "被击中"要按玩家名匹配，但名字不能写死在脚本里（换个人用就失效）。
// 三级回退：环境变量 → /api/me 的 nickname → 页脚 "HP x/y · N GB · <玩家名>"。
// 实测（11-10 10:5x）：战局记录页脚不再渲染 HP/GB 行，旧的页脚正则直接失效，
// 导致 10 局全部 hitsTaken=0（看起来像"从没被击中"）。
const ME = process.env.RTT_PLAYER || await page.evaluate(async () => {
  try {
    const r = await fetch('/api/me', { credentials: 'include' });
    const j = await r.json();
    const nickname = j?.account?.nickname;
    if (nickname) return nickname;
  } catch { /* 落到页脚解析 */ }
  const t = document.body.innerText || '';
  const m = t.match(/HP \d+\s*\/\s*\d+\n[\d,]+ GB\n([^\n]+)/);
  return m ? m[1].trim() : '';
});
if (!ME) console.error('[warn] 未能识别玩家名，被击中统计将为 0；可用 RTT_PLAYER=<你的名字> 指定');
else console.error('[player] ' + ME);
const escaped = ME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 列表行（button）是元数据的权威来源：时间|地图|结局|N 杀|±收益 GB|XP
const rows = page.locator('button', { hasText: /\d{2}-\d{2} \d{2}:\d{2}:\d{2}/ });
const n = await rows.count();
const results = [];

const num = (s) => Number(String(s ?? '').replace(/[^\d-]/g, '')) || 0;

// 详情面板的就绪时间不定（TOOLING T-14：固定等待会拿到上一局的残留面板或空详情 → turns=0）。
// 判据是「<地图> · N 回合」出现 **且**「战局收益」等于列表行那一笔 ——
// 后者用来排除"读到上一局残留详情"（点下一行时旧面板还在，看起来像解析成功）。
async function openDetail(i, gain) {
  const want = (gain >= 0 ? '+' : '-') + Math.abs(gain);
  for (let attempt = 1; attempt <= 2; attempt++) {
    await rows.nth(i).click();
    try {
      await page.waitForFunction(
        (w) => {
          const t = document.body.innerText;
          if (!/·\s*\d+\s*回合/.test(t)) return false;
          const m = t.match(/战局收益\s*\n\s*([+\-][\d,]+)\s*GB/);
          return !!m && m[1].replace(/,/g, '') === w;
        },
        want,
        { timeout: 8000 },
      );
      return true;
    } catch {
      if (attempt === 2) return false;
      console.error(`[warn] 第 ${i + 1} 行详情 8 秒内没出来，重点一次`);
    }
  }
  return false;
}

for (let i = 0; i < n; i++) {
  const label = (await rows.nth(i).innerText()).replace(/\n+/g, '|').trim();
  const listMeta = {
    time: (label.match(/(\d{2}-\d{2} \d{2}:\d{2}:\d{2})/) || [])[1] || label,
    map: (label.match(/\|([^|]*(?:外环|旧城区|边境检查站|机场|发电站|交通枢纽)[^|]*)\|/) || [])[1] || '',
    outcome: (label.match(/(匆匆撤离|阵亡|撤离)/) || [])[1] || '',
    kills: num((label.match(/(\d+)\s*杀/) || [])[1]),
    gain: num((label.match(/([+\-][\d,]+)\s*GB/) || [])[1]),
  };

  const opened = await openDetail(i, listMeta.gain);
  const raw = await page.evaluate(() => document.body.innerText);
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);

  // 详情区元数据：回合数 / FIR 件数（结局、击杀、收益取列表行，更稳）
  // 回合数只从头部「<地图> · N 回合」取，避免正文里其他 "N 回合" 命中。
  const headMatch = raw.match(/([^\n]+?)\s·\s(\d+)\s*回合/);
  const meta = {
    map: headMatch ? headMatch[1].trim() : listMeta.map,
    turns: headMatch ? Number(headMatch[2]) : 0,
    fir: num((raw.replace(/\n+/g, '|').match(/带出 FIR 物品\|(\d+) 件/) || [])[1]),
  };
  if (!opened || !meta.turns) {
    console.error(`[warn] ${listMeta.time} 详情区没打开或没有回合数，本行聚合值不可用（TOOLING T-14），可稍后重跑`);
  } else if (meta.map && listMeta.map && !meta.map.includes(listMeta.map) && !listMeta.map.includes(meta.map)) {
    console.error(`[warn] ${listMeta.time} 详情地图「${meta.map}」与列表「${listMeta.map}」不一致，可能读到上一局残留`);
  }

  // 日志条目
  const entries = [];
  let cur = null;
  for (const line of lines) {
    const tm = line.match(/^\[(\d+)\]$/);
    if (tm) { cur = { turn: +tm[1], msg: [] }; entries.push(cur); continue; }
    if (cur && !/^(营地|装备|战局|策略|商人|LOG|记录|战局|详情|报告问题|撤离|击杀|战局收益|带出 FIR 物品)$/.test(line)) cur.msg.push(line);
  }
  // 实测（11-10 10:5x）：详情页并不渲染全部日志（293 回合的局只有 112 条），
  // 所以"交火次数/被击中/装填"这类聚合值只是抽样，不能当绝对数用；尾部与结局是完整的。
  if (meta.turns && entries.length && entries.length < meta.turns * 0.8) {
    console.error(`[warn] ${listMeta.time} 详情页只渲染了 ${entries.length}/${meta.turns} 条日志，聚合统计偏低`);
  }

  const text = entries.map((e) => e.msg.join(' ')).join(' ');
  const count = (re) => (text.match(re) || []).length;

  // 关键事件
  // "撤离成功"在日志里有多种措辞：`已完成撤离`、`已撤出战局，带出物资价值 X`（实测 11-10 09:09 机场局）。
  // 取**最后**一处命中：中段击杀日志里也常有"死亡"字样，取第一处会把击杀当成结局（实测把 09:09 那局的
  // 撤离误定位到第 173 回合的一次击杀）。
  let extractIdx = -1;
  entries.forEach((e, i) => {
    if (/撤离成功|成功撤出|完成撤离|撤出战局|匆匆撤离|阵亡|被击杀|死亡|致命攻击|带出物资价值|带出价值/.test(e.msg.join(' '))) extractIdx = i;
  });
  // 都没匹配到（措辞又变了）时退回最后 6 条，否则 slice(0,0) 会给出空数组、看起来像"没有日志"。
  const window_ = extractIdx >= 0 ? entries.slice(Math.max(0, extractIdx - 6), extractIdx + 1) : entries.slice(-6);
  const reasonEntry = window_.map((e) => `[${e.turn}] ${e.msg.join(' ')}`);

  const stat = {
    ...listMeta,
    ...meta,
    logTurns: entries.length,
    shotsFired: count(/开火|射击/g),
    hits: count(/命中/g),
    damageLines: count(/伤害$/gm),
    hitsTaken: ME ? count(new RegExp('射向 ' + escaped, 'g')) : 0,
    // 游戏对"弹尽"有多种措辞，只匹配一种会全部漏统计（实测漏报）
    outOfAmmo: count(/已无弹可用|没有可用子弹|无弹可用|弹药耗尽|弹匣为空/g),
    noLoot: count(/已无可搜物资/g),
    reloads: count(/装填|换好弹|换弹/g),
    bleeds: count(/出血/g),
    fractures: count(/骨折/g),
    loots: count(/拾取|拿到|收下|收起|装好|带上/g),
    killsInLog: count(/倒地身亡|致命攻击/g),
    extractReason: reasonEntry,
  };
  results.push(stat);
}

// 汇总
const summary = results.map((r) => `- ${r.time} · ${r.map} · ${r.outcome} · ${r.turns || '?'} 回合 · ${r.kills} 杀 · ${r.gain >= 0 ? '+' : ''}${r.gain} GB · FIR ${r.fir || '?'} · 交火 ${r.shotsFired} 次 · 被击中 ${r.hitsTaken} · 耗尽弹药 ${r.outOfAmmo} 次`);
writeFileSync(path.join(OUT, 'raid-analysis.json'), JSON.stringify(results, null, 2));
writeFileSync(path.join(OUT, 'raid-analysis.md'), '# 战局日志分析\n\n' + summary.join('\n') + '\n');

console.log(JSON.stringify({ rows: n, summary, detail: results.map((r) => ({ time: r.time, turns: r.turns, gain: r.gain, shots: r.shotsFired, outOfAmmo: r.outOfAmmo, noLoot: r.noLoot, extractReason: r.extractReason })) }, null, 2));
await browser.close();

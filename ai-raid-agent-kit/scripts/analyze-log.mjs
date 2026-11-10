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
await page.waitForTimeout(2000);

// 列表行（button）是元数据的权威来源：时间|地图|结局|N 杀|±收益 GB|XP
const rows = page.locator('button', { hasText: /\d{2}-\d{2} \d{2}:\d{2}:\d{2}/ });
const n = await rows.count();
const results = [];

const num = (s) => Number(String(s ?? '').replace(/[^\d-]/g, '')) || 0;

for (let i = 0; i < n; i++) {
  const label = (await rows.nth(i).innerText()).replace(/\n+/g, '|').trim();
  const listMeta = {
    time: (label.match(/(\d{2}-\d{2} \d{2}:\d{2}:\d{2})/) || [])[1] || label,
    map: (label.match(/\|([^|]*(?:外环|旧城区|边境检查站|机场|发电站|交通枢纽)[^|]*)\|/) || [])[1] || '',
    outcome: (label.match(/(匆匆撤离|阵亡|撤离)/) || [])[1] || '',
    kills: num((label.match(/(\d+)\s*杀/) || [])[1]),
    gain: num((label.match(/([+\-][\d,]+)\s*GB/) || [])[1]),
  };

  await rows.nth(i).click();
  await page.waitForTimeout(900);
  const raw = await page.evaluate(() => document.body.innerText);
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);

  // 详情区元数据：回合数 / FIR 件数（结局、击杀、收益取列表行，更稳）
  const head = raw.replace(/\n+/g, '|');
  const meta = {
    turns: num((head.match(/(\d+)\s*回合/) || [])[1]),
    fir: num((head.match(/带出 FIR 物品\|(\d+) 件/) || [])[1]),
  };

  // 日志条目
  const entries = [];
  let cur = null;
  for (const line of lines) {
    const tm = line.match(/^\[(\d+)\]$/);
    if (tm) { cur = { turn: +tm[1], msg: [] }; entries.push(cur); continue; }
    if (cur && !/^(营地|装备|战局|策略|商人|LOG|记录|战局|详情|报告问题|撤离|击杀|战局收益|带出 FIR 物品)$/.test(line)) cur.msg.push(line);
  }
  const text = entries.map((e) => e.msg.join(' ')).join(' ');
  const count = (re) => (text.match(re) || []).length;

  // 关键事件
  const extractIdx = entries.findIndex((e) => /完成撤离|阵亡|被击杀|死亡/.test(e.msg.join(' ')));
  const reasonEntry = entries.slice(Math.max(0, extractIdx - 6), extractIdx + 1).map((e) => `[${e.turn}] ${e.msg.join(' ')}`);

  const stat = {
    ...listMeta,
    ...meta,
    logTurns: entries.length,
    shotsFired: count(/开火|射击/g),
    hits: count(/命中/g),
    damageLines: count(/伤害$/gm),
    hitsTaken: count(/射向 罗觉觉/g),
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

// raid-watch.mjs — 有界时长的战局进度轮询
//
// 为什么需要它：手写 `for i in ...; do ...; sleep 150; done` 会因为单条命令时限被截断，
// 采样只输出一半、进程被外部杀掉，看起来像"脚本有问题"。本脚本把总时长写死成参数，
// 到点一定自己退出并打印汇总（退出码 2 = 到时长上限，0 = 批次结束，1 = 连接错误）。
//
// 用法:
//   node scripts/raid-watch.mjs [--every=120] [--minutes=12] [--json]
//     --every    采样间隔秒数，默认 120
//     --minutes  总时长上限（分钟，可带小数），默认 12 —— 务必小于命令/会话时限
//     --json     每个采样只输出一行紧凑 JSON（默认输出人类可读的一行）
//
// 只做 page.goto('/raid') + 读文本，不点任何按钮（LESSONS 1）。
import { chromium } from 'playwright-core';

const CDP = process.env.RTT_CDP || 'http://127.0.0.1:9222';
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : def;
};
const EVERY = Math.max(3, arg('every', 120));
const MINUTES = arg('minutes', 12);
const JSONL = argv.includes('--json');

const state = async (page) => {
  const t = await page.evaluate(() => document.body.innerText || '');
  const map = (t.match(/^(Togov 外环|Togov 交通枢纽|机场|旧城区|边境检查站|发电站)$/m) || [])[1] || '';
  const turn = (t.match(/第 (\d+) 回合/) || [])[1] || '';
  const kills = (t.match(/(\d+) 击杀/) || [])[1] || '';
  const blood = (t.match(/血液\n(\d+) \/ (\d+)/) || [])[1] || '';
  const died = /阵亡|被打倒并死亡/.test(t);
  return { live: Boolean(turn), map, turn, kills, blood, died };
};

const browser = await chromium.connectOverCDP(CDP).catch((e) => {
  console.error(JSON.stringify({ error: 'CDP 连接失败: ' + e.message }));
  process.exit(1);
});
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('toogle.club'));
if (!page) {
  console.error(JSON.stringify({ error: '没有找到目标站点页面，先让人类登录' }));
  await browser.close();
  process.exit(1);
}

const started = Date.now();
const limitMs = MINUTES * 60 * 1000;
const samples = [];
let idleStreak = 0;
let sawRaid = false;
let exitCode = 2;

while (Date.now() - started < limitMs) {
  await page.goto(new URL('/raid', 'https://rtt.toogle.club').href, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1500);
  const s = await state(page);
  const row = {
    t: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    min: +((Date.now() - started) / 60000).toFixed(1),
    ...s,
  };
  samples.push(row);
  if (JSONL) console.log(JSON.stringify(row));
  else
    console.log(
      `${row.t} +${row.min}m  ${s.live ? `${s.map} 第${s.turn}回合 击杀${s.kills} 血${s.blood}` : '无战局'}` +
        (s.died ? '  [阵亡]' : '')
    );

  if (s.live) {
    sawRaid = true;
    idleStreak = 0;
  } else if (sawRaid) {
    idleStreak += 1;
    // 已跑过战局且连续两次采样都没在局内 → 认为这一批结束
    if (idleStreak >= 2) {
      exitCode = 0;
      break;
    }
  }

  const left = limitMs - (Date.now() - started);
  if (left <= 0) break;
  await page.waitForTimeout(Math.min(EVERY * 1000, left));
}

const summary = {
  samples: samples.length,
  rounds: samples.filter((s) => s.live).length,
  span: `${samples[0]?.t || '-'} → ${samples[samples.length - 1]?.t || '-'}`,
  lastMap: [...samples].reverse().find((s) => s.live)?.map || '-',
  maxTurn: Math.max(0, ...samples.map((s) => Number(s.turn) || 0)),
  died: samples.some((s) => s.died),
  reason: exitCode === 0 ? 'batch-done' : 'time-limit',
};
console.log(JSON.stringify({ summary }));
await browser.close();
process.exit(exitCode);

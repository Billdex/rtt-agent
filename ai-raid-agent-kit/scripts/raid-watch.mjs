// raid-watch.mjs — 有界时长的战局进度轮询
//
// 为什么需要它：手写 `for i in ...; do ...; sleep 150; done` 会因为单条命令时限被截断，
// 采样只输出一半、进程被外部杀掉，看起来像"脚本有问题"。本脚本把总时长写死成参数，
// 到点一定自己退出并打印汇总（退出码 2 = 到时长上限，0 = 批次结束，1 = 连接错误）。
//
// 用法:
//   node scripts/raid-watch.mjs [--every=45] [--minutes=12] [--idle=2] [--grace=90] [--json]
//     --every    采样间隔秒数，默认 45（越小越灵敏，但对游戏页刷新越频繁）
//     --minutes  总时长上限（分钟，可带小数），默认 12 —— 务必小于命令/会话时限
//     --idle     判"结束"需要连续几次空闲，默认 2（防渲染抢跑的假阴性）
//     --grace    开局后多少秒内一次没见过战局就判"本轮没跑起来"，默认 90
//     --json     每个采样只输出一行紧凑 JSON（默认输出人类可读的一行）
//
// 灵敏度说明（v2）：
//   旧版每 --every 秒采样一次，判结束还要再等一个完整周期，实战尾部延迟可达 2×every + 6s
//   （--every=120 时约 4 分钟）。现在空闲时改用 --probe（默认 8s）快速复核，
//   尾部延迟降到 every + probe ≈ 1 分钟；并且汇总里给 lagSec，能直接看到"晚了多少"。
//
// 只做 page.goto('/raid') + 读文本，不点任何按钮（LESSONS 1）。
import { chromium } from 'playwright-core';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CDP = process.env.RTT_CDP || 'http://127.0.0.1:9222';
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : def;
};
const EVERY = Math.max(3, arg('every', 45));
const MINUTES = arg('minutes', 12);
const IDLE = Math.max(1, arg('idle', 2));
const GRACE = Math.max(10, arg('grace', 90));
const PROBE = 8; // 空闲复核间隔（秒），固定值：比 every 短一个量级
const JSONL = argv.includes('--json');

const OUT_DIR = join(process.cwd(), 'progress');
const OUT_FILE = join(OUT_DIR, `raid-watch-${new Date().toISOString().slice(0, 10)}.jsonl`);
try {
  mkdirSync(OUT_DIR, { recursive: true });
} catch {}

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
  process.exitCode = 1;
});
if (!browser) process.exit(1);

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
let lastLiveAt = 0;
let exitCode = 2;
let reason = 'time-limit';

const sample = async () => {
  await page.goto(new URL('/raid', 'https://rtt.toogle.club').href, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1200);
  const s = await state(page);
  const row = {
    t: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    min: +((Date.now() - started) / 60000).toFixed(1),
    ...s,
  };
  samples.push(row);
  // 每次采样立刻落盘：外部把进程杀掉也不会丢证据
  try {
    appendFileSync(OUT_FILE, JSON.stringify(row) + '\n');
  } catch {}
  if (JSONL) console.log(JSON.stringify(row));
  else
    console.log(
      `${row.t} +${row.min}m  ${s.live ? `${s.map} 第${s.turn}回合 击杀${s.kills} 血${s.blood}` : '无战局'}` +
        (s.died ? '  [阵亡]' : '')
    );
  if (s.live) {
    sawRaid = true;
    idleStreak = 0;
    lastLiveAt = Date.now();
  }
  return s;
};

while (Date.now() - started < limitMs) {
  const s = await sample();
  const elapsed = Date.now() - started;

  // 一次都没见过战局：给 --grace 秒的宽限，过了就判"本轮没跑起来"，别傻等到时限
  if (!sawRaid && !s.live && elapsed > GRACE * 1000) {
    exitCode = 0;
    reason = 'no-raid-seen';
    break;
  }

  if (!s.live && sawRaid) {
    idleStreak += 1;
    if (idleStreak >= IDLE) {
      exitCode = 0;
      reason = 'batch-done';
      break;
    }
    // 还没凑够次数：用短间隔快速复核，而不是再等一个完整 every
    const left = limitMs - (Date.now() - started);
    if (left > 0) await page.waitForTimeout(Math.min(PROBE * 1000, left));
    continue;
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
  reason,
  everySec: EVERY,
  // 从最后一次确认"在局内"到脚本退出隔了多久 —— 这就是你感觉到的迟钝量
  lagSec: lastLiveAt ? Math.round((Date.now() - lastLiveAt) / 1000) : null,
  log: OUT_FILE,
};
console.log(JSON.stringify({ summary }));
await browser.close();
process.exitCode = exitCode;

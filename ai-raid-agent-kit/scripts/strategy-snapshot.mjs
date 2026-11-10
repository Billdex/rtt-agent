/**
 * 策略快照：把 /strategy 当前的策略原文存成带时间戳的 JSON，并与上一份做字段级 diff。
 *
 * 为什么需要：调参必须有"改前/改后"的确证。表单页面上看不出真实绑定值，
 * 只靠人记"我把撤退线从 35 改到 45"迟早对不上账。这个脚本只读、不点保存。
 *
 * 用法（在工作目录下执行）：
 *   node ai-raid-agent-kit/scripts/strategy-snapshot.mjs
 *   RTT_OUT=progress/run-03 node ai-raid-agent-kit/scripts/strategy-snapshot.mjs
 */
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const KIT = path.resolve(import.meta.dirname, '..');
const OUT = process.env.RTT_OUT ? path.resolve(process.env.RTT_OUT) : path.resolve(process.cwd(), 'progress');
mkdirSync(OUT, { recursive: true });
if (OUT === KIT || OUT.startsWith(KIT + path.sep)) console.error('[warn] 输出目录在工具包内部：' + OUT + '（分享这个包前请清理）');
else console.error('[out] ' + OUT);

const browser = await chromium.connectOverCDP(process.env.RTT_CDP || 'http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('toogle.club'));
if (!page) {
  console.error('[fail] 没找到 toogle.club 标签页（先让人类起好 Chrome 并登录）');
  await browser.close();
  process.exit(1);
}

await page.goto('https://rtt.toogle.club/strategy', { waitUntil: 'domcontentloaded' });
// 跳转后页面会先"重连中"，等编辑区出现再读，否则会读到空壳（analyze-log 踩过同一个坑）。
try {
  await page.getByRole('button', { name: '保存策略' }).waitFor({ timeout: 20000 });
} catch {
  console.error('[warn] 20 秒内没等到策略编辑区，可能在重连；本次快照可能不准');
}
await page.waitForTimeout(1200);

// 「高级模式」勾上代表当前槽位已被 Lua 接管：此时「JSON」面板里是 Lua 代码而不是策略 JSON。
const isLua = await page.locator('.strategy-mode-toggle input').isChecked().catch(() => false);

// 只点「JSON」打开面板；永远不点「保存策略」。
if ((await page.locator('textarea').count()) === 0) {
  await page.getByRole('button', { name: 'JSON' }).click();
  await page.waitForTimeout(800);
}
const raw = await page.locator('textarea').first().inputValue();

// 用本地时间做文件名：战局日志里的时间是本地时间（如 11-10 09:09:40），对账时不能一个 UTC 一个本地。
const now = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
const ext = isLua ? 'lua' : 'json';
const file = path.join(OUT, `strategy-${stamp}.${ext}`);

let strategy = null;
if (!isLua) {
  try {
    strategy = JSON.parse(raw);
  } catch {
    console.error('[warn] 读到的内容不是合法 JSON（可能是 Lua 或页面还没渲染完），按原文保存');
  }
}

// ── 与上一份快照做字段级 diff ─────────────────────────────────────────────
const flat = (o, p = '', acc = {}) => {
  if (o === null || typeof o !== 'object') { acc[p] = o; return acc; }
  if (Array.isArray(o)) {
    if (o.length === 0) acc[p] = [];
    o.forEach((v, i) => flat(v, `${p}[${i}]`, acc));
    return acc;
  }
  for (const k of Object.keys(o)) flat(o[k], p ? `${p}.${k}` : k, acc);
  return acc;
};

let prevFile = null;
if (strategy) {
  const prev = readdirSync(OUT)
    .filter((f) => /^strategy-.*\.json$/.test(f))
    .sort()
    .pop();
  if (prev) {
    prevFile = prev;
    try {
      const a = flat(JSON.parse(readFileSync(path.join(OUT, prev), 'utf8')));
      const b = flat(strategy);
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      const changes = keys
        .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
        .map((k) => ({ key: k, from: a[k] ?? '(无)', to: b[k] ?? '(无)' }));
      console.log(JSON.stringify({ saved: file, comparedWith: prev, changeCount: changes.length, changes }, null, 2));
    } catch (e) {
      console.error('[warn] 上一份快照读不出来，跳过 diff：' + e.message);
    }
  }
}

writeFileSync(file, isLua ? raw : JSON.stringify(strategy ?? raw, null, 2));
if (!prevFile) console.log(JSON.stringify({ saved: file, note: strategy ? '这是第一份快照，下次运行会给出 diff' : 'Lua 原文已保存' }, null, 2));

await browser.close();

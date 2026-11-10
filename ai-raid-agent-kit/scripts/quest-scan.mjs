import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// 产物一律写到「工作目录」（执行命令时的 cwd），不写进工具包内部；需要改落点时用 RTT_OUT。
const KIT = path.resolve(import.meta.dirname, '..');
const OUT = process.env.RTT_OUT ? path.resolve(process.env.RTT_OUT) : path.resolve(process.cwd(), 'progress');

const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
const p = b.contexts()[0].pages().find(x => x.url().includes('toogle.club'));
await p.goto('https://rtt.toogle.club/traders', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1800);
await p.locator('button', { hasText: /^任务/ }).first().click();
await p.waitForTimeout(1200);

const rows = p.locator('.quest-row');
const n = await rows.count();
const out = [];
for (let i = 0; i < n; i++) {
  const row = rows.nth(i);
  const head = (await row.innerText()).replace(/\n+/g, '|');
  await row.click();
  await p.waitForTimeout(500);
  const detail = await p.evaluate(() => {
    const d = document.querySelector('.quest-detail,[class*=quest-detail]') || document.querySelector('.panel-body');
    return d ? d.innerText.replace(/\n+/g, '|') : '';
  });
  out.push({ head, detail });
}
mkdirSync(OUT, { recursive: true });
if (OUT === KIT || OUT.startsWith(KIT + path.sep)) console.error('[warn] 输出目录在工具包内部：' + OUT + '（分享这个包前请清理）');
else console.error('[out] ' + OUT);
writeFileSync(path.join(OUT, 'quests.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.map(o => o.head + ' >>> ' + o.detail.slice(0, 200)), null, 1));
await b.close();

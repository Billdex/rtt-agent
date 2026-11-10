import { chromium } from 'playwright-core';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const CDP = process.env.RTT_CDP || 'http://127.0.0.1:9222';
// 产物一律写到「工作目录」（执行命令时的 cwd），不写进工具包内部；需要改落点时用 RTT_OUT。
const KIT = path.resolve(import.meta.dirname, '..');
const OUT = process.env.RTT_OUT ? path.resolve(process.env.RTT_OUT) : path.resolve(process.cwd(), 'progress');
mkdirSync(OUT, { recursive: true });
if (OUT === KIT || OUT.startsWith(KIT + path.sep)) console.error('[warn] 输出目录在工具包内部：' + OUT + '（分享这个包前请清理）');
else console.error('[out] ' + OUT);
const LOG = path.join(OUT, 'raid-log.jsonl');

const samples = Number(process.env.RTT_SAMPLES || 60);
const everyMs = Number(process.env.RTT_EVERY_MS || 10000);

const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('toogle.club'));
if (!page) { console.log('no page'); process.exit(1); }

const read = async () => {
  const body = await page.evaluate(() => document.body.innerText || '');
  const turn = body.match(/第\s*(\d+)\s*回合/)?.[1] ?? null;
  const kills = body.match(/(\d+)\s*击杀/)?.[1] ?? null;
  const state = /进行中/.test(body) ? 'live' : (/已结束|结束|阵亡|撤离成功|撤离/.test(body) ? 'ended?' : 'unknown');
  const hp = body.match(/(\d{1,3})%/)?.[1] ?? null;
  const map = body.match(/Togov 外环|旧城区|边境检查站|机场|发电站|Togov 交通枢纽/)?.[0] ?? null;
  const lastLines = body.split('\n').filter((l) => l.trim()).slice(-6).join(' | ');
  return { at: new Date().toISOString(), url: page.url(), map, turn, kills, hp, state, lastLines };
};

for (let i = 0; i < samples; i++) {
  try {
    const row = await read();
    appendFileSync(LOG, JSON.stringify(row) + '\n');
    console.log(JSON.stringify(row).slice(0, 240));
    if (row.state !== 'live') { console.log('raid not live, stop sampling'); break; }
  } catch (e) {
    console.log('sample error: ' + e.message);
  }
  await page.waitForTimeout(everyMs);
}
await browser.close();

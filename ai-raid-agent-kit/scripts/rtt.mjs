// rtt.mjs — 通过 CDP 接管用户已登录的独立 Chrome
// 用法: node rtt.mjs <status|tabs|shot|text|click|goto|eval|wait> [参数]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const CDP = process.env.RTT_CDP || 'http://127.0.0.1:9222';
// 产物一律写到「工作目录」（执行命令时的 cwd），不写进工具包内部；
// 需要改落点时用 RTT_OUT。
const KIT = path.resolve(import.meta.dirname, '..');
const OUT = process.env.RTT_OUT ? path.resolve(process.env.RTT_OUT) : path.resolve(process.cwd(), 'progress');
const noteOut = () => {
  if (OUT === KIT || OUT.startsWith(KIT + path.sep)) console.error('[warn] 输出目录在工具包内部：' + OUT + '（分享这个包前请清理）');
  else console.error('[out] ' + OUT);
};
const [cmd, ...args] = process.argv.slice(2);

const browser = await chromium.connectOverCDP(CDP);
const contexts = browser.contexts();
const ctx = contexts[0];
const pick = () => {
  const pages = ctx.pages().filter((p) => !p.isClosed());
  return pages.find((p) => p.url().includes('toogle.club')) || pages[pages.length - 1];
};

const page = pick();
if (!page) {
  console.log(JSON.stringify({ error: '没有可用页面' }));
  process.exit(1);
}

const NAV = ['藏身处', '装备', '战局', '策略', '商人', '图鉴'];

switch (cmd) {
  case 'status': {
    const body = (await page.evaluate(() => document.body.innerText || '')).slice(0, 4000);
    console.log(JSON.stringify({
      url: page.url(),
      title: await page.title(),
      viewport: page.viewportSize(),
      navHits: NAV.filter((n) => body.includes(n)),
      hasLoginWord: /登录|注册|LOGIN/i.test(body),
      textHead: body.slice(0, 600),
    }, null, 2));
    break;
  }
  case 'tabs': {
    for (const p of ctx.pages()) console.log(JSON.stringify({ url: p.url(), title: await p.title() }));
    break;
  }
  case 'shot': {
    mkdirSync(OUT, { recursive: true });
    noteOut();
    const file = path.join(OUT, args[0] || `shot-${page.url().split('/').pop() || 'root'}.png`);
    await page.screenshot({ path: file, fullPage: args.includes('--full') });
    console.log(file);
    break;
  }
  case 'text': {
    const body = await page.evaluate(() => document.body.innerText || '');
    console.log(body.slice(0, Number(args[0] || 8000)));
    break;
  }
  case 'fillfile': {
    const { readFileSync } = await import('node:fs');
    const content = readFileSync(args[0], 'utf8').trim();
    await page.fill(args[1], content);
    console.log('filled ' + args[1] + ' chars=' + content.length);
    break;
  }
  case 'click': {
    const target = args.join(' ');
    await page.getByText(target, { exact: false }).first().click({ timeout: 10000 });
    await page.waitForTimeout(800);
    console.log('clicked: ' + target + ' -> ' + page.url());
    break;
  }
  case 'goto': {
    await page.goto(new URL(args[0], 'https://rtt.toogle.club').href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    console.log(page.url());
    break;
  }
  case 'key': {
    await page.keyboard.press(args[0]);
    console.log('pressed ' + args[0]);
    break;
  }
  case 'wait': {
    await page.waitForTimeout(Number(args[0] || 1000));
    console.log('waited');
    break;
  }
  case 'evalscript': {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync(args[0], 'utf8');
    const r = await page.evaluate(code);
    console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2));
    break;
  }
  case 'eval': {
    const r = await page.evaluate(args.join(' '));
    console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2));
    break;
  }
  default:
    console.log('命令: status | tabs | shot [文件名] [--full] | text [字符数] | click <文本> | goto <路径> | wait <ms> | eval <js>');
}
await browser.close();

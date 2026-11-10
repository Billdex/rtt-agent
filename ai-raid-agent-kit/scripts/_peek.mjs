import { chromium } from 'playwright-core';

const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
const pages = b.contexts()[0].pages().filter((p) => p.url().includes('toogle.club'));
for (const p of pages) {
  const info = await p.evaluate(() => {
    const t = document.body.innerText || '';
    const grab = (re) => (t.match(re) || [])[1] || '';
    return {
      url: location.href,
      live: /进行中/.test(t),
      syncing: /重连中|同步失败|读取中/.test(t),
      map: grab(/\n([^\n]+)\n(\d+)\n进行中/) ,
      round: grab(/第 (\d+) 回合/),
      kills: grab(/(\d+) 击杀/),
      hp: grab(/(\d+)\s*\/\s*101/),
      cash: grab(/\n([\d,]+)\nGB/),
      buttons: [...document.querySelectorAll('button')].map((x) => (x.innerText || '').replace(/\n/g, ' ').trim()).filter(Boolean).slice(0, 40),
      tail: t.slice(-700),
    };
  });
  console.log(JSON.stringify(info, null, 2));
  console.log('-----');
}
await b.close();

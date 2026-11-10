import { chromium } from 'playwright-core';

// 开局前检查：装备槽位、负重、生命状态、保险箱
const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
const p = b.contexts()[0].pages().find(x => x.url().includes('toogle.club'));

await p.goto('https://rtt.toogle.club/stash', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1800);

const stash = await p.evaluate(() => {
  const t = document.body.innerText;
  return {
    slots: [...document.querySelectorAll('.loadout-cell')].map((e) => (e.innerText || '').replace(/\n/g, '|').trim()),
    filled: Number((t.match(/(\d+) \/ 11 槽位/) || [])[1] || 0),
    weight: (t.match(/负重 ([\d.]+ kg \/ [\d.]+ kg)/) || [])[1] || '',
    carriedValue: (t.match(/携带总价值 ([\d,]+) GB/) || [])[1] || '',
    cash: (t.match(/GB ([\d,]+)/) || [])[1] || '',
    // 局外记账用：批次收益 = 现金增量 + 仓库价值增量（LESSONS 36），所以必须留仓库基线
    stashValue: (t.match(/仓库总价值\s*([\d,]+) GB/) || [])[1] || '',
    stashVolume: (t.match(/([\d.]+) L \/ [\d.]+ L/) || [])[1] || '',
  };
});

await p.goto('https://rtt.toogle.club/raid', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1600);
const raid = await p.evaluate(() => {
  const t = document.body.innerText;
  const live = /进行中/.test(t);
  const parts = [...t.matchAll(/\n(头部|胸|腹|左臂|右臂|左腿|右腿)\n(\d{1,3})/g)].map((m) => [m[1], Number(m[2])]);
  // 血量上限不一定是 100（角色升级后会变，实测见过 102 / 102），别硬编码
  const bm = t.match(/血液\s+(\d+)\s*\/\s*(\d+)/) || [];
  const bloodCur = Number(bm[1] || 0);
  const bloodMax = Number(bm[2] || 0);
  return {
    live,
    blood: bm[1] && bm[2] ? `${bm[1]}/${bm[2]}` : '',
    bloodFull: bloodMax > 0 && bloodCur >= bloodMax,
    treatment: (t.match(/治疗费用约 ([\d,]+) GB/) || [])[1] || '',
    parts,
    syncFail: /状态同步失败/.test(t),
  };
});

const checks = [];
const slot = (name) => stash.slots.find((s) => s.startsWith(name)) || '';
// 槽位文本形如 “头部|SSh-68 钢盔|FIR”；只有标签 = 空槽
const isFilled = (s) => s.split('|').length > 1 && s.split('|')[1].trim().length > 0;
const need = ['主武器', '副武器', '头部', '防弹衣', '胸挂', '背包'];
for (const k of need) { const v = slot(k); checks.push([k, v || '空', isFilled(v) ? 'PASS' : 'FAIL']); }
for (const k of ['面部', '耳机', '安全箱']) { const v = slot(k); checks.push([k, v || '空', isFilled(v) ? 'PASS' : 'WARN']); }

const lowParts = raid.parts.filter(([, v]) => v < 90);
checks.push(['生命状态', `血 ${raid.blood} · 低部位 ${lowParts.length} 处 · 治疗费 ${raid.treatment}`, raid.bloodFull && lowParts.length === 0 ? 'PASS' : 'WARN']);
checks.push(['负重', stash.weight, '—']);
checks.push(['现金', stash.cash + ' GB', '—']);
if (raid.live) checks.push(['提示', '战局进行中，本检查基于仓库视图，仅供参考', 'INFO']);
if (raid.syncFail) checks.push(['提示', '状态同步失败，先刷新页面', 'FAIL']);

console.log(JSON.stringify({ stash, raid, checks }, null, 2));
await b.close();

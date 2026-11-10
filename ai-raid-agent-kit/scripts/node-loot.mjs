import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// 产物一律写到「工作目录」；需要改落点时用 RTT_OUT。
const KIT = path.resolve(import.meta.dirname, '..');
const OUT = process.env.RTT_OUT ? path.resolve(process.env.RTT_OUT) : path.resolve(process.cwd(), 'progress');
mkdirSync(OUT, { recursive: true });
if (OUT === KIT || OUT.startsWith(KIT + path.sep)) console.error('[warn] 输出目录在工具包内部：' + OUT);
else console.error('[out] ' + OUT);

const MAX_RAIDS = Number(process.env.RTT_RAIDS || 10);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('toogle.club'));

// ---------- 1. 地图数据（节点的搜刮类型是权威信息，别靠肉眼截图） ----------
// 客户端先读 manifest 拿内容 hash，再取 /api/content/<hash>：里面有 maps / items / lootTypes。
const content = await page.evaluate(async () => {
  const man = await (await fetch('/api/content/public/manifest', { credentials: 'include' })).json();
  const c = await (await fetch('/api/content/' + man.hash, { credentials: 'include' })).json();
  return { hash: man.hash, maps: c.maps, items: c.items, lootTypes: c.lootTypes };
});
console.error('[content] hash=' + content.hash + ' maps=' + Object.keys(content.maps).length);

const typeName = (id) => content.lootTypes[id]?.name || id;
// 物品名 → 单价（同名取最高，子弹/value 都是单件价）
const itemValue = new Map();
for (const it of Object.values(content.items)) {
  const v = Number(it.value) || 0;
  if (!itemValue.has(it.name) || itemValue.get(it.name) < v) itemValue.set(it.name, v);
}

// 搜刮类型的"档位"只用于**排序参考**，不是游戏内数值：靠类型名的语义分级。
// 结论必须用日志实收（下面第 2 段）交叉验证，不能只看这个分。
const TIER = {
  locked_valuables: 5, military_supplies: 5, advanced_ammo: 5, high_armor: 5, rare_weapons: 5, special_ammo: 4.5,
  high_building: 4, advanced_electronics: 4, advanced_medical: 4,
  locked_building_1: 3.5, locked_building_2: 4, locked_building_3: 4.5,
  valuables: 3, weapon_mods: 2.5, common_weapons: 2.5, keys_documents: 2,
  basic_ammo: 1.5, basic_electronics: 1.5, basic_medical: 1.5, tools_hardware: 1.5,
  low_armor: 1, low_building: 1, food_supplies: 0.8, fuel_chemicals: 0.8,
};
const tierOf = (t) => (t.startsWith('keys_') ? 1.2 : TIER[t] ?? 1);

const nodes = [];
for (const [mapId, m] of Object.entries(content.maps)) {
  for (const n of m.nodes) {
    const types = (n.lootTypes || []).map((x) => x.type);
    nodes.push({
      mapId, mapName: m.name, id: n.id, name: n.name,
      types, typeNames: types.map(typeName),
      tierScore: types.reduce((a, t) => a + tierOf(t), 0),
      highTier: types.filter((t) => tierOf(t) >= 4).length,
      lootTime: n.lootTime ?? null, size: n.size ?? null,
      tags: n.tags || [], spawn: !!n.spawn, lock: n.lock || null,
      extract: n.extract ? n.extract.name + '（' + (n.extract.kind === 'always' ? '必出' : '概率') + '）' : null,
      typeless: types.length === 0,
    });
  }
}

// ---------- 2. 日志实收：每个点位实际搜到多少钱 ----------
// 白名单：日志里只把**真实存在的节点名**当作点位（敌人在别的节点"开始检查武器"不算）。
const nodeNames = new Set(nodes.map((n) => n.name));
await page.goto('https://rtt.toogle.club/raid?tab=history', { waitUntil: 'domcontentloaded' });
try {
  await page.locator('button', { hasText: /\d{2}-\d{2} \d{2}:\d{2}:\d{2}/ }).first().waitFor({ timeout: 20000 });
} catch {
  console.error('[warn] 没等到战局历史列表');
}
await page.waitForTimeout(800);

const rows = page.locator('button', { hasText: /\d{2}-\d{2} \d{2}:\d{2}:\d{2}/ });
const n = Math.min(await rows.count(), MAX_RAIDS);
const raids = [];

for (let i = 0; i < n; i++) {
  const label = (await rows.nth(i).innerText()).replace(/\n+/g, '|');
  const meta = {
    time: (label.match(/(\d{2}-\d{2} \d{2}:\d{2}:\d{2})/) || [])[1] || '',
    map: (label.match(/\|([^|]*(?:外环|旧城区|边境检查站|机场|发电站|交通枢纽)[^|]*)\|/) || [])[1] || '',
    outcome: (label.match(/(匆匆撤离|阵亡|撤离)/) || [])[1] || '',
  };
  await rows.nth(i).click();
  try {
    await page.waitForFunction((w) => {
      const t = document.body.innerText;
      if (!/·\s*\d+\s*回合/.test(t)) return false;
      const m = t.match(/战局收益\s*\n\s*([+\-][\d,]+)\s*GB/);
      return !!m && m[1].replace(/,/g, '') === w;
    }, (label.match(/([+\-][\d,]+)\s*GB/) || ['', ''])[1].replace(/,/g, ''), { timeout: 8000 });
  } catch { console.error(`[warn] ${meta.time} 详情没出来，跳过本行`); continue; }

  const lines = (await page.evaluate(() => document.body.innerText)).split('\n').map((l) => l.trim()).filter(Boolean);

  // 当前正在搜的点位：从"开始检查 X 的物资 / 搜索 X 的物资"切换；拿到的东西记到该点位名下。
  let cur = null;
  const perNode = {};
  for (const line of lines) {
    // 搜刮开始：实测至少有这几种措辞 ——
    // 「开始检查 X 的物资」「开始搜索 X」「在 X 开始找物资」「在 X 开始搜刮」
    // 只认**真实节点名**，否则敌人的「开始检查并排除 M9 的供弹故障」也会被当成点位。
    const st = line.match(/(?:开始检查|正在检查|继续检查|开始搜索|继续搜索)\s*([^\s，。]+)/)
      || line.match(/在\s*([^\s，。]+)\s*(?:开始找物资|开始搜刮|开始搜查)/);
    if (st && nodeNames.has(st[1])) { cur = st[1]; continue; }
    const mv = line.match(/(?:开始向|开始赶往|前往|动身去|出发，目标|选定)\s*([^\s，。]+)/);
    if (mv && nodeNames.has(mv[1])) { cur = null; continue; } // 换赶路目标后不再把收获算到上一个点位
    const pk = line.match(/(?:已拿到|拿到|装好搜到的|收下|收起|拾取)\s*([^×]+?)\s*×(\d+)/);
    if (pk && cur) {
      const name = pk[1].trim();
      const qty = Number(pk[2]) || 1;
      const unit = itemValue.get(name);
      if (!perNode[cur]) perNode[cur] = { items: 0, value: 0, unknown: 0 };
      perNode[cur].items += qty;
      if (unit == null) perNode[cur].unknown += 1;
      else perNode[cur].value += unit * qty;
    }
  }
  raids.push({ ...meta, perNode });
  console.error(`[raid] ${meta.time} ${meta.map} 点位 ${Object.keys(perNode).length} 个`);
}

// ---------- 3. 合并：静态档位 + 日志实收 ----------
const stats = new Map(); // nodeName → {visits, items, value, unknown}
for (const r of raids) {
  for (const [name, v] of Object.entries(r.perNode)) {
    const s = stats.get(name) || { visits: 0, items: 0, value: 0, unknown: 0 };
    s.visits += 1; s.items += v.items; s.value += v.value; s.unknown += v.unknown;
    stats.set(name, s);
  }
}
for (const nd of nodes) {
  const s = stats.get(nd.name);
  nd.seen = s?.visits || 0;
  nd.lootedValue = Math.round(s?.value || 0);
  nd.lootedItems = s?.items || 0;
  nd.valuePerVisit = nd.seen ? Math.round((s.value || 0) / nd.seen) : null;
}

const fmt = (nd) => `| ${nd.name} | ${nd.id} | ${nd.typeNames.join('、')} | ${nd.lootTime ?? '?'} | ${nd.size ?? '?'} | ${nd.highTier} | ${nd.tierScore.toFixed(1)} | ${nd.seen} | ${nd.lootedValue.toLocaleString('en-US')} | ${nd.valuePerVisit == null ? '—' : nd.valuePerVisit.toLocaleString('en-US')} |${nd.extract ? ' 撤离点 ' + nd.extract : ''}${nd.lock ? ' 需钥匙 ' + nd.lock : ''}`;

const md = ['# 点位物资盘点（map + log）', ''];
md.push(`内容 hash：\`${content.hash}\`；日志样本：最近 ${raids.length} 局（${raids[0]?.time || '?'} → ${raids.at(-1)?.time || '?'}）。`, '');
md.push('> **口径**：`档位分` 是按搜刮类型名做的启发式分级（锁库/军品/高级弹 5 分，基础建材/食品 1 分左右），**只用于排序参考**；');
md.push('> `实收/次` 才是证据（日志里该点位实际拿到的物品按单件价值折算），样本小，缺 `—` 表示这 N 局没去过。', '');

for (const [mapId, m] of Object.entries(content.maps)) {
  const list = nodes.filter((x) => x.mapId === mapId);
  const byStatic = [...list].sort((a, b) => b.tierScore - a.tierScore || a.lootTime - b.lootTime);
  md.push(`## ${m.name}（${mapId} · ${list.length} 节点 · 撤离点 ${list.filter((x) => x.extract).length}）`, '');
  md.push('| 节点 | id | 搜刮类型 | 搜查 | 占地 | 高档类型数 | 档位分 | 到访 | 实收 GB | 实收/次 | 备注 |');
  md.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const nd of byStatic) md.push(fmt(nd));
  md.push('');
}

const brief = Object.fromEntries(Object.entries(content.maps).map(([id, m]) => [id, {
  name: m.name,
  nodes: nodes.filter((x) => x.mapId === id).length,
  extracts: nodes.filter((x) => x.mapId === id && x.extract).length,
  top: nodes.filter((x) => x.mapId === id).sort((a, b) => b.tierScore - a.tierScore).slice(0, 5).map((x) => `${x.name}(${x.tierScore.toFixed(1)})`),
}]));

writeFileSync(path.join(OUT, 'node-loot.json'), JSON.stringify({ hash: content.hash, raids: raids.map((r) => ({ time: r.time, map: r.map, outcome: r.outcome, perNode: r.perNode })), nodes, brief }, null, 2));
writeFileSync(path.join(OUT, 'node-loot.md'), md.join('\n'));

console.log(JSON.stringify({ raids: raids.length, nodes: nodes.length, brief }, null, 2));
await browser.close();

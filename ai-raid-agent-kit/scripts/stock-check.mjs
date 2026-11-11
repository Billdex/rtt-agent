/**
 * stock-check.mjs — 配装可补性核对（分层配装 M-11 的执行工具）
 *
 * 回答一个问题：**这份配装清单，按我当前的商人等级，一个刷新窗口内能不能整份补回来。**
 * 逐件报：谁在卖 / 需要几级 / 限购多少 / 单价 / 本套用量，最后给合计与缺口清单。
 *
 * 为什么不用页面：商人面板要逐页点、逐件读，还不能算合计；
 * 内容接口 `/api/content/public/manifest` + `/api/content/<hash>` 是公开的（无需登录、无需 CDP），
 * `traders[].stock[]` 里有 item / minLevel / limit，`items[]` 里有 value / weightG，一次拉全。
 *
 * 用法（工作目录 = 仓库根）：
 *   node ai-raid-agent-kit/scripts/stock-check.mjs \
 *     --levels 军需=2,军械=1,杂货=2,医生=1 \
 *     --loadout "w_ak74:1,ammo_545_bt:150,armor_scout:1"
 *
 *   --file <path>     从 JSON 读清单：[{"id":"w_ak74","count":1}, ...]
 *   --levels <k=v,...> 当前商人等级；没写的商人按 1 级算
 *   --content <path>  离线模式：读已保存的内容 JSON（不联网）
 *   --force           忽略缓存，强制重拉内容
 *   --json            输出机器可读结果
 *
 * 缓存：progress/content-cache.json（hash 未变自动复用），RTT_OUT 可改目录。
 * 退出码：0 = 全部可补 / 2 = 有缺口 / 1 = 取数失败
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const val = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : null;
};

const OUT = process.env.RTT_OUT ? path.resolve(process.env.RTT_OUT) : path.resolve(process.cwd(), 'progress');
const CACHE = path.join(OUT, 'content-cache.json');

const LEVELS = (() => {
  const m = new Map();
  const raw = val('--levels') || '';
  for (const part of raw.split(/[,，]/).filter(Boolean)) {
    const [k, v] = part.split('=');
    if (k && v != null) m.set(k.trim(), Number(v));
  }
  return m;
})();

const LOADOUT = (() => {
  const file = val('--file');
  if (file) {
    const rows = JSON.parse(readFileSync(path.resolve(file), 'utf8'));
    return rows.map((r) => ({ id: r.id, count: r.count ?? 1 }));
  }
  const raw = val('--loadout') || '';
  const rows = [];
  for (const part of raw.split(/[,，\s]+/).filter(Boolean)) {
    const [id, c] = part.split(':');
    rows.push({ id: id.trim(), count: c == null ? 1 : Number(c) });
  }
  return rows;
})();

if (!LOADOUT.length) {
  console.error('[fail] 没有配装清单：用 --loadout "id:数量,..." 或 --file <json>');
  process.exit(1);
}

/* ---------- 取内容：公开接口，无需登录 ---------- */
const PUBLIC = 'https://rtt.toogle.club';

async function fetchContent() {
  const forced = val('--content');
  if (forced) return { content: JSON.parse(readFileSync(path.resolve(forced), 'utf8')), hash: 'offline' };

  const man = await (await fetch(`${PUBLIC}/api/content/public/manifest`)).json();
  if (!flag('--force') && existsSync(CACHE)) {
    try {
      const c = JSON.parse(readFileSync(CACHE, 'utf8'));
      if (c.hash === man.hash) return { content: c, hash: c.hash, cached: true };
    } catch { /* 缓存坏了就重拉 */ }
  }
  const content = await (await fetch(`${PUBLIC}/api/content/${man.hash}`)).json();
  content.hash = man.hash;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(CACHE, JSON.stringify(content));
  return { content, hash: man.hash, cached: false };
}

let got;
try {
  got = await fetchContent();
} catch (e) {
  console.error('[fail] 取内容失败：' + e.message);
  process.exit(1);
}
const { content, hash } = got;
const items = content.items || {};
const traders = Object.values(content.traders || {});

/* ---------- 索引：item → 卖它的商人档位 ---------- */
const stockOf = new Map();
for (const t of traders) {
  for (const s of t.stock || []) {
    if (!stockOf.has(s.item)) stockOf.set(s.item, []);
    stockOf.get(s.item).push({ trader: t.name, traderId: t.id, lv: s.minLevel ?? 1, limit: s.limit ?? 0, pf: t.priceFactor ?? 1 });
  }
}
/** 商人等级：--levels 可写中文名或 trader id，没写的按 1 级 */
const levelOf = (name, id) => LEVELS.get(name) ?? LEVELS.get(id) ?? 1;
const levelOfEntry = (c) => levelOf(c.trader, c.traderId);

/* ---------- 逐件判定 ---------- */
const rows = [];
let gap = 0;
let priceSum = 0;
let weightG = 0;

for (const want of LOADOUT) {
  const it = items[want.id];
  if (!it) {
    rows.push({ 件: want.id, 商: '—', 需LV: '', 现LV: '', 限购: '', 单价: '', 量: want.count, 小计: '', 判定: '未找到该物品' });
    gap++;
    continue;
  }
  weightG += (it.weightG ?? 0) * want.count;

  const priceOf = (c) => Math.round((it.value ?? 0) * c.pf);
  const cands = (stockOf.get(want.id) || []).slice().sort((a, b) => a.lv - b.lv || priceOf(a) - priceOf(b));
  const ok = cands.filter((c) => c.lv <= levelOfEntry(c))[0] || null;
  const best = ok || cands[0] || null;

  let verdict;
  let price = '';
  if (!cands.length) {
    verdict = /loot_only/.test(JSON.stringify(it.tags || [])) ? '仅战利品，不可购' : '无商人出售';
  } else if (!ok) {
    verdict = `等级不够（需 ${best.trader} LV${best.lv}）`;
  } else if (want.count > ok.limit) {
    verdict = `超限购（限 ${ok.limit}，本套 ${want.count}）`;
  } else {
    verdict = ok.limit === 1 ? 'OK（限购 1，断供风险）' : 'OK';
  }
  if (best) price = Math.round((it.value ?? 0) * best.pf);
  if (typeof price === 'number') priceSum += price * want.count;
  if (!verdict.startsWith('OK')) gap++;

  rows.push({
    件: it.name,
    商: best ? best.trader : '—',
    需LV: best ? best.lv : '',
    现LV: best ? levelOfEntry(best) : '',
    限购: best ? best.limit : '',
    单价: price,
    量: want.count,
    小计: typeof price === 'number' ? price * want.count : '',
    判定: verdict,
  });
}

const summary = {
  contentHash: hash,
  cached: !!got.cached,
  levels: Object.fromEntries(traders.map((t) => [t.name, levelOf(t.name, t.id)])),
  priceSum,
  weightKg: +(weightG / 1000).toFixed(2),
  gaps: gap,
  rows,
};

if (flag('--json')) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`[content] hash=${String(hash).slice(0, 12)}${got.cached ? '（缓存）' : ''} n=${Object.keys(items).length}`);
  console.log('[levels] ' + Object.entries(summary.levels).map(([k, v]) => `${k}=${v}`).join(' '));
  console.table(rows);
  console.log(`[合计] 单价合计 ${priceSum.toLocaleString()} GB · 裸重量 ${summary.weightKg} kg（容器减重未计入）· 缺口 ${gap} / ${rows.length} 件`);
  if (gap) console.log('[缺口] ' + rows.filter((r) => !String(r.判定).startsWith('OK')).map((r) => `${r.件}(${r.判定})`).join('；'));
}

process.exit(gap ? 2 : 0);

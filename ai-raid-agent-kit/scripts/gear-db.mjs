/**
 * gear-db.mjs — 装备数据库：把游戏内容 API 里的全部物品落地成本地 JSON，后续查询不再联网。
 *
 * 为什么这么做：物品详情页的「弹药数据 / 武器数据 / 防护数据」是折叠的，逐个点开 389 件又慢又易错；
 * 而客户端本来就是从 `/api/content/<hash>` 拿全部内容（`items` 里带 damage/penetration/armorClass…）。
 * 于是「拉一次 → 存本地 → 平时只读本地」，内容 hash 变了才重拉。
 *
 * 用法（工作目录 = 仓库根）：
 *   node ai-raid-agent-kit/scripts/gear-db.mjs              # 拉取 / 更新（hash 未变自动跳过）
 *   node ai-raid-agent-kit/scripts/gear-db.mjs --force      # 强制重拉
 *   node ai-raid-agent-kit/scripts/gear-db.mjs --md         # 同时输出 markdown 速查表
 *   node ai-raid-agent-kit/scripts/gear-db.mjs --query 5.45 # 只读本地文件（不联网、不需登录）
 *
 * 产物：
 *   progress/gear-db.json   { meta, items[], byKind }
 *   progress/gear-db.md     （仅 --md）
 *
 * 退出码：0 成功 / 1 取数失败
 */
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const WITH_MD = argv.includes('--md');
const qi = argv.indexOf('--query');
const QUERY = qi >= 0 ? argv.slice(qi + 1).join(' ') : null;

const OUT = process.env.RTT_OUT ? path.resolve(process.env.RTT_OUT) : path.resolve(process.cwd(), 'progress');
mkdirSync(OUT, { recursive: true });
const DB_PATH = path.join(OUT, 'gear-db.json');
const MD_PATH = path.join(OUT, 'gear-db.md');

const KIND_CN = {
  ammo: '弹药', weapon: '武器', armor: '防弹衣', helmet: '头盔', facemask: '面罩', rig: '胸挂',
  backpack: '背包', secure: '安全箱', belt: '腰带', headset: '耳机', melee: '刀具', throwable: '投掷物',
  medical: '医药', mod: '配件', key: '钥匙', barter: '杂物', dogtag: '狗牌', money: '货币',
};
const RARITY_CN = { common: '普通', uncommon: '优良', rare: '稀有', epic: '史诗', legendary: '传说', quest: '任务' };
const SUB_KEYS = ['ammo', 'weapon', 'armor', 'container', 'melee', 'throwable', 'medical'];

const loadDb = () => {
  if (!existsSync(DB_PATH)) return null;
  try { return JSON.parse(readFileSync(DB_PATH, 'utf8')); } catch { return null; }
};

const num = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? '' : String(+(+v).toFixed(d)));

function flatten(it) {
  const row = {
    id: it.id,
    kind: it.kind,
    kindCn: KIND_CN[it.kind] || it.kind,
    name: it.name,
    rarity: it.rarity,
    rarityCn: RARITY_CN[it.rarity] || it.rarity,
    desc: it.desc || '',
    weightKg: it.weightG != null ? +(it.weightG / 1000).toFixed(3) : null,
    volumeL: it.volumeCm3 != null ? +(it.volumeCm3 / 1000).toFixed(3) : null,
    value: it.value ?? null,
    stack: it.stack ?? null,
  };
  for (const k of SUB_KEYS) if (it[k]) row[k] = it[k];
  if (it.tags) row.tags = it.tags;
  if (it.concealmentBonus != null) row.concealmentBonus = it.concealmentBonus;
  return row;
}

/* ---------- --query：只读本地 ---------- */
if (QUERY) {
  const db = loadDb();
  if (!db) {
    console.error('[fail] 本地没有 gear-db.json，先跑一次不带 --query 的更新');
    process.exit(1);
  }
  const kw = QUERY.toLowerCase();
  const hits = db.items.filter(
    (it) => (it.name || '').toLowerCase().includes(kw) || (it.id || '').toLowerCase().includes(kw) || (it.desc || '').includes(QUERY)
  );
  console.log(`[db] hash=${db.meta.contentHash} fetchedAt=${db.meta.fetchedAt} n=${db.items.length}`);
  if (!hits.length) {
    console.log('(无匹配)');
  } else {
    for (const it of hits.slice(0, 50)) console.log(JSON.stringify(it));
  }
  process.exit(0);
}

/* ---------- 联网：取内容 ---------- */
const browser = await chromium.connectOverCDP(process.env.RTT_CDP || 'http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('toogle.club'));
if (!page) {
  console.error('[fail] 没找到 toogle.club 标签页（先让人类起好 Chrome 并登录）');
  await browser.close();
  process.exit(1);
}

let payload;
try {
  payload = await page.evaluate(async () => {
    const man = await (await fetch('/api/content/public/manifest', { credentials: 'include' })).json();
    const c = await (await fetch('/api/content/' + man.hash, { credentials: 'include' })).json();
    return { hash: man.hash, schema: man.schema ?? c.schema ?? null, items: c.items || {} };
  });
} catch (e) {
  console.error('[fail] 取内容失败：' + e.message);
  await browser.close();
  process.exit(1);
}
await browser.close();

const prev = loadDb();
const total = Object.keys(payload.items).length;
if (!FORCE && prev && prev.meta?.contentHash === payload.hash) {
  console.log(`[skip] 内容未变（hash=${payload.hash}），本地 gear-db.json 已是最新（n=${prev.items.length}）`);
  console.log('[tip] 游戏更新后可用 --force 重拉；查物品用 --query <关键词>');
  process.exit(0);
}

const items = Object.values(payload.items).map(flatten).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
const byKind = {};
for (const it of items) byKind[it.kind] = (byKind[it.kind] || 0) + 1;

const db = {
  meta: {
    fetchedAt: new Date().toISOString(),
    contentHash: payload.hash,
    schema: payload.schema,
    count: items.length,
    prevHash: prev?.meta?.contentHash || null,
    byKind,
    note: '由 gear-db.mjs 从 /api/content/<hash> 生成；查询用 --query，不要手改。',
  },
  items,
  byKind,
};
writeFileSync(DB_PATH, JSON.stringify(db, null, 1));
console.log(`[ok] ${items.length} 件 → ${DB_PATH}`);
console.log('[kinds] ' + Object.entries(byKind).map(([k, v]) => `${KIND_CN[k] || k}=${v}`).join(' '));
if (prev?.meta?.contentHash && prev.meta.contentHash !== payload.hash) {
  console.log(`[diff] 内容 hash 变化：${prev.meta.contentHash.slice(0, 8)} → ${payload.hash.slice(0, 8)}（游戏数据更新了）`);
}

/* ---------- 可选 markdown 速查表 ---------- */
if (WITH_MD) {
  const md = [];
  md.push('# 装备数据库速查（自动生成，勿手改）', '');
  md.push(`内容 hash：\`${payload.hash}\` · 拉取时间：${db.meta.fetchedAt} · 共 ${items.length} 件`, '');
  md.push('> 由 `scripts/gear-db.mjs` 从游戏内容 API 生成。数值以游戏为准；卖出参考 ≈ 价值 × 0.55（最佳收购），回收站 ≈ × 0.4（按耐久浮动）。', '');

  const ammo = items.filter((i) => i.kind === 'ammo' && i.ammo).sort((a, b) => b.ammo.penetration - a.ammo.penetration || b.ammo.damage - a.ammo.damage);
  md.push('## 弹药（按穿深降序）', '');
  md.push('| 名称 | 口径 | 伤害 | 穿深 | 护甲伤害 | 破片 | 轻/重出血 | 单价(基础) | 稀有度 |');
  md.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const i of ammo) {
    const a = i.ammo;
    md.push(`| ${i.name} | ${a.caliber} | ${num(a.damage)} | **${num(a.penetration, 0)}** | ${num((a.armorDamage ?? 0) * 100, 0)}% | ${num((a.fragChance ?? 0) * 100, 0)}% | ${num((a.lightBleed ?? 0) * 100, 0)}% / ${num((a.heavyBleed ?? 0) * 100, 0)}% | ${i.value ?? ''} | ${i.rarityCn} |`);
  }
  md.push('');

  const w = items.filter((i) => i.kind === 'weapon' && i.weapon).sort((a, b) => a.weapon.moa - b.weapon.moa);
  md.push('## 武器（按 MOA 升序，越小越准）', '');
  md.push('| 名称 | 口径 | 射速 | MOA | 后坐 | 人机 | 可靠性 | 弹匣 | 有效射程 | 单价(基础) |');
  md.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const i of w) {
    const x = i.weapon;
    md.push(`| ${i.name} | ${x.caliber} | ${x.rpm ?? ''} | ${num(x.moa)} | ${x.recoil ?? ''} | ${x.ergonomics ?? ''} | ${x.reliability ?? ''} | ${x.magCapacity ?? ''} | ${x.effectiveRange ?? ''} m | ${i.value ?? ''} |`);
  }
  md.push('');

  const ar = items.filter((i) => (i.kind === 'armor' || i.kind === 'helmet' || i.kind === 'facemask') && i.armor)
    .sort((a, b) => b.armor.class - a.armor.class || b.armor.durability - a.armor.durability);
  md.push('## 防具（按防护等级降序）', '');
  md.push('| 名称 | 类型 | 等级 | 覆盖 | 钝伤 | 跳弹 | 移动/人机惩罚 | 耐久 | 重量 | 单价(基础) |');
  md.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const i of ar) {
    const x = i.armor;
    const cov = Object.entries(x.coverageRatio || {}).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(' / ') || (x.coverage || []).join('/');
    md.push(`| ${i.name} | ${i.kindCn} | **${x.class}** | ${cov} | ${num((x.blunt ?? 0) * 100, 0)}% | ${num((x.ricochet ?? 0) * 100, 0)}% | ${num(x.movePenalty)} / ${x.ergoPenalty ?? ''} | ${x.durability ?? ''} | ${num(i.weightKg)} kg | ${i.value ?? ''} |`);
  }
  md.push('');

  const ct = items.filter((i) => i.container && ['rig', 'backpack', 'secure', 'belt'].includes(i.kind))
    .sort((a, b) => (b.container.capacity ?? 0) - (a.container.capacity ?? 0));
  if (ct.length) {
    md.push('## 容器（按容量降序）', '');
    md.push('| 名称 | 类型 | 容量 | 重量 | 单价(基础) |');
    md.push('| --- | --- | --- | --- | --- |');
    for (const i of ct) md.push(`| ${i.name} | ${i.kindCn} | ${i.container.capacity ?? ''} | ${num(i.weightKg)} kg | ${i.value ?? ''} |`);
    md.push('');
  }

  writeFileSync(MD_PATH, md.join('\n'));
  console.log(`[ok] markdown → ${MD_PATH}`);
}

/*
 * registry.js — 功能注册表（全项目声明式核心）。
 *
 * 每个功能 = 一个 op 对象：{ id, cat, name, desc, params, encode?, decode?, run? }。
 * UI 完全由本注册表驱动——左侧分类树、参数表单、双向按钮全自动渲染
 * 加新功能只在此注册一条 + 写算法，UI 零改动。这是声明式驱动相比硬编码 UI 的关键优势。
 *
 * 字段约定：
 * id 全局唯一短标识（英文，用于路由 / 收藏 / URL）
 * cat 分类 id（见 CATEGORIES）
 * name 显示名（中文）
 * desc 一句话说明（中文，可空）
 * params 参数声明数组（见下），无参留空数组
 * encode(text, p) / decode(text, p) 双向；只有一向的只填一个
 * run(text, p) 单向工具（如哈希），填了 run 就不显示双向切换
 * detect(text) 可选，一键解码用的识别指纹，返回 0..1 置信度
 *
 * 参数声明 params 每项：
 * { key, label, type: 'text'|'number'|'select'|'bool', default, options?, placeholder? }
 */

// ---- 分类定义（左侧菜单分组，顺序即显示顺序） ----
export const CATEGORIES = [
  { id: "home",    name: "首页 · 一把梭", icon: "bolt",           pinned: true },
  { id: "base",    name: "Base 系列",     icon: "tag" },
  { id: "text",    name: "文本 / 传输编码", icon: "translate" },
  { id: "fancy",   name: "花式 / CTF 编码", icon: "auto_awesome" },
  { id: "cn",      name: "中文 / 本土编码", icon: "language" },
  { id: "classic", name: "古典密码",       icon: "history_edu" },
  { id: "modern",  name: "现代加密",       icon: "lock" },
  { id: "hash",    name: "哈希 / 校验",    icon: "fingerprint" },
  { id: "radix",   name: "进制 / 字符集",  icon: "calculate" },
  { id: "analysis",name: "分析 / 爆破",    icon: "query_stats" },
  { id: "crypto",  name: "密码攻击",       icon: "vpn_key" },
  { id: "forensic",name: "取证 / 文件",    icon: "travel_explore" },
  { id: "data",    name: "数据结构 / 序列化", icon: "web" },
  { id: "stego",   name: "隐写 / 图像",    icon: "image" },
 // ---- 本地桥·外部 exe 专用分类（requiresBridge，仅 Windows + 起桥可用），按用途细分 ----
  { id: "bridgeLang",     name: "本地桥·语言执行", icon: "terminal" },
  { id: "bridgeStego",    name: "本地桥·隐写嵌入", icon: "visibility_off" },
  { id: "bridgeForensic", name: "本地桥·检测取证", icon: "travel_explore" },
];

// 注册表本体。各算法模块 import register 往里塞。
export const OPS = [];
const _byId = new Map();

// 合法分类 id 集合（cat 校验用）。CATEGORIES 是单一真相源。
const _catIds = new Set(CATEGORIES.map((c) => c.id));

/** 注册一个 op（重复 id 抛错，防覆盖）。 */
export function register(op) {
  if (!op || typeof op.id !== "string" || !op.id) {
    throw new Error(`op 必须有非空字符串 id`);
  }
  if (_byId.has(op.id)) throw new Error(`重复注册 op id: ${op.id}`);
 // cat 合法性校验：不在 CATEGORIES 里的 cat 会导致 op 静默不显示，直接抛错拦住。
  if (!_catIds.has(op.cat)) {
    throw new Error(
      `op ${op.id} 的 cat "${op.cat}" 不在 CATEGORIES 中（合法值：${[..._catIds].join("/")}）`
    );
  }
  if (!op.encode && !op.decode && !op.run) {
    throw new Error(`op ${op.id} 必须至少有 encode / decode / run 之一`);
  }
  op.params = op.params || [];
  _byId.set(op.id, op);
  OPS.push(op);
  return op;
}

export function getOp(id) {
  return _byId.get(id);
}

export function opsByCat(catId) {
  return OPS.filter((o) => o.cat === catId);
}

/** 用参数默认值构造一份初始参数对象。 */
export function defaultParams(op) {
  const p = {};
  for (const d of op.params) p[d.key] = d.default;
  return p;
}

// ============ 插件扩展点（运行时增删，供 pluginHost 用；内置算法不走这些） ============

/**
 * 运行时新增一个分类（插件专用）。内置分类在 CATEGORIES 声明式定义，插件的分类在此动态挂。
 * 已存在同 id 直接返回旧的（幂等），不覆盖内置。
 */
export function addCategory(cat) {
  if (!cat || typeof cat.id !== "string" || !cat.id) {
    throw new Error(`分类必须有非空字符串 id`);
  }
  if (_catIds.has(cat.id)) return CATEGORIES.find((c) => c.id === cat.id);
  const rec = { id: cat.id, name: cat.name || cat.id, icon: cat.icon || "extension" };
  CATEGORIES.push(rec);
  _catIds.add(cat.id);
  return rec;
}

/**
 * 注销一个 op（插件卸载用）。从 OPS 与 _byId 移除。返回是否移除成功。
 * 内置 op 不应调用此函数（无 __plugin 标记的会抛错，防误删内置算法）。
 */
export function unregister(id) {
  const op = _byId.get(id);
  if (!op) return false;
  if (!op.__plugin) throw new Error(`拒绝注销内置 op: ${id}（仅插件 op 可注销）`);
  _byId.delete(id);
  const i = OPS.indexOf(op);
  if (i >= 0) OPS.splice(i, 1);
  return true;
}

/** 是否为插件动态注册的 op（带 __plugin 标记）。 */
export function isPluginOp(id) {
  const op = _byId.get(id);
  return !!(op && op.__plugin);
}

/**
 * 移除一个运行时新增的分类（插件卸载用）。内置分类（前 16 个声明式定义的）不可移除。
 * 返回是否移除成功。
 */
const _builtinCatIds = new Set(CATEGORIES.map((c) => c.id));
export function removeCategory(catId) {
  if (_builtinCatIds.has(catId)) throw new Error(`拒绝移除内置分类: ${catId}`);
  const i = CATEGORIES.findIndex((c) => c.id === catId);
  if (i < 0) return false;
  CATEGORIES.splice(i, 1);
  _catIds.delete(catId);
  return true;
}

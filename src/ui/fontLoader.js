/*
 * fontLoader.js — 天珩全字库按平面主动加载 + 状态查询。
 *
 * fonts.css 里的 @font-face 已让浏览器「按需」拉平面（出现该平面字符才下载）。
 * 本模块补的是「主动预载 + 可视化」：顶栏「字库」面板列出 4 个平面
 * 用户可手动点「加载」把某平面整个拉进来（new FontFace.load）
 * 之后该平面所有字符即刻可显示，无需等首次出现触发。
 *
 * 零外发：全部 url 指向本地 public/fonts/th/*.woff2，绝不挂 CDN。
 *
 * 双层架构（MT8）：
 * - 首屏：fonts.css 只挂 th-ctf-subset.woff2（约 1.5 MB，覆盖全项目用字 + GB2312 + 全部
 * CTF 编码表生僻字），秒开，绝不首屏拖全量。
 * - 后台：页面渲染完后 preloadAllPlanes 空闲时逐个把天珩全量 4 平面 woff2（共约 31 MB）
 * 拉进 document.fonts，补齐子集外的冷僻字。全程本地文件、零外发、不阻塞 UI。
 * - 面板：顶栏「字库」列 4 平面加载状态，用户也可手动点加载/重试。
 * 全量 4 平面已由 ttf 无损转 woff2（brotli），相对原 ttf 砍 64%。
 */

// 平面元数据。unicode-range 与全量 woff2 一一对应；bytes 为 woff2 字节数（面板显示）。
export const FONT_PLANES = [
  {
    id: "p0",
    file: "public/fonts/th/th-p0.woff2",
    range: [0x0000, 0xFFFF],
    label: "平面 0 · BMP",
    labelEn: "Plane 0 · BMP",
    desc: "拉丁/符号/CJK 基本+扩A/谚文/假名（日常主力）",
    descEn: "Latin, symbols, CJK basic+ExtA, Hangul, Kana (daily use)",
    bytes: 5821788,
  },
  {
    id: "p1",
    file: "public/fonts/th/th-p1.woff2",
    range: [0x10000, 0x1FFFF],
    label: "平面 1 · SMP",
    labelEn: "Plane 1 · SMP",
    desc: "古文字/Emoji/数学字母/音乐符号",
    descEn: "Ancient scripts, emoji, math alphanumerics, music",
    bytes: 7873912,
  },
  {
    id: "p2",
    file: "public/fonts/th/th-p2.woff2",
    range: [0x20000, 0x2FFFF],
    label: "平面 2 · SIP",
    labelEn: "Plane 2 · SIP",
    desc: "CJK 扩展 B–F 生僻字大片",
    descEn: "CJK Ext B–F rare characters",
    bytes: 9563000,
  },
  {
    id: "p16",
    file: "public/fonts/th/th-p16.woff2",
    range: [0x30000, 0x10FFFF],
    label: "平面 3+ · TIP",
    labelEn: "Plane 3+ · TIP",
    desc: "CJK 扩展 G/H/I 等最冷僻码位",
    descEn: "CJK Ext G/H/I, most rarely used",
    bytes: 9416000,
  },
];

// 加载状态：id → "idle" | "loading" | "loaded" | "error"
const _status = new Map(FONT_PLANES.map((p) => [p.id, "idle"]));
const _listeners = new Set();

function emit() {
  for (const cb of _listeners) { try { cb(); } catch { /* 单个订阅出错不影响其余 */ } }
}

/** 订阅状态变化（面板重渲染用），返回取消订阅函数。 */
export function onFontStatusChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

/** 取某平面当前加载状态。 */
export function fontStatus(id) {
  return _status.get(id) || "idle";
}

/** 取全部平面状态快照。 */
export function allFontStatus() {
  return FONT_PLANES.map((p) => ({ ...p, status: fontStatus(p.id) }));
}

/**
 * 主动加载一个平面：new FontFace 指向本地 ttf，load 后 document.fonts.add。
 * 加载完成后该平面全部字符即刻可用（不必等首次出现触发按需下载）。
 * 幂等：已 loaded / loading 中直接返回。
 */
export async function loadFontPlane(id) {
  const plane = FONT_PLANES.find((p) => p.id === id);
  if (!plane) return false;
  const cur = _status.get(id);
  if (cur === "loaded" || cur === "loading") return cur === "loaded";

  _status.set(id, "loading");
  emit();
  try {
 // 相对页面根的 url。FontFace 的 family 与 fonts.css @font-face 同名，命中同一族。
    const desc = { style: "normal", weight: "400", display: "swap" };
 // 子集单文件不限码位；若某条目带 range 才设 unicodeRange。
    if (plane.range) desc.unicodeRange = `U+${plane.range[0].toString(16)}-${plane.range[1].toString(16)}`;
    const face = new FontFace("Cheonhyeong", `url("${plane.file}") format("woff2")`, desc);
    await face.load();
    document.fonts.add(face);
    _status.set(id, "loaded");
    emit();
    return true;
  } catch (e) {
    _status.set(id, "error");
    emit();
    return false;
  }
}

/** 人类可读字节数（面板显示 MB）。 */
export function humanSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB";
  return bytes + " B";
}

let _preloadStarted = false;

/**
 * 后台渐进加载全量天珩 4 平面：首屏子集秒开后，趁浏览器空闲逐个把全量 woff2 拉进
 * document.fonts，补齐子集外的冷僻字。串行 + requestIdleCallback，绝不与首屏抢带宽
 * 不阻塞 UI。幂等：只跑一次；已 loaded 的平面自动跳过（loadFontPlane 内部幂等）。
 * 零外发：全是本地文件。
 */
export function preloadAllPlanes() {
  if (_preloadStarted) return;
  _preloadStarted = true;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 0 }), 300));
  const queue = FONT_PLANES.map((p) => p.id);
  const step = () => {
    const id = queue.shift();
    if (!id) return;
 // 加载完（成功或失败）再排下一个，串行避免同时占满连接
    loadFontPlane(id).finally(() => idle(step));
  };
 // 首屏渲染让位：等一次空闲再启动
  idle(step);
}

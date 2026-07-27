/*
 * dynamicColor.js ── M3 动态取色核心
 *
 * ◆ 用途
 * 从单一「种子色」运行时生成一整套 Material 3 tonal 调色板
 * 覆盖 :root 上 primary 一族语义变量与 --red-XX 色阶，实现「换肤 / 强调色」。
 * 浏览器版：预设色板 + 选色器；本地版后续叠系统强调色（不在本模块）。
 *
 * ◆ 零外发
 * 纯本地计算，绝不 fetch / XHR / 任何网络请求。全部色彩变换在内存中完成。
 *
 * ◆ 算法（A 路线：零依赖精简 tonal，非 Google material-color-utilities 等价物）
 * 1. seed hex → HSL，取其 hue（色相）与 saturation（作 chroma 近似基准）。
 * 2. 按 M3 tone 刻度 0/10/20…/100 生成同色相、明度=tone% 的一族色；
 * 饱和度随 tone 向两端（0/100）衰减，贴近 M3「极暗/极亮处近中性」的观感。
 * 3. tone → hex，得 tonalPalette。
 * 4. 按 M3 明暗规则映射到语义变量：
 * 暗色 primary=tone80 / on-primary=tone20 / container=tone30 / on-container=tone90
 * 亮色 primary=tone40 / on-primary=tone100 / container=tone90 / on-container=tone10
 * 注：精简版用 HSL-L 近似 M3 tone（真 tone 基于 CIELAB L*），色相不做 HCT 校正
 * 故与 Google 库存在肉眼可辨的偏差，但对「强调色换肤」够用。
 *
 * ◆ B 路线预留
 * 若将 material-color-utilities 落到 public/vendor/material-color/
 * 可经 setPaletteEngine 注入精确引擎替换 buildTonalPalette，applyAccent 无需改动。
 */

/* ───────────────────────── 色彩工具（纯函数） ───────────────────────── */

/* clamp 到 [lo, hi] */
function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

/* hex(#rgb / #rrggbb) → {r,g,b} 0..255 */
function hexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) {
    throw new Error('非法 hex 颜色: ' + hex);
  }
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/* {r,g,b} 0..255 → #rrggbb（小写） */
function rgbToHex(r, g, b) {
  const to2 = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + to2(r) + to2(g) + to2(b);
}

/* rgb 0..255 → hsl {h:0..360, s:0..1, l:0..1} */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, l };
}

/* hsl {h:0..360, s:0..1, l:0..1} → #rrggbb */
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/* hex → hsl 便捷组合 */
function hexToHsl(hex) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsl(r, g, b);
}

/* ───────────────────────── tonal 生成（A 路线核心） ───────────────────────── */

/* M3 tone 刻度 */
export const TONES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100];

/*
 * 单个 tone 取色：色相恒定，明度=tone%，饱和度随 tone 向两端衰减。
 * factor = 1 - (|tone-50|/50)^1.5 * 0.55
 * → tone50 满饱和，tone0/100 保留约 45%，避免极端处灰死或过艳。
 */
function toneColor(hue, baseSat, tone) {
  const l = tone / 100;
  const dist = Math.abs(tone - 50) / 50;          // 0..1
  const factor = 1 - Math.pow(dist, 1.5) * 0.55;  // 0.45..1
  const s = clamp(baseSat * factor, 0, 1);
  return hslToHex(hue, s, l);
}

/*
 * buildTonalPalette(seedHex) → { 0:'#..', 10:'#..', …, 100:'#..' }
 * 纯函数，无副作用，node 可直接测试。B 路线可用 setPaletteEngine 替换本实现。
 */
export function buildTonalPalette(seedHex) {
  return _engine(seedHex);
}

function _defaultEngine(seedHex) {
  const { h, s } = hexToHsl(seedHex);
 // 饱和度托底：种子太灰时抬到 0.3，保证生成的色阶有辨识度
  const baseSat = clamp(Math.max(s, 0.3), 0, 1);
  const palette = {};
  for (const t of TONES) palette[t] = toneColor(h, baseSat, t);
  return palette;
}

let _engine = _defaultEngine;

/*
 * setPaletteEngine(fn) ── B 路线注入点。
 * fn(seedHex) 须返回同结构 { tone: hex }。传 null 恢复内置精简引擎。
 */
export function setPaletteEngine(fn) {
  _engine = typeof fn === 'function' ? fn : _defaultEngine;
}

/* ───────────────────────── B 路线：HCT 精确引擎 ───────────────────────── */
/*
 * enableHctEngine ── 动态加载 public/vendor/material-color 的 HCT TonalPalette
 * 注入为调色引擎，替换 A 路线 HSL 近似，得到 Google material-color-utilities 等价的
 * 感知均匀 tonal（CIELAB L* + CAM16 色相校正）。懒加载不压首屏；vendor 缺失/加载失败
 * 时静默保留 A 路线精简引擎（降级不报错）。返回是否启用成功。
 *
 * 零外发：vendor 是本地静态文件，import 走同源 /vendor/ 路径，无网络请求。
 */
let _hctReady = null;   // 记住加载结果，避免重复 import
export function enableHctEngine() {
  if (_hctReady) return _hctReady;
  _hctReady = (async () => {
    try {
      const base = new URL("public/vendor/material-color/", document.baseURI).href;
      const [{ TonalPalette }, { argbFromHex, hexFromArgb }] = await Promise.all([
        import(new URL("palettes/tonal_palette.js", base).href),
        import(new URL("utils/string_utils.js", base).href),
      ]);
 // HCT 引擎：种子 hex → argb → TonalPalette，逐 tone 取精确 argb → hex
      setPaletteEngine((seedHex) => {
        const tp = TonalPalette.fromInt(argbFromHex(seedHex));
        const palette = {};
        for (const t of TONES) palette[t] = hexFromArgb(tp.tone(t));
        return palette;
      });
      return true;
    } catch {
      _hctReady = null;   // 允许后续重试
      return false;       // 降级：保留 A 路线
    }
  })();
  return _hctReady;
}

/* ───────────────────────── 语义映射 & DOM 覆盖 ───────────────────────── */

/*
 * 从 tonalPalette 推出 primary 一族语义色（遵循 M3 明暗规则）。
 * 返回 { primary, onPrimary, primaryContainer, onPrimaryContainer }
 */
export function semanticFromPalette(palette, dark) {
  return dark
    ? {
        primary: palette[80],
        onPrimary: palette[20],
        primaryContainer: palette[30],
        onPrimaryContainer: palette[90],
      }
    : {
        primary: palette[40],
        onPrimary: palette[100],
        primaryContainer: palette[90],
        onPrimaryContainer: palette[10],
      };
}

/* theme.css 中存在的 --red-XX 色阶键（覆盖后 var(--red-XX) 引用自动跟随） */
const RED_STOPS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95];

/*
 * theme.css 中性色阶键 --n-XX（键名恰好 = M3 tone 值）。覆盖后 surface / on-surface /
 * outline 一族 var(--n-XX) 引用整体跟随，实现「换种子色 → 整套配色（含背景/卡片）重染」的
 * M3 whole-theme 效果。含浅色 surface 专用档 89/91/92/94。
 */
const NEUTRAL_STOPS = [4, 6, 10, 12, 17, 20, 24, 30, 50, 60, 70, 80, 89, 90, 91, 92, 94, 95, 99];

/*
 * 中性 tint：色相恒定跟随种子，chroma 极低（HSL 饱和度 ≈0.08），明度=tone%。
 * 贴近 M3 Neutral palette 的「几乎中性、仅带一丝主色调 tint」观感——换蓝主题背景带极淡冷调
 * 换砖红背景带极淡暖调，而非死灰。默认路径不调用（保 theme.css 出厂暖砖红中性原样）。
 */
function neutralTint(hue, tone) {
  return hslToHex(hue, 0.08, tone / 100);
}

/* buildNeutralPalette(seedHex) → { 4:'#..', 6:'#..', …, 99:'#..' }，纯函数 */
export function buildNeutralPalette(seedHex) {
  const { h } = hexToHsl(seedHex);
  const palette = {};
  for (const t of NEUTRAL_STOPS) palette[t] = neutralTint(h, t);
  return palette;
}

/*
 * applyAccent(seedHex, { dark }) ── 生成调色板并写内联覆盖到 documentElement。
 * dark 缺省时按 <html data-theme> 判定（非 light 即视为暗色，与 theme.css 默认一致）。
 * 覆盖变量（共 14 个）：
 * 色阶 --red-10..--red-95（10 个）
 * 语义 --primary / --on-primary / --primary-container / --on-primary-container（4 个）
 * 返回本次生成的 tonalPalette，便于调用方回显。
 */
export function applyAccent(seedHex, opts = {}) {
  const root = document.documentElement;
  const dark =
    typeof opts.dark === 'boolean'
      ? opts.dark
      : root.getAttribute('data-theme') !== 'light';

  const palette = buildTonalPalette(seedHex);

 // ▪ 覆盖 --red-XX 色阶（强调色一族）
  for (const t of RED_STOPS) {
    root.style.setProperty('--red-' + t, palette[t]);
  }

 // ▪ 直接覆盖 primary 语义（不依赖 var 链，明暗切换时更稳）
  const sem = semanticFromPalette(palette, dark);
  root.style.setProperty('--primary', sem.primary);
  root.style.setProperty('--on-primary', sem.onPrimary);
  root.style.setProperty('--primary-container', sem.primaryContainer);
  root.style.setProperty('--on-primary-container', sem.onPrimaryContainer);

 // ▪ 覆盖 --n-XX 中性色阶（跟随种子 hue 的极低 chroma tint）→ surface/on-surface/
 // outline 一族 var(--n-XX) 引用整体跟随，实现 M3 whole-theme 重染（含背景/卡片）。
 // 默认路径（未选色/未取到系统色）不调用 applyAccent，theme.css 出厂暖砖红中性原样保留。
  const neutral = buildNeutralPalette(seedHex);
  for (const t of NEUTRAL_STOPS) {
    root.style.setProperty('--n-' + t, neutral[t]);
  }

  return palette;
}

/*
 * resetAccent ── 清除本模块写下的全部内联覆盖，回退 theme.css 默认。
 */
export function resetAccent() {
  const root = document.documentElement;
  for (const t of RED_STOPS) root.style.removeProperty('--red-' + t);
  root.style.removeProperty('--primary');
  root.style.removeProperty('--on-primary');
  root.style.removeProperty('--primary-container');
  root.style.removeProperty('--on-primary-container');
}

/* ───────────────────────── 预设色板 ───────────────────────── */

/*
 * ACCENT_PRESETS ── M3 推荐种子色（含默认砖红）。
 * seed 取各色相中段，经 tonal 生成后即为该色系整套强调色。
 * id 'brick' 为默认，与 theme.css 砖红观感一致。
 */
export const ACCENT_PRESETS = [
  { id: 'brick',  label: '陶土砖红', seed: '#b0503f' },  // 默认，对齐 theme.css
  { id: 'purple', label: '雅致紫',   seed: '#6750a4' },  // M3 baseline
  { id: 'blue',   label: '沉静蓝',   seed: '#0061a4' },
  { id: 'teal',   label: '松石青',   seed: '#00696d' },
  { id: 'green',  label: '苔原绿',   seed: '#3a6a35' },
  { id: 'amber',  label: '琥珀橙',   seed: '#8a5100' },
  { id: 'pink',   label: '绯红粉',   seed: '#a83b62' },
];

export const DEFAULT_ACCENT = ACCENT_PRESETS[0];

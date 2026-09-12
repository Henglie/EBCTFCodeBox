/* spring.js — M3 弹簧动效内核（T510 候选 · 零依赖 · 零外发 · ~150 行）
 * 恒烈CTF编码工具箱 · T510 第一批灰度接入（弹层②+族滑块④，恒烈真机验演示后批准）
 * 总开关：localStorage ebctf.springMotion（'0'=关闭回退 CSS 动画）；原始候选与实测证据在 资料/工程留存/T510/
 *
 * 核心思想（安卓 12+/14 手感核心）：
 *   每个元素的每个属性持有「当前值 + 当前速度」的弹簧状态（WeakMap 持久化）；
 *   新目标到来时不重置状态，从当前位置与当前速度续算（velocity carry）
 *   → 动画中途打断/反向永不跳变、永不重播，天然可连点。
 *
 * API：
 *   HLSpring.to(el, {x, y, scale, opacity}, presetOrOpts) → handle { stop() }
 *       presetOrOpts：字符串（见 PRESETS）或对象
 *       { stiffness, damping } / { stiffness, dampingRatio, mass=1, onRest(el) }
 *       onRest：全部属性到达目标并静止后回调（用于关闭动画后 display:none）。
 *   HLSpring.set(el, {x, y, scale, opacity})   直设状态+样式（初始化/减动效路径）
 *   HLSpring.impulse(el, {x?: Δv, y?: Δv})     注入速度（切页「推入」感、连点蓄能）
 *   HLSpring.stop(el)                          停在当前位置（清速度，保留值）
 *   HLSpring.presets                            参数组（只读引用）
 *
 * 渲染取舍：直接写 style.transform / style.opacity，不用 WAAPI composite:"transform"：
 *   ① velocity carry 需要每帧可读的瞬时速度；WAAPI 不暴露速度，getComputedTiming
 *      只有进度，反推须差分，且主线程节流时 JS 侧值与合成器侧脱钩，打断续接不可靠。
 *   ② rAF 内同步写 style 与采样同帧提交，无双数据源冲突；transform/opacity 均为
 *     合成器属性，配 will-change 后不触发 layout/paint，帧预算内（每元素每帧 2 次样式写）。
 *   ③ WAAPI composite 的价值在于「叠加既有 CSS transform」；本内核独占所控元素的
 *     transform，无叠加需求。
 *
 * 数值积分：半隐式欧拉（symplectic Euler，先速度后位置），游戏/动效库通用；
 *   dt 钳 1/30s —— 标签页切走后回来 dt 巨大时不爆冲（按 33ms 步进续算）。
 * 减动效：html.reduce-motion 存在（main.js 依 localStorage 'ebctf.reduceMotion' 加类）
 *   → to() 立即设终值、清速度，不启动 rAF —— 与现行 T471b 路径同源，无新增状态。
 */
(function (global) {
  "use strict";

  /* 参数组。来源（数值锚点，详见图 接线方案.md §3）：
   *   AndroidX SpringForce 官方常量（developer.android.com/reference/androidx/
   *   dynamicanimation/animation/SpringForce）：STIFFNESS_HIGH=10000 / MEDIUM=1500 /
   *   LOW=200 / VERY_LOW=50；DAMPING_RATIO_HIGH_BOUNCY=0.2 / MEDIUM_BOUNCY=0.5 /
   *   LOW_BOUNCY=0.75 / NO_BOUNCY=1.0。
   *   dur* 组：按 T471c 时长令牌换算（settle≈时长，T≈4/(ζω)，mass=1，ζ=1 无弹）。
   *   M3 网页侧（m3.material.io/styles/motion）2025 expressive 更新引入 spring tokens
   *   但未公开数值常量表 —— 数值以 Android 权威常量 + 时长换算为准，不编造。 */
  var PRESETS = {
    snap:       { stiffness: 1500, dampingRatio: 0.85 }, // Android 中刚度微弹：小位移快捷件
    gentle:     { stiffness: 200,  dampingRatio: 0.80 }, // Android 低刚度：大位移柔和
    dur75:      { stiffness: 2844, damping: 107 },  // ≈ --dur-1 75ms  无弹
    dur150:     { stiffness: 711,  damping: 53 },   // ≈ --dur-2 150ms 无弹
    dur200:     { stiffness: 400,  damping: 40 },   // ≈ --dur-3 200ms 无弹
    dur250:     { stiffness: 256,  damping: 32 },   // ≈ --dur-4 250ms 无弹
    bouncy250:  { stiffness: 455,  damping: 32 },   // 250ms 档 ζ≈0.75（Android LOW_BOUNCY）
    bouncy150:  { stiffness: 1422, damping: 42 }    // 150ms 档 ζ≈0.56（Android MEDIUM_BOUNCY；
                                                   // 因半隐式欧拉数值阻尼 c+k·dt/2，名义值须更弹）
  };

  var PROPS = ["x", "y", "scale", "opacity"];
  var START = { x: 0, y: 0, scale: 1, opacity: 1 };
  var EPS =   { x: 0.1, y: 0.1, scale: 0.001, opacity: 0.001 }; // 位移阈值：px / 无量纲
  var VSTOP = { x: 2, y: 2, scale: 0.02, opacity: 0.02 };       // 速度阈值：单位/秒（收紧避免吞过冲尾段）

  var states = new WeakMap();   // el → 状态（含每属性 {v, t, vel}）
  var running = new Set();      // 有活弹簧的元素
  var rafId = 0, lastT = 0;

  function resolveCfg(o) {
    if (typeof o === "string") o = PRESETS[o] || {};
    else if (o && o.preset) o = Object.assign({}, PRESETS[o.preset] || {}, o);
    else o = o || {};
    var m = o.mass || 1, k = o.stiffness || 256;
    var c = (o.damping != null) ? o.damping
        : 2 * (o.dampingRatio != null ? o.dampingRatio : 1) * Math.sqrt(k * m);
    return { k: k / m, c: c / m, onRest: o.onRest || null }; // 归一到 mass=1
  }

  function mk(v) { return { v: v, t: v, vel: 0 }; }
  function state(el) {
    var st = states.get(el);
    if (!st) {
      st = { cfg: resolveCfg(null) };
      for (var i = 0; i < PROPS.length; i++) st[PROPS[i]] = mk(START[PROPS[i]]);
      states.set(el, st);
    }
    return st;
  }

  function apply(el, st) {
    el.style.transform = "translate(" + rnd(st.x.v) + "px," + rnd(st.y.v) + "px) scale(" +
      st.scale.v.toFixed(4) + ")";
    el.style.opacity = st.opacity.v.toFixed(4);
  }
  function rnd(n) { return Math.round(n * 100) / 100; }

  /* 新目标：只改 t（目标值），v/vel 原样保留 → 打断续接（velocity carry） */
  function to(el, target, presetOrOpts) {
    var st = state(el);
    var cfg = resolveCfg(presetOrOpts);
    st.cfg = cfg;
    if (target) for (var i = 0; i < PROPS.length; i++) {
      var p = PROPS[i];
      if (p in target) st[p].t = target[p];
    }
    if (global.document && document.documentElement.classList.contains("reduce-motion")) {
      set(el, target);                       // 减动效：直切终值
      if (cfg.onRest) cfg.onRest(el);
      return { stop: function () {} };
    }
    running.add(el);
    if (!rafId) { lastT = performance.now(); rafId = requestAnimationFrame(tick); }
    return { stop: function () { stop(el); } };
  }

  /* 直设状态+样式（无动画）：初始化关闭态、减动效路径 */
  function set(el, values) {
    var st = state(el);
    if (values) for (var i = 0; i < PROPS.length; i++) {
      var p = PROPS[i];
      if (p in values) { st[p].v = values[p]; st[p].t = values[p]; st[p].vel = 0; }
    }
    apply(el, st);
    running.delete(el);
  }

  /* 注入速度：切页推入、连点蓄能；不动位置与目标 */
  function impulse(el, deltas) {
    var st = state(el);
    for (var p in deltas) if (p in st) st[p].vel += deltas[p];
    running.add(el);
    if (!rafId) { lastT = performance.now(); rafId = requestAnimationFrame(tick); }
  }

  function stop(el) {
    var st = states.get(el);
    if (!st) return;
    for (var i = 0; i < PROPS.length; i++) st[PROPS[i]].vel = 0; // 停在当前位置
    running.delete(el);
  }

  function tick(now) {
    var dt = Math.min((now - lastT) / 1000, 1 / 30);
    lastT = now;
    var SUB = 2, h = dt / SUB;          // 子步进×2：压低数值阻尼（c_eff≈c+k·h/2），大刚度小过冲不被吃
    running.forEach(function (el) {
      var st = states.get(el);
      if (!st) { running.delete(el); return; }
      var a = st.cfg, alive = false;
      for (var i = 0; i < PROPS.length; i++) {
        var p = st[PROPS[i]];
        for (var s2 = 0; s2 < SUB; s2++) {
          p.vel += (-a.k * (p.v - p.t) - a.c * p.vel) * h; // 半隐式欧拉：先速度
          p.v += p.vel * h;                                 // 后位置（稳定，不发散）
        }
        if (Math.abs(p.v - p.t) < EPS[PROPS[i]] && Math.abs(p.vel) < VSTOP[PROPS[i]]) {
          p.v = p.t; p.vel = 0;                            // 静止吸附终值
        } else alive = true;
      }
      apply(el, st);
      if (!alive) {
        running.delete(el);
        if (a.onRest) { var cb = a.onRest; a.onRest = null; cb(el); }
      }
    });
    if (running.size) rafId = requestAnimationFrame(tick);
    else { rafId = 0; lastT = 0; }
  }

  global.HLSpring = { to: to, set: set, impulse: impulse, stop: stop, presets: PRESETS };
})(typeof window !== "undefined" ? window : globalThis);

// ESM 导出（接线层用；IIFE 全局挂载保留兼容演示页）
export const HLSpring = (typeof window !== "undefined" ? window : globalThis).HLSpring;

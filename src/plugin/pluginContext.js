/*
 * pluginContext.js — 插件运行时上下文（ctx）：插件与主项目之间的唯一契约面。
 *
 * 设计目标（2）：让主项目兼容功能差异与增量，把插件开发难度降到最低——
 * 插件作者只面对一个稳定的 ctx 对象，不直接 import 主项目内部模块，主项目重构不波及插件。
 *
 * 能力边界（低耦合红线）：
 * - 插件通过 ctx 注册 op / 语言 / 一键解码器 / AI 提供方，全部登记在册，卸载时逐一回收。
 * - ctx 由 pluginHost 为每个插件单独构造，带插件 id 前缀校验，防串台。
 * - 纯前端零外发：ctx 不给文件系统/网络原语，网络只走 AI 层用户自备的 fetch（另见 aiClient）。
 */
import { register, unregister, addCategory as registryAddCategory, getOp, OPS } from "../core/registry.js";
import { mergeDict, unmergeDict, getLocale, onLocaleChange } from "../i18n/index.js";

/**
 * 为一个插件构造受控上下文。所有注册动作都记进 record，供 pluginHost 卸载时精确回收。
 * @param {object} manifest 插件清单（已校验）
 * @param {object} record 该插件的注册台账（pluginHost 持有）
 */
export function makeContext(manifest, record) {
  const pid = manifest.id;

 // 插件注册的 op id 必须以 "插件id/" 命名空间开头，防和主项目/别的插件撞 id。
  function nsCheck(opId) {
    if (typeof opId !== "string" || !opId.startsWith(pid + "/")) {
      throw new Error(`插件 ${pid} 的 op id "${opId}" 必须以 "${pid}/" 开头（命名空间隔离）`);
    }
  }

  return {
 /** 插件自身信息（只读快照）。 */
    plugin: Object.freeze({ id: pid, name: manifest.name, version: manifest.version }),

 /**
 * 注册一个算法 op。字段同主项目 registry（id/cat/name/params/encode/decode/run/detect…）
 * 但 id 强制带插件命名空间前缀。注册后自动出现在左侧菜单、搜索、一键解码/穷举。
 */
    registerOp(op) {
      if (!op || typeof op !== "object") throw new Error(`registerOp 需要 op 对象`);
      nsCheck(op.id);
      op.__plugin = pid; // 标记来源，UI 可加"插件"徽章、卸载时识别
      register(op);
      record.ops.push(op.id);
      return op;
    },

 /**
 * 新增一个左侧分类（插件想把自己的 op 单独归类时用）。cat id 也带命名空间。
 */
    addCategory(cat) {
      if (!cat || typeof cat.id !== "string") throw new Error(`addCategory 需要 {id,name}`);
      nsCheck(cat.id);
      registryAddCategory(cat);
      record.cats.push(cat.id);
      return cat;
    },

 /**
 * 注入/覆盖 i18n 文案。dicts 形如 { zh:{key:val}, en:{...}, ja:{...} }。
 * 插件的 op 名 key 约定 `op.<插件命名空间opId>.name`，与主项目一致。
 */
    addMessages(dicts) {
      if (!dicts || typeof dicts !== "object") throw new Error(`addMessages 需要 {locale:{key:val}}`);
      mergeDict(dicts);
      record.msgDicts.push(dicts);
    },

 /**
 * 注册一个"一键解码器"贡献（2：自行增减微调一键解码逻辑）。
 * 因 magic 直接遍历 OPS，只要插件 registerOp 的 op 带 detect+decode 就会自动进入一键解码。
 * 本方法是显式声明入口，便于 UI 在"一键解码贡献"面板列出/开关，不改 magic 内核。
 * @param {{id:string, label:string, when?:(input:string)=>boolean, run:(input:string)=>Promise<any>}} contrib
 */
    registerDecoder(contrib) {
      if (!contrib || typeof contrib.run !== "function") throw new Error(`registerDecoder 需要 {id,run}`);
      const c = { ...contrib, __plugin: pid };
      record.decoders.push(c);
      return c;
    },

 /**
 * 注册一个 AI 提供方（2：接入 AI，自备 key 和站点）。
 * provider 形如 { id, label, endpoint, models, chat(messages,opts) }
 * 由 aiClient 统一调度。key/endpoint 用户在设置里填，插件只声明形状。
 */
    registerAiProvider(provider) {
      if (!provider || typeof provider.id !== "string") throw new Error(`registerAiProvider 需要 {id,label,chat}`);
      const p = { ...provider, __plugin: pid };
      record.aiProviders.push(p);
      return p;
    },

 /** 只读访问主项目当前 op 列表（插件想基于现有 op 组合时用），返回浅拷贝。 */
    listOps() {
      return OPS.map((o) => ({ id: o.id, cat: o.cat, name: o.name }));
    },
    getOp(id) { return getOp(id); },

 /** 当前语言码 + 语言变化订阅（插件 UI 跟随切换）。返回的取消函数会在卸载时自动调用。 */
    getLocale,
    onLocaleChange(cb) {
      const off = onLocaleChange(cb);
      record.disposers.push(off);
      return off;
    },

 /** 受控存储：以插件 id 为前缀的 localStorage 命名空间，插件间互不可见。 */
    storage: {
      get(key) {
        try { return localStorage.getItem(`ebctf_plugin:${pid}:${key}`); } catch { return null; }
      },
      set(key, val) {
        try { localStorage.setItem(`ebctf_plugin:${pid}:${key}`, val); } catch { /* 隐私模式忽略 */ }
      },
      remove(key) {
        try { localStorage.removeItem(`ebctf_plugin:${pid}:${key}`); } catch { /* 忽略 */ }
      },
    },

 /** 提示条（复用主项目 toast，不自造 UI）。 */
    toast(msg) {
      try { window.__ebctfToast?.(String(msg)); } catch { /* 无 UI 环境忽略 */ }
    },

 /** 结构化日志，带插件前缀，便于排障（不外发）。 */
    log(...args) { console.log(`[plugin:${pid}]`, ...args); },
  };
}

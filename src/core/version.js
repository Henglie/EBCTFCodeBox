/*
 * version.js — 项目全局版本号（唯一来源）。
 *
 * 所有需要显示 / 申报版本号的地方（main.js 关于页 + 顶栏、mcpBridge.js server info、
 * index.html 由 main.js 启动时注入）统一从这里 import，避免版本号散落割裂。
 *
 * SW（sw.js）因独立运行环境无法 import 项目模块，CACHE_VER 保持独立常量，
 * 升版本时同步修改此处与 sw.js 即可。
 */
export const APP_VERSION = "0.1.4";

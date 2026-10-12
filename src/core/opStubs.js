/*
 * opStubs.js — 惰载 stub 播种（副作用模块，main.js 静态 import，求值序必须先于 detect 四件套）。
 *
 * 开机把 lazyTables 的全量 op 元数据以 __stub 占位形式按 registerAll 注册序种进 registry，
 * 使列表/搜索/计数在算法文件未加载时即完整且有序；算法文件按需 import 后经 register()
 * 的 stub 升级路径原位替换为真实 op（detect 补丁合并保留）。纯副作用，无导出。
 */
import { CORE_OP_STUBS } from "./lazyTables.generated.js";
import { seedStub } from "./registry.js";

for (const s of CORE_OP_STUBS) {
  seedStub({ id: s.id, cat: s.cat, name: s.name, family: s.family || undefined, familyLabel: s.familyLabel || undefined });
}

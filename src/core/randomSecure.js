/*
 * randomSecure.js — 「增强随机安全」独立 op（件内自注册）。
 *
 * 定位（恒烈批准形态，M676/随机性增强_规划.md §形态）：
 *   既是一个**独立 op**（可在工具列表中找到、可单独使用），又是其他 op 参数区里
 *   【增强随机安全】内嵌组件的后端语义来源。用途：
 *     1. 取一段随机数（hex / base64 两种呈现）；
 *     2. 查看当前档位与随机源状态；
 *     3. 切换档位（system / mixed / custom / server）。
 *
 * 四档语义、取字节实现全部在 `randSource.js`（薄抽象、零 DOM）。本文件只做「编排 + 呈现」：
 *   - 读取当前配置（getRandConfig）→ 报告档位与随机源状态；
 *   - 参数 mode 非 inherit 时调用 setRandConfig 切换档位（切换结果经 randSource 的
 *     变更通知回传 UI，由 UI 负责持久化——本文件**不读也不写 localStorage**，守
 *     「算法层零 UI 依赖」铁律）；
 *   - 调 randomBytes 取字节。
 *
 * 红线：
 *   - core 零 DOM / 零 localStorage；随机配置由 UI/main 层注入内存单例。
 *   - 禁静默降级：取随机失败一律显式呈现（server 档未就绪、无 CSPRNG 等），绝不回落。
 *   - 零外发：system / mixed / custom 三档纯本地；server 档的真实联网取数由联网 server 档单独提供。
 *
 * 契约：register({ id, cat, name, desc, params, run })。run 单向，参数 mode/seed/
 *       endpoint/auth/length/format，输出「状态报告 + 随机数」文本。
 */
import { register } from "./registry.js";
import { randomBytes, setRandConfig, getRandConfig, isServerReady, warmupServer } from "./randSource.js";
import { RAND_SERVER_MAX_BYTES, RAND_SERVER_DEFAULT_BYTES } from "./randServer.js";

/** 档位中文标签（op 输出报告用；op 名称/描述的 i18n 由 M 落 op.randomSecure.* 键）。 */
const MODE_LABEL = {
  system: "系统（crypto.getRandomValues，默认）",
  mixed: "混合增强（用户输入 ‖ 系统熵 → HKDF-SHA-256）",
  custom: "完全自定义（仅用户输入，可复现，风险自担）",
  server: "自配置随机数服务器（未就绪时抛错，禁静默回落）",
};

function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

function bytesToB64(b) {
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin);
}

function clampLen(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 16;
  return Math.max(0, Math.min(4096, Math.trunc(v)));
}

/** 随机源状态一行文字（server 档额外报 endpoint 是否配置 / 池是否就绪）。 */
function sourceStatus(cfg) {
  if (cfg.mode === "server") {
    const ready = isServerReady();
    return "server 档；endpoint=" + (cfg.endpoint ? "已配置" : "未配置") +
      "，预取池=" + (ready ? "已就绪" : "未就绪（取数将抛错；联网取数由 server 档提供）");
  }
  if (cfg.mode === "mixed") return "mixed 档；每次真取 32B 系统熵作 ikm，用户输入作 salt（只增不减）";
  if (cfg.mode === "custom") return "custom 档；完全由用户输入决定（可复现；不触碰系统熵）";
  return "system 档；crypto.getRandomValues 直通（与默认行为逐字节等价）";
}

register({
  id: "randomSecure", cat: "radix", name: "增强随机安全",
  desc: "查看 / 切换随机源档位、查看随机源状态、按指定长度取随机数（hex/base64）",
  params: [
    { key: "mode", label: "档位", type: "select", default: "inherit",
      options: [
        { value: "inherit", label: "跟随全局（不修改）" },
        { value: "system", label: "系统（默认）" },
        { value: "mixed", label: "混合增强" },
        { value: "custom", label: "完全自定义" },
        { value: "server", label: "自配置服务器" },
      ] },
    { key: "seed", label: "用户随机输入", type: "text", default: "", placeholder: "mixed/custom 档的加料/种子" },
    { key: "endpoint", label: "服务器地址", type: "text", default: "", placeholder: "server 档 endpoint（如 http://…）" },
    { key: "auth", label: "鉴权头", type: "text", default: "", placeholder: "server 档可选鉴权（如 Bearer …）" },
    { key: "length", label: "字节数", type: "number", default: 16, placeholder: "0..4096 字节" },
    { key: "format", label: "输出格式", type: "select", default: "hex",
      options: [
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
      ] },
  ],
  run: async (_text, p) => {
    const req = (p && p.mode) || "inherit";
    // 显式档位 → 切换全局配置（inherit = 不改动，仅查看）。
    if (req !== "inherit") {
      setRandConfig({ mode: req, seed: p && p.seed, endpoint: p && p.endpoint, auth: p && p.auth });
    }
    const cfg = getRandConfig();
    const len = clampLen(p && p.length);
    const fmt = (p && p.format) === "base64" ? "base64" : "hex";

    const lines = [
      "当前档位：" + cfg.mode + " —— " + (MODE_LABEL[cfg.mode] || "未知档位"),
      "随机源状态：" + sourceStatus(cfg),
      "请求：" + len + " 字节 · 输出格式 " + fmt,
      req === "inherit" ? "本次未修改档位（mode=inherit，仅查看）" : "已切换档位 → " + cfg.mode,
    ];

    let out;
    try {
      if (req !== "inherit" && cfg.mode === "server") {
        // op 参数显式选了 server 档——本 op 的 setRandConfig 已使预取池失效，
        // 先取数一次填池（用户在本 op 参数中自填 endpoint 即为主动配置的联网），
        // 再同步消费；失败显式抛错（底层原因如实呈现），绝不回落。
        // mode=inherit 时不在此取数：UI 运行前钩子（main.js convert）已取一次，避免重复请求。
        await warmupServer({ count: Math.max(1, Math.min(RAND_SERVER_MAX_BYTES, len || RAND_SERVER_DEFAULT_BYTES)) });
      }
      out = randomBytes(len);
    } catch (e) {
      // 禁静默降级：取不到随机数 → 明确呈现底层原因（不回落、不返回弱随机）。
      return lines.join("\n") + "\n\n✗ 取随机数失败：" + ((e && e.message) || String(e));
    }
    const body = fmt === "base64" ? bytesToB64(out) : bytesToHex(out);
    return lines.join("\n") + "\n\n" + body;
  },
});

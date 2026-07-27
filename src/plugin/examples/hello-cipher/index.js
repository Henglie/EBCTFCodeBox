/*
 * hello-cipher — 参考插件（活样板）。
 *
 * 目的：向插件作者示范 ctx 的全部能力，照抄改名即可做自己的插件。
 * 本插件不依赖主项目任何内部模块，只用 setup(ctx) 收到的受控 ctx。
 *
 * 演示内容：
 * 1. registerOp —— 注册一个自定义"语言/编码"op（凯撒偏移 7 的趣味变体 + detect）。
 * 2. addCategory —— 把它归到插件自己的分类。
 * 3. addMessages —— 补 zh/en/ja 三语文案（含新语言 ja，验证 i18n 可扩语言）。
 * 4. registerDecoder—— 声明一个一键解码贡献（因 op 带 detect 已自动进 magic，这里做显式登记）。
 * 5. registerAiProvider —— 声明一个 AI 提供方形状（OpenAI 兼容，key/endpoint 用户填）。
 *
 * 插件契约：export const manifest + export default setup(ctx)。
 */

export const manifest = {
  id: "hello-cipher",              // 命名空间前缀：本插件所有 op/cat id 都要以 "hello-cipher/" 开头
  name: "Hello Cipher 示例插件",
  version: "1.0.0",
  description: "参考插件：演示注册算法 / 分类 / 多语言 / 一键解码贡献 / AI 提供方。",
  author: "EBCTFCodeBox",
  apiVersion: 1,
};

// ---- 纯算法：一个简单的可逆编码（凯撒偏移 7，只处理 ASCII 字母），演示自造"语言" ----
const SHIFT = 7;
function shiftChar(code, by) {
  if (code >= 65 && code <= 90) return ((code - 65 + by + 26) % 26) + 65;  // A-Z
  if (code >= 97 && code <= 122) return ((code - 97 + by + 26) % 26) + 97; // a-z
  return code;
}
function helloEncode(text) {
  let out = "";
  for (const ch of String(text)) out += String.fromCharCode(shiftChar(ch.charCodeAt(0), SHIFT));
  return out;
}
function helloDecode(text) {
  let out = "";
  for (const ch of String(text)) out += String.fromCharCode(shiftChar(ch.charCodeAt(0), -SHIFT));
  return out;
}
// detect：偏移 7 后 "flag" 会变成 "smhn"，这里用一个弱指纹演示——纯字母且解出含 flag/ctf 才给分。
function helloDetect(text) {
  if (!/^[A-Za-z\s]+$/.test(text) || text.length < 4) return 0;
  const dec = helloDecode(text);
  return /flag|ctf|key/i.test(dec) ? 0.6 : 0.05;
}

export default function setup(ctx) {
 // 1) 自己的分类（可选；也可直接用主项目现成 cat，如 "fancy"）
  ctx.addCategory({ id: "hello-cipher/cat", name: "示例插件", icon: "extension" });

 // 2) 注册 op —— id 必须带命名空间前缀
  ctx.registerOp({
    id: "hello-cipher/shift7",
    cat: "hello-cipher/cat",
    name: "Hello 偏移7",             // 会被 addMessages 的 op.<id>.name 覆盖为可切换的双语
    desc: "字母表凯撒偏移 7 的趣味编码（参考插件演示）",
    params: [],
    encode: (text) => helloEncode(text),
    decode: (text) => helloDecode(text),
    detect: helloDetect,
  });

 // 3) 多语言文案（含新语言 ja，证明 i18n 运行时可扩语言）
  ctx.addMessages({
    zh: { "op.hello-cipher/shift7.name": "Hello 偏移7", "cat.hello-cipher/cat": "示例插件" },
    en: { "op.hello-cipher/shift7.name": "Hello Shift-7", "cat.hello-cipher/cat": "Example Plugin" },
    ja: { "op.hello-cipher/shift7.name": "Hello シフト7", "cat.hello-cipher/cat": "サンプルプラグイン" },
  });

 // 4) 一键解码贡献（显式登记，便于 UI 在"一键解码贡献"面板开关；op 带 detect 已自动进 magic）
  ctx.registerDecoder({
    id: "hello-cipher/shift7-decoder",
    label: "Hello 偏移7 反解",
    when: (input) => /^[A-Za-z\s]+$/.test(input),
    run: async (input) => helloDecode(input),
  });

 // 5) AI 提供方形状（OpenAI 兼容；key/endpoint 由用户在 AI 设置里填，插件只声明形状）
  ctx.registerAiProvider({
    id: "hello-cipher/openai-compatible",
    label: "OpenAI 兼容（示例声明）",
    endpoint: "https://api.openai.com/v1/chat/completions",
    models: ["gpt-4o-mini", "gpt-4o"],
 // 真正的 chat 由 aiClient 用用户填的 key 发起；这里仅声明默认模型/端点。
  });

  ctx.log("hello-cipher 已激活：op / 分类 / 三语 / 解码贡献 / AI 提供方 全部登记");
}

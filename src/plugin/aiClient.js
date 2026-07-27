/*
 * aiClient.js — AI 接入层（接入 AI，数据给 AI 分析，AI 也能操作软件，自备 key 和站点）。
 *
 * 定位（零外发红线的边界）：
 * - 本项目其余部分零外发。AI 是唯一对外网络出口，且必须"用户自备"——
 * 用户在设置里填自己的 endpoint + apiKey，请求直连用户指定站点，本项目服务器不中转、不记录。
 * - 默认关闭。不填 key 就没有任何网络请求。key 只存本地 localStorage，不上传任何地方。
 *
 * 两种能力：
 * 1. 分析（chat）：把当前输入/解码结果作为上下文发给 AI，让它帮判断编码类型 / 找 flag 思路。
 * 2. 操作（tools）：以"函数调用"形式暴露工具箱能力给 AI（列分类 / 列 op / 查参数 / 识别 / 跑 op / 一键解码）
 * AI 返回要调用的工具 + 参数，本层在本地执行后把结果回灌——AI 操作软件，动作全在本地。
 *
 * 提供方：内置一个 OpenAI 兼容 provider（大多数自托管/中转站点都兼容 /v1/chat/completions）
 * 插件可通过 ctx.registerAiProvider 注册更多形状。
 */
import { MCP_TOOLS, callMcpTool } from "./mcpBridge.js";
import { allAiProviders } from "./pluginHost.js";

const STORE = "ebctf_ai_config"; // { providerId, endpoint, apiKey, model }

/** 读取用户本地 AI 配置（不存在返回空壳，全部字段空 = 未配置 = 不发请求）。 */
export function getAiConfig() {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return JSON.parse(raw);
  } catch { /* 忽略 */ }
  return { providerId: "openai-compat", endpoint: "", apiKey: "", model: "" };
}

/** 保存 AI 配置到本地（仅本地，绝不外发）。 */
export function setAiConfig(cfg) {
  try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch { /* 隐私模式忽略 */ }
}

/** 是否已配置可用（endpoint + apiKey 都填了）。未配置时 UI 灰置、绝不发请求。 */
export function isAiReady() {
  const c = getAiConfig();
  return !!(c.endpoint && c.apiKey);
}

// ---------- 内置 OpenAI 兼容 provider ----------

const OPENAI_COMPAT = {
  id: "openai-compat",
  label: "OpenAI 兼容 (/v1/chat/completions)",
 /**
 * @param {Array<{role:string,content:string}>} messages
 * @param {{model?:string, tools?:any[], signal?:AbortSignal, temperature?:number}} opts
 */
  async chat(messages, opts = {}) {
    const cfg = getAiConfig();
    if (!cfg.endpoint || !cfg.apiKey) throw new Error("未配置 AI endpoint / apiKey");
    const url = cfg.endpoint.replace(/\/+$/, "") + "/v1/chat/completions";
    const body = {
      model: opts.model || cfg.model || "gpt-4o-mini",
      messages,
      temperature: opts.temperature ?? 0.2,
    };
    if (opts.tools && opts.tools.length) {
      body.tools = opts.tools;
      body.tool_choice = "auto";
    }
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`AI 请求失败 ${resp.status}：${errText.slice(0, 200)}`);
    }
    const data = await resp.json();
    return data.choices && data.choices[0] ? data.choices[0].message : null;
  },
};

/** 全部可用 provider = 内置 + 插件注册的。 */
export function listProviders() {
  return [OPENAI_COMPAT, ...allAiProviders()];
}

function getProvider(id) {
  return listProviders().find((p) => p.id === id) || OPENAI_COMPAT;
}

// ---------- AI 可调用的工具（AI 操作软件的能力面，全部本地执行） ----------

/**
 * 暴露给 AI 的工具集（OpenAI function-calling 形状），从 MCP 单一事实源派生。
 * MCP 的 inputSchema 就是 function-calling 的 parameters，两者同为 JSON Schema。
 * AI 只能通过这些工具操作工具箱，每个工具都在本地执行、结果回灌，拿不到网络/文件系统等原语。
 */
export const AI_TOOLS = MCP_TOOLS.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.inputSchema },
}));

/** 在本地执行 AI 请求的工具调用，转发给 MCP 后把 content 拍平成字符串回灌给 AI。 */
export async function execAiTool(name, args) {
  const result = await callMcpTool(name, args || {});
  return result.content?.[0]?.text ?? "";
}

/**
 * 一轮"AI 操作软件"对话：发消息 → 若 AI 要调工具则本地执行并回灌 → 直到 AI 给出最终文本。
 * @param {Array} messages 对话历史（含 system/user）
 * @param {{model?:string, maxToolRounds?:number, signal?:AbortSignal, onStep?:(info:object)=>void}} opts
 * @returns {Promise<{content:string, messages:Array}>}
 */
export async function chatWithTools(messages, opts = {}) {
  const provider = getProvider(getAiConfig().providerId);
  const maxRounds = opts.maxToolRounds ?? 5;
  const convo = [...messages];
  for (let round = 0; round < maxRounds; round++) {
    const msg = await provider.chat(convo, { model: opts.model, tools: AI_TOOLS, signal: opts.signal });
    if (!msg) break;
    convo.push(msg);
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      return { content: msg.content || "", messages: convo };
    }
 // 本地执行每个工具调用，把结果回灌
    for (const call of calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* 参数非法当空 */ }
      opts.onStep?.({ tool: call.function.name, args });
      const result = await execAiTool(call.function.name, args);
      convo.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
 // 达到工具轮次上限仍未收敛：返回最后一条有内容的助手消息
  const last = [...convo].reverse().find((m) => m.role === "assistant" && m.content);
  return { content: last ? last.content : "（AI 未返回最终结果）", messages: convo };
}

/** 纯分析（不给工具）：把上下文发给 AI 要一段解读。 */
export async function analyzeWithAi(userText, contextText, opts = {}) {
  const provider = getProvider(getAiConfig().providerId);
  const messages = [
    { role: "system", content: "你是 CTF 编解码助手。根据用户提供的数据，判断可能的编码/加密类型，并给出下一步解题思路。简洁中文回答。" },
    { role: "user", content: `${userText}\n\n---数据---\n${contextText}` },
  ];
  const msg = await provider.chat(messages, { model: opts.model, signal: opts.signal });
  return msg ? (msg.content || "") : "";
}

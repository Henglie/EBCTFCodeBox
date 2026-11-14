// Isolated HTTP worker adapter: dispatch shared algorithms under a fixed local policy.
import { callMcpTool as dispatch } from "./ebctf-core-adapter.mjs";
import { prepareHttpToolArgs, validateToolCall } from "./http-policy.mjs";

// No request can opt HTTP into bridge execution or an outbound fetch.
globalThis.fetch = async () => { throw new Error("Network access is disabled in the HTTP MCP worker"); };

export async function callMcpTool(name, args, opts) {
  validateToolCall({ name, arguments: args });
  const safe = await prepareHttpToolArgs(name, args, process.env.EBCTF_MCP_WORKSPACE);
  return dispatch(name, safe, opts);
}

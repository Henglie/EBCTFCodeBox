/*
 * license.js — 授权信息读取与验签（纯前端，Web Crypto）。
 *
 * 启动时 fetch 项目根的 license.bin，用内嵌公钥验签（ECDSA P-256 / SHA-256）。
 * 验签通过 → 返回授权信息（来源自 / 授权给），关于页据此显示。
 * 无 bin 或验签失败 → 视为「开源自编译」，返回默认：来源 = GitHub 源码，授权给 = 无。
 *
 * bin 格式（JWT 式，两段 base64url 以 "." 连接）：
 *   base64url(JSON.stringify(payload)) + "." + base64url(signature)
 * payload = { v, source, licensedTo, issuedAt, note, ext }
 *   ext：授权附带的可选展示元数据（对象，缺省无）。仅在 bin 中声明，签名保护，不可篡改。
 *
 * 私钥只在 授权/ 目录的签发工具里（不上传 git），任何人无私钥都伪造不出通过验签的 bin。
 * 公钥公开无妨——只能验签不能签发。
 */

// 内嵌公钥（SPKI DER，base64）。对应 授权/private_key.pem 的私钥。
const PUBLIC_KEY_B64 =
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEkOkYdb4i7EAZ1KukarDW12eqfLQf1S18MlgIqVp7H7jqOJdZotjIigSMYPDtvSJdYdydRwfpFXXJ273987Ke3w==";

const LICENSE_URL = "license.bin";

// 无 bin / 验签失败时的默认授权信息。ext 缺省为 null（无附带展示元数据）。
export const OPENSOURCE_LICENSE = {
  verified: false,
  source: "opensource",
  licensedTo: null,
  ext: null,
};

function b64ToBytes(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function b64urlToBytes(s) {
  // base64url → base64（补 padding）
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return b64ToBytes(b64);
}

async function importPubKey() {
  const der = b64ToBytes(PUBLIC_KEY_B64);
  return crypto.subtle.importKey(
    "spki",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

/**
 * 读取并验签 license.bin。
 * @returns {Promise<{verified:boolean, source:string, licensedTo:string|null, issuedAt?:string, note?:string}>}
 *   验签通过返回 bin 里的授权信息（verified:true）；无 bin / 失败返回 OPENSOURCE_LICENSE。
 */
export async function loadLicense() {
  try {
    const res = await fetch(LICENSE_URL, { cache: "no-store" });
    if (!res.ok) return OPENSOURCE_LICENSE;
    const text = (await res.text()).trim();
    const dot = text.indexOf(".");
    if (dot < 0) return OPENSOURCE_LICENSE;

    const payloadB64 = text.slice(0, dot);
    const sigB64 = text.slice(dot + 1);
 // 签发端（sign.mjs / 授权 index.html）对 payload JSON 原文字节签名，
 // 故验签 data 必须是 base64url 解码回的 payload 字节，与签发端保持一致。
    const payloadBytes = b64urlToBytes(payloadB64);
    const sigBytes = b64urlToBytes(sigB64);

    const key = await importPubKey();
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sigBytes,
      payloadBytes,
    );
    if (!ok) return OPENSOURCE_LICENSE;

    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    // ext：授权可选展示元数据，原样透传（未声明则为 null）。
    const ext = payload.ext && typeof payload.ext === "object" ? payload.ext : null;
    return {
      verified: true,
      source: payload.source || "authorized",
      licensedTo: payload.licensedTo || null,
      issuedAt: payload.issuedAt || null,
      note: payload.note || null,
      ext,
    };
  } catch {
    // fetch 失败（无 bin）、解析失败、Web Crypto 不可用 → 一律回落开源自编译
    return OPENSOURCE_LICENSE;
  }
}

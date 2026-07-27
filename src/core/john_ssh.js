/*
 * john_ssh.js — SSH 私钥 → John hash 串提取（T292，cat:'analysis'，单向 run）。
 *
 * 用途：CTF 取证里拿到加密 SSH 私钥，想用 John the Ripper 离线爆破密码。
 * 本 op 只提取 hash 串（不爆破），输出可直接喂给 john 的 $sshng$ 格式。
 *
 * 支持的私钥格式（照 john 官方 src/ssh2john.py + ssh_fmt_plug.c）：
 * 1. OpenSSH 新格式（BEGIN OPENSSH PRIVATE KEY）
 * - base64 解码后以 "openssh-key-v1\0" magic 开头
 * - cipher: none / aes256-cbc / aes256-ctr
 * - kdf: none / bcrypt（salt 16 字节 + rounds uint32 BE）
 * - 加密时输出: $sshng$cipher_id$salt_len$salt_hex$data_len$data_hex$rounds$ct_offset
 * · aes256-cbc → cipher_id=2
 * · aes256-ctr → cipher_id=6
 * - 未加密（cipher=none）：报告无需爆破
 *
 * 2. PEM 传统格式（BEGIN RSA / DSA / EC PRIVATE KEY）
 * - ASN.1 DER 编码的 base64 体
 * - 加密时有 Proc-Type: 4,ENCRYPTED 头 + DEK-Info: <cipher>,<iv_hex> 头
 * - 加密时输出: $sshng$cipher_id$iv_len$iv_hex$data_len$data_hex
 * · 3DES(DES-EDE3-CBC) → cipher_id=0
 * · AES-128-CBC (RSA/DSA) → cipher_id=1
 * · AES-256-CBC (OpenSSH cbc) → cipher_id=2
 * · AES-128-CBC (EC) → cipher_id=3
 * · AES-192-CBC (RSA/DSA) → cipher_id=4
 * · AES-256-CBC (RSA/DSA/EC) → cipher_id=5
 * · DES-CBC (keysize=8,iv=8) → cipher_id=6
 * · AES-256-CTR (OpenSSH ctr) → cipher_id=6（带 rounds+ct_offset）
 * - 未加密（无 Proc-Type）：报告无需爆破
 *
 * 红线：只建本文件，件内自注册，不碰任何现有文件。零外发纯 JS 计算。
 * 只提取 hash 串，绝不爆破密码。
 */
import { register } from "./registry.js";

// ============================================================
// 通用工具
// ============================================================

/** 大端 uint32 读取（SSH 字符串长度、rounds 等都是 BE） */
function u32be(b, i) {
  return ((b[i] * 0x1000000) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

/** 字节数组 → hex 字符串（可带起止） */
function toHex(bytes, start, end) {
  let s = "";
  const e = end == null ? bytes.length : end;
  const st = start || 0;
  for (let i = st; i < e; i++) {
    const b = bytes[i];
    s += (b < 16 ? "0" : "") + b.toString(16);
  }
  return s;
}

/** base64 字符串 → Uint8Array（容忍换行/空白） */
function b64ToBytes(s) {
  let str = String(s).replace(/[^A-Za-z0-9+/=]/g, "");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** UTF-8 字节串编/解码（cipher/kdf 名称是 ASCII） */
const te = new TextEncoder();
const td = new TextDecoder();

/** SSH string：4 字节 BE 长度 + 数据；返回 {data, next} */
function readSshString(b, offset) {
  if (offset + 4 > b.length) return { data: new Uint8Array(0), next: offset, err: "short" };
  const len = u32be(b, offset);
  const start = offset + 4;
  const end = start + len;
  if (end > b.length) return { data: b.slice(start, b.length), next: b.length, err: "short" };
  return { data: b.slice(start, end), next: end, err: null };
}

/** 字节数组拼接 */
function concatBytes(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// ============================================================
// PEM 解析（识别 BEGIN/END、提取 headers、base64 解码 body）
// ============================================================

const PEM_BEGIN_RE = /-----BEGIN\s+(RSA|DSA|OPENSSH|EC)\s+PRIVATE\s+KEY-----/;
const PEM_END_RE   = /-----END\s+(RSA|DSA|OPENSSH|EC)\s+PRIVATE\s+KEY-----/;

/**
 * 解析 PEM 文本，返回 { tag, ktype, headers, data } 或 { error }。
 * tag: "RSA" | "DSA" | "OPENSSH" | "EC"
 * ktype: 0=RSA, 1=DSA, 2=OPENSSH, 3=EC
 * headers: { "proc-type": "4,ENCRYPTED", "dek-info": "AES-128-CBC,xxxx...", ... }
 * data: base64 解码后的二进制（OpenSSH 新格式含 magic；传统 PEM 是 DER）
 */
function parsePem(text) {
  const raw = String(text);
  const beginMatch = raw.match(PEM_BEGIN_RE);
  if (!beginMatch) return { error: "未识别到 SSH 私钥（缺少 BEGIN xxx PRIVATE KEY 标记）" };
  const tag = beginMatch[1];
  const ktype = tag === "RSA" ? 0 : tag === "DSA" ? 1 : tag === "OPENSSH" ? 2 : 3;

  const beginIdx = beginMatch.index;
  const afterBegin = beginIdx + beginMatch[0].length;
  const endMatch = raw.slice(afterBegin).match(PEM_END_RE);
  if (!endMatch) return { error: `找到 BEGIN ${tag} PRIVATE KEY 但缺少 END 标记` };

  const inner = raw.slice(afterBegin, afterBegin + endMatch.index);

 // 解析 headers：在 base64 body 之前的 "Key: Value" 行
 // 空行后即 base64 body（参考 ssh2john.py read_private_key）
 // 注意：inner 是 BEGIN 标记之后到 END 标记之前的内容，通常以 \n 开头
 // 故先跳过前导空行，再按 "Key: Value" 解析头，遇到空行或非头行即切到 body。
  const headers = {};
  const lines = inner.split(/\r?\n/);
  let bodyStart = 0;
  let i = 0;
 // 跳过前导空行（BEGIN 标记后的换行）
  while (i < lines.length && !lines[i].trim()) i++;
 // 解析 headers
  for (; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) { bodyStart = i + 1; break; } // 空行 = headers 结束
    const ci = trimmed.indexOf(": ");
    if (ci > 0) {
      headers[trimmed.slice(0, ci).toLowerCase()] = trimmed.slice(ci + 2).trim();
      bodyStart = i + 1;
    } else {
 // 不是 header 也不是空行 → 视为 body 起始
      bodyStart = i;
      break;
    }
  }
  const bodyText = lines.slice(bodyStart).join("").replace(/\s+/g, "");
  if (!bodyText) return { error: "PEM body 为空" };

  let data;
  try {
    data = b64ToBytes(bodyText);
  } catch (e) {
    return { error: "PEM body base64 解码失败: " + (e && e.message ? e.message : String(e)) };
  }
  return { tag, ktype, headers, data };
}

// ============================================================
// OpenSSH 新格式解析（"openssh-key-v1\0" magic + SSH 结构）
// ============================================================

const AUTH_MAGIC = "openssh-key-v1"; // 15 字节，后跟 0x00

/**
 * 解析 OpenSSH 新格式二进制（PEM body 解码后）。
 * 返回 { cipherName, kdfName, salt, rounds, numKeys, ciphertextBeginOffset, isEncrypted } 或 { error }。
 *
 * 二进制结构（照 ssh2john.py / sshkey_private_to_blob2 in sshkey.c）：
 * "openssh-key-v1\0" 14 + 1 = 15 字节（AUTH_MAGIC 14 字节 + null 终止符）
 * string ciphername ("none" / "aes256-cbc" / "aes256-ctr")
 * string kdfname ("none" / "bcrypt")
 * string kdfoptions (bcrypt: uint32 salt_len + salt + uint32 rounds)
 * uint32 number_of_keys (通常 1)
 * string pubkey_blob
 * string encrypted_private_keys_blob
 * ↑ ciphertext_begin_offset 指向 encrypted_private_keys_blob 内部数据起点（跳过其 4 字节长度字段）
 */
function parseOpenSshNewFormat(data) {
  const magicBytes = te.encode(AUTH_MAGIC);
  if (data.length < magicBytes.length + 1) return { error: "数据过短，无法容纳 AUTH_MAGIC" };
  for (let i = 0; i < magicBytes.length; i++) {
    if (data[i] !== magicBytes[i]) return { error: "Missing AUTH_MAGIC（不是 openssh-key-v1）" };
  }
  if (data[magicBytes.length] !== 0x00) return { error: "AUTH_MAGIC 后缺少 0x00 终止符" };

  let offset = magicBytes.length + 1;

 // ciphername
  const cipher = readSshString(data, offset);
  if (cipher.err) return { error: "解析 ciphername 时数据过短" };
  const cipherName = td.decode(cipher.data);
  offset = cipher.next;

 // kdfname
  const kdf = readSshString(data, offset);
  if (kdf.err) return { error: "解析 kdfname 时数据过短" };
  const kdfName = td.decode(kdf.data);
  offset = kdf.next;

 // kdfoptions
  const kdfOpts = readSshString(data, offset);
  if (kdfOpts.err) return { error: "解析 kdfoptions 时数据过短" };
  offset = kdfOpts.next;

 // 从 kdfoptions 提取 salt + rounds（bcrypt）
  let salt = new Uint8Array(0);
  let rounds = 0;
  if (kdfName === "bcrypt" && kdfOpts.data.length >= 4) {
    const saltLen = u32be(kdfOpts.data, 0);
    const saltEnd = 4 + saltLen;
    if (saltEnd + 4 <= kdfOpts.data.length) {
      salt = kdfOpts.data.slice(4, saltEnd);
      rounds = u32be(kdfOpts.data, saltEnd);
    } else if (saltEnd <= kdfOpts.data.length) {
 // salt 有但 rounds 缺失
      salt = kdfOpts.data.slice(4, saltEnd);
    }
  }

 // number_of_keys
  if (offset + 4 > data.length) return { error: "解析 number_of_keys 时数据过短" };
  const numKeys = u32be(data, offset);
  offset += 4;

 // pubkey blob（string）
  const pubkey = readSshString(data, offset);
  if (pubkey.err) return { error: "解析 pubkey 时数据过短" };
  offset = pubkey.next;

 // encrypted_private_keys_blob：4 字节长度 + 实际密文
  if (offset + 4 > data.length) return { error: "解析 encrypted blob 长度时数据过短" };
 // const encBlobLen = u32be(data, offset); // 不需要，john 输出的是 offset 不是长度
  offset += 4; // 跳过长度字段，此时 offset 即 ciphertext_begin_offset
  const ciphertextBeginOffset = offset;

  return {
    cipherName,
    kdfName,
    salt,
    rounds,
    numKeys,
    ciphertextBeginOffset,
    isEncrypted: cipherName !== "none",
  };
}

// ============================================================
// 传统 PEM 加密参数（DEK-Info）
// ============================================================

// 照 ssh2john.py CIPHER_TABLE
const CIPHER_TABLE = {
  "AES-128-CBC":   { keysize: 16, blocksize: 16 },
  "DES-EDE3-CBC":  { keysize: 24, blocksize: 8  },
  "AES-256-CBC":   { keysize: 32, blocksize: 16 },
  "AES-192-CBC":   { keysize: 24, blocksize: 16 },
  "AES-256-CTR":   { keysize: 32, blocksize: 16 },
  "DES-CBC":       { keysize: 8,  blocksize: 8  },
};

/**
 * 据 keysize / encryptionType / ktype 推断 john cipher_id（照 ssh2john.py 分支顺序）。
 * 返回 -1 表示不支持。
 */
function cipherIdFor(keysize, encryptionType, ktype) {
  if (keysize === 24 && encryptionType === "AES-192-CBC" && (ktype === 0 || ktype === 1)) return 4;
  if (keysize === 32 && encryptionType === "AES-256-CBC" && (ktype === 0 || ktype === 1 || ktype === 3)) return 5;
  if (keysize === 24) return 0; // 3DES
  if (keysize === 8 && encryptionType === "DES-CBC") return 6;
  if (keysize === 16 && (ktype === 0 || ktype === 1)) return 1; // AES-128 RSA/DSA
  if (keysize === 16 && ktype === 3) return 3; // AES-128 EC
  if (keysize === 32 && encryptionType === "AES-256-CBC" && ktype === 2) return 2;
  if (keysize === 32 && encryptionType === "AES-256-CTR" && ktype === 2) return 6;
  return -1;
}

// ============================================================
// 主提取函数：返回结构化结果，供 run 与测试使用
// ============================================================

/**
 * 从 SSH 私钥文本提取 john $sshng$ hash 串。
 * @param {string} text PEM 格式私钥文本
 * @returns {object} { keyType, encrypted, hash?, ... } 或 { error }
 */
function extractSshHash(text) {
  if (!text || !String(text).trim()) return { error: "（空输入）" };

  const pem = parsePem(text);
  if (pem.error) return { error: pem.error };

  const { tag, ktype, headers, data } = pem;

 // ---- OpenSSH 新格式 ----
  if (ktype === 2) {
    const parsed = parseOpenSshNewFormat(data);
    if (parsed.error) return { error: parsed.error };

    if (!parsed.isEncrypted) {
      return {
        keyType: "OpenSSH 新格式",
        tag,
        encrypted: false,
        cipher: "none",
        kdf: parsed.kdfName,
        message: "私钥未加密（cipher=none），无需爆破",
      };
    }

 // 加密：只支持 aes256-cbc / aes256-ctr（照 ssh2john.py）
    let encryptionType = "";
    if (parsed.cipherName === "aes256-cbc") encryptionType = "AES-256-CBC";
    else if (parsed.cipherName === "aes256-ctr") encryptionType = "AES-256-CTR";
    else return { error: `OpenSSH 新格式不支持的 cipher: ${parsed.cipherName}` };

    const cipherId = encryptionType === "AES-256-CBC" ? 2 : 6;
    const saltHex = toHex(parsed.salt);
    const saltLen = parsed.salt.length;
    const dataHex = toHex(data);
    const dataLen = data.length;
    const rounds = parsed.rounds;
    const ctOffset = parsed.ciphertextBeginOffset;

    const hash = `$sshng$${cipherId}$${saltLen}$${saltHex}$${dataLen}$${dataHex}$${rounds}$${ctOffset}`;

    return {
      keyType: "OpenSSH 新格式",
      tag,
      encrypted: true,
      cipher: encryptionType,
      kdf: parsed.kdfName,
      salt: saltHex,
      saltLen,
      rounds,
      ciphertextOffset: ctOffset,
      dataLen,
      hash,
    };
  }

 // ---- 传统 PEM（RSA/DSA/EC）----
  if (ktype === 0 || ktype === 1 || ktype === 3) {
    if (!headers["proc-type"]) {
      return {
        keyType: `${tag} 传统 PEM`,
        tag,
        encrypted: false,
        message: "私钥未加密（无 Proc-Type 头），无需爆破",
      };
    }
    const dekInfo = headers["dek-info"];
    if (!dekInfo) return { error: "加密私钥缺少 DEK-Info 头" };

    const commaIdx = dekInfo.indexOf(",");
    if (commaIdx < 0) return { error: "DEK-Info 格式错误（应为 Cipher,IV_HEX）" };
    const encryptionType = dekInfo.slice(0, commaIdx);
    const ivHex = dekInfo.slice(commaIdx + 1).trim().toLowerCase();

    const cipher = CIPHER_TABLE[encryptionType];
    if (!cipher) return { error: `不支持的加密类型: ${encryptionType}` };
    if (!/^[0-9a-f]+$/.test(ivHex) || ivHex.length % 2 !== 0) {
      return { error: `DEK-Info IV 非法: ${ivHex}` };
    }

    const cipherId = cipherIdFor(cipher.keysize, encryptionType, ktype);
    if (cipherId < 0) return { error: `无法确定 cipher_id (${encryptionType}, ktype=${ktype})` };

    const ivLen = ivHex.length / 2;
    const dataHex = toHex(data);
    const dataLen = data.length;

    const hash = `$sshng$${cipherId}$${ivLen}$${ivHex}$${dataLen}$${dataHex}`;

    return {
      keyType: `${tag} 传统 PEM`,
      tag,
      encrypted: true,
      cipher: encryptionType,
      iv: ivHex,
      ivLen,
      dataLen,
      hash,
    };
  }

  return { error: `不支持的私钥类型: ${tag}` };
}

// ============================================================
// op run 函数
// ============================================================

/**
 * op run：提取 SSH 私钥 hash 串。
 * @param {string} text 输入私钥文本（PEM）
 * @param {object} p （保留参数，当前无选项）
 */
function sshkey2johnRun(text, p = {}) {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：SSH 私钥（PEM）是 ASCII 文本
 // 把真字节按 latin1 还原成文本再交给 PEM 解析；无 rawBytes 时文本路径不受影响。
  let input = text;
  if (p && p.rawBytes && p.rawBytes.length) {
    const rb = p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes);
    let s = "";
    for (let i = 0; i < rb.length; i++) s += String.fromCharCode(rb[i]);
    input = s;
  }
  const result = extractSshHash(input);

  if (result.error) return result.error;

  const lines = [];
  lines.push("=== SSH 私钥哈希提取（ssh2john 格式）===");
  lines.push(`私钥类型: ${result.keyType}`);

  if (!result.encrypted) {
    lines.push(`状态: ${result.message}`);
    lines.push("");
    lines.push("--- 说明 ---");
    lines.push("未加密私钥无需爆破，可直接 ssh-keygen 读取或转格式使用。");
    return lines.join("\n");
  }

  lines.push(`状态: 已加密`);
  lines.push(`加密算法: ${result.cipher}`);
  if (result.kdf) lines.push(`KDF: ${result.kdf}`);
  if (result.salt) lines.push(`Salt: ${result.salt}（${result.saltLen} 字节）`);
  if (result.rounds !== undefined) lines.push(`Rounds: ${result.rounds}`);
  if (result.iv) lines.push(`IV: ${result.iv}（${result.ivLen} 字节）`);
  if (result.ciphertextOffset !== undefined) lines.push(`密文偏移: ${result.ciphertextOffset}`);
  lines.push(`数据长度: ${result.dataLen} 字节`);
  lines.push("");
  lines.push("--- John 格式 hash ---");
 // 前缀 "sshkey:" 是 john 期望的 label（可作文件名），用户可自行改名
  lines.push(`sshkey:${result.hash}`);
  lines.push("");
  lines.push("--- 使用方法 ---");
  lines.push("john --wordlist=wordlist.txt hash.txt");
  lines.push("hashcat -m 22421 hash.txt wordlist.txt   (OpenSSH 新格式 bcrypt+AES-256-CBC)");
  lines.push("hashcat -m 22422 hash.txt wordlist.txt   (OpenSSH 新格式 bcrypt+AES-256-CTR)");
  lines.push("");
  lines.push("注: $sshng$ 格式由 ssh2john.py 定义，字段以 $ 分隔:");
  lines.push("  OpenSSH 新格式: $sshng$cipher_id$salt_len$salt_hex$data_len$data_hex$rounds$ct_offset");
  lines.push("  传统 PEM 加密: $sshng$cipher_id$iv_len$iv_hex$data_len$data_hex");
  lines.push("  cipher_id: 0=3DES 1=AES-128-CBC(RSA/DSA) 2=AES-256-CBC(OpenSSH) 3=AES-128-CBC(EC)");
  lines.push("             4=AES-192-CBC 5=AES-256-CBC(RSA/DSA/EC) 6=AES-256-CTR(OpenSSH)/DES");
  return lines.join("\n");
}

// ============================================================
// 注册 op
// ============================================================
register({
  id: "sshkey2john",
  cat: "forensic",
  name: "SSH 私钥哈希提取（sshkey2john）",
  desc: "从 SSH 私钥（OpenSSH 新格式 / PEM 传统 RSA/DSA/EC）提取 John $sshng$ 格式 hash 串（只提取不爆破）。OpenSSH 加密用 bcrypt+AES-256；PEM 用 DEK-Info 指定的 cipher+IV。输出可直接喂 john/hashcat 离线爆破",
  params: [],
  run: sshkey2johnRun,
  acceptsBytes: true,
});

// 导出纯函数供测试
export {
  sshkey2johnRun,
  extractSshHash,
  parsePem,
  parseOpenSshNewFormat,
  cipherIdFor,
  CIPHER_TABLE,
  readSshString,
  u32be,
  toHex,
  b64ToBytes,
  concatBytes,
};

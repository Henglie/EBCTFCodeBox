/*
 * rsaKeyCheck.js — RSA 公钥参数的合法性/弱密钥检查（单一源）。
 *
 * 背景：e=1、e 为偶数、e=3、模数过短在 CTF 题里是常见「弱密钥」信号；
 * 而 e=1/偶数在数学上根本不该进入验签（e=1 时任何签名都会「验证通过」）。
 * 这里只做参数层检查，不做因子分解或信任链验证。
 */

/** 返回弱/非法公钥提示（人话）；空数组表示未发现参数层问题。 */
export function rsaKeyWarnings(n, e) {
  const w = [];
  const be = typeof e === "bigint" ? e : null;
  if (be != null) {
    if (be < 3n) w.push(`公钥指数 e=${be} 不合法：RSA 要求 e ≥ 3（e=1 会让任意签名都「验证通过」）`);
    else if ((be & 1n) === 0n) w.push(`公钥指数 e=${be} 为偶数：RSA 公钥指数必须为奇数`);
    else if (be === 3n) w.push("公钥指数 e=3：验签本身可用，但广播/低指数攻击（Coppersmith）常针对 e=3，注意不要复用同一明文");
    else if (be < 65537n) w.push(`公钥指数 e=${be} 偏小（常见取 65537）；若为题目参数请留意小指数攻击`);
  }
  const bn = typeof n === "bigint" ? n : null;
  if (bn && bn > 0n) {
    const bits = bn.toString(2).length;
    if (bits < 2048) w.push(`模数仅 ${bits} bit（现代最低要求 2048 bit；CTF 小模数可尝试分解）`);
  }
  return w;
}

/** e 不可用于验签/参数计算时抛错（e 必须 ≥3 且为奇数）。 */
export function assertUsableRsaExponent(e, label = "公钥指数 e") {
  const be = typeof e === "bigint" ? e : BigInt(String(e));
  if (be < 3n) throw new Error(`${label}=${be} 不合法：RSA 要求 e ≥ 3 且为奇数（e=1 会让任意签名通过）`);
  if ((be & 1n) === 0n) throw new Error(`${label}=${be} 不合法：RSA 公钥指数必须为奇数`);
  return be;
}

/** n 不可用于 RSA 运算时抛错（n 必须 >3 且为奇数；偶数 n 不可能是两个奇素数之积）。 */
export function assertUsableRsaModulus(n, label = "模数 n") {
  let bn;
  try {
    bn = typeof n === "bigint" ? n : BigInt(String(n));
  } catch {
    throw new Error(`${label} 不是合法整数`);
  }
  if (bn <= 3n) throw new Error(`${label}=${bn} 不合法：RSA 模数必须 > 3`);
  if ((bn & 1n) === 0n) throw new Error(`${label}=${bn} 为偶数：RSA 模数必须是奇数（n=p·q，p/q 为奇素数）`);
  return bn;
}

/** 校验 RSA 公钥 (n,e) 并返回弱密钥提示；明显无效参数直接抛错。 */
export function assertUsableRsaPublicKey(n, e) {
  const bn = assertUsableRsaModulus(n);
  const be = assertUsableRsaExponent(e);
  if (be >= bn) throw new Error(`公钥指数 e=${be} 须小于模数 n=${bn}`);
  return { n: bn, e: be, warnings: rsaKeyWarnings(bn, be) };
}

export default { rsaKeyWarnings, assertUsableRsaExponent, assertUsableRsaModulus, assertUsableRsaPublicKey };

(() => {
  "use strict";
  const api = globalThis.EBCryptoLicense, images = globalThis.EBCryptoLicenseImages;
  const $ = id => document.getElementById(id);
  let generation = 0;
  function clear() { generation++; $("details").textContent = $("payload").textContent = ""; $("branding").replaceChildren(); $("status").textContent = "待验证"; }
  async function keyChanged() {
    clear(); const started = generation, publicKey = $("public-key").value.trim() || api.PUBLIC_KEY_B64;
    $("key-kind").textContent = $("public-key").value.trim() ? "当前信任锚：用户提供（不代表恒烈官方公钥）" : "当前信任锚：内置公钥";
    $("fingerprint").textContent = "";
    try {
      await api.importPublicKey(publicKey); const value = await api.fingerprint(publicKey);
      if (started === generation) $("fingerprint").textContent = value;
    } catch { if (started === generation) $("fingerprint").textContent = "公钥格式错误：需要 ECDSA P-256 SPKI"; }
  }
  $("public-key").addEventListener("input", keyChanged);
  $("license-file").addEventListener("change", clear);
  $("key-file").addEventListener("change", async e => {
    clear(); const started = generation, file = e.target.files[0]; if (!file) return;
    if (file.size > 4096) { $("status").textContent = "公钥文件超限"; return; }
    const value = await file.text(); if (started !== generation) return;
    $("public-key").value = value; keyChanged();
  });
  $("verify").onclick = async () => {
    clear(); const started = generation, file = $("license-file").files[0];
    const publicKey = $("public-key").value.trim() || api.PUBLIC_KEY_B64;
    if (!file) { $("status").textContent = "请选择 license.bin"; return; }
    $("verify").disabled = true;
    try {
      if (file.size > api.LIMITS.binBytes) throw new Error("BIN_BUDGET");
      const raw = new Uint8Array(await file.arrayBuffer());
      const result = await api.verifyLicense(new TextDecoder("utf-8", { fatal: true }).decode(raw), { publicKey });
      const binSha256 = await api.sha256(raw);
      if (started !== generation) return;
      $("status").textContent = "签名有效（当前信任公钥；未检查撤销或现实身份）";
      $("details").textContent = `算法：ECDSA P-256 / SHA-256；IEEE-P1363\n公钥 SPKI SHA256：${result.fingerprint}\n文件 SHA256：${binSha256}\n已签原文 SHA256：${result.payloadSha256}`;
      $("payload").textContent = JSON.stringify(result.payload, null, 2);
      const brand = api.resolveBranding({ ...result.payload, verified: true });
      const heading = document.createElement("p"); heading.textContent = brand.appName || "内置软件名（授权未覆盖）"; $("branding").append(heading);
      for (const [url, kind] of [[brand.appIcon?.dataUrl, "icon"], [brand.ext?.img, "feed"]]) {
        if (!url) continue;
        try {
          const { image } = await images.decodeRaster(url, kind);
          if (started !== generation) return;
          image.alt = kind === "icon" ? "已签软件图标" : brand.ext.imgCap; image.className = kind === "icon" ? "app-icon" : "";
          $("branding").append(image);
        } catch (error) { brand.warnings.push(`${kind}:${error.message}`); }
      }
      if (started === generation && brand.warnings.length) $("details").textContent += `\n展示已回退：${brand.warnings.join("；")}`;
    } catch (error) { if (started === generation) { $("status").textContent = `验证失败：${error.message}`; $("details").textContent = $("payload").textContent = ""; $("branding").replaceChildren(); } }
    finally { $("verify").disabled = false; }
  };
  keyChanged();
})();

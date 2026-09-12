import { t } from "../i18n/index.js";
import { ensureExpStyles } from "./expandableInput.js";
import { icon } from "./icons.js";

export function downloadBytes(bytes, filename, mime) {
  const blob = new Blob([bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download.bin";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fmtByteSize(n) {
  if (!Number.isFinite(n)) return "?";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(2) + " MB";
}

export function isCloudDeploy() {
  try {
    return location.protocol !== "file:" && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(location.hostname) && !location.hostname.endsWith(".localhost");
  } catch { return false; }
}

export function cloudWarnGate(downloadFn) {
  let off = false;
  try { off = localStorage.getItem("ebctfCloudWarnOff") === "1"; } catch { /* Session-only environment. */ }
  if (!isCloudDeploy() || off) { downloadFn(); return; }
  ensureExpStyles();
  const focus = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className = "exp-overlay";
  overlay.innerHTML = '<div class="exp-dialog cloud-warn-dialog" role="dialog" aria-modal="true"><div class="exp-head"><div class="exp-title"></div></div><div class="exp-view exp-view-text"></div><label class="cloud-warn-setting"><span class="switch"><input type="checkbox"><span class="track"></span><span class="knob"></span></span><span class="cloud-warn-label"></span></label><div class="cloud-warn-actions"><button type="button" class="act-btn" data-cancel></button><button type="button" class="act-btn primary" data-download></button></div></div>';
  overlay.querySelector(".exp-title").textContent = t("ui.cloudWarn.title");
  overlay.querySelector("[role=dialog]").setAttribute("aria-label", t("ui.cloudWarn.title"));
  overlay.querySelector(".exp-view").textContent = t("ui.cloudWarn.body");
  overlay.querySelector(".cloud-warn-label").textContent = t("ui.cloudWarn.dontAsk");
  const cancel = overlay.querySelector("[data-cancel]");
  const accept = overlay.querySelector("[data-download]");
  cancel.textContent = t("ui.cloudWarn.cancel");
  accept.textContent = t("ui.cloudWarn.continue");
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    overlay.classList.add("exp-closing");
    setTimeout(() => { overlay.remove(); if (focus?.isConnected) focus.focus(); }, 175);
  }
  function onKey(e) {
    if ([...document.querySelectorAll(".exp-overlay")].at(-1) !== overlay) return;
    if (e.key === "Escape") { e.preventDefault(); close(); }
    if (e.key === "Tab") {
      const first = overlay.querySelector("button,input");
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); accept.focus(); }
      else if (!e.shiftKey && document.activeElement === accept) { e.preventDefault(); first.focus(); }
    }
  }
  cancel.onclick = close;
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "exp-close";
  closeButton.setAttribute("aria-label", t("ui.expand.cancel"));
  closeButton.innerHTML = '<span class="msym">' + icon("close") + '</span>';
  closeButton.onclick = close;
  overlay.querySelector(".exp-head").append(closeButton);
  accept.onclick = () => {
    if (closed) return;
    if (overlay.querySelector("input").checked) {
      try { localStorage.setItem("ebctfCloudWarnOff", "1"); } catch { /* Keep warning next time. */ }
    }
    close();
    downloadFn();
  };
  overlay.addEventListener("mousedown", e => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  cancel.focus();
}

import { t } from "../i18n/index.js";
import { icon } from "./icons.js";

// One compact live region per workbench; output data is never announced wholesale.
export function createOpFeedback(output, runButton, { getInputIdentity = null } = {}) {
  const element = document.createElement("div");
  element.className = "op-feedback";
  const glyph = document.createElement("span");
  glyph.className = "msym";
  glyph.setAttribute("aria-hidden", "true");
  const message = document.createElement("span");
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.setAttribute("aria-atomic", "true");
  const elapsed = document.createElement("span");
  elapsed.className = "op-feedback-time";
  elapsed.setAttribute("aria-hidden", "true");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "op-feedback-cancel";
  cancel.textContent = t("ui.workbench.cancel");
  let timer = 0, indicatorTimer = 0, started = 0, onCancel = null, cancelRequested = false;
  let inputIdentity;
  const matchesInput = () => getInputIdentity && inputIdentity !== undefined && inputIdentity === getInputIdentity();
  cancel.addEventListener("click", () => { if (onCancel) { cancelRequested = true; onCancel(); } });
  element.append(glyph, message, elapsed, cancel);
  const symbols = { idle: "info", pending: "edit", stale: "edit", running: "sync", success: "check", error: "error", cancelled: "close", restored: "history" };
  function set(state, options = {}) {
    clearInterval(timer); timer = 0;
    clearTimeout(indicatorTimer); indicatorTimer = 0;
    delete element.dataset.immediate;
    const wasRunning = element.dataset.state === "running";
    const focusedCancel = document.activeElement === cancel;
    element.dataset.state = state;
    if (['running', 'success', 'restored'].includes(state)) inputIdentity = getInputIdentity?.();
    if (state === 'stale') output.setAttribute('data-result-stale', 'true');
    else output.removeAttribute('data-result-stale');
    glyph.innerHTML = icon(symbols[state] || "info");
    message.textContent = t(`ui.workbench.${state}`);
    output.setAttribute("aria-busy", String(state === "running"));
    output.setAttribute("aria-invalid", String(state === "error"));
    runButton.disabled = state === "running";
    runButton.classList.toggle("pending-run", state === "pending" || state === 'stale');
    onCancel = state === "running" ? options.cancel : null;
    cancel.hidden = !onCancel;
    elapsed.textContent = "";
    if (state === "running") {
      element.dataset.immediate = 'true';
      indicatorTimer = setTimeout(() => { delete element.dataset.immediate; indicatorTimer = 0; }, 200);
      started = performance.now();
      const tick = () => { elapsed.textContent = `${((performance.now() - started) / 1000).toFixed(1)} s`; };
      tick(); timer = setInterval(tick, 100);
    } else if (state === "success" && wasRunning) {
      elapsed.textContent = `${((performance.now() - started) / 1000).toFixed(2)} s`;
    }
    if ((focusedCancel || cancelRequested) && cancel.hidden && runButton.isConnected) runButton.focus({ preventScroll: true });
    cancelRequested = false;
  }
  set("idle");
  return { element, set,
    matchesInput,
    markStale() { if (!matchesInput() && output.value && ['success', 'restored', 'stale'].includes(element.dataset.state)) set('stale'); },
    dispose() { clearInterval(timer); clearTimeout(indicatorTimer); onCancel = null; } };
}
